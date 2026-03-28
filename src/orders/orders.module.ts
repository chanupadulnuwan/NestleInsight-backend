import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TmOrdersController } from './tm-orders.controller';
import { TmOrdersService } from './tm-orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, User, WarehouseInventoryItem]),
    UsersModule,
    ActivityModule,
  ],
  controllers: [OrdersController, TmOrdersController],
  providers: [OrdersService, TmOrdersService, JwtAuthGuard, RolesGuard, PortalApprovalGuard],
  exports: [OrdersService, TypeOrmModule],
})
export class OrdersModule {}
