import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { RedisModule } from '../redis/redis.module';
import { Stock, StockSchema } from '../stocks/schemas/stock.schema';
import { Wallet, WalletSchema } from '../wallets/schemas/wallet.schema';
import { BuyOrder, BuyOrderSchema } from './schemas/buy-order.schema';
import {
  PortfolioPosition,
  PortfolioPositionSchema,
} from './schemas/portfolio-position.schema';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    RedisModule,
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
        name: Wallet.name,
        schema: WalletSchema,
      },
      {
        name: BuyOrder.name,
        schema: BuyOrderSchema,
      },
      {
        name: PortfolioPosition.name,
        schema: PortfolioPositionSchema,
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
