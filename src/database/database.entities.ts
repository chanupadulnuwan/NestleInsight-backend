import { ActivityLog } from '../activity/entities/activity.entity';
import { AdminReportReview } from '../report-dashboard/entities/admin-report-review.entity';
import { DemandPlannerReport } from '../report-dashboard/entities/demand-planner-report.entity';
import { FeedbackSubmission } from '../activity/entities/feedback-submission.entity';
import { OrderFeedback } from '../activity/entities/order-feedback.entity';
import { Category } from '../categories/entities/category.entity';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { DeliveryAssignmentOrder } from '../delivery-assignments/entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from '../delivery-assignments/entities/delivery-assignment.entity';
import { IncidentReport } from '../delivery-assignments/entities/incident-report.entity';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { ReturnItem } from '../delivery-assignments/entities/return-item.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { AssistedOrderRequest } from '../orders/entities/assisted-order-request.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionRedemption } from '../promotions/entities/promotion-redemption.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { RoutePlanStop } from '../sales-routes/entities/route-plan-stop.entity';
import { RouteSession } from '../sales-routes/entities/route-session.entity';
import { RouteStopEvent } from '../sales-routes/entities/route-stop-event.entity';
import { RouteApprovalRequest } from '../sales-routes/entities/route-approval-request.entity';
import { RouteBeatPlanItem } from '../sales-routes/entities/route-beat-plan-item.entity';
import { RouteBeatPlanTemplate } from '../sales-routes/entities/route-beat-plan-template.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { SkipReasonCode } from '../sales-routes/entities/skip-reason-code.entity';
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
  AdminReportReview,
  DemandPlannerReport,
  FeedbackSubmission,
  OrderFeedback,
  Category,
  DailyReport,
  DeliveryAssignment,
  DeliveryAssignmentOrder,
  IncidentReport,
  OrderReturn,
  ReturnItem,
  Outlet,
  AssistedOrderRequest,
  Order,
  OrderItem,
  Product,
  Promotion,
  PromotionProduct,
  PromotionRedemption,
  PromotionTerritory,
  RoutePlanStop,
  RouteSession,
  RouteStopEvent,
  RouteApprovalRequest,
  RouteBeatPlanItem,
  RouteBeatPlanTemplate,
  SalesIncident,
  SalesRoute,
  SkipReasonCode,
  StoreVisit,
  Territory,
  User,
  VanLoadRequest,
  Vehicle,
  Warehouse,
  WarehouseInventoryItem,
];
