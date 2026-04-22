import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { Outlet } from '../outlets/entities/outlet.entity';
import { SmartRouteService } from './smart-route.service';
import { SmartRouteController } from './smart-route.controller';
import { RouteBeatPlanItem } from '../sales-routes/entities/route-beat-plan-item.entity';
import { RouteSession } from '../sales-routes/entities/route-session.entity';
import { RoutePlanStop } from '../sales-routes/entities/route-plan-stop.entity';
import { RouteStopEvent } from '../sales-routes/entities/route-stop-event.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    ActivityModule,
    TypeOrmModule.forFeature([
      RouteSession,
      RoutePlanStop,
      RouteStopEvent,
      RouteBeatPlanItem,
      SalesRoute,
      Outlet,
      User,
    ]),
  ],
  controllers: [SmartRouteController],
  providers: [SmartRouteService],
})
export class SmartRouteModule {}
