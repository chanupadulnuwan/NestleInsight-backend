import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Order } from '../orders/entities/order.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { UsersModule } from '../users/users.module';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { RouteApprovalRequest } from './entities/route-approval-request.entity';
import { RouteBeatPlanItem } from './entities/route-beat-plan-item.entity';
import { RouteBeatPlanTemplate } from './entities/route-beat-plan-template.entity';
import { SalesRoute } from './entities/sales-route.entity';
import { VanLoadRequest } from './entities/van-load-request.entity';
import { SalesRoutesController } from './sales-routes.controller';
import { SalesRoutesService } from './sales-routes.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      Outlet,
      RouteApprovalRequest,
      RouteBeatPlanItem,
      RouteBeatPlanTemplate,
      SalesRoute,
      StoreVisit,
      User,
      VanLoadRequest,
      Vehicle,
      Warehouse,
      WarehouseInventoryItem,
    ]),
    ActivityModule,
    UsersModule,
  ],
  controllers: [SalesRoutesController],
  providers: [SalesRoutesService, JwtAuthGuard, RolesGuard],
  exports: [SalesRoutesService, TypeOrmModule],
})
export class SalesRoutesModule {}
