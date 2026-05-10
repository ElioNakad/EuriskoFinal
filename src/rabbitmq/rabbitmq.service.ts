import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import * as amqp from 'amqplib';

type RabbitConnection = Awaited<ReturnType<typeof amqp.connect>>;
type RabbitChannel = Awaited<ReturnType<RabbitConnection['createChannel']>>;

@Injectable()
export class RabbitMqService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RabbitMqService.name);
  private connection?: RabbitConnection;
  private channel?: RabbitChannel;

  async onApplicationBootstrap() {
    await this.connect();
  }

  async onApplicationShutdown() {
    await this.channel?.close();
    await this.connection?.close();
  }

  async publish(
    exchange: string,
    routingKey: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const channel = await this.getChannel();

    if (!channel) {
      return false;
    }

    await channel.assertExchange(exchange, 'topic', { durable: true });

    return channel.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      {
        contentType: 'application/json',
        persistent: true,
      },
    );
  }

  async consume(
    exchange: string,
    queue: string,
    routingKey: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    const channel = await this.getChannel();

    if (!channel) {
      return;
    }

    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, routingKey);
    await channel.prefetch(Number(process.env.RABBITMQ_PREFETCH ?? 20));

    await channel.consume(queue, (message) => {
      if (!message) {
        return;
      }

      void this.handleMessage(channel, message, handler);
    });
  }

  private async handleMessage(
    channel: RabbitChannel,
    message: amqp.ConsumeMessage,
    handler: (payload: unknown) => Promise<void>,
  ) {
    try {
      const payload = JSON.parse(message.content.toString()) as unknown;

      await handler(payload);
      channel.ack(message);
    } catch (error) {
      this.logger.error('RabbitMQ message failed', error);
      channel.nack(message, false, false);
    }
  }

  private async getChannel(): Promise<RabbitChannel | undefined> {
    if (this.channel) {
      return this.channel;
    }

    await this.connect();

    return this.channel;
  }

  private async connect(): Promise<void> {
    if (this.channel) {
      return;
    }

    const url = process.env.RABBITMQ_URL ?? 'amqp://localhost:5672';

    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      this.logger.log('Connected to RabbitMQ');
    } catch (error) {
      this.logger.warn(`RabbitMQ is unavailable: ${(error as Error).message}`);
    }
  }
}
