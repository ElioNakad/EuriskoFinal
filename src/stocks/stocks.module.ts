import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';

import { Stock, StockSchema } from './schemas/stock.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Stock.name,
        schema: StockSchema,
      },
    ]),
  ],
  controllers: [StocksController],
  providers: [StocksService],
})
export class StocksModule {}
