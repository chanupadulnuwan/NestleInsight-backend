import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SmartRouteService } from './smart-route.service';
import { SmartRouteController } from './smart-route.controller';
import { RouteSession } from '../sales-routes/entities/route-session.entity';
import { RoutePlanStop } from '../sales-routes/entities/route-plan-stop.entity';
import { RouteStopEvent } from '../sales-routes/entities/route-stop-event.entity';
import { Outlet } from '../outlets/entities/outlet.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RouteSession,
      RoutePlanStop,
      RouteStopEvent,
      Outlet,
    ]),
  ],
  controllers: [SmartRouteController],
  providers: [SmartRouteService],
})
export class SmartRouteModule {}
