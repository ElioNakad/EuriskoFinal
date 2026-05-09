import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('portfolio/summary')
  getPortfolioSummary(@Req() req: Request & { user: { userId: string } }) {
    return this.ordersService.getPortfolioSummary(req.user.userId);
  }
}
