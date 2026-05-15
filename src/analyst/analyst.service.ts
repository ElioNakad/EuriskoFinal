import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';

import {
  BuyOrder,
  BuyOrderDocument,
} from '../orders/schemas/buy-order.schema';
import {
  SellOrder,
  SellOrderDocument,
} from '../orders/schemas/sell-order.schema';
import { Stock, StockDocument } from '../stocks/schemas/stock.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Wallet, WalletDocument } from '../wallets/schemas/wallet.schema';
import { ActiveMembersQueryDto } from './dto/active-members-query.dto';
import { TopStocksQueryDto } from './dto/top-stocks-query.dto';
import { VolumeGranularity, VolumeQueryDto } from './dto/volume-query.dto';

interface SumResult {
  total: number;
}

export interface TradingVolumeResult {
  date: string;
  sharesTraded: number;
  totalValue: number;
}

interface TopStockResult {
  stockId: Types.ObjectId;
  ticker: string;
  companyName: string;
  tradeCount: number;
  totalVolume: number;
}

interface ActiveMemberResult {
  memberId: Types.ObjectId;
  displayName: string;
  tradeCount: number;
}

export interface SectorAllocationResult {
  sector: string;
  totalCurrentValue: number;
  percentage: number;
}

@Injectable()
export class AnalystService {
  constructor(
    @InjectModel(BuyOrder.name)
    private readonly buyOrderModel: Model<BuyOrderDocument>,

    @InjectModel(SellOrder.name)
    private readonly sellOrderModel: Model<SellOrderDocument>,

    @InjectModel(Stock.name)
    private readonly stockModel: Model<StockDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,

    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
  ) {}

