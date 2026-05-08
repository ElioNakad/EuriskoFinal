import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StocksModule } from './stocks/stocks.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI!),

    AuthModule,
    UsersModule,
    StocksModule,
  ],
})
export class AppModule {}
