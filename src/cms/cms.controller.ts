import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { CmsService } from './cms.service';
import { CreateCmsAccountDto } from './dto/create-cms-account.dto';
import { ManualWalletAdjustmentDto } from './dto/manual-wallet-adjustment.dto';
import { MemberAccountStatusDto } from './dto/member-account-status.dto';
import { UpdateWithdrawalRequestStatusDto } from './dto/update-withdrawal-request-status.dto';
import { CmsAdminGuard } from './guards/cms-admin.guard';
import { CmsSuperAdminGuard } from './guards/cms-super-admin.guard';
import { CmsSupportAgentGuard } from './guards/cms-support-agent.guard';
import { CmsWithdrawalReviewGuard } from './guards/cms-withdrawal-review.guard';
import { TransactionHistoryQueryDto } from '../wallets/dto/transaction-history-query.dto';

type CmsRequest = Request & {
  user: {
    userId: string;
  };
};

@Controller('cms/accounts')
export class CmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
  ) {}

  @UseGuards(JwtAuthGuard, CmsSuperAdminGuard)
  @Post()
  createCmsUser(@Body() dto: CreateCmsAccountDto) {
    return this.cmsService.createCmsUser(dto);
  }

  @UseGuards(JwtAuthGuard, CmsAdminGuard)
  @Get('members/metrics')
  getMemberRegistrationMetrics() {
    return this.usersService.getMemberRegistrationMetrics();
  }

  @UseGuards(JwtAuthGuard, CmsSupportAgentGuard)
  @Get('members/:memberId')
  getMemberProfile(@Param('memberId') memberId: string) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.usersService.getMemberProfileForCms(memberId);
  }

  @UseGuards(JwtAuthGuard, CmsSupportAgentGuard)
  @Get('members/:memberId/transactions/history')
  getMemberTransactionHistory(
    @Param('memberId') memberId: string,
    @Query() query: TransactionHistoryQueryDto,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.walletsService.getMemberTransactionHistoryForCms(
      memberId,
      query,
    );
  }

  @UseGuards(JwtAuthGuard, CmsAdminGuard)
  @Post('members/:memberId/suspend')
  suspendMemberAccount(
    @Param('memberId') memberId: string,
    @Body() dto: MemberAccountStatusDto,
    @Req() request: CmsRequest,
  ) {
    return this.usersService.suspendMemberAccount(
      memberId,
      dto.reason,
      request.user.userId,
    );
  }

  @UseGuards(JwtAuthGuard, CmsAdminGuard)
  @Post('members/:memberId/reinstate')
  reinstateMemberAccount(
    @Param('memberId') memberId: string,
    @Body() dto: MemberAccountStatusDto,
    @Req() request: CmsRequest,
  ) {
    return this.usersService.reinstateMemberAccount(
      memberId,
      dto.reason,
      request.user.userId,
    );
  }

  @UseGuards(JwtAuthGuard, CmsAdminGuard)
  @Post('members/:memberId/wallet/adjust')
  adjustMemberWallet(
    @Param('memberId') memberId: string,
    @Body() dto: ManualWalletAdjustmentDto,
    @Req() request: CmsRequest,
  ) {
    return this.walletsService.adjustMemberWalletBalance(
      memberId,
      dto,
      request.user.userId,
    );
  }

  @UseGuards(JwtAuthGuard, CmsSupportAgentGuard)
  @Get('withdrawal-requests')
  getWithdrawalRequests(@Query() query: PaginationQueryDto) {
    return this.walletsService.getWithdrawalRequestsForCms(query);
  }

  @UseGuards(JwtAuthGuard, CmsSupportAgentGuard)
  @Get('withdrawal-requests/pending-review')
  getPendingWithdrawalRequests(@Query() query: PaginationQueryDto) {
    return this.walletsService.getPendingWithdrawalRequestsForCms(query);
  }

  @UseGuards(JwtAuthGuard, CmsWithdrawalReviewGuard)
  @Patch('withdrawal-requests/:requestId/status')
  updateWithdrawalRequestStatus(
    @Param('requestId') requestId: string,
    @Body() dto: UpdateWithdrawalRequestStatusDto,
  ) {
    return this.walletsService.updateWithdrawalRequestStatus(
      requestId,
      dto.status,
    );
  }
}
