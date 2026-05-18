import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';

import { RedisService } from '../redis/redis.service';
import { Stock } from '../stocks/schemas/stock.schema';
import { User } from '../users/schemas/user.schema';
import { Wallet } from '../wallets/schemas/wallet.schema';
import { MailService } from '../mail/mail.service';
import { BuyOrder, BuyOrderStatus } from './schemas/buy-order.schema';
import { SellOrder, SellOrderStatus } from './schemas/sell-order.schema';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let stockModel: {
    findOne: jest.Mock;
    collection: {
      updateOne: jest.Mock;
    };
  };
  let walletModel: {
    collection: {
      updateOne: jest.Mock;
    };
  };
  let userModel: {
    findById: jest.Mock;
    collection: {
      updateOne: jest.Mock;
    };
  };
  let buyOrderModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    collection: {
      updateOne: jest.Mock;
    };
  };
  let sellOrderModel: {
    create: jest.Mock;
  };
  let redisService: {
    get: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
  };
  let mailService: {
    sendTradeConfirmation: jest.Mock;
  };
  let session: {
    withTransaction: jest.Mock;
    endSession: jest.Mock;
  };

  beforeEach(async () => {
    session = {
      withTransaction: jest.fn(async (callback: () => Promise<void>) =>
        callback(),
      ),
      endSession: jest.fn(),
    };

    stockModel = {
      findOne: jest.fn(),
      collection: {
        updateOne: jest.fn(),
      },
    };
    walletModel = {
      collection: {
        updateOne: jest.fn(),
      },
    };
    userModel = {
      findById: jest.fn(),
      collection: {
        updateOne: jest.fn(),
      },
    };
    buyOrderModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      collection: {
        updateOne: jest.fn(),
      },
    };
    sellOrderModel = {
      create: jest.fn(),
    };
    redisService = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };
    mailService = {
      sendTradeConfirmation: jest.fn(),
    };
    userModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest.fn().mockResolvedValue(session),
          },
        },
        {
          provide: getModelToken(Stock.name),
          useValue: stockModel,
        },
        {
          provide: getModelToken(Wallet.name),
          useValue: walletModel,
        },
        {
          provide: getModelToken(User.name),
          useValue: userModel,
        },
        {
          provide: getModelToken(BuyOrder.name),
          useValue: buyOrderModel,
        },
        {
          provide: getModelToken(SellOrder.name),
          useValue: sellOrderModel,
        },
        {
          provide: RedisService,
          useValue: redisService,
        },
        {
          provide: MailService,
          useValue: mailService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('fills a market buy order inside a transaction and evicts portfolio cache', async () => {
    const userId = new Types.ObjectId().toHexString();
    const stockId = new Types.ObjectId().toHexString();
    const orderId = new Types.ObjectId();
    const order = { _id: orderId };

    stockModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(stockId),
          ticker: 'AAPL',
          currentPrice: 25,
          isListed: true,
          availableShares: 10,
        }),
      }),
    });
    userModel.collection.updateOne.mockResolvedValue({ matchedCount: 1 });
    stockModel.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    walletModel.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    buyOrderModel.create.mockResolvedValue([order]);
    userModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          email: 'trader@example.com',
        }),
      }),
    });

    await expect(
      service.placeMarketBuyOrder(userId, {
        stockId,
        numberOfShares: 4,
      }),
    ).resolves.toEqual({
      message: 'Buy order filled',
      order,
    });

    expect(stockModel.collection.updateOne).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(stockId),
        isListed: true,
        availableShares: { $gte: 4 },
      },
      {
        $inc: {
          availableShares: -4,
        },
      },
      { session },
    );
    expect(userModel.collection.updateOne).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(userId),
        isActive: true,
      },
      {
        $currentDate: {
          lastTradingActivityAt: true,
        },
      },
      { session },
    );
    expect(walletModel.collection.updateOne).toHaveBeenCalledWith(
      {
        userId: new Types.ObjectId(userId),
        balance: { $gte: 100 },
      },
      {
        $inc: {
          balance: -100,
        },
      },
      { session },
    );
    expect(buyOrderModel.create).toHaveBeenCalledWith(
      [
        {
          stock_id: new Types.ObjectId(stockId),
          user_id: new Types.ObjectId(userId),
          numberOfShares: 4,
          availableShares: 4,
          costPerShare: 25,
          totalCost: 100,
          status: BuyOrderStatus.Filled,
        },
      ],
      { session },
    );
    expect(redisService.delete).toHaveBeenCalledWith(
      `portfolio-summary:${userId}`,
    );
    expect(mailService.sendTradeConfirmation).toHaveBeenCalledWith(
      'trader@example.com',
      'buy',
      'AAPL',
      4,
      25,
      100,
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejects when the wallet cannot cover the total cost', async () => {
    const userId = new Types.ObjectId().toHexString();
    const stockId = new Types.ObjectId().toHexString();

    stockModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(stockId),
          currentPrice: 25,
          isListed: true,
          availableShares: 10,
        }),
      }),
    });
    userModel.collection.updateOne.mockResolvedValue({ matchedCount: 1 });
    stockModel.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    walletModel.collection.updateOne.mockResolvedValue({ modifiedCount: 0 });

    await expect(
      service.placeMarketBuyOrder(userId, {
        stockId,
        numberOfShares: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(buyOrderModel.create).not.toHaveBeenCalled();
    expect(redisService.delete).not.toHaveBeenCalled();
    expect(mailService.sendTradeConfirmation).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejects a market buy order when the member is inactive inside the transaction', async () => {
    const userId = new Types.ObjectId().toHexString();
    const stockId = new Types.ObjectId().toHexString();

    userModel.collection.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(
      service.placeMarketBuyOrder(userId, {
        stockId,
        numberOfShares: 4,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(stockModel.findOne).not.toHaveBeenCalled();
    expect(stockModel.collection.updateOne).not.toHaveBeenCalled();
    expect(walletModel.collection.updateOne).not.toHaveBeenCalled();
    expect(buyOrderModel.create).not.toHaveBeenCalled();
    expect(redisService.delete).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  it('closes an open sell order inside a transaction and returns the refreshed portfolio summary', async () => {
    const userId = new Types.ObjectId().toHexString();
    const orderId = new Types.ObjectId().toHexString();
    const stockId = new Types.ObjectId();
    const sellOrder = { _id: new Types.ObjectId() };
    const summary = {
      userId,
      positions: [],
      totals: {
        shares: 0,
        cost: 0,
        marketValue: 0,
        unrealizedGainLoss: 0,
      },
      cachedAt: new Date().toISOString(),
    };

    buyOrderModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(orderId),
          stock_id: stockId,
          user_id: new Types.ObjectId(userId),
          numberOfShares: 4,
          availableShares: 4,
          costPerShare: 25,
          totalCost: 100,
          status: BuyOrderStatus.Filled,
        }),
      }),
    });
    userModel.collection.updateOne.mockResolvedValue({ matchedCount: 1 });
    stockModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: stockId,
          ticker: 'MSFT',
          currentPrice: 30,
          isListed: true,
        }),
      }),
    });
    buyOrderModel.collection.updateOne.mockResolvedValue({
      modifiedCount: 1,
    });
    stockModel.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    walletModel.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    sellOrderModel.create.mockResolvedValue([sellOrder]);
    redisService.get.mockResolvedValue(summary);
    userModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          email: 'trader@example.com',
        }),
      }),
    });

    await expect(
      service.closeMarketSellOrder(userId, {
        orderId,
      }),
    ).resolves.toEqual({
      message: 'Sell order closed',
      sellOrder,
      portfolioSummary: summary,
    });

    expect(buyOrderModel.collection.updateOne).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(orderId),
        user_id: new Types.ObjectId(userId),
        availableShares: { $gte: 4 },
      },
      {
        $set: expect.objectContaining({
          availableShares: 0,
        }),
      },
      { session },
    );
    expect(userModel.collection.updateOne).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(userId),
        isActive: true,
      },
      {
        $currentDate: {
          lastTradingActivityAt: true,
        },
      },
      { session },
    );
    expect(stockModel.collection.updateOne).toHaveBeenCalledWith(
      {
        _id: stockId,
      },
      {
        $inc: {
          availableShares: 4,
        },
      },
      { session },
    );
    expect(walletModel.collection.updateOne).toHaveBeenCalledWith(
      {
        userId: new Types.ObjectId(userId),
      },
      {
        $inc: {
          balance: 120,
        },
      },
      { session },
    );
    expect(sellOrderModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: new Types.ObjectId(userId),
          stock_id: stockId,
          buy_order_id: new Types.ObjectId(orderId),
          numberOfShares: 4,
          purchasePricePerShare: 25,
          sellPricePerShare: 30,
          costBasis: 100,
          proceeds: 120,
          profitLoss: 20,
          status: SellOrderStatus.Filled,
        }),
      ],
      { session },
    );
    expect(redisService.delete).toHaveBeenCalledWith(
      `portfolio-summary:${userId}`,
    );
    expect(redisService.get).toHaveBeenCalledWith(
      `portfolio-summary:${userId}`,
    );
    expect(mailService.sendTradeConfirmation).toHaveBeenCalledWith(
      'trader@example.com',
      'sell',
      'MSFT',
      4,
      30,
      120,
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('allows closing an existing position when the stock is delisted', async () => {
    const userId = new Types.ObjectId().toHexString();
    const orderId = new Types.ObjectId().toHexString();
    const stockId = new Types.ObjectId();
    const sellOrder = { _id: new Types.ObjectId() };
    const summary = {
      userId,
      positions: [],
      totals: {
        shares: 0,
        cost: 0,
        marketValue: 0,
        unrealizedGainLoss: 0,
      },
      cachedAt: new Date().toISOString(),
    };

    buyOrderModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(orderId),
          stock_id: stockId,
          user_id: new Types.ObjectId(userId),
          numberOfShares: 4,
          availableShares: 4,
          costPerShare: 25,
          totalCost: 100,
          status: BuyOrderStatus.Filled,
        }),
      }),
    });
    userModel.collection.updateOne.mockResolvedValue({ matchedCount: 1 });
    stockModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: stockId,
          currentPrice: 30,
          isListed: false,
        }),
      }),
    });
    buyOrderModel.collection.updateOne.mockResolvedValue({
      modifiedCount: 1,
    });
    stockModel.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    walletModel.collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    sellOrderModel.create.mockResolvedValue([sellOrder]);
    redisService.get.mockResolvedValue(summary);

    await expect(
      service.closeMarketSellOrder(userId, {
        orderId,
      }),
    ).resolves.toEqual({
      message: 'Sell order closed',
      sellOrder,
      portfolioSummary: summary,
    });

    expect(stockModel.findOne).toHaveBeenCalledWith({
      _id: stockId,
    });
    expect(stockModel.collection.updateOne).toHaveBeenCalledWith(
      {
        _id: stockId,
      },
      {
        $inc: {
          availableShares: 4,
        },
      },
      { session },
    );
  });

  it('returns cached portfolio summaries by member id', async () => {
    const userId = new Types.ObjectId().toHexString();
    const cachedSummary = {
      userId,
      positions: [],
      totals: {
        shares: 0,
        cost: 0,
        marketValue: 0,
        unrealizedGainLoss: 0,
      },
      cachedAt: new Date().toISOString(),
    };

    redisService.get.mockResolvedValue(cachedSummary);

    await expect(service.getPortfolioSummary(userId)).resolves.toEqual(
      cachedSummary,
    );

    expect(redisService.get).toHaveBeenCalledWith(
      `portfolio-summary:${userId}`,
    );
    expect(buyOrderModel.find).not.toHaveBeenCalled();
  });
});
