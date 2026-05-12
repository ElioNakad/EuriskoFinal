import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  getPagination,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import {
  STOCK_PRICE_EXCHANGE,
  STOCK_PRICE_UPDATED_ROUTING_KEY,
} from '../rabbitmq/rabbitmq.constants';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';
import { StockHistory } from './schemas/stock-history.schema';
import { Stock } from './schemas/stock.schema';

@Injectable()
export class StocksService {
  constructor(
    @InjectModel(Stock.name)
    private stockModel: Model<Stock>,
    @InjectModel(StockHistory.name)
    private stockHistoryModel: Model<StockHistory>,
    private readonly rabbitMqService: RabbitMqService,
  ) {}

  async create(createStockDto: CreateStockDto) {
    return this.stockModel.create({
      ...createStockDto,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      initialShares:
        createStockDto.initialShares ?? createStockDto.availableShares,
    });
  }

  async findAll(query: PaginationQueryDto = {}) {
    const { page, limit, skip } = getPagination(query);
    const stocks = await this.stockModel
      .find()
      .sort({ ticker: 1 })
      .skip(skip)
      .limit(limit + 1)
      .lean()
      .exec();

    return {
      data: stocks.slice(0, limit),
      page,
      limit,
      hasMore: stocks.length > limit,
    };
  }

  async findByName(name: string, query: PaginationQueryDto = {}) {
    const { page, limit, skip } = getPagination(query);
    const stock = await this.stockModel
      .findOne({
        ticker: new RegExp(`^${this.escapeRegExp(name)}$`, 'i'),
      })
      .exec();

    if (!stock) {
      throw new NotFoundException('Stock not found');
    }

    const stockHistory = await this.stockHistoryModel
      .find({ stockId: stock._id })
      .sort({ changedAt: -1 })
      .skip(skip)
      .limit(limit + 1)
      .lean()
      .exec();

    return {
      ...stock.toObject(),
      stockHistory: {
        data: stockHistory.slice(0, limit),
        page,
        limit,
        hasMore: stockHistory.length > limit,
      },
    };
  }

  async updateByTicker(ticker: string, updateStockDto: UpdateStockDto) {
    const previousStock = await this.stockModel
      .findOne({
        ticker: new RegExp(`^${this.escapeRegExp(ticker)}$`, 'i'),
      })
      .exec();

    if (!previousStock) {
      throw new NotFoundException('Stock not found');
    }

    const stock = await this.stockModel
      .findOneAndUpdate(
        {
          ticker: new RegExp(`^${this.escapeRegExp(ticker)}$`, 'i'),
        },
        updateStockDto,
        {
          new: true,
          runValidators: true,
        },
      )
      .exec();

    if (!stock) {
      throw new NotFoundException('Stock not found');
    }

    if (
      typeof updateStockDto.currentPrice === 'number' &&
      previousStock.currentPrice !== stock.currentPrice
    ) {
      await this.rabbitMqService.publish(
        STOCK_PRICE_EXCHANGE,
        STOCK_PRICE_UPDATED_ROUTING_KEY,
        {
          ticker: stock.ticker,
          previousPrice: previousStock.currentPrice,
          currentPrice: stock.currentPrice,
          changedAt: new Date().toISOString(),
        },
      );
    }

    return stock;
  }

  async delist(ticker: string) {
    return this.updateByTicker(ticker, { isListed: false });
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
