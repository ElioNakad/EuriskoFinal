import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CmsAnalystGuard } from '../cms/guards/cms-analyst.guard';
import { AnalystService } from './analyst.service';
import { ActiveMembersQueryDto } from './dto/active-members-query.dto';
import { TopStocksQueryDto } from './dto/top-stocks-query.dto';
import { VolumeQueryDto } from './dto/volume-query.dto';

@UseGuards(JwtAuthGuard, CmsAnalystGuard)
@Controller('analytics')
export class AnalystController {
  constructor(private readonly analystService: AnalystService) {}

  @Get('volume')
  getTradingVolume(@Query() query: VolumeQueryDto) {
    return this.analystService.getTradingVolume(query);
  }

  @Get('stocks/top')
  getTopTradedStocks(@Query() query: TopStocksQueryDto) {
    return this.analystService.getTopTradedStocks(query);
  }

  @Get('aum')
  getAssetsUnderManagement() {
    return this.analystService.getAssetsUnderManagement();
  }

  @Get('members/active')
  getMostActiveMembers(@Query() query: ActiveMembersQueryDto) {
    return this.analystService.getMostActiveMembers(query);
  }

  @Get('sectors')
  getSectorAllocation() {
    return this.analystService.getSectorAllocation();
  }
}
