import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StocksService } from './stocks.service';
import { StockHistory } from './schemas/stock-history.schema';
import { Stock } from './schemas/stock.schema';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';

describe('StocksService', () => {
  let service: StocksService;
  let rabbitMqService: {
    publish: jest.Mock;
  };
  let stockModel: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let stockHistoryModel: {
    find: jest.Mock;
  };

  beforeEach(async () => {
    stockModel = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    stockHistoryModel = {
      find: jest.fn(),
    };
    rabbitMqService = {
      publish: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StocksService,
        {
          provide: getModelToken(Stock.name),
          useValue: stockModel,
        },
        {
          provide: getModelToken(StockHistory.name),
          useValue: stockHistoryModel,
        },
        {
          provide: RabbitMqService,
          useValue: rabbitMqService,
        },
      ],
    }).compile();

    service = module.get<StocksService>(StocksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a stock from request data', async () => {
    const createStockDto = {
      ticker: 'MSFT',
      companyName: 'Microsoft',
      sector: 'Technology',
      currentPrice: 420,
      availableShares: 100,
      description: 'Software company',
      isListed: true,
    };

    stockModel.create.mockResolvedValue(createStockDto);

    await expect(service.create(createStockDto)).resolves.toBe(createStockDto);
    expect(stockModel.create).toHaveBeenCalledWith({
      ...createStockDto,
      initialShares: createStockDto.availableShares,
    });
  });

  it('should find all stocks', async () => {
    const stocks = [{ companyName: 'Apple' }];

    stockModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue(stocks),
    });

    await expect(service.findAll()).resolves.toBe(stocks);
  });

  it('should find a stock by name', async () => {
    const stock = {
      _id: 'stock-id',
      companyName: 'Apple',
      toObject: jest.fn().mockReturnValue({
        _id: 'stock-id',
        companyName: 'Apple',
      }),
    };
    const stockHistory = [
      { stockId: 'stock-id', operation: 'findOneAndUpdate' },
    ];

    stockModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(stock),
    });
    stockHistoryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(stockHistory),
      }),
    });

    await expect(service.findByName('Apple')).resolves.toEqual({
      _id: 'stock-id',
      companyName: 'Apple',
      stockHistory,
    });
    expect(stockModel.findOne).toHaveBeenCalledWith({
      ticker: /^Apple$/i,
    });
    expect(stockHistoryModel.find).toHaveBeenCalledWith({
      stockId: 'stock-id',
    });
  });

  it('should throw when a stock name is not found', async () => {
    stockModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.findByName('Missing')).rejects.toThrow(
      'Stock not found',
    );
  });

  it('should update a stock by ticker', async () => {
    const updatedStock = { ticker: 'AAPL', currentPrice: 210 };
    const previousStock = { ticker: 'AAPL', currentPrice: 200 };
    const update = { currentPrice: 210 };

    stockModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(previousStock),
    });
    stockModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updatedStock),
    });

    await expect(service.updateByTicker('AAPL', update)).resolves.toBe(
      updatedStock,
    );
    expect(stockModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        ticker: /^AAPL$/i,
      },
      update,
      {
        new: true,
        runValidators: true,
      },
    );
    expect(rabbitMqService.publish).toHaveBeenCalledWith(
      'stock.price',
      'stock.price.updated',
      expect.objectContaining({
        ticker: 'AAPL',
        previousPrice: 200,
        currentPrice: 210,
      }),
    );
  });

  it('should throw when updating a missing stock', async () => {
    stockModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.updateByTicker('Missing', { currentPrice: 210 }),
    ).rejects.toThrow('Stock not found');
  });
});
