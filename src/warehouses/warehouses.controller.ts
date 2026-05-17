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
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseInventoryDto } from './dto/update-warehouse-inventory.dto';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.REGIONAL_MANAGER, Role.SALES_REP, Role.DEMAND_PLANNER)
  listWarehouses(
    @Query('territoryId') territoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.warehousesService.listWarehouses(territoryId, search);
  }

  @Get('lookup')
  lookupWarehouseByName(@Query('name') name: string) {
    return this.warehousesService.lookupWarehouseByName(name);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
  @Roles(Role.ADMIN, Role.REGIONAL_MANAGER, Role.DEMAND_PLANNER)
  getWarehouseDetails(
    @Param('id') warehouseId: string,
    @Query('orderWindow') orderWindow?: string,
  ) {
    return this.warehousesService.getWarehouseDetails(warehouseId, orderWindow);
  }

  @Get(':id/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
  @Roles(Role.ADMIN, Role.REGIONAL_MANAGER)
  getWarehouseAnalytics(
    @Param('id') warehouseId: string,
    @Query('productId') productId?: string,
    @Query('days') days?: string,
  ) {
    return this.warehousesService.getWarehouseAnalytics(
      warehouseId,
      productId,
      days ? Math.min(Math.max(parseInt(days, 10) || 30, 7), 365) : 30,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  createWarehouse(@Body() createWarehouseDto: CreateWarehouseDto) {
    return this.warehousesService.createWarehouse(createWarehouseDto);
  }

  @Patch(':id/inventory')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  updateWarehouseInventory(
    @Param('id') warehouseId: string,
    @Body() updateWarehouseInventoryDto: UpdateWarehouseInventoryDto,
  ) {
    return this.warehousesService.updateWarehouseInventory(
      warehouseId,
      updateWarehouseInventoryDto,
    );
  }
}
