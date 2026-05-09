import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { AiWriterService } from '../ai-writer/ai-writer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { ForecastEngineController } from './forecast-engine.controller';
import { ForecastEngineService } from './forecast-engine.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityLog,
      DailyReport,
      Order,
      Product,
      Promotion,
      PromotionProduct,
      PromotionTerritory,
      SalesIncident,
      StoreVisit,
      WarehouseInventoryItem,
    ]),
  ],
  controllers: [ForecastEngineController],
  providers: [ForecastEngineService, AiWriterService, JwtAuthGuard, RolesGuard],
  exports: [ForecastEngineService],
})
export class ForecastEngineModule {}
