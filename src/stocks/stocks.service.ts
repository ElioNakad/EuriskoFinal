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
import { RedisService } from '../redis/redis.service';
import { StockHistory } from './schemas/stock-history.schema';
import { Stock } from './schemas/stock.schema';

const DEFAULT_STOCK_CATALOGUE_CACHE_TTL_SECONDS = 300;
const DEFAULT_STOCK_PRICE_CACHE_TTL_SECONDS = 60;

@Injectable()
export class StocksService {
  constructor(
    @InjectModel(Stock.name)
    private stockModel: Model<Stock>,
    @InjectModel(StockHistory.name)
    private stockHistoryModel: Model<StockHistory>,
    private readonly rabbitMqService: RabbitMqService,
    private readonly redisService: RedisService,
  ) {}

  async create(createStockDto: CreateStockDto) {
    const stock = await this.stockModel.create({
      ...createStockDto,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      initialShares:
        createStockDto.initialShares ?? createStockDto.availableShares,
    });

    await this.evictStockCatalogueCache();
    await this.refreshStockPriceCache(stock.ticker, stock.currentPrice);

    return stock;
  }

  async findAll(query: PaginationQueryDto = {}) {
    const { page, limit, skip } = getPagination(query);
    const cacheKey = this.getStockCatalogueCacheKey(page, limit);
    const cachedCatalogue = await this.redisService.get(cacheKey);

    if (this.isStockCatalogueResult(cachedCatalogue)) {
      return cachedCatalogue;
    }

    const stocks = await this.stockModel
      .find()
      .sort({ ticker: 1 })
      .skip(skip)
      .limit(limit + 1)
      .lean()
      .exec();

    const catalogue = {
      data: stocks.slice(0, limit),
      page,
      limit,
      hasMore: stocks.length > limit,
    };

    await this.redisService.set(
      cacheKey,
      catalogue,
      this.getCacheTtlSeconds(
        'STOCK_CATALOGUE_CACHE_TTL_SECONDS',
        DEFAULT_STOCK_CATALOGUE_CACHE_TTL_SECONDS,
      ),
    );

    return catalogue;
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

    await this.refreshStockPriceCache(stock.ticker, stock.currentPrice);

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

    await this.evictStockCatalogueCache();

    if (
      typeof updateStockDto.currentPrice === 'number' &&
      previousStock.currentPrice !== stock.currentPrice
    ) {
      await this.redisService.delete(
        this.getStockPriceCacheKey(previousStock.ticker),
      );
      await this.refreshStockPriceCache(stock.ticker, stock.currentPrice);

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

  private getStockCatalogueCacheKey(page: number, limit: number): string {
    return `stocks:catalogue:page:${page}:limit:${limit}`;
  }

  private getStockPriceCacheKey(ticker: string): string {
    return `stocks:price:${ticker.toUpperCase()}`;
  }

  private async evictStockCatalogueCache(): Promise<void> {
    await this.redisService.deleteByPattern('stocks:catalogue:*');
  }

  private async refreshStockPriceCache(
    ticker: string,
    currentPrice: number,
  ): Promise<void> {
    await this.redisService.set(
      this.getStockPriceCacheKey(ticker),
      {
        ticker,
        currentPrice,
      },
      this.getCacheTtlSeconds(
        'STOCK_PRICE_CACHE_TTL_SECONDS',
        DEFAULT_STOCK_PRICE_CACHE_TTL_SECONDS,
      ),
    );
  }

  private getCacheTtlSeconds(key: string, defaultValue: number): number {
    const value = Number(process.env[key]);

    return Number.isInteger(value) && value > 0 ? value : defaultValue;
  }

  private isStockCatalogueResult(value: unknown): value is {
    data: unknown[];
    page: number;
    limit: number;
    hasMore: boolean;
  } {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const catalogue = value as {
      data?: unknown;
      page?: unknown;
      limit?: unknown;
      hasMore?: unknown;
    };

    return (
      Array.isArray(catalogue.data) &&
      typeof catalogue.page === 'number' &&
      typeof catalogue.limit === 'number' &&
      typeof catalogue.hasMore === 'boolean'
    );
  }
}
