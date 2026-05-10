import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { Stock, StockSchema } from '../stocks/schemas/stock.schema';
import { Wallet, WalletSchema } from '../wallets/schemas/wallet.schema';
import { BuyOrder, BuyOrderSchema } from './schemas/buy-order.schema';
import { SellOrder, SellOrderSchema } from './schemas/sell-order.schema';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    AuthModule,
    RedisModule,
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
        name: SellOrder.name,
        schema: SellOrderSchema,
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
