import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { DeliveryAssignmentsController } from './delivery-assignments.controller';
import { DeliveryAssignmentsService } from './delivery-assignments.service';
import { DeliveryAssignmentOrder } from './entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from './entities/delivery-assignment.entity';
import { IncidentReport } from './entities/incident-report.entity';
import { OrderReturn } from './entities/order-return.entity';
import { ReturnItem } from './entities/return-item.entity';

@Module({
  imports: [
    ActivityModule,
    TypeOrmModule.forFeature([
      DeliveryAssignment,
      DeliveryAssignmentOrder,
      OrderReturn,
      ReturnItem,
      IncidentReport,
      Order,
      User,
      Vehicle,
      WarehouseInventoryItem,
    ]),
  ],
  controllers: [DeliveryAssignmentsController],
  providers: [DeliveryAssignmentsService, JwtAuthGuard, RolesGuard, PortalApprovalGuard],
  exports: [DeliveryAssignmentsService, TypeOrmModule],
})
export class DeliveryAssignmentsModule {}
