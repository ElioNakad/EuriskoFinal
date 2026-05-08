import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

import { Wallet, WalletSchema } from './schemas/wallet.schema';

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
    ]),
  ],

  controllers: [WalletsController],

  providers: [WalletsService, JwtAuthGuard],

  exports: [WalletsService],
})
export class WalletsModule {}
