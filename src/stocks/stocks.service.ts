import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Stock } from './schemas/stock.schema';

@Injectable()
export class StocksService {
  constructor(
    @InjectModel(Stock.name)
    private stockModel: Model<Stock>,
  ) {}

  async create() {
    return this.stockModel.create({
      ticker: 'AAPL',
      companyName: 'Apple',
      sector: 'Technology',
      currentPrice: 200,
      description: 'Tech company',
      isListed: true,
    });
  }

  async findAll() {
    return this.stockModel.find();
  }
}
