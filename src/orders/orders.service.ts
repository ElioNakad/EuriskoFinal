import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { RedisService } from '../redis/redis.service';
import { Stock, StockDocument } from '../stocks/schemas/stock.schema';
import { Wallet, WalletDocument } from '../wallets/schemas/wallet.schema';
import { PlaceMarketBuyOrderDto } from './dto/place-market-buy-order.dto';
import {
  BuyOrder,
  BuyOrderDocument,
  BuyOrderStatus,
} from './schemas/buy-order.schema';
import {
  PortfolioPosition,
  PortfolioPositionDocument,
  PortfolioPositionStatus,
} from './schemas/portfolio-position.schema';

const PORTFOLIO_SUMMARY_TTL_SECONDS = 60;

type LeanStock = Stock & { _id: Types.ObjectId };

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

    @InjectModel(BuyOrder.name)
    private readonly buyOrderModel: Model<BuyOrderDocument>,

    @InjectModel(PortfolioPosition.name)
    private readonly portfolioPositionModel: Model<PortfolioPositionDocument>,

    private readonly redisService: RedisService,
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
      let position: PortfolioPositionDocument | undefined;

      await session.withTransaction(async () => {
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
              costPerShare,
              totalCost,
              status: BuyOrderStatus.Filled,
            },
          ],
          { session },
        );

        [position] = await this.portfolioPositionModel.create(
          [
            {
              user_id: userObjectId,
              stock_id: stockObjectId,
              buy_order_id: order._id,
              numberOfShares: dto.numberOfShares,
              costPerShare,
              totalCost,
              status: PortfolioPositionStatus.Open,
            },
          ],
          { session },
        );
      });

      await this.evictPortfolioSummary(userId);

      return {
        message: 'Buy order filled',
        order,
        position,
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

    const positions = await this.portfolioPositionModel
      .find({
        user_id: userObjectId,
        status: PortfolioPositionStatus.Open,
      })
      .populate<{
        stock_id: Pick<
          LeanStock,
          '_id' | 'ticker' | 'companyName' | 'currentPrice'
        >;
      }>('stock_id', 'ticker companyName currentPrice')
      .lean();

    const byStock = new Map<string, PortfolioSummaryPosition>();

    for (const position of positions) {
      const stock =
        position.stock_id && typeof position.stock_id === 'object'
          ? position.stock_id
          : undefined;
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const stockId = stock?._id?.toString() ?? String(position.stock_id);
      const current = byStock.get(stockId);
      const currentPrice = stock?.currentPrice;

      if (!current) {
        byStock.set(stockId, {
          stockId,
          ticker: stock?.ticker,
          companyName: stock?.companyName,
          numberOfShares: position.numberOfShares,
          averageCostPerShare: position.costPerShare,
          totalCost: position.totalCost,
          currentPrice,
        });
        continue;
      }

      current.numberOfShares += position.numberOfShares;
      current.totalCost += position.totalCost;
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
      PORTFOLIO_SUMMARY_TTL_SECONDS,
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

  private getPortfolioSummaryCacheKey(userId: string): string {
    return `portfolio-summary:${userId}`;
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
