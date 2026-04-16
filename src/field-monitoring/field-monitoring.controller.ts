import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FieldMonitoringService } from './field-monitoring.service';

@Controller('monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class FieldMonitoringController {
  constructor(private readonly fieldMonitoringService: FieldMonitoringService) {}

  /**
   * GET /monitoring/field-ops/overview?date=YYYY-MM-DD&territoryId=
   * Returns one row per field user for the given date.
   */
  @Get('field-ops/overview')
  getTeamOverview(
    @Query('date') date?: string,
    @Query('territoryId') territoryId?: string,
  ) {
    const queryDate = date ?? new Date().toISOString().split('T')[0];
    return this.fieldMonitoringService.getTeamOverview(queryDate, territoryId);
  }

  /**
   * GET /monitoring/field-ops/employee/:userId?date=YYYY-MM-DD
   * Returns the full drill-down for a single field user.
   */
  @Get('field-ops/employee/:userId')
  getEmployeeDetail(
    @Param('userId') userId: string,
    @Query('date') date?: string,
  ) {
    const queryDate = date ?? new Date().toISOString().split('T')[0];
    return this.fieldMonitoringService.getEmployeeDetail(userId, queryDate);
  }
}
