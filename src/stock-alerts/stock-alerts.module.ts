import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MailModule } from '../mail/mail.module';
import { RabbitMqModule } from '../rabbitmq/rabbitmq.module';
import { UsersModule } from '../users/users.module';
import { StockAlertsController } from './stock-alerts.controller';
import { StockAlertsService } from './stock-alerts.service';
import { StockAlert, StockAlertSchema } from './schemas/stock-alert.schema';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
    MailModule,
    RabbitMqModule,
    UsersModule,
    MongooseModule.forFeature([
      {
        name: StockAlert.name,
        schema: StockAlertSchema,
      },
    ]),
  ],
  controllers: [StockAlertsController],
  providers: [StockAlertsService, JwtAuthGuard],
})
export class StockAlertsModule {}
