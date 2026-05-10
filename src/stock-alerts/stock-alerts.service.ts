import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { MailService } from '../mail/mail.service';
import {
  STOCK_PRICE_EXCHANGE,
  STOCK_PRICE_UPDATED_QUEUE,
  STOCK_PRICE_UPDATED_ROUTING_KEY,
} from '../rabbitmq/rabbitmq.constants';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';
import { UsersService } from '../users/users.service';
import {
  CreateStockAlertDto,
  StockAlertDirection,
} from './dto/create-stock-alert.dto';
import {
  StockAlert,
  StockAlertDocument,
  StockAlertStatus,
} from './schemas/stock-alert.schema';

interface StockPriceUpdatedEvent {
  ticker: string;
  previousPrice: number;
  currentPrice: number;
  changedAt: string;
}

@Injectable()
export class StockAlertsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StockAlertsService.name);

  constructor(
    @InjectModel(StockAlert.name)
    private readonly stockAlertModel: Model<StockAlertDocument>,
    private readonly rabbitMqService: RabbitMqService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
  ) {}

  async onApplicationBootstrap() {
    await this.rabbitMqService.consume(
      STOCK_PRICE_EXCHANGE,
      STOCK_PRICE_UPDATED_QUEUE,
      STOCK_PRICE_UPDATED_ROUTING_KEY,
      (payload) => this.handleStockPriceUpdated(payload),
    );
  }

  async create(memberId: string, dto: CreateStockAlertDto) {
    return this.stockAlertModel.create({
      memberId: new Types.ObjectId(memberId),
      ticker: dto.ticker.toUpperCase(),
      direction: dto.direction,
      thresholdPrice: dto.thresholdPrice,
      emailEnabled: true,
      pushEnabled: dto.pushEnabled,
    });
  }

  async findMine(memberId: string) {
    return this.stockAlertModel
      .find({ memberId: new Types.ObjectId(memberId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async cancel(memberId: string, id: string) {
    const alert = await this.stockAlertModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          memberId: new Types.ObjectId(memberId),
          status: StockAlertStatus.Active,
        },
        {
          status: StockAlertStatus.Cancelled,
        },
        { new: true },
      )
      .exec();

    if (!alert) {
      throw new NotFoundException('Active stock alert not found');
    }

    return alert;
  }

  private async handleStockPriceUpdated(payload: unknown) {
    if (!this.isStockPriceUpdatedEvent(payload)) {
      this.logger.warn('Ignored malformed stock price event');
      return;
    }

    const alerts = await this.findCrossedAlerts(payload);

    for (const alert of alerts) {
      await this.triggerAlert(alert, payload.currentPrice);
    }
  }

  private async findCrossedAlerts(event: StockPriceUpdatedEvent) {
    const ticker = event.ticker.toUpperCase();

    return this.stockAlertModel
      .find({
        ticker,
        status: StockAlertStatus.Active,
        $or: [
          {
            direction: StockAlertDirection.Above,
            thresholdPrice: {
              $gt: event.previousPrice,
              $lte: event.currentPrice,
            },
          },
          {
            direction: StockAlertDirection.Below,
            thresholdPrice: {
              $lt: event.previousPrice,
              $gte: event.currentPrice,
            },
          },
        ],
      })
      .exec();
  }

  private async triggerAlert(alert: StockAlertDocument, currentPrice: number) {
    const triggeredAlert = await this.stockAlertModel
      .findOneAndUpdate(
        {
          _id: alert._id,
          status: StockAlertStatus.Active,
        },
        {
          status: StockAlertStatus.Triggered,
          triggeredAt: new Date(),
          triggeredPrice: currentPrice,
        },
        { new: true },
      )
      .exec();

    if (!triggeredAlert) {
      return;
    }

    await this.notifyMember(triggeredAlert);
  }

  private async notifyMember(alert: StockAlertDocument) {
    const user = await this.usersService.findById(alert.memberId.toString());

    if (!user) {
      this.logger.warn(
        `User not found for stock alert ${alert._id.toString()}`,
      );
      return;
    }

    if (alert.emailEnabled) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await this.mailService.sendStockAlertTriggered(
        user.email,
        alert.ticker,
        alert.direction,
        alert.thresholdPrice,
        alert.triggeredPrice ?? alert.thresholdPrice,
      );
    }

    if (alert.pushEnabled) {
      this.logger.log(
        `Push notification queued for ${user.email}: ${alert.ticker} crossed ${alert.thresholdPrice}`,
      );
    }
  }

  private isStockPriceUpdatedEvent(
    payload: unknown,
  ): payload is StockPriceUpdatedEvent {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const event = payload as Record<keyof StockPriceUpdatedEvent, unknown>;

    return (
      typeof event.ticker === 'string' &&
      typeof event.previousPrice === 'number' &&
      typeof event.currentPrice === 'number' &&
      typeof event.changedAt === 'string'
    );
  }
}
