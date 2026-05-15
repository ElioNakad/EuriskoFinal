import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
import { CmsAdminGuard } from './guards/cms-admin.guard';
import { CmsSuperAdminGuard } from './guards/cms-super-admin.guard';
import { CmsSupportAgentGuard } from './guards/cms-support-agent.guard';
import { CmsWithdrawalReviewGuard } from './guards/cms-withdrawal-review.guard';
import { CmsAccount, CmsAccountSchema } from './schemas/cms-account.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: CmsAccount.name,
        schema: CmsAccountSchema,
      },
    ]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
    MailModule,
    UsersModule,
    WalletsModule,
  ],
  controllers: [CmsController],
  providers: [
    CmsService,
    JwtAuthGuard,
    CmsAdminGuard,
    CmsSuperAdminGuard,
    CmsSupportAgentGuard,
    CmsWithdrawalReviewGuard,
  ],
  exports: [CmsService],
})
export class CmsModule {}
