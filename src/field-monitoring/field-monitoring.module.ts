import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { RoutePlanStop } from '../sales-routes/entities/route-plan-stop.entity';
import { RouteSession } from '../sales-routes/entities/route-session.entity';
import { RouteStopEvent } from '../sales-routes/entities/route-stop-event.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { User } from '../users/entities/user.entity';
import { FieldMonitoringController } from './field-monitoring.controller';
import { FieldMonitoringService } from './field-monitoring.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      SalesRoute,
      RouteSession,
      RoutePlanStop,
      RouteStopEvent,
      DailyReport,
      Outlet,
      SalesIncident,
      StoreVisit,
    ]),
  ],
  controllers: [FieldMonitoringController],
  providers: [FieldMonitoringService],
})
export class FieldMonitoringModule {}
