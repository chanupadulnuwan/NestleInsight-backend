import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { buildPlannerReportAttachmentUrl, createPlannerReportUploadOptions } from './planner-report.storage';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { CreatePlannerReportDto } from './dto/create-planner-report.dto';
import { SaveCriticalDto } from './dto/save-critical.dto';
import { WarnReportDto } from './dto/warn-report.dto';
import { ReportDashboardService } from './report-dashboard.service';

@Controller('report-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.DEMAND_PLANNER)
export class ReportDashboardController {
  constructor(private readonly service: ReportDashboardService) {}

  // --- Inbox ---

  @Get('inbox')
  getInbox() {
    return this.service.getInbox();
  }

  @Patch('inbox/:dailyReportId/mark-read')
  markAsRead(@Req() req: any, @Param('dailyReportId') dailyReportId: string) {
    return this.service.markAsRead(dailyReportId, req.user?.userId);
  }

  @Get('daily-report/:id')
  getDailyReportDetail(@Param('id') id: string) {
    return this.service.getDailyReportDetail(id);
  }

  @Post('inbox/:dailyReportId/save')
  saveReport(@Req() req: any, @Param('dailyReportId') dailyReportId: string) {
    return this.service.saveReport(dailyReportId, req.user?.userId);
  }

  @Post('inbox/:dailyReportId/save-critical')
  saveCritical(
    @Req() req: any,
    @Param('dailyReportId') dailyReportId: string,
    @Body() dto: SaveCriticalDto,
  ) {
    return this.service.saveCritical(dailyReportId, req.user?.userId, dto);
  }

  @Post('inbox/:dailyReportId/warn')
  warnSalesRep(
    @Req() req: any,
    @Param('dailyReportId') dailyReportId: string,
    @Body() dto: WarnReportDto,
  ) {
    return this.service.warnSalesRep(dailyReportId, req.user?.userId, dto);
  }

  // --- Saved Reports ---

  @Get('saved')
  getSavedReports(
    @Query('territoryId') territoryId?: string,
    @Query('salesRepId') salesRepId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getSavedReports({ territoryId, salesRepId, startDate, endDate });
  }

  @Delete('saved/:dailyReportId')
  deleteSavedReport(@Req() req: any, @Param('dailyReportId') dailyReportId: string) {
    return this.service.deleteSavedReport(dailyReportId, req.user?.userId);
  }

  // --- Critical Reports ---

  @Get('critical')
  getCriticalReports() {
    return this.service.getCriticalReports();
  }

  @Patch('critical/:dailyReportId/resolve')
  resolveCritical(@Param('dailyReportId') dailyReportId: string) {
    return this.service.resolveCriticalReport(dailyReportId);
  }

  // --- Demand Planner Reports ---

  @Post('planner-reports')
  @UseInterceptors(FileInterceptor('attachment', createPlannerReportUploadOptions()))
  createPlannerReport(
    @Req() req: any,
    @Body() dto: CreatePlannerReportDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const attachmentUrl = file ? buildPlannerReportAttachmentUrl(file.filename) : undefined;
    return this.service.createPlannerReport(req.user?.userId, dto, attachmentUrl);
  }

  @Get('planner-reports')
  getPlannerReports(
    @Query('authorId') authorId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('isCritical') isCritical?: string,
  ) {
    return this.service.getPlannerReports({
      authorId,
      startDate,
      endDate,
      isCritical: isCritical === 'true' ? true : isCritical === 'false' ? false : undefined,
    });
  }

  @Delete('planner-reports/:id')
  deletePlannerReport(@Req() req: any, @Param('id') id: string) {
    return this.service.deletePlannerReport(id, req.user?.userId);
  }
}
