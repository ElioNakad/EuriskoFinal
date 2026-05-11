import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
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
  ],
  controllers: [CmsController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
