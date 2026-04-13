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
import { ReportIncidentDto } from './dto/report-incident.dto';
import { SalesIncidentsService } from './sales-incidents.service';

@Controller('sales-incidents')
@UseGuards(JwtAuthGuard)
export class SalesIncidentsController {
  constructor(private readonly incidentsService: SalesIncidentsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  reportIncident(@Req() req: any, @Body() dto: ReportIncidentDto) {
    return this.incidentsService.reportIncident(req.user?.userId, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.REGIONAL_MANAGER)
  getIncidents(
    @Query('territoryId') territoryId?: string,
    @Query('status') status?: string,
  ) {
    return this.incidentsService.getIncidents(territoryId, status);
  }
}
