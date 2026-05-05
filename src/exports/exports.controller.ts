import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { ExportsService } from './exports.service';

@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.DEMAND_PLANNER)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('ars-demand-forecast')
  async downloadArsDemandForecastExport(
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Query('forecastDays') forecastDays: string | undefined,
    @Res() res: Response,
  ) {
    const exportFile = await this.exportsService.generateArsDemandForecastExport({
      fromDate,
      toDate,
      forecastDays,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFile.filename}"`,
    );
    res.setHeader('Content-Length', exportFile.buffer.length);
    res.send(exportFile.buffer);
  }
}
