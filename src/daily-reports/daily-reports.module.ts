import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssistedOrderRequest } from '../orders/entities/assisted-order-request.entity';
import { Order } from '../orders/entities/order.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { DailyReport } from './entities/daily-report.entity';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyReport,
      SalesRoute,
      StoreVisit,
      SalesIncident,
      AssistedOrderRequest,
      Order,
    ]),
    ActivityModule,
  ],
  controllers: [DailyReportsController],
  providers: [DailyReportsService, JwtAuthGuard, RolesGuard],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}
