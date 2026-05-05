import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { ActivityLog } from '../activity/entities/activity.entity';
import { OrdersModule } from '../orders/orders.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { RouteBeatPlanItem } from '../sales-routes/entities/route-beat-plan-item.entity';
import { StoreVisit } from './entities/store-visit.entity';
import { StoreVisitsController } from './store-visits.controller';
import { StoreVisitsService } from './store-visits.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityLog,
      OrderReturn,
      StoreVisit,
      SalesRoute,
      RouteBeatPlanItem,
    ]),
    ActivityModule,
    OrdersModule,
  ],
  controllers: [StoreVisitsController],
  providers: [StoreVisitsService, JwtAuthGuard, RolesGuard],
  exports: [StoreVisitsService],
})
export class StoreVisitsModule {}
