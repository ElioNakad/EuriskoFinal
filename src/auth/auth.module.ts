import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';

import { RedisModule } from '../redis/redis.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { WalletsModule } from '../wallets/wallets.module';
import { CmsModule } from '../cms/cms.module';
@Module({
  imports: [
    RedisModule,
    UsersModule,
    MailModule,
    WalletsModule,
    CmsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, WsJwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard, WsJwtAuthGuard],
})
export class AuthModule {}
