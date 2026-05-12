import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

import { MailService } from '../mail/mail.service';
import { AuditTrail } from '../cms/schemas/audit-trail.schema';
import { BuyOrder } from '../orders/schemas/buy-order.schema';
import { SellOrder } from '../orders/schemas/sell-order.schema';
import { UsersService } from '../users/users.service';
import { TransactionHistoryType } from './dto/transaction-history-query.dto';
import {
  WalletTransaction,
  WalletTransactionType,
} from './schemas/wallet-transaction.schema';
import { Wallet } from './schemas/wallet.schema';
import {
  WithdrawalRequest,
  WithdrawalRequestStatus,
} from './schemas/withdrawal-request.schema';
import { WalletsService } from './wallets.service';

describe('WalletsService', () => {
  let service: WalletsService;
  let walletModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let withdrawalRequestModel: {
    create: jest.Mock;
    exists: jest.Mock;
    find: jest.Mock;
  };
  let walletTransactionModel: {
    exists: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
  };
  let auditTrailModel: {
    create: jest.Mock;
  };
  let buyOrderModel: {
    find: jest.Mock;
  };
  let sellOrderModel: {
    find: jest.Mock;
  };
  let dbSession: {
    withTransaction: jest.Mock;
    endSession: jest.Mock;
  };

  beforeEach(async () => {
    dbSession = {
      withTransaction: jest.fn(async (callback: () => Promise<void>) =>
        callback(),
      ),
      endSession: jest.fn(),
    };
    walletModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    withdrawalRequestModel = {
      create: jest.fn(),
      exists: jest.fn(),
      find: jest.fn(),
    };
    walletTransactionModel = {
      exists: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
    };
    auditTrailModel = {
      create: jest.fn(),
    };
    buyOrderModel = {
      find: jest.fn(),
    };
    sellOrderModel = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('test-secret'),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendPaymentSuccess: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest.fn().mockResolvedValue(dbSession),
          },
        },
        {
          provide: getModelToken(Wallet.name),
          useValue: walletModel,
        },
        {
          provide: getModelToken(WithdrawalRequest.name),
          useValue: withdrawalRequestModel,
        },
        {
          provide: getModelToken(WalletTransaction.name),
          useValue: walletTransactionModel,
        },
        {
          provide: getModelToken(AuditTrail.name),
          useValue: auditTrailModel,
        },
        {
          provide: getModelToken(BuyOrder.name),
          useValue: buyOrderModel,
        },
        {
          provide: getModelToken(SellOrder.name),
          useValue: sellOrderModel,
        },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects withdrawals when the wallet balance is insufficient', async () => {
    walletModel.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      balance: 25,
      lastDepositAt: new Date(),
    });

    await expect(
      service.requestWithdrawal(new Types.ObjectId().toHexString(), 50),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(withdrawalRequestModel.create).not.toHaveBeenCalled();
  });

  it('creates a pending withdrawal request when funds are available', async () => {
    const walletId = new Types.ObjectId();

    walletModel.findOne.mockResolvedValue({
      _id: walletId,
      balance: 100,
      lastDepositAt: new Date(),
    });
    withdrawalRequestModel.exists.mockResolvedValue(null);
    withdrawalRequestModel.create.mockResolvedValue({
      wallet_id: walletId,
      amount: 50,
      status: WithdrawalRequestStatus.Pending,
    });

    await expect(
      service.requestWithdrawal(new Types.ObjectId().toHexString(), 50),
    ).resolves.toEqual({
      wallet_id: walletId,
      amount: 50,
      status: WithdrawalRequestStatus.Pending,
    });

    expect(withdrawalRequestModel.create).toHaveBeenCalledWith({
      wallet_id: walletId,
      amount: 50,
      status: WithdrawalRequestStatus.Pending,
    });
  });

  it('rejects when a withdrawal request is already pending', async () => {
    const walletId = new Types.ObjectId();

    walletModel.findOne.mockResolvedValue({
      _id: walletId,
      balance: 100,
      lastDepositAt: new Date(),
    });
    withdrawalRequestModel.exists.mockResolvedValue({
      _id: new Types.ObjectId(),
    });

    await expect(
      service.requestWithdrawal(new Types.ObjectId().toHexString(), 50),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(withdrawalRequestModel.create).not.toHaveBeenCalled();
  });

  it('combines completed wallet withdrawals with pending and rejected withdrawal requests', async () => {
    const walletId = new Types.ObjectId();
    const walletWithdrawalId = new Types.ObjectId();
    const pendingWithdrawalId = new Types.ObjectId();
    const rejectedWithdrawalId = new Types.ObjectId();
    const olderDate = new Date('2026-01-01T00:00:00.000Z');
    const newestDate = new Date('2026-01-03T00:00:00.000Z');
    const middleDate = new Date('2026-01-02T00:00:00.000Z');

    walletModel.findOne.mockResolvedValue({
      _id: walletId,
    });
    walletTransactionModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: walletWithdrawalId,
          transaction_type: 'withdrawal',
          amount: 100,
          status: 'completed',
          createdAt: middleDate,
          reference_id: 'approved-withdrawal',
        },
      ]),
    });
    withdrawalRequestModel.find = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          _id: pendingWithdrawalId,
          amount: 25,
          status: WithdrawalRequestStatus.Pending,
          createdAt: newestDate,
        },
        {
          _id: rejectedWithdrawalId,
          amount: 50,
          status: WithdrawalRequestStatus.Rejected,
          createdAt: olderDate,
        },
      ]),
    });

    await expect(
      service.getTransactionHistory(new Types.ObjectId().toHexString(), {
        type: TransactionHistoryType.Withdrawal,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: pendingWithdrawalId.toString(),
        source: 'withdrawals_requests',
        status: WithdrawalRequestStatus.Pending,
      }),
      expect.objectContaining({
        id: walletWithdrawalId.toString(),
        source: 'wallet_transactions',
        status: 'completed',
      }),
      expect.objectContaining({
        id: rejectedWithdrawalId.toString(),
        source: 'withdrawals_requests',
        status: WithdrawalRequestStatus.Rejected,
      }),
    ]);

    expect(walletTransactionModel.find).toHaveBeenCalledWith({
      wallet_id: walletId,
      transaction_type: {
        $in: [
          WalletTransactionType.Withdrawal,
          WalletTransactionType.ManualDebit,
        ],
      },
    });
    expect(withdrawalRequestModel.find).toHaveBeenCalledWith({
      wallet_id: walletId,
      status: {
        $in: [
          WithdrawalRequestStatus.Pending,
          WithdrawalRequestStatus.Rejected,
        ],
      },
    });
    expect(buyOrderModel.find).not.toHaveBeenCalled();
    expect(sellOrderModel.find).not.toHaveBeenCalled();
  });
});
