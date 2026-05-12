import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { CmsService } from './cms.service';
import { CreateCmsAccountDto } from './dto/create-cms-account.dto';
import { MemberAccountStatusDto } from './dto/member-account-status.dto';
import { CmsSuperAdminGuard } from './guards/cms-super-admin.guard';

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
  ) {}

  @UseGuards(JwtAuthGuard, CmsSuperAdminGuard)
  @Post()
  createCmsUser(@Body() dto: CreateCmsAccountDto) {
    return this.cmsService.createCmsUser(dto);
  }

  @UseGuards(JwtAuthGuard, CmsSuperAdminGuard)
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

  @UseGuards(JwtAuthGuard, CmsSuperAdminGuard)
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
}
