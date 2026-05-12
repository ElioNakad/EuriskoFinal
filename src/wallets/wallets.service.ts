import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import Stripe from 'stripe';

import { ManualWalletAdjustmentDirection } from '../cms/dto/manual-wallet-adjustment.dto';
import {
  AuditTrail,
  AuditTrailAction,
  AuditTrailDocument,
} from '../cms/schemas/audit-trail.schema';
import { MailService } from '../mail/mail.service';
import {
  getPagination,
  PaginationQueryDto,
} from '../common/dto/pagination-query.dto';
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

export interface TransactionHistoryResponse {
  data: TransactionHistoryItem[];
  page: number;
  limit: number;
  hasMore: boolean;
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

    @InjectModel(AuditTrail.name)
    private readonly auditTrailModel: Model<AuditTrailDocument>,

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

      const user = await this.usersService.findById(userId);

      if (user?.email) {
        try {
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
  ): Promise<TransactionHistoryResponse> {
    const userObjectId = this.toObjectId(userId, 'Invalid user id');
    const { page, limit, skip } = getPagination(query);
    const fetchLimit = skip + limit + 1;
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
              WalletTransactionType.ManualCredit,
              WalletTransactionType.ManualDebit,
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
            .sort({ createdAt: -1 })
            .limit(fetchLimit)
            .lean()
            .then((transactions) =>
              transactions.map((transaction) => {
                const transactionWithTimestamps =
                  transaction as unknown as TimestampedDocument<WalletTransaction>;

                return {
                  id: transactionWithTimestamps._id.toString(),
                  type:
                    transactionWithTimestamps.transaction_type ===
                      WalletTransactionType.Withdrawal ||
                    transactionWithTimestamps.transaction_type ===
                      WalletTransactionType.ManualDebit
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
          .sort({ createdAt: -1 })
          .limit(fetchLimit)
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
          .sort({ createdAt: -1 })
          .limit(fetchLimit)
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
          .sort({ soldAt: -1 })
          .limit(fetchLimit)
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

    const history = (await Promise.all(historyQueries)).flat().sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

    return {
      data: history.slice(skip, skip + limit),
      page,
      limit,
      hasMore: history.length > skip + limit,
    };
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

  async getWithdrawalRequestsForCms(query: PaginationQueryDto = {}) {
    const { page, limit, skip } = getPagination(query);
    const requests = await this.withdrawalRequestModel
      .find()
      .populate({
        path: 'wallet_id',
        select: 'userId balance lastDepositAt createdAt updatedAt',
        populate: {
          path: 'userId',
          select: 'fullName email nationalId isActive',
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit + 1)
      .lean();

    return {
      data: requests
        .slice(0, limit)
        .map((request) => this.toCmsWithdrawalRequestResponse(request)),
      page,
      limit,
      hasMore: requests.length > limit,
    };
  }

  async getPendingWithdrawalRequestsForCms(
    query: PaginationQueryDto = {},
  ) {
    const { page, limit, skip } = getPagination(query);
    const filter = {
      status: WithdrawalRequestStatus.Pending,
    };

    const [total, requests] = await Promise.all([
      this.withdrawalRequestModel.countDocuments(filter),
      this.withdrawalRequestModel
        .find(filter)
        .populate({
          path: 'wallet_id',
          select: 'userId balance lastDepositAt createdAt updatedAt',
          populate: {
            path: 'userId',
            select: 'fullName email nationalId isActive',
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return {
      total,
      page,
      limit,
      withdrawalRequests: requests.map((request) =>
        this.toCmsWithdrawalRequestResponse(request),
      ),
    };
  }

  async updateWithdrawalRequestStatus(
    requestId: string,
    status: WithdrawalRequestStatus,
  ) {
    const requestObjectId = this.toObjectId(
      requestId,
      'Invalid withdrawal request id',
    );

    if (
      status !== WithdrawalRequestStatus.Approved &&
      status !== WithdrawalRequestStatus.Rejected
    ) {
      throw new BadRequestException('Unsupported withdrawal request status');
    }

    const dbSession = await this.connection.startSession();
    let updatedWithdrawal: WithdrawalRequestDocument | null = null;
    let updatedWallet: WalletDocument | null = null;
    let walletTransaction: WalletTransactionDocument | undefined;

    try {
      await dbSession.withTransaction(async () => {
        const withdrawal = await this.withdrawalRequestModel
          .findOne({
            _id: requestObjectId,
            status: WithdrawalRequestStatus.Pending,
          })
          .session(dbSession);

        if (!withdrawal) {
          throw new BadRequestException(
            'Withdrawal request is not pending or does not exist',
          );
        }

        const amount = withdrawal.amount ?? 0;

        if (status === WithdrawalRequestStatus.Approved) {
          updatedWallet = await this.walletModel.findOneAndUpdate(
            {
              _id: withdrawal.wallet_id,
              balance: {
                $gte: amount,
              },
            },
            {
              $inc: {
                balance: -amount,
              },
            },
            {
              new: true,
              session: dbSession,
              runValidators: true,
            },
          );

          if (!updatedWallet) {
            throw new BadRequestException('Insufficient wallet balance');
          }

          [walletTransaction] = await this.walletTransactionModel.create(
            [
              {
                wallet_id: withdrawal.wallet_id,
                transaction_type: WalletTransactionType.Withdrawal,
                amount,
                status: WalletTransactionStatus.Completed,
                reference_id: `withdrawal_request:${requestObjectId.toString()}`,
              },
            ],
            {
              session: dbSession,
            },
          );
        }

        updatedWithdrawal = await this.withdrawalRequestModel.findOneAndUpdate(
          {
            _id: requestObjectId,
            status: WithdrawalRequestStatus.Pending,
          },
          {
            $set: {
              status,
            },
          },
          {
            new: true,
            session: dbSession,
            runValidators: true,
          },
        );

        if (!updatedWithdrawal) {
          throw new BadRequestException('Withdrawal request is not pending');
        }
      });
    } finally {
      await dbSession.endSession();
    }

    const finalWithdrawal =
      updatedWithdrawal as unknown as WithdrawalRequestDocument;
    const wallet =
      (updatedWallet as WalletDocument | null) ??
      (await this.walletModel.findOne({
        _id: finalWithdrawal.wallet_id,
      }));
    const memberId = wallet?.userId?.toString();
    const member = memberId ? await this.usersService.findById(memberId) : null;
    const amount = finalWithdrawal.amount ?? 0;

    if (member?.email) {
      try {
        if (status === WithdrawalRequestStatus.Approved) {
          await this.mailService.sendWithdrawalApproved(member.email, amount);
        } else {
          await this.mailService.sendWithdrawalRejected(member.email, amount);
        }
      } catch (error) {
        this.logger.error(
          'Failed to send withdrawal status email',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      message:
        status === WithdrawalRequestStatus.Approved
          ? 'Withdrawal request approved successfully'
          : 'Withdrawal request rejected successfully',
      withdrawalRequest: {
        id: finalWithdrawal._id,
        wallet_id: finalWithdrawal.wallet_id,
        amount: finalWithdrawal.amount,
        status: finalWithdrawal.status,
      },
      wallet: wallet
        ? {
            id: wallet._id,
            memberId: wallet.userId,
            balance: wallet.balance,
          }
        : null,
      transaction: walletTransaction
        ? {
            id: walletTransaction._id,
            wallet_id: walletTransaction.wallet_id,
            transaction_type: walletTransaction.transaction_type,
            amount: walletTransaction.amount,
            status: walletTransaction.status,
            reference_id: walletTransaction.reference_id,
          }
        : null,
    };
  }

  async adjustMemberWalletBalance(
    memberId: string,
    data: {
      direction: ManualWalletAdjustmentDirection;
      amount: number;
      reason: string;
    },
    performedByAdminId: string,
  ) {
    const memberObjectId = this.toObjectId(memberId, 'Invalid member id');
    const adminObjectId = this.toObjectId(
      performedByAdminId,
      'Invalid admin id',
    );
    const amount = Number(data.amount);
    const reason = data.reason.trim();

    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    if (!reason) {
      throw new BadRequestException('Reason is required');
    }

    const member = await this.usersService.findById(memberId);

    if (!member) {
      throw new NotFoundException('Member account not found');
    }

    if (member.role !== 'member') {
      throw new BadRequestException('Target account must be a member');
    }

    const dbSession = await this.connection.startSession();

    try {
      let wallet: WalletDocument | null = null;
      let adjustedWalletId: Types.ObjectId | undefined;
      let walletTransaction: WalletTransactionDocument | undefined;
      let auditTrail: AuditTrailDocument | undefined;
      let balanceBefore = 0;
      let balanceAfter = 0;

      await dbSession.withTransaction(async () => {
        if (data.direction === ManualWalletAdjustmentDirection.Credit) {
          wallet = await this.walletModel.findOneAndUpdate(
            {
              userId: memberObjectId,
            },
            {
              $inc: {
                balance: amount,
              },
              $setOnInsert: {
                userId: memberObjectId,
              },
            },
            {
              new: true,
              upsert: true,
              session: dbSession,
              runValidators: true,
            },
          );

          if (!wallet) {
            throw new NotFoundException('Wallet not found');
          }

          balanceAfter = wallet.balance ?? 0;
          balanceBefore = balanceAfter - amount;
        } else {
          wallet = await this.walletModel.findOneAndUpdate(
            {
              userId: memberObjectId,
              balance: {
                $gte: amount,
              },
            },
            {
              $inc: {
                balance: -amount,
              },
            },
            {
              new: true,
              session: dbSession,
              runValidators: true,
            },
          );

          if (!wallet) {
            throw new BadRequestException('Insufficient wallet balance');
          }

          balanceAfter = wallet.balance ?? 0;
          balanceBefore = balanceAfter + amount;
        }

        const adjustedWallet = wallet;
        adjustedWalletId = adjustedWallet._id;

        const transactionType =
          data.direction === ManualWalletAdjustmentDirection.Credit
            ? WalletTransactionType.ManualCredit
            : WalletTransactionType.ManualDebit;

        [walletTransaction] = await this.walletTransactionModel.create(
          [
            {
              wallet_id: adjustedWallet._id,
              transaction_type: transactionType,
              amount,
              status: WalletTransactionStatus.Completed,
              reference_id: `manual_adjustment:${randomUUID()}`,
            },
          ],
          {
            session: dbSession,
          },
        );

        [auditTrail] = await this.auditTrailModel.create(
          [
            {
              actor_id: adminObjectId,
              action: AuditTrailAction.WalletManualAdjustment,
              target_type: 'wallet',
              target_id: adjustedWallet._id,
              wallet_transaction_id: walletTransaction._id,
              reason,
              metadata: {
                member_id: memberObjectId.toString(),
                direction: data.direction,
                amount,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
              },
            },
          ],
          {
            session: dbSession,
          },
        );
      });

      return {
        message: 'Member wallet adjusted successfully',
        wallet: {
          id: adjustedWalletId,
          memberId: member._id,
          balance: balanceAfter,
        },
        transaction: {
          id: walletTransaction?._id,
          wallet_id: walletTransaction?.wallet_id,
          transaction_type: walletTransaction?.transaction_type,
          amount: walletTransaction?.amount,
          status: walletTransaction?.status,
          reference_id: walletTransaction?.reference_id,
        },
        auditTrail: {
          id: auditTrail?._id,
          action: auditTrail?.action,
          reason: auditTrail?.reason,
          wallet_transaction_id: auditTrail?.wallet_transaction_id,
        },
      };
    } finally {
      await dbSession.endSession();
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

  private toWalletTransactionType(type: TransactionHistoryType):
    | WalletTransactionType
    | {
        $in: WalletTransactionType[];
      }
    | undefined {
    if (type === TransactionHistoryType.Deposit) {
      return {
        $in: [
          WalletTransactionType.Deposit,
          WalletTransactionType.ManualCredit,
        ],
      };
    }

    if (type === TransactionHistoryType.Withdrawal) {
      return {
        $in: [
          WalletTransactionType.Withdrawal,
          WalletTransactionType.ManualDebit,
        ],
      };
    }

    return undefined;
  }

  private toCmsWithdrawalRequestResponse(request: unknown) {
    const withdrawal = request as {
      _id: Types.ObjectId;
      wallet_id?: {
        _id: Types.ObjectId;
        userId?:
          | Types.ObjectId
          | {
              _id: Types.ObjectId;
              fullName?: string;
              email?: string;
              nationalId?: string;
              isActive?: boolean;
            };
        balance?: number;
        lastDepositAt?: Date | null;
        createdAt?: Date;
        updatedAt?: Date;
      };
      amount?: number;
      status?: WithdrawalRequestStatus;
      createdAt?: Date;
      updatedAt?: Date;
    };

    const wallet = withdrawal.wallet_id;
    const member = (
      wallet?.userId &&
      typeof wallet.userId === 'object' &&
      '_id' in wallet.userId
        ? wallet.userId
        : null
    ) as {
      _id: Types.ObjectId;
      fullName?: string;
      email?: string;
      nationalId?: string;
      isActive?: boolean;
    } | null;

    return {
      id: withdrawal._id,
      amount: withdrawal.amount,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
      updatedAt: withdrawal.updatedAt,
      wallet: wallet
        ? {
            id: wallet._id,
            balance: wallet.balance,
            lastDepositAt: wallet.lastDepositAt,
            createdAt: wallet.createdAt,
            updatedAt: wallet.updatedAt,
          }
        : null,
      member: member
        ? {
            id: member._id,
            fullName: member.fullName,
            email: member.email,
            nationalId: member.nationalId,
            isActive: member.isActive,
          }
        : null,
    };
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
