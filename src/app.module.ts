import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StocksModule } from './stocks/stocks.module';
import { WalletsModule } from './wallets/wallets.module';
import { OrdersModule } from './orders/orders.module';
import { RabbitMqModule } from './rabbitmq/rabbitmq.module';
import { StockAlertsModule } from './stock-alerts/stock-alerts.module';
import { CmsModule } from './cms/cms.module';
import { AnalystModule } from './analyst/analyst.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    MongooseModule.forRoot(process.env.MONGO_URI!),

    AuthModule,
    UsersModule,
    StocksModule,
    WalletsModule,
    OrdersModule,
    RabbitMqModule,
    StockAlertsModule,
    CmsModule,
    AnalystModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
