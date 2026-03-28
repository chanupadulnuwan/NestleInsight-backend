import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Territory } from './entities/territory.entity';
import { TerritoriesController } from './territories.controller';
import { TerritoriesService } from './territories.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Territory,
      Warehouse,
      WarehouseInventoryItem,
      User,
      Vehicle,
    ]),
  ],
  controllers: [TerritoriesController],
  providers: [TerritoriesService, JwtAuthGuard, RolesGuard, PortalApprovalGuard],
  exports: [TerritoriesService, TypeOrmModule],
})
export class TerritoriesModule {}
