import * as common from '@nestjs/common';

import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { WalletsService } from './wallets.service';

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
