import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { StockHistory } from './schemas/stock-history.schema';
import { Stock } from './schemas/stock.schema';

@Injectable()
export class StocksService {
  constructor(
    @InjectModel(Stock.name)
    private stockModel: Model<Stock>,
    @InjectModel(StockHistory.name)
    private stockHistoryModel: Model<StockHistory>,
  ) {}

  async create(createStockDto: CreateStockDto) {
    return this.stockModel.create({
      ...createStockDto,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      initialShares:
        createStockDto.initialShares ?? createStockDto.availableShares,
    });
  }

  async findAll() {
    return this.stockModel.find().exec();
  }

  async findByName(name: string) {
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
      .exec();

    return {
      ...stock.toObject(),
      stockHistory,
    };
  }

  async updateByTicker(ticker: string, updateStockDto: UpdateStockDto) {
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

    return stock;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
