import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CmsAnalystGuard } from '../cms/guards/cms-analyst.guard';
import { RabbitMqModule } from '../rabbitmq/rabbitmq.module';
import { UsersModule } from '../users/users.module';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';

import { Stock, StockSchema } from './schemas/stock.schema';
import {
  StockHistory,
  StockHistorySchema,
} from './schemas/stock-history.schema';

@Module({
  imports: [
    RabbitMqModule,
    UsersModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
    MongooseModule.forFeature([
      {
        name: Stock.name,
        schema: StockSchema,
      },
      {
        name: StockHistory.name,
        schema: StockHistorySchema,
      },
    ]),
  ],
  controllers: [StocksController],
  providers: [StocksService, JwtAuthGuard, CmsAnalystGuard],
})
export class StocksModule {}