  async getTradingVolume(
    query: VolumeQueryDto,
  ): Promise<TradingVolumeResult[]> {
    const stockObjectId = new Types.ObjectId(query.stock_id);
    const { from, to } = this.getDateRange(query.from, query.to);
    const dateFormat =
      query.granularity === VolumeGranularity.Month ? '%Y-%m-01' : '%Y-%m-%d';

    return this.buyOrderModel.aggregate<TradingVolumeResult>([
      {
        $match: {
          stock_id: stockObjectId,
          createdAt: {
            $gte: from,
            $lte: to,
          },
        },
      },
      {
        $project: {
          tradeDate: '$createdAt',
          sharesTraded: '$numberOfShares',
          totalValue: '$totalCost',
        },
      },
      {
        $unionWith: {
          coll: this.sellOrderModel.collection.name,
          pipeline: [
            {
              $match: {
                stock_id: stockObjectId,
                soldAt: {
                  $gte: from,
                  $lte: to,
                },
              },
            },
            {
              $project: {
                tradeDate: '$soldAt',
                sharesTraded: '$numberOfShares',
                totalValue: '$proceeds',
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              date: '$tradeDate',
              format: dateFormat,
            },
          },
          sharesTraded: {
            $sum: '$sharesTraded',
          },
          totalValue: {
            $sum: '$totalValue',
          },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          sharesTraded: 1,
          totalValue: 1,
        },
      },
      {
        $sort: {
          date: 1,
        },
      },
    ]);
  }

  async getTopTradedStocks(query: TopStocksQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 5;
    const skip = (page - 1) * limit;

    const results = await this.buyOrderModel.aggregate<TopStockResult>([
      this.tradeProjectionStage('$numberOfShares'),
      {
        $unionWith: {
          coll: this.sellOrderModel.collection.name,
          pipeline: [this.tradeProjectionStage('$numberOfShares')],
        },
      },
      {
        $group: {
          _id: '$stock_id',
          tradeCount: {
            $sum: 1,
          },
          totalVolume: {
            $sum: '$shares',
          },
        },
      },
      {
        $lookup: {
          from: this.stockModel.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'stock',
        },
      },
      {
        $unwind: '$stock',
      },
      {
        $sort: {
          tradeCount: -1,
          totalVolume: -1,
          'stock.ticker': 1,
        },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit + 1,
      },
      {
        $project: {
          _id: 0,
          stockId: '$_id',
          ticker: '$stock.ticker',
          companyName: '$stock.companyName',
          tradeCount: 1,
          totalVolume: 1,
        },
      },
    ]);

    return {
      data: results.slice(0, limit).map((stock) => ({
        ...stock,
        stockId: stock.stockId.toString(),
      })),
      page,
      limit,
      hasMore: results.length > limit,
    };
  }

  async getAssetsUnderManagement() {
    const [walletBalanceTotal, openPositionsValue] = await Promise.all([
      this.getWalletBalanceTotal(),
      this.getOpenPositionsValue(),
    ]);

    return {
      totalAum: walletBalanceTotal + openPositionsValue,
      walletBalanceTotal,
      openPositionsValue,
    };
  }

  async getMostActiveMembers(query: ActiveMembersQueryDto) {
    const days = query.days ?? 30;
    const limit = query.limit ?? 10;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const results = await this.buyOrderModel.aggregate<ActiveMemberResult>([
      {
        $match: {
          createdAt: {
            $gte: since,
          },
        },
      },
      {
        $project: {
          user_id: 1,
        },
      },
      {
        $unionWith: {
          coll: this.sellOrderModel.collection.name,
          pipeline: [
            {
              $match: {
                soldAt: {
                  $gte: since,
                },
              },
            },
            {
              $project: {
                user_id: 1,
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: '$user_id',
          tradeCount: {
            $sum: 1,
          },
        },
      },
      {
        $lookup: {
          from: this.userModel.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'member',
        },
      },
      {
        $unwind: '$member',
      },
      {
        $sort: {
          tradeCount: -1,
          'member.fullName': 1,
        },
      },
      {
        $limit: limit,
      },
      {
        $project: {
          _id: 0,
          memberId: '$_id',
          displayName: '$member.fullName',
          tradeCount: 1,
        },
      },
    ]);

    return results.map((member) => ({
      ...member,
      memberId: member.memberId.toString(),
    }));
  }

  async getSectorAllocation(): Promise<SectorAllocationResult[]> {
    const [walletBalanceTotal, sectors] = await Promise.all([
      this.getWalletBalanceTotal(),
      this.buyOrderModel.aggregate<Omit<SectorAllocationResult, 'percentage'>>([
        {
          $match: {
            availableShares: {
              $gt: 0,
            },
          },
        },
        {
          $lookup: {
            from: this.stockModel.collection.name,
            localField: 'stock_id',
            foreignField: '_id',
            as: 'stock',
          },
        },
        {
          $unwind: '$stock',
        },
        {
          $group: {
            _id: '$stock.sector',
            totalCurrentValue: {
              $sum: {
                $multiply: ['$availableShares', '$stock.currentPrice'],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            sector: '$_id',
            totalCurrentValue: 1,
          },
        },
        {
          $sort: {
            totalCurrentValue: -1,
            sector: 1,
          },
        },
      ]),
    ]);

    const investedTotal = sectors.reduce(
      (total, sector) => total + sector.totalCurrentValue,
      0,
    );
    const totalAum = walletBalanceTotal + investedTotal;

    return sectors.map((sector) => ({
      ...sector,
      percentage:
        totalAum === 0 ? 0 : (sector.totalCurrentValue / totalAum) * 100,
    }));
  }

  private async getWalletBalanceTotal(): Promise<number> {
    const [result] = await this.walletModel.aggregate<SumResult>([
      {
        $group: {
          _id: null,
          total: {
            $sum: '$balance',
          },
        },
      },
    ]);

    return result?.total ?? 0;
  }

  private async getOpenPositionsValue(): Promise<number> {
    const [result] = await this.buyOrderModel.aggregate<SumResult>([
      {
        $match: {
          availableShares: {
            $gt: 0,
          },
        },
      },
      {
        $lookup: {
          from: this.stockModel.collection.name,
          localField: 'stock_id',
          foreignField: '_id',
          as: 'stock',
        },
      },
      {
        $unwind: '$stock',
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $multiply: ['$availableShares', '$stock.currentPrice'],
            },
          },
        },
      },
    ]);

    return result?.total ?? 0;
  }

  private tradeProjectionStage(sharesPath: string): PipelineStage.Project {
    return {
      $project: {
        stock_id: 1,
        shares: sharesPath,
      },
    };
  }

  private getDateRange(
    fromValue: string,
    toValue: string,
  ): { from: Date; to: Date } {
    const from = new Date(fromValue);
    const to = new Date(toValue);

    if (this.isDateOnly(toValue)) {
      to.setUTCHours(23, 59, 59, 999);
    }

    if (from > to) {
      throw new BadRequestException('from must be before or equal to to');
    }

    return {
      from,
      to,
    };
  }

  private isDateOnly(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
}
