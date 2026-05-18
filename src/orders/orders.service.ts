import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { Stock, StockDocument } from '../stocks/schemas/stock.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Wallet, WalletDocument } from '../wallets/schemas/wallet.schema';
import { CloseMarketSellOrderDto } from './dto/close-market-sell-order.dto';
import { PlaceMarketBuyOrderDto } from './dto/place-market-buy-order.dto';
import {
  BuyOrder,
  BuyOrderDocument,
  BuyOrderStatus,
} from './schemas/buy-order.schema';
import {
  SellOrder,
  SellOrderDocument,
  SellOrderStatus,
} from './schemas/sell-order.schema';

const DEFAULT_PORTFOLIO_SUMMARY_TTL_SECONDS = 60;

type LeanStock = Stock & { _id: Types.ObjectId };
type LeanBuyOrder = BuyOrder & { _id: Types.ObjectId };

interface PortfolioSummaryPosition {
  stockId: string;
  ticker?: string;
  companyName?: string;
  numberOfShares: number;
  averageCostPerShare: number;
  totalCost: number;
  currentPrice?: number;
  marketValue?: number;
  unrealizedGainLoss?: number;
}

export interface PortfolioSummary {
  userId: string;
  positions: PortfolioSummaryPosition[];
  totals: {
    shares: number;
    cost: number;
    marketValue: number;
    unrealizedGainLoss: number;
  };
  cachedAt: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectConnection()
    private readonly connection: Connection,

    @InjectModel(Stock.name)
    private readonly stockModel: Model<StockDocument>,

    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,

    @InjectModel(BuyOrder.name)
    private readonly buyOrderModel: Model<BuyOrderDocument>,

    @InjectModel(SellOrder.name)
    private readonly sellOrderModel: Model<SellOrderDocument>,

    private readonly redisService: RedisService,

