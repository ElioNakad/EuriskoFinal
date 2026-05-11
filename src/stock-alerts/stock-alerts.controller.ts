import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateStockAlertDto } from './dto/create-stock-alert.dto';
import { StockAlertsService } from './stock-alerts.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: string;
    email: string;
  };
};

@UseGuards(JwtAuthGuard)
@Controller('stock-alerts')
export class StockAlertsController {
  constructor(private readonly stockAlertsService: StockAlertsService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateStockAlertDto) {
    return this.stockAlertsService.create(request.user.userId, dto);
  }

  @Get()
  findMine(@Req() request: AuthenticatedRequest) {
    return this.stockAlertsService.findMine(request.user.userId);
  }

  @Delete(':id')
  cancel(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.stockAlertsService.cancel(request.user.userId, id);
  }
}
