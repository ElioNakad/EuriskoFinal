import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import Stripe from 'stripe';

import { MailService } from '../mail/mail.service';
import { BuyOrder, BuyOrderDocument } from '../orders/schemas/buy-order.schema';
import {
  SellOrder,
  SellOrderDocument,
} from '../orders/schemas/sell-order.schema';
import { UsersService } from '../users/users.service';
import {
  TransactionHistoryQueryDto,
  TransactionHistoryType,
} from './dto/transaction-history-query.dto';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTransactionStatus,
  WalletTransactionType,
} from './schemas/wallet-transaction.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import {
  WithdrawalRequest,
  WithdrawalRequestDocument,
  WithdrawalRequestStatus,
} from './schemas/withdrawal-request.schema';

type CheckoutSession = Awaited<
  ReturnType<Stripe.Stripe['checkout']['sessions']['create']>
>;

export interface TransactionHistoryItem {
  id: string;
  type: TransactionHistoryType;
  status: string;
  amount?: number;
  createdAt: Date;
  source:
    | 'wallet_transactions'
    | 'withdrawals_requests'
    | 'buy_orders'
    | 'sell_orders';
  referenceId?: string | null;
  stockId?: string;
  buyOrderId?: string;
  numberOfShares?: number;
  pricePerShare?: number;
  total?: number;
  proceeds?: number;
  profitLoss?: number;
}

