import { Controller, Get, Post } from '@nestjs/common';
import { StocksService } from './stocks.service';

@Controller('stocks')
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @Post()
  create() {
    return this.stocksService.create();
  }

  @Get()
  findAll() {
    return this.stocksService.findAll();
  }
}
