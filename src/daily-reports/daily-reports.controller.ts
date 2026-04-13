import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { GenerateReportDto } from './dto/generate-report.dto';
import { DailyReportsService } from './daily-reports.service';

@Controller('daily-reports')
@UseGuards(JwtAuthGuard)
export class DailyReportsController {
  constructor(private readonly reportsService: DailyReportsService) {}

  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  generateReport(@Req() req: any, @Body() dto: GenerateReportDto) {
    return this.reportsService.generateReport(req.user?.userId, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.REGIONAL_MANAGER)
  getReports(
    @Query('territoryId') territoryId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getReports(territoryId, startDate, endDate);
  }
}
