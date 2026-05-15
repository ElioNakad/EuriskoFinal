import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { CmsAnalystGuard } from '../cms/guards/cms-analyst.guard';
import { BuyOrder, BuyOrderSchema } from '../orders/schemas/buy-order.schema';
import {
  SellOrder,
  SellOrderSchema,
} from '../orders/schemas/sell-order.schema';
import { Stock, StockSchema } from '../stocks/schemas/stock.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { Wallet, WalletSchema } from '../wallets/schemas/wallet.schema';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    MongooseModule.forFeature([
      {
        name: BuyOrder.name,
        schema: BuyOrderSchema,
      },
      {
        name: SellOrder.name,
        schema: SellOrderSchema,
      },
      {
        name: Stock.name,
        schema: StockSchema,
      },
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: Wallet.name,
        schema: WalletSchema,
      },
    ]),
  ],
  controllers: [AnalystController],
  providers: [AnalystService, CmsAnalystGuard],
})
export class AnalystModule {}
