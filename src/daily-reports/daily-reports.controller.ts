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

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { GenerateReportDto } from './dto/generate-report.dto';
import { UpdateReportDraftDto } from './dto/update-report-draft.dto';
import { DailyReportsService } from './daily-reports.service';

@Controller('daily-reports')
@UseGuards(JwtAuthGuard)
export class DailyReportsController {
  constructor(private readonly reportsService: DailyReportsService) { }

  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  generateReport(@Req() req: any, @Body() dto: GenerateReportDto) {
    return this.reportsService.generateReport(req.user?.userId, dto);
  }

  @Get('my/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  getMyReport(@Req() req: any, @Param('id') reportId: string) {
    return this.reportsService.getMyReport(req.user?.userId, reportId);
  }

  @Get('my')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  getMyReports(@Req() req: any) {
    return this.reportsService.getMyReports(req.user?.userId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  updateDraft(
    @Req() req: any,
    @Param('id') reportId: string,
    @Body() dto: UpdateReportDraftDto,
  ) {
    return this.reportsService.updateDraft(req.user?.userId, reportId, dto);
  }

  @Post(':id/submit')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  submitReport(@Req() req: any, @Param('id') reportId: string) {
    return this.reportsService.submitReport(req.user?.userId, reportId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR)
  getReports(
    @Query('territoryId') territoryId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getReports(territoryId, startDate, endDate);
  }
}
