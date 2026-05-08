import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
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
  };
  let withdrawalRequestModel: {
    create: jest.Mock;
  };

  beforeEach(async () => {
    walletModel = {
      findOne: jest.fn(),
    };
    withdrawalRequestModel = {
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-secret'),
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
          provide: getModelToken(Wallet.name),
          useValue: walletModel,
        },
        {
          provide: getModelToken(WithdrawalRequest.name),
          useValue: withdrawalRequestModel,
        },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects withdrawals within 48 hours of the last deposit', async () => {
    walletModel.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      balance: 100,
      lastDepositAt: new Date(Date.now() - 47 * 60 * 60 * 1000),
    });

    await expect(
      service.requestWithdrawal(new Types.ObjectId().toHexString(), 50),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(withdrawalRequestModel.create).not.toHaveBeenCalled();
  });

  it('creates a pending withdrawal request after 48 hours', async () => {
    const walletId = new Types.ObjectId();

    walletModel.findOne.mockResolvedValue({
      _id: walletId,
      balance: 100,
      lastDepositAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
    });
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
});
