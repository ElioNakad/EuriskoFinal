/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { InjectModel } from '@nestjs/mongoose';

import Stripe from 'stripe';

import { Model, Types } from 'mongoose';

import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { Wallet } from './schemas/wallet.schema';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  private readonly stripe: any;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,

    @InjectModel(Wallet.name)
    private readonly walletModel: Model<Wallet>,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') as string,
    );
  }

  async createDepositSession(
    userId: string,
    amount: number,
  ): Promise<{ url: string | null }> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],

      mode: 'payment',

      line_items: [
        {
          price_data: {
            currency: 'usd',

            product_data: {
              name: 'Wallet Deposit',
            },

            unit_amount: amount * 100,
          },

          quantity: 1,
        },
      ],

      metadata: {
        userId,
        amount: amount.toString(),
      },

      success_url: 'http://localhost:3001/payment-success',

      cancel_url: 'http://localhost:3001/payment-cancel',
    });

    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      url: session.url,
    };
  }

  async handleWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<{ received: boolean }> {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    ) as string;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (event.type === 'checkout.session.completed') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const session = event.data.object;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const userId = String(session.metadata?.userId ?? '');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const amount = Number(session.metadata?.amount);

      if (!userId || Number.isNaN(amount)) {
        throw new BadRequestException('Invalid webhook metadata');
      }

      const existingWallet = await this.walletModel.findOne({
        userId: new Types.ObjectId(userId),
      });

      if (!existingWallet) {
        await this.walletModel.create({
          userId: new Types.ObjectId(userId),
          balance: amount,
          lastDepositAt: new Date(),
        });
      } else {
        existingWallet.balance = (existingWallet.balance ?? 0) + amount;

        existingWallet.lastDepositAt = new Date();

        await existingWallet.save();
      }

      const user = await this.usersService.findById(userId);

      if (user?.email) {
        try {
          await this.mailService.sendPaymentSuccess(user.email, amount);
        } catch (error) {
          this.logger.error('Failed to send payment success email', error);
        }
      }
    }

    return {
      received: true,
    };
  }

  async hasWallet(userId: string): Promise<boolean> {
    const wallet = await this.walletModel.exists({
      userId: new Types.ObjectId(userId),
    });

    return Boolean(wallet);
  }
}
