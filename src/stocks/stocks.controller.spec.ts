import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CmsAnalystGuard } from '../cms/guards/cms-analyst.guard';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';

describe('StocksController', () => {
  let controller: StocksController;
  let service: jest.Mocked<
    Pick<
      StocksService,
      'create' | 'findAll' | 'findByName' | 'updateByTicker' | 'delist'
    >
  >;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findByName: jest.fn(),
      updateByTicker: jest.fn(),
      delist: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StocksController],
      providers: [
        {
          provide: StocksService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn(() => true),
      })
      .overrideGuard(CmsAnalystGuard)
      .useValue({
        canActivate: jest.fn(() => true),
      })
      .compile();

    controller = module.get<StocksController>(StocksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create a stock from request data', () => {
    const createStockDto = {
      ticker: 'MSFT',
      companyName: 'Microsoft',
      sector: 'Technology',
      currentPrice: 420,
      description: 'Software company',
      isListed: true,
    };

    controller.create(createStockDto);

    expect(service.create).toHaveBeenCalledWith(createStockDto);
  });

  it('should find all stocks', () => {
    controller.findAll();

    expect(service.findAll).toHaveBeenCalled();
  });

  it('should find a stock by name', () => {
    controller.findByName('Apple');

    expect(service.findByName).toHaveBeenCalledWith('Apple');
  });

  it('should update a stock by ticker', () => {
    const update = { currentPrice: 210 };

    controller.updateByTicker('AAPL', update);

    expect(service.updateByTicker).toHaveBeenCalledWith('AAPL', update);
  });

  it('should delist a stock by ticker', () => {
    controller.delist('AAPL');

    expect(service.delist).toHaveBeenCalledWith('AAPL');
  });
});
