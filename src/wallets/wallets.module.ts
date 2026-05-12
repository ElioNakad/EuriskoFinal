import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuditTrail,
  AuditTrailSchema,
} from '../cms/schemas/audit-trail.schema';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

import { BuyOrder, BuyOrderSchema } from '../orders/schemas/buy-order.schema';
import {
  SellOrder,
  SellOrderSchema,
} from '../orders/schemas/sell-order.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from './schemas/wallet-transaction.schema';
import {
  WithdrawalRequest,
  WithdrawalRequestSchema,
} from './schemas/withdrawal-request.schema';

@Module({
  imports: [
    MailModule,
    UsersModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
    MongooseModule.forFeature([
      {
        name: Wallet.name,
        schema: WalletSchema,
      },
      {
        name: WithdrawalRequest.name,
        schema: WithdrawalRequestSchema,
      },
      {
        name: WalletTransaction.name,
        schema: WalletTransactionSchema,
      },
      {
        name: AuditTrail.name,
        schema: AuditTrailSchema,
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

  controllers: [WalletsController],

  providers: [WalletsService, JwtAuthGuard],

  exports: [WalletsService],
})
export class WalletsModule {}
