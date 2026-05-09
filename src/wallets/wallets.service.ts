import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';

import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import {
  WithdrawalRequest,
  WithdrawalRequestDocument,
  WithdrawalRequestStatus,
} from './schemas/withdrawal-request.schema';

type CheckoutSession = Awaited<
  ReturnType<Stripe.Stripe['checkout']['sessions']['create']>
>;

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  private readonly withdrawalDelayMs = 0;
  // 48 * 60 * 60 * 1000;

  private readonly stripe: Stripe.Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,

    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,

    @InjectModel(WithdrawalRequest.name)
    private readonly withdrawalRequestModel: Model<WithdrawalRequestDocument>,
  ) {
    const stripeSecretKey =
      this.configService.getOrThrow<string>('STRIPE_SECRET_KEY');

    this.stripe = new Stripe(stripeSecretKey);
  }

  async createDepositSession(
    userId: string,
    amount: number,
  ): Promise<{ url: string | null }> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

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
      url: session.url,
    };
  }

  async handleWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<{ received: boolean }> {
    const webhookSecret = this.configService.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as CheckoutSession;

      const userId = String(session.metadata?.userId ?? '');

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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const user = await this.usersService.findById(userId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (user?.email) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          await this.mailService.sendPaymentSuccess(user.email, amount);
        } catch (error) {
          this.logger.error(
            'Failed to send payment success email',
            error instanceof Error ? error.stack : String(error),
          );
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

  async requestWithdrawal(
    userId: string,
    amount: number,
  ): Promise<WithdrawalRequestDocument> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const wallet = await this.walletModel.findOne({
      userId: new Types.ObjectId(userId),
    });

    if (!wallet) {
      throw new BadRequestException('Wallet not found');
    }

    if (!wallet.lastDepositAt) {
      throw new BadRequestException('No deposit found for this wallet');
    }

    const nextEligibleAt = new Date(
      wallet.lastDepositAt.getTime() + this.withdrawalDelayMs,
    );

    if (Date.now() < nextEligibleAt.getTime()) {
      throw new BadRequestException(
        `Withdrawals are available after ${nextEligibleAt.toISOString()}`,
      );
    }

    if ((wallet.balance ?? 0) < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    return this.withdrawalRequestModel.create({
      wallet_id: wallet._id,
      amount,
      status: WithdrawalRequestStatus.Pending,
    });
  }
}
