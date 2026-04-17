import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import {
  AddInventoryItemDto,
  CreateTmVehicleDto,
  TmWarehousesService,
} from './tm-warehouses.service';

@Controller('tm/warehouse')
@UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
@Roles(Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR)
export class TmWarehousesController {
  constructor(private readonly tmWarehousesService: TmWarehousesService) {}

  @Get()
  getMyWarehouse(@Req() req: any) {
    return this.tmWarehousesService.getMyWarehouse(req.user.userId);
  }

  @Get('users/:userId')
  getUserDetail(@Req() req: any, @Param('userId') targetUserId: string) {
    return this.tmWarehousesService.getUserDetail(req.user.userId, targetUserId);
  }

  @Post('inventory')
  addInventoryItem(@Req() req: any, @Body() dto: AddInventoryItemDto) {
    return this.tmWarehousesService.addInventoryItem(req.user.userId, dto);
  }

  @Post('vehicles/:vehicleId/assign')
  assignVehicle(@Req() req: any, @Param('vehicleId') vehicleId: string) {
    return this.tmWarehousesService.assignVehicle(req.user.userId, vehicleId);
  }

  @Post('vehicles')
  createVehicle(@Req() req: any, @Body() dto: CreateTmVehicleDto) {
    return this.tmWarehousesService.createVehicle(req.user.userId, dto);
  }
}
