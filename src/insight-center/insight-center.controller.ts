import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { InsightCenterService } from './insight-center.service';

@Controller('insight-center')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.DEMAND_PLANNER)
export class InsightCenterController {
  constructor(private readonly insightCenterService: InsightCenterService) {}

  @Get('dashboard')
  dashboard(
    @Query('period') period: string | undefined,
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Query('granularity') granularity: string | undefined,
    @Query('demandType') demandType: string | undefined,
    @Query('viewMode') viewMode: string | undefined,
    @Query('confidenceLevel') confidenceLevel: string | undefined,
    @Query('compareMode') compareMode: string | undefined,
    @Query('source') source: string | undefined,
    @Query('territoryId') territoryId: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Query('routeId') routeId: string | undefined,
    @Query('shopId') shopId: string | undefined,
    @Query('productId') productId: string | undefined,
  ) {
    return this.insightCenterService.generateDashboard({
      period,
      fromDate,
      toDate,
      granularity,
      demandType,
      viewMode,
      confidenceLevel,
      compareMode,
      source,
      territoryId,
      warehouseId,
      routeId,
      shopId,
      productId,
    });
  }

  @Get('report.csv')
  async csvReport(
    @Query('period') period: string | undefined,
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Query('granularity') granularity: string | undefined,
    @Query('demandType') demandType: string | undefined,
    @Query('viewMode') viewMode: string | undefined,
    @Query('confidenceLevel') confidenceLevel: string | undefined,
    @Query('compareMode') compareMode: string | undefined,
    @Query('source') source: string | undefined,
    @Query('territoryId') territoryId: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Query('routeId') routeId: string | undefined,
    @Query('shopId') shopId: string | undefined,
    @Query('productId') productId: string | undefined,
    @Res() res: Response,
  ) {
    const report = await this.insightCenterService.generateCsvReport({
      period,
      fromDate,
      toDate,
      granularity,
      demandType,
      viewMode,
      confidenceLevel,
      compareMode,
      source,
      territoryId,
      warehouseId,
      routeId,
      shopId,
      productId,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.send(report.csv);
  }

  @Get('report.pdf')
  async pdfReport(
    @Query('period') period: string | undefined,
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Query('granularity') granularity: string | undefined,
    @Query('demandType') demandType: string | undefined,
    @Query('viewMode') viewMode: string | undefined,
    @Query('confidenceLevel') confidenceLevel: string | undefined,
    @Query('compareMode') compareMode: string | undefined,
    @Query('source') source: string | undefined,
    @Query('territoryId') territoryId: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Query('routeId') routeId: string | undefined,
    @Query('shopId') shopId: string | undefined,
    @Query('productId') productId: string | undefined,
    @Res() res: Response,
  ) {
    const report = await this.insightCenterService.generatePdfReport({
      period,
      fromDate,
      toDate,
      granularity,
      demandType,
      viewMode,
      confidenceLevel,
      compareMode,
      source,
      territoryId,
      warehouseId,
      routeId,
      shopId,
      productId,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.setHeader('Content-Length', report.buffer.length);
    res.send(report.buffer);
  }
}
