import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import {
  MemberAccountStatusLog,
  MemberAccountStatusLogSchema,
} from './schemas/member-account-status-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: MemberAccountStatusLog.name,
        schema: MemberAccountStatusLogSchema,
      },
    ]),
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
