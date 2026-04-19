import { ActivityLog } from '../activity/entities/activity.entity';
import { FeedbackSubmission } from '../activity/entities/feedback-submission.entity';
import { Category } from '../categories/entities/category.entity';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { AssistedOrderRequest } from '../orders/entities/assisted-order-request.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { RouteApprovalRequest } from '../sales-routes/entities/route-approval-request.entity';
import { RouteBeatPlanItem } from '../sales-routes/entities/route-beat-plan-item.entity';
import { RouteBeatPlanTemplate } from '../sales-routes/entities/route-beat-plan-template.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { VanLoadRequest } from '../sales-routes/entities/van-load-request.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
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
  DailyReport,
  Outlet,
  AssistedOrderRequest,
  Order,
  OrderItem,
  Product,
  RouteApprovalRequest,
  RouteBeatPlanItem,
  RouteBeatPlanTemplate,
  SalesIncident,
  SalesRoute,
  StoreVisit,
  Territory,
  User,
  VanLoadRequest,
  Vehicle,
  Warehouse,
  WarehouseInventoryItem,
];
