import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { WarehouseInventoryItem } from './entities/warehouse-inventory-item.entity';
import { Warehouse } from './entities/warehouse.entity';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Warehouse,
      WarehouseInventoryItem,
      Territory,
      Product,
      User,
      Vehicle,
      Order,
    ]),
  ],
  controllers: [WarehousesController],
  providers: [WarehousesService, JwtAuthGuard, RolesGuard, PortalApprovalGuard],
  exports: [WarehousesService, TypeOrmModule],
})
export class WarehousesModule {}