    private readonly mailService: MailService,
  ) {}

  async placeMarketBuyOrder(userId: string, dto: PlaceMarketBuyOrderDto) {
    const userObjectId = this.toObjectId(userId, 'Invalid user id');
    const stockObjectId = this.toObjectId(dto.stockId, 'Invalid stock id');

    if (dto.numberOfShares <= 0) {
      throw new BadRequestException('Number of shares must be greater than 0');
    }

    const session = await this.connection.startSession();

    try {
      let order: BuyOrderDocument | undefined;
      let tradeConfirmation:
        | {
            ticker: string;
            numberOfShares: number;
            pricePerShare: number;
            totalAmount: number;
          }
        | undefined;

      await session.withTransaction(async () => {
        await this.assertActiveMemberForTrading(userObjectId, session);

        const stock = await this.stockModel
          .findOne({
            _id: stockObjectId,
            isListed: true,
          })
          .session(session)
          .lean<LeanStock>();

        if (!stock) {
          throw new NotFoundException('Stock not found or not listed');
        }

        const costPerShare = stock.currentPrice;
        const totalCost = costPerShare * dto.numberOfShares;
        tradeConfirmation = {
          ticker: stock.ticker,
          numberOfShares: dto.numberOfShares,
          pricePerShare: costPerShare,
          totalAmount: totalCost,
        };

        const stockUpdate = await this.stockModel.collection.updateOne(
          {
            _id: stockObjectId,
            isListed: true,
            availableShares: { $gte: dto.numberOfShares },
          },
          {
            $inc: {
              availableShares: -dto.numberOfShares,
            },
          },
          { session },
        );

        if (stockUpdate.modifiedCount !== 1) {
          throw new BadRequestException('Insufficient available shares');
        }

        const walletUpdate = await this.walletModel.collection.updateOne(
          {
            userId: userObjectId,
            balance: { $gte: totalCost },
          },
          {
            $inc: {
              balance: -totalCost,
            },
          },
          { session },
        );

        if (walletUpdate.modifiedCount !== 1) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        [order] = await this.buyOrderModel.create(
          [
            {
              stock_id: stockObjectId,
              user_id: userObjectId,
              numberOfShares: dto.numberOfShares,
              availableShares: dto.numberOfShares,
              costPerShare,
              totalCost,
              status: BuyOrderStatus.Filled,
            },
          ],
          { session },
        );
      });

      await this.evictPortfolioSummary(userId);
      await this.sendTradeConfirmationEmail(
        userObjectId,
        'buy',
        tradeConfirmation,
      );

      return {
        message: 'Buy order filled',
        order,
      };
    } finally {
      await session.endSession();
    }
  }

  async closeMarketSellOrder(userId: string, dto: CloseMarketSellOrderDto) {
    const userObjectId = this.toObjectId(userId, 'Invalid user id');
    const buyOrderId = dto.buyOrderId ?? dto.orderId;

    if (!buyOrderId) {
      throw new BadRequestException('Buy order id is required');
    }

    const orderObjectId = this.toObjectId(buyOrderId, 'Invalid buy order id');

    if (dto.numberOfShares !== undefined && dto.numberOfShares <= 0) {
      throw new BadRequestException('Number of shares must be greater than 0');
    }

    const session = await this.connection.startSession();

    try {
      let sellOrder: SellOrderDocument | undefined;
      let tradeConfirmation:
        | {
            ticker: string;
            numberOfShares: number;
            pricePerShare: number;
            totalAmount: number;
          }
        | undefined;

      await session.withTransaction(async () => {
        await this.assertActiveMemberForTrading(userObjectId, session);

        const buyOrder = await this.buyOrderModel
          .findOne({
            _id: orderObjectId,
            user_id: userObjectId,
            availableShares: { $gt: 0 },
          })
          .session(session)
          .lean<LeanBuyOrder>();

        if (!buyOrder) {
          throw new NotFoundException('Open order not found');
        }

        const sharesToSell = dto.numberOfShares ?? buyOrder.availableShares;

        if (sharesToSell > buyOrder.availableShares) {
          throw new BadRequestException(
            'Sell shares cannot exceed buy order available shares',
          );
        }

        const stock = await this.stockModel
          .findOne({
            _id: buyOrder.stock_id,
          })
          .session(session)
          .lean<LeanStock>();

        if (!stock) {
          throw new NotFoundException('Stock not found');
        }

        const closedAt = new Date();
        const purchasePricePerShare = buyOrder.costPerShare;
        const sellPricePerShare = stock.currentPrice;
        const costBasis = purchasePricePerShare * sharesToSell;
        const proceeds = sellPricePerShare * sharesToSell;
        const profitLoss = proceeds - costBasis;
        const isFullClose = sharesToSell === buyOrder.availableShares;
        tradeConfirmation = {
          ticker: stock.ticker,
          numberOfShares: sharesToSell,
          pricePerShare: sellPricePerShare,
          totalAmount: proceeds,
        };

        const buyOrderUpdate = await this.buyOrderModel.collection.updateOne(
          {
            _id: buyOrder._id,
            user_id: userObjectId,
            availableShares: { $gte: sharesToSell },
          },
          isFullClose
            ? {
                $set: {
                  availableShares: 0,
                  closedAt,
                },
              }
            : {
                $inc: {
                  availableShares: -sharesToSell,
                },
              },
          { session },
        );

        if (buyOrderUpdate.modifiedCount !== 1) {
          throw new BadRequestException('Unable to close open order');
        }

        await this.stockModel.collection.updateOne(
          {
            _id: buyOrder.stock_id,
          },
          {
            $inc: {
              availableShares: sharesToSell,
            },
          },
          { session },
        );

        const walletUpdate = await this.walletModel.collection.updateOne(
          {
            userId: userObjectId,
          },
          {
            $inc: {
              balance: proceeds,
            },
          },
          { session },
        );

        if (walletUpdate.modifiedCount !== 1) {
          throw new NotFoundException('Wallet not found');
        }

        [sellOrder] = await this.sellOrderModel.create(
          [
            {
              user_id: userObjectId,
              stock_id: buyOrder.stock_id,
              buy_order_id: orderObjectId,
              numberOfShares: sharesToSell,
              purchasePricePerShare,
              sellPricePerShare,
              costBasis,
              proceeds,
              profitLoss,
              status: SellOrderStatus.Filled,
              soldAt: closedAt,
            },
          ],
          { session },
        );
      });

      await this.evictPortfolioSummary(userId);
      await this.sendTradeConfirmationEmail(
        userObjectId,
        'sell',
        tradeConfirmation,
      );
      const portfolioSummary = await this.getPortfolioSummary(userId);

      return {
        message: 'Sell order closed',
        sellOrder,
        portfolioSummary,
      };
    } finally {
      await session.endSession();
    }
  }

  async getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
    const cacheKey = this.getPortfolioSummaryCacheKey(userId);
    const cachedSummary = await this.redisService.get(cacheKey);

    if (this.isPortfolioSummary(cachedSummary)) {
      return cachedSummary;
    }

    const userObjectId = this.toObjectId(userId, 'Invalid user id');

    const buyOrders = await this.buyOrderModel
      .find({
        user_id: userObjectId,
        availableShares: { $gt: 0 },
      })
      .populate<{
        stock_id: Pick<
          LeanStock,
          '_id' | 'ticker' | 'companyName' | 'currentPrice'
        >;
      }>('stock_id', 'ticker companyName currentPrice')
      .lean();

    const byStock = new Map<string, PortfolioSummaryPosition>();

    for (const order of buyOrders) {
      const stock =
        order.stock_id && typeof order.stock_id === 'object'
          ? order.stock_id
          : undefined;
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const stockId = stock?._id?.toString() ?? String(order.stock_id);
      const current = byStock.get(stockId);
      const currentPrice = stock?.currentPrice;
      const totalCost = order.costPerShare * order.availableShares;

      if (!current) {
        byStock.set(stockId, {
          stockId,
          ticker: stock?.ticker,
          companyName: stock?.companyName,
          numberOfShares: order.availableShares,
          averageCostPerShare: order.costPerShare,
          totalCost,
          currentPrice,
        });
        continue;
      }

      current.numberOfShares += order.availableShares;
      current.totalCost += totalCost;
      current.averageCostPerShare = current.totalCost / current.numberOfShares;
      current.currentPrice = current.currentPrice ?? currentPrice;
    }

    const summaryPositions = Array.from(byStock.values()).map((position) => {
      const marketValue =
        typeof position.currentPrice === 'number'
          ? position.currentPrice * position.numberOfShares
          : undefined;
      const unrealizedGainLoss =
        typeof marketValue === 'number'
          ? marketValue - position.totalCost
          : undefined;

      return {
        ...position,
        marketValue,
        unrealizedGainLoss,
      };
    });

    const summary: PortfolioSummary = {
      userId,
      positions: summaryPositions,
      totals: {
        shares: summaryPositions.reduce(
          (total, position) => total + position.numberOfShares,
          0,
        ),
        cost: summaryPositions.reduce(
          (total, position) => total + position.totalCost,
          0,
        ),
        marketValue: summaryPositions.reduce(
          (total, position) => total + (position.marketValue ?? 0),
          0,
        ),
        unrealizedGainLoss: summaryPositions.reduce(
          (total, position) => total + (position.unrealizedGainLoss ?? 0),
          0,
        ),
      },
      cachedAt: new Date().toISOString(),
    };

    await this.redisService.set(
      cacheKey,
      summary,
      this.getPortfolioSummaryTtlSeconds(),
    );

    return summary;
  }

  private async evictPortfolioSummary(userId: string): Promise<void> {
    try {
      await this.redisService.delete(this.getPortfolioSummaryCacheKey(userId));
    } catch (error) {
      this.logger.error(
        `Failed to evict portfolio summary cache for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async sendTradeConfirmationEmail(
    userObjectId: Types.ObjectId,
    side: 'buy' | 'sell',
    trade:
      | {
          ticker: string;
          numberOfShares: number;
          pricePerShare: number;
          totalAmount: number;
        }
      | undefined,
  ): Promise<void> {
    if (!trade) {
      return;
    }

    try {
      const user = await this.userModel
        .findById(userObjectId)
        .select('email')
        .lean<Pick<User, 'email'> | null>();

      if (!user?.email) {
        this.logger.warn(
          `Trade confirmation skipped because user ${userObjectId.toString()} has no email`,
        );
        return;
      }

      await this.mailService.sendTradeConfirmation(
        user.email,
        side,
        trade.ticker,
        trade.numberOfShares,
        trade.pricePerShare,
        trade.totalAmount,
      );
    } catch (error) {
      this.logger.error(
        'Failed to send trade confirmation email',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private getPortfolioSummaryCacheKey(userId: string): string {
    return `portfolio-summary:${userId}`;
  }

  private getPortfolioSummaryTtlSeconds(): number {
    const value = Number(process.env.PORTFOLIO_SUMMARY_CACHE_TTL_SECONDS);

    return Number.isInteger(value) && value > 0
      ? value
      : DEFAULT_PORTFOLIO_SUMMARY_TTL_SECONDS;
  }

  private async assertActiveMemberForTrading(
    userObjectId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const activeUserUpdate = await this.userModel.collection.updateOne(
      {
        _id: userObjectId,
        isActive: true,
      },
      {
        $currentDate: {
          lastTradingActivityAt: true,
        },
      },
      { session },
    );

    if (activeUserUpdate.matchedCount !== 1) {
      throw new UnauthorizedException('Account is inactive');
    }
  }

  private toObjectId(value: string, errorMessage: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(errorMessage);
    }

    return new Types.ObjectId(value);
  }

  private isPortfolioSummary(value: unknown): value is PortfolioSummary {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const summary = value as Partial<PortfolioSummary>;

    return (
      typeof summary.userId === 'string' &&
      Array.isArray(summary.positions) &&
      typeof summary.totals === 'object' &&
      typeof summary.cachedAt === 'string'
    );
  }
}
