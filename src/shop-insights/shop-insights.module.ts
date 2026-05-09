import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Order } from '../orders/entities/order.entity';
import { ShopInsightsController } from './shop-insights.controller';
import { ShopInsightsService } from './shop-insights.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [ShopInsightsController],
  providers: [ShopInsightsService, JwtAuthGuard, RolesGuard],
})
export class ShopInsightsModule {}
