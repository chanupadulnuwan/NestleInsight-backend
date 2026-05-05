import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { ForecastEngineService } from './forecast-engine.service';

@Controller('forecast-engine')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.DEMAND_PLANNER)
export class ForecastEngineController {
  constructor(private readonly forecastEngineService: ForecastEngineService) {}

  @Get('ars-demand/preview')
  previewArsDemandForecast(
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Query('forecastDays') forecastDays: string | undefined,
    @Query('backtestDays') backtestDays: string | undefined,
  ) {
    return this.forecastEngineService.generateForecastPreview({
      fromDate,
      toDate,
      forecastDays,
      backtestDays,
    });
  }

  @Get('ars-demand/report')
  async downloadArsDemandForecastReport(
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Query('forecastDays') forecastDays: string | undefined,
    @Query('backtestDays') backtestDays: string | undefined,
    @Res() res: Response,
  ) {
    const report = await this.forecastEngineService.generateForecastReport({
      fromDate,
      toDate,
      forecastDays,
      backtestDays,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.setHeader('Content-Length', report.buffer.length);
    res.send(report.buffer);
  }
}
