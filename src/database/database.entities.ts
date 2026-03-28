import { ActivityLog } from '../activity/entities/activity.entity';
import { FeedbackSubmission } from '../activity/entities/feedback-submission.entity';
import { Category } from '../categories/entities/category.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';

// Standalone database scripts do not benefit from Nest's autoLoadEntities.
export const databaseEntities = [
  ActivityLog,
  FeedbackSubmission,
  Category,
  Order,
  OrderItem,
  Product,
  Territory,
  User,
  Vehicle,
  Warehouse,
  WarehouseInventoryItem,
];
