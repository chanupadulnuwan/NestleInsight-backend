import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { SmartRouteService } from './smart-route.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('smart-route')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SALES_REP, Role.TERRITORY_DISTRIBUTOR)
export class SmartRouteController {
  constructor(private readonly smartRouteService: SmartRouteService) {}

  @Get('session')
  async getSession(@Request() req, @Query('date') dateString?: string) {
    let date = new Date();
    if (dateString) {
      date = new Date(dateString);
    }
    const territoryId = req.user?.territoryId || '00000000-0000-0000-0000-000000000001';
    const userId = req.user?.userId || req.user?.id;
    return this.smartRouteService.getOrCreateSession(userId, req.user?.role || Role.SALES_REP, date, territoryId);
  }

  @Get('next-stop')
  async getNextStop(
    @Request() req,
    @Query('sessionId') sessionId: string,
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.smartRouteService.getNextStop(
      sessionId,
      userId,
      lat ? Number(lat) : undefined,
      lng ? Number(lng) : undefined,
    );
  }

  @Get('progress')
  async getProgress(
    @Request() req,
    @Query('sessionId') sessionId: string,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.smartRouteService.getProgress(sessionId, userId);
  }

  @Post('skip')
  async skipStop(
    @Request() req,
    @Body('stopId') stopId: string,
    @Body('reasonCode') reasonCode: string,
    @Body('freeText') freeText: string,
    @Body('lat') lat?: number,
    @Body('lng') lng?: number,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.smartRouteService.skipStop(stopId, reasonCode, freeText, userId, lat, lng);
  }

  @Post('start')
  async startStop(
    @Request() req,
    @Body('stopId') stopId: string,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.smartRouteService.startStop(stopId, userId);
  }

  @Post('complete')
  async completeStop(
    @Request() req,
    @Body('stopId') stopId: string,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.smartRouteService.completeStop(stopId, userId);
  }
}
