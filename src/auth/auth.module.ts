import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

import { RedisModule } from '../redis/redis.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { WalletsModule } from '../wallets/wallets.module';
@Module({
  imports: [
    RedisModule,
    UsersModule,
    MailModule,
    WalletsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
