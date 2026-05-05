import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Order } from '../orders/entities/order.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { DeliveryAssignmentOrder } from '../delivery-assignments/entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from '../delivery-assignments/entities/delivery-assignment.entity';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { ReturnItem } from '../delivery-assignments/entities/return-item.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityLog,
      DeliveryAssignment,
      DeliveryAssignmentOrder,
      Order,
      OrderReturn,
      Outlet,
      Product,
      Promotion,
      PromotionProduct,
      PromotionTerritory,
      ReturnItem,
      SalesRoute,
      StoreVisit,
      Territory,
      User,
      Warehouse,
      WarehouseInventoryItem,
    ]),
  ],
  controllers: [ExportsController],
  providers: [ExportsService, JwtAuthGuard, RolesGuard],
  exports: [ExportsService],
})
export class ExportsModule {}
