import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

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
    @Query('productId') productId: string | undefined,
    @Query('planningWindow') planningWindow: string | undefined,
  ) {
    return this.forecastEngineService.generateForecastPreview({
      fromDate,
      toDate,
      forecastDays,
      backtestDays,
      productId,
      planningWindow,
    });
  }

  @Get('ars-demand/report')
  async downloadArsDemandForecastReport(
    @Query('fromDate') fromDate: string | undefined,
    @Query('toDate') toDate: string | undefined,
    @Query('forecastDays') forecastDays: string | undefined,
    @Query('backtestDays') backtestDays: string | undefined,
    @Query('productId') productId: string | undefined,
    @Query('planningWindow') planningWindow: string | undefined,
    @Res() res: Response,
  ) {
    const report = await this.forecastEngineService.generateForecastReport({
      fromDate,
      toDate,
      forecastDays,
      backtestDays,
      productId,
      planningWindow,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.setHeader('Content-Length', report.buffer.length);
    res.send(report.buffer);
  }

  @Post('ars-demand/import-preview')
  @UseInterceptors(FileInterceptor('bundle'))
  previewImportedArsDemandForecast(
    @UploadedFile() bundle: Express.Multer.File,
    @Body('fromDate') fromDate: string | undefined,
    @Body('toDate') toDate: string | undefined,
    @Body('forecastDays') forecastDays: string | undefined,
    @Body('backtestDays') backtestDays: string | undefined,
    @Body('productId') productId: string | undefined,
    @Body('planningWindow') planningWindow: string | undefined,
  ) {
    if (!bundle?.buffer) {
      throw new BadRequestException('An export ZIP bundle is required.');
    }

    return this.forecastEngineService.generateImportedForecastPreview(
      bundle.buffer,
      {
        fromDate,
        toDate,
        forecastDays,
        backtestDays,
        productId,
        planningWindow,
      },
    );
  }

  @Post('ars-demand/import-report')
  @UseInterceptors(FileInterceptor('bundle'))
  async downloadImportedArsDemandForecastReport(
    @UploadedFile() bundle: Express.Multer.File,
    @Body('fromDate') fromDate: string | undefined,
    @Body('toDate') toDate: string | undefined,
    @Body('forecastDays') forecastDays: string | undefined,
    @Body('backtestDays') backtestDays: string | undefined,
    @Body('productId') productId: string | undefined,
    @Body('planningWindow') planningWindow: string | undefined,
    @Res() res: Response,
  ) {
    if (!bundle?.buffer) {
      throw new BadRequestException('An export ZIP bundle is required.');
    }

    const report = await this.forecastEngineService.generateImportedForecastReport(
      bundle.buffer,
      {
        fromDate,
        toDate,
        forecastDays,
        backtestDays,
        productId,
        planningWindow,
      },
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.setHeader('Content-Length', report.buffer.length);
    res.send(report.buffer);
  }
}
