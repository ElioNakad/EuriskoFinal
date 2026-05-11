import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CmsService } from './cms.service';
import { CreateCmsAccountDto } from './dto/create-cms-account.dto';
import { CmsSuperAdminGuard } from './guards/cms-super-admin.guard';

@Controller('cms/accounts')
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  @UseGuards(JwtAuthGuard, CmsSuperAdminGuard)
  @Post()
  createCmsUser(@Body() dto: CreateCmsAccountDto) {
    return this.cmsService.createCmsUser(dto);
  }
}