type TimestampedDocument<T> = T & {
  _id: Types.ObjectId;
  createdAt: Date;
};

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

    @InjectConnection()
    private readonly connection: Connection,

    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,

    @InjectModel(WithdrawalRequest.name)
    private readonly withdrawalRequestModel: Model<WithdrawalRequestDocument>,

    @InjectModel(WalletTransaction.name)
    private readonly walletTransactionModel: Model<WalletTransactionDocument>,

    @InjectModel(BuyOrder.name)
    private readonly buyOrderModel: Model<BuyOrderDocument>,

    @InjectModel(SellOrder.name)
    private readonly sellOrderModel: Model<SellOrderDocument>,
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

      if (!userId || Number.isNaN(amount) || amount <= 0) {
        throw new BadRequestException('Invalid webhook metadata');
      }

      const userObjectId = this.toObjectId(userId, 'Invalid user id');
      const depositedAt = new Date();
      const dbSession = await this.connection.startSession();

      try {
        await dbSession.withTransaction(async () => {
          const wallet = await this.walletModel.findOneAndUpdate(
            {
              userId: userObjectId,
            },
            {
              $inc: {
                balance: amount,
              },
              $set: {
                lastDepositAt: depositedAt,
              },
              $setOnInsert: {
                userId: userObjectId,
              },
            },
            {
              new: true,
              upsert: true,
              session: dbSession,
              runValidators: true,
            },
          );

          await this.walletTransactionModel.create(
            [
              {
                wallet_id: wallet._id,
                transaction_type: WalletTransactionType.Deposit,
                amount,
                status: WalletTransactionStatus.Completed,
                reference_id: session.id,
              },
            ],
            {
              session: dbSession,
            },
          );
        });
      } catch (error) {
        if (this.isDuplicateKeyError(error)) {
          return {
            received: true,
          };
        }

        throw error;
      } finally {
        await dbSession.endSession();
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

  async getTransactionHistory(
    userId: string,
    query: TransactionHistoryQueryDto,
  ): Promise<TransactionHistoryItem[]> {
    const userObjectId = this.toObjectId(userId, 'Invalid user id');
    const dateFilter = this.getDateFilter(query);
    const wallet = await this.walletModel.findOne({
      userId: userObjectId,
    });

    const shouldInclude = (type: TransactionHistoryType) =>
      !query.type || query.type === type;

    const historyQueries: Promise<TransactionHistoryItem[]>[] = [];

    if (
      wallet &&
      (shouldInclude(TransactionHistoryType.Deposit) ||
        shouldInclude(TransactionHistoryType.Withdrawal))
    ) {
      const transactionTypeFilter = query.type
        ? this.toWalletTransactionType(query.type)
        : {
            $in: [
              WalletTransactionType.Deposit,
              WalletTransactionType.Withdrawal,
            ],
          };

      if (transactionTypeFilter) {
        historyQueries.push(
          this.walletTransactionModel
            .find({
              wallet_id: wallet._id,
              transaction_type: transactionTypeFilter,
              ...this.createdAtCondition(dateFilter),
            })
            .lean()
            .then((transactions) =>
              transactions.map((transaction) => {
                const transactionWithTimestamps =
                  transaction as unknown as TimestampedDocument<WalletTransaction>;

                return {
                  id: transactionWithTimestamps._id.toString(),
                  type:
                    transactionWithTimestamps.transaction_type ===
                    WalletTransactionType.Withdrawal
                      ? TransactionHistoryType.Withdrawal
                      : TransactionHistoryType.Deposit,
                  status: transactionWithTimestamps.status,
                  amount: transactionWithTimestamps.amount,
                  createdAt: transactionWithTimestamps.createdAt,
                  source: 'wallet_transactions' as const,
                  referenceId: transactionWithTimestamps.reference_id,
                };
              }),
            ),
        );
      }
    }

    if (wallet && shouldInclude(TransactionHistoryType.Withdrawal)) {
      historyQueries.push(
        this.withdrawalRequestModel
          .find({
            wallet_id: wallet._id,
            status: {
              $in: [
                WithdrawalRequestStatus.Pending,
                WithdrawalRequestStatus.Rejected,
              ],
            },
            ...this.createdAtCondition(dateFilter),
          })
          .lean()
          .then((withdrawals) =>
            withdrawals.map((withdrawal) => {
              const withdrawalWithTimestamps =
                withdrawal as unknown as TimestampedDocument<WithdrawalRequest>;

              return {
                id: withdrawalWithTimestamps._id.toString(),
                type: TransactionHistoryType.Withdrawal,
                status:
                  withdrawalWithTimestamps.status ??
                  WithdrawalRequestStatus.Pending,
                amount: withdrawalWithTimestamps.amount,
                createdAt: withdrawalWithTimestamps.createdAt,
                source: 'withdrawals_requests' as const,
              };
            }),
          ),
      );
    }

    if (shouldInclude(TransactionHistoryType.Buy)) {
      historyQueries.push(
        this.buyOrderModel
          .find({
            user_id: userObjectId,
            ...this.createdAtCondition(dateFilter),
          })
          .lean()
          .then((orders) =>
            orders.map((order) => {
              const orderWithTimestamps =
                order as unknown as TimestampedDocument<BuyOrder>;

              return {
                id: orderWithTimestamps._id.toString(),
                type: TransactionHistoryType.Buy,
                status: orderWithTimestamps.status,
                createdAt: orderWithTimestamps.createdAt,
                source: 'buy_orders' as const,
                stockId: orderWithTimestamps.stock_id.toString(),
                numberOfShares: orderWithTimestamps.numberOfShares,
                pricePerShare: orderWithTimestamps.costPerShare,
                total: orderWithTimestamps.totalCost,
              };
            }),
          ),
      );
    }

    if (shouldInclude(TransactionHistoryType.Sell)) {
      historyQueries.push(
        this.sellOrderModel
          .find({
            user_id: userObjectId,
            ...this.soldAtCondition(dateFilter),
          })
          .lean()
          .then((orders) =>
            orders.map((order) => {
              const orderWithTimestamps =
                order as unknown as TimestampedDocument<SellOrder>;

              return {
                id: orderWithTimestamps._id.toString(),
                type: TransactionHistoryType.Sell,
                status: orderWithTimestamps.status,
                createdAt:
                  orderWithTimestamps.soldAt ?? orderWithTimestamps.createdAt,
                source: 'sell_orders' as const,
                stockId: orderWithTimestamps.stock_id.toString(),
                buyOrderId: orderWithTimestamps.buy_order_id.toString(),
                numberOfShares: orderWithTimestamps.numberOfShares,
                pricePerShare: orderWithTimestamps.sellPricePerShare,
                total: orderWithTimestamps.proceeds,
                proceeds: orderWithTimestamps.proceeds,
                profitLoss: orderWithTimestamps.profitLoss,
              };
            }),
          ),
      );
    }

    const history = (await Promise.all(historyQueries)).flat();

    return history.sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
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

    const existingPendingWithdrawal = await this.withdrawalRequestModel.exists({
      wallet_id: wallet._id,
      status: WithdrawalRequestStatus.Pending,
    });

    if (existingPendingWithdrawal) {
      throw new BadRequestException('A withdrawal request is already pending');
    }

    try {
      return await this.withdrawalRequestModel.create({
        wallet_id: wallet._id,
        amount,
        status: WithdrawalRequestStatus.Pending,
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new BadRequestException(
          'A withdrawal request is already pending',
        );
      }

      throw error;
    }
  }

  private getDateFilter(query: TransactionHistoryQueryDto): {
    $gte?: Date;
    $lte?: Date;
  } {
    const filter: { $gte?: Date; $lte?: Date } = {};

    if (query.from) {
      filter.$gte = new Date(query.from);
    }

    if (query.to) {
      filter.$lte = /^\d{4}-\d{2}-\d{2}$/.test(query.to)
        ? new Date(`${query.to}T23:59:59.999Z`)
        : new Date(query.to);
    }

    return filter;
  }

  private createdAtCondition(dateFilter: { $gte?: Date; $lte?: Date }) {
    return Object.keys(dateFilter).length > 0
      ? {
          createdAt: dateFilter,
        }
      : {};
  }

  private soldAtCondition(dateFilter: { $gte?: Date; $lte?: Date }) {
    return Object.keys(dateFilter).length > 0
      ? {
          soldAt: dateFilter,
        }
      : {};
  }

  private toObjectId(value: string, errorMessage: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(errorMessage);
    }

    return new Types.ObjectId(value);
  }

  private toWalletTransactionType(
    type: TransactionHistoryType,
  ): WalletTransactionType | undefined {
    if (type === TransactionHistoryType.Deposit) {
      return WalletTransactionType.Deposit;
    }

    if (type === TransactionHistoryType.Withdrawal) {
      return WalletTransactionType.Withdrawal;
    }

    return undefined;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }
}
