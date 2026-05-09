import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { FeedbackSubmission } from '../activity/entities/feedback-submission.entity';
import { OrderFeedback } from '../activity/entities/order-feedback.entity';
import { AiWriterService } from '../ai-writer/ai-writer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { DeliveryAssignmentOrder } from '../delivery-assignments/entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from '../delivery-assignments/entities/delivery-assignment.entity';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { ForecastEngineModule } from '../forecast-engine/forecast-engine.module';
import { Order } from '../orders/entities/order.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { InsightCenterController } from './insight-center.controller';
import { InsightCenterService } from './insight-center.service';

@Module({
  imports: [
    ForecastEngineModule,
    TypeOrmModule.forFeature([
      ActivityLog,
      FeedbackSubmission,
      DailyReport,
      DeliveryAssignment,
      DeliveryAssignmentOrder,
      Order,
      OrderFeedback,
      OrderReturn,
      Outlet,
      Product,
      Promotion,
      PromotionProduct,
      PromotionTerritory,
      SalesIncident,
      StoreVisit,
      Territory,
      User,
      Warehouse,
    ]),
  ],
  controllers: [InsightCenterController],
  providers: [InsightCenterService, AiWriterService, JwtAuthGuard, RolesGuard],
})
export class InsightCenterModule {}
