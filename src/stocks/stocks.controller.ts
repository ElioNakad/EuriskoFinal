import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CmsAnalystGuard } from '../cms/guards/cms-analyst.guard';
import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { StocksService } from './stocks.service';

@Controller('stocks')
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @UseGuards(JwtAuthGuard, CmsAnalystGuard)
  @Post()
  create(@Body() createStockDto: CreateStockDto) {
    return this.stocksService.create(createStockDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.stocksService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':name')
  findByName(@Param('name') name: string, @Query() query: PaginationQueryDto) {
    return this.stocksService.findByName(name, query);
  }

  @UseGuards(JwtAuthGuard, CmsAnalystGuard)
  @Patch(':ticker')
  updateByTicker(
    @Param('ticker') ticker: string,
    @Body() updateStockDto: UpdateStockDto,
  ) {
    return this.stocksService.updateByTicker(ticker, updateStockDto);
  }

  @UseGuards(JwtAuthGuard, CmsAnalystGuard)
  @Patch(':ticker/delist')
  delist(@Param('ticker') ticker: string) {
    return this.stocksService.delist(ticker);
  }
}
