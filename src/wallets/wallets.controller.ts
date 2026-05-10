import * as common from '@nestjs/common';

import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { WalletsService } from './wallets.service';
import { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import { TransactionHistoryQueryDto } from './dto/transaction-history-query.dto';

@common.Controller('wallet')
export class WalletsController {
  constructor(private readonly walletService: WalletsService) {}

  @common.UseGuards(JwtAuthGuard)
  @common.Post('deposit-session')
  createDepositSession(
    @common.Req() req: Request & { user: { userId: string } },

    @common.Body('amount') amount: number,
  ) {
    return this.walletService.createDepositSession(req.user.userId, amount);
  }

  @common.UseGuards(JwtAuthGuard)
  @common.Post('withdrawal-request')
  requestWithdrawal(
    @common.Req() req: Request & { user: { userId: string } },

    @common.Body() requestWithdrawalDto: RequestWithdrawalDto,
  ) {
    return this.walletService.requestWithdrawal(
      req.user.userId,
      requestWithdrawalDto.amount,
    );
  }

  @common.UseGuards(JwtAuthGuard)
  @common.Get('transactions/history')
  getTransactionHistory(
    @common.Req() req: Request & { user: { userId: string } },
    @common.Query() query: TransactionHistoryQueryDto,
  ) {
    return this.walletService.getTransactionHistory(req.user.userId, query);
  }

  @common.Post('webhook')
  handleWebhook(
    @common.Req() req: common.RawBodyRequest<Request>,

    @common.Headers('stripe-signature')
    signature: string,
  ) {
    if (!req.rawBody || !signature) {
      throw new common.BadRequestException('Missing Stripe webhook payload');
    }

    return this.walletService.handleWebhook(req.rawBody, signature);
  }
}
