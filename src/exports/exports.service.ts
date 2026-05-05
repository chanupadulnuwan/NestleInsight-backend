import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Role } from '../common/enums/role.enum';
import { DeliveryAssignmentOrder } from '../delivery-assignments/entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from '../delivery-assignments/entities/delivery-assignment.entity';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { ReturnItem } from '../delivery-assignments/entities/return-item.entity';
import { Order } from '../orders/entities/order.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { toCsv, type CsvColumn } from './utils/csv.util';
import { createZip } from './utils/zip.util';

type ExportQuery = {
  fromDate?: string;
  toDate?: string;
  forecastDays?: string;
};

type ExportFilters = {
  fromDate: Date | null;
  toDate: Date | null;
  forecastDays: number;
  generatedAt: Date;
  exportDateKey: string;
};

type OutletShopOwnerMatch = {
  outletId: string;
  shopOwnerId: string;
  matchSource: string;
  score: number;
};

type ShopReferenceRow = {
  canonical_shop_id: string;
  source_type: string;
  outlet_id: string | null;
  linked_shop_owner_user_id: string | null;
  link_match_source: string | null;
  outlet_name: string;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  address: string | null;
  territory_id: string | null;
  territory_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  registered_by_sales_rep_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ShopReferenceContext = {
  rowsByCanonicalId: Map<string, ShopReferenceRow>;
  canonicalByOutletId: Map<string, string>;
  canonicalByShopOwnerId: Map<string, { canonicalShopId: string; linkSource: string | null }>;
};

type OrderInfo = {
  order: Order;
  canonicalShopId: string;
  canonicalLinkSource: string;
  routeId: string | null;
};

type DeliveryItemRow = {
  delivery_item_id: string;
  delivery_id: string;
  order_id: string;
  canonical_shop_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  ordered_cases: number;
  delivered_cases: number;
  delivered_units: number;
  units_per_case: number;
  delivered_at: string | null;
  delivery_status: string;
  data_quality_flags: string;
};

type DeliveryRow = {
  delivery_id: string;
  order_id: string;
  assignment_id: string | null;
  canonical_shop_id: string;
  territory_id: string | null;
  warehouse_id: string | null;
  distributor_id: string | null;
  territory_manager_id: string | null;
  vehicle_id: string | null;
  delivery_date: string | null;
  delivered_at: string | null;
  delivery_status: string;
  delivery_mode: string;
  delivered_cases_total: number;
  delivered_item_count: number;
  data_quality_flags: string;
};

type ReturnItemExportRow = {
  return_item_id: string;
  return_id: string;
  order_id: string | null;
  canonical_shop_id: string | null;
  product_id: string | null;
  product_name: string;
  quantity_cases: number;
  quantity_units: number;
  units_per_case: number;
  reason: string;
  return_type: string;
  tm_verified: boolean;
  returned_at: string;
  data_quality_flags: string;
};

type OsaStockCountRow = {
  stock_count_id: string;
  visit_id: string;
  canonical_shop_id: string;
  sales_rep_id: string;
  route_id: string | null;
  product_id: string;
  product_name: string;
  units_per_case: number;
  shelf_units: number;
  backroom_units: number;
  current_stock_units: number;
  current_stock_cases: number;
  estimated_sales_input_units: number;
  in_stock: boolean;
  oos_reason: string;
  observed_at: string;
  observed_date: string;
  verified: boolean;
  duplicate_visit_conflict: boolean;
};

type StockoutEventRow = {
  stockout_event_id: string;
  visit_id: string;
  canonical_shop_id: string;
  product_id: string;
  product_name: string;
  observed_at: string;
  observed_date: string;
  stock_units: number;
  stockout_flag: boolean;
  oos_reason: string;
  detection_rule: string;
};

type DamageExpiredRow = {
  loss_event_id: string;
  visit_id: string;
  canonical_shop_id: string;
  product_id: string | null;
  product_name: string;
  loss_type: string;
  quantity_units: number;
  quantity_cases: number;
  units_per_case: number | null;
  observed_at: string;
  observed_date: string;
  notes: string;
  count_source: string;
  data_quality_flags: string;
};

type VisitSummaryRow = {
  visit_id: string;
  canonical_shop_id: string;
  shop_id: string | null;
  route_id: string | null;
  route_session_id: string | null;
  stop_id: string | null;
  sales_rep_id: string;
  territory_id: string | null;
  shop_name: string;
  visit_started_at: string;
  visit_ended_at: string | null;
  duration_minutes: number | null;
  duration_seconds: number | null;
  status: string;
  has_pending_delivery: boolean;
  planogram_ok: boolean | null;
  posm_ok: boolean | null;
  photo_count: number;
  created_at: string;
  updated_at: string;
};

type InventorySnapshotRow = {
  snapshot_id: string;
  snapshot_source: string;
  canonical_shop_id: string;
  warehouse_id: string | null;
  product_id: string;
  product_name: string;
  units_per_case: number;
  quantity_units: number;
  quantity_cases: number;
  snapshot_at: string;
  snapshot_date: string;
  reference_id: string;
};

type RetailOfftakeRow = {
  estimated_retail_offtake_id: string;
  canonical_shop_id: string;
  product_id: string;
  product_name: string;
  units_per_case: number;
  baseline_visit_id: string;
  current_visit_id: string;
  baseline_observed_at: string;
  current_observed_at: string;
  gap_days: number;
  previous_stock_units: number;
  delivered_units_since_previous_visit: number;
  returned_units_since_previous_visit: number;
  damaged_units_since_previous_visit: number;
  expired_units_since_previous_visit: number;
  current_stock_units: number;
  estimated_sold_units_raw: number;
  estimated_sold_units: number;
  estimated_sold_cases: number;
  estimated_sold_cases_per_day: number;
  stockout_flag: boolean;
  duplicate_visit_conflict: boolean;
  negative_clamped_flag: boolean;
  confidence_score: number;
  confidence_level: string;
  data_quality_flags: string;
  signal_date: string;
};

type ForecastRow = {
  forecast_date: string;
  canonical_shop_id: string;
  product_id: string;
  product_name: string;
  territory_id: string | null;
  warehouse_id: string | null;
  history_window_start: string | null;
  history_window_end: string | null;
  avg_daily_cases_7d: number;
  avg_daily_cases_28d: number;
  forecast_cases: number;
  promotion_flag: boolean;
  confidence_score: number;
  confidence_level: string;
  signal_source: string;
};

type CombinedSignalRow = {
  signal_kind: string;
  signal_date: string;
  canonical_shop_id: string;
  product_id: string;
  product_name: string;
  territory_id: string | null;
  warehouse_id: string | null;
  ordered_cases: number;
  delivered_cases: number;
  unfulfilled_cases: number;
  returned_cases: number;
  estimated_sold_cases: number;
  estimated_sold_cases_per_day: number;
  forecast_replenishment_cases: number;
  forecast_estimated_retail_cases: number;
  stockout_flag: boolean;
  promotion_flag: boolean;
  confidence_score: number;
  confidence_level: string;
  data_quality_flags: string;
};

type DictionaryRow = {
  file_name: string;
  column_name: string;
  data_type: string;
  description: string;
};

const DIRECT_ORDER_STATUSES = new Set([
  'PLACED',
  'APPROVED',
  'PROCEED',
  'COMPLETED',
  'PARTIAL',
  'DELAYED',
]);

const ACTIVE_PROMOTION_STATUSES = new Set(['active', 'scheduled']);

@Injectable()
export class ExportsService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityLogsRepo: Repository<ActivityLog>,
    @InjectRepository(DeliveryAssignment)
    private readonly assignmentsRepo: Repository<DeliveryAssignment>,
    @InjectRepository(DeliveryAssignmentOrder)
    private readonly assignmentOrdersRepo: Repository<DeliveryAssignmentOrder>,
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    @InjectRepository(OrderReturn)
    private readonly orderReturnsRepo: Repository<OrderReturn>,
    @InjectRepository(Outlet)
    private readonly outletsRepo: Repository<Outlet>,
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,
    @InjectRepository(Promotion)
    private readonly promotionsRepo: Repository<Promotion>,
    @InjectRepository(PromotionProduct)
    private readonly promotionProductsRepo: Repository<PromotionProduct>,
    @InjectRepository(PromotionTerritory)
    private readonly promotionTerritoriesRepo: Repository<PromotionTerritory>,
    @InjectRepository(SalesRoute)
    private readonly salesRoutesRepo: Repository<SalesRoute>,
    @InjectRepository(StoreVisit)
    private readonly storeVisitsRepo: Repository<StoreVisit>,
    @InjectRepository(Territory)
    private readonly territoriesRepo: Repository<Territory>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepo: Repository<Warehouse>,
    @InjectRepository(WarehouseInventoryItem)
    private readonly warehouseInventoryRepo: Repository<WarehouseInventoryItem>,
  ) {}

  async generateArsDemandForecastExport(query: ExportQuery) {
    const filters = this.normalizeFilters(query);
    const exportDate = filters.exportDateKey;

    const [
      products,
      territories,
      warehouses,
      outlets,
      users,
      routes,
      orders,
      assignments,
      assignmentOrders,
      orderReturns,
      visits,
      promotions,
      promotionProducts,
      promotionTerritories,
      warehouseInventory,
      activityLogs,
    ] = await Promise.all([
      this.productsRepo.find({ order: { productName: 'ASC' } }),
      this.territoriesRepo.find({ order: { name: 'ASC' } }),
      this.warehousesRepo.find({ order: { name: 'ASC' } }),
      this.outletsRepo.find({ order: { createdAt: 'ASC' } }),
      this.usersRepo.find({
        relations: { territory: true, warehouse: true },
        order: { createdAt: 'ASC' },
      }),
      this.salesRoutesRepo.find({
        relations: {
          salesRep: true,
          territory: true,
          warehouse: true,
          vehicle: true,
        },
        order: { createdAt: 'ASC' },
      }),
      this.ordersRepo.find({
        relations: {
          user: true,
          territory: true,
          warehouse: true,
          items: { product: true },
        },
        order: { placedAt: 'ASC' },
      }),
      this.assignmentsRepo.find({
        relations: {
          territoryManager: true,
          distributor: true,
          vehicle: true,
          assignmentOrders: {
            order: {
              user: true,
              items: { product: true },
            },
          },
        },
        order: { createdAt: 'ASC' },
      }),
      this.assignmentOrdersRepo.find({
        relations: {
          assignment: true,
          order: { user: true, items: { product: true } },
        },
      }),
      this.orderReturnsRepo.find({
        relations: {
          assignment: true,
          distributor: true,
          items: { product: true },
        },
        order: { createdAt: 'ASC' },
      }),
      this.storeVisitsRepo.find({
        relations: { salesRep: true, route: true },
        order: { visitStartedAt: 'ASC' },
      }),
      this.promotionsRepo.find({ order: { startDate: 'ASC' } }),
      this.promotionProductsRepo.find(),
      this.promotionTerritoriesRepo.find(),
      this.warehouseInventoryRepo.find({
        relations: { warehouse: true, product: true },
        order: { updatedAt: 'ASC' },
      }),
      this.activityLogsRepo.find({ order: { createdAt: 'ASC' } }),
    ]);

    const shopOwners = users.filter((user) => user.role === Role.SHOP_OWNER);
    const productById = new Map(products.map((product) => [product.id, product]));
    const territoryById = new Map(
      territories.map((territory) => [territory.id, territory]),
    );
    const warehouseById = new Map(
      warehouses.map((warehouse) => [warehouse.id, warehouse]),
    );
    const routeById = new Map(routes.map((route) => [route.id, route]));
    const outletMatches = this.buildOutletMatches(outlets, shopOwners);
    const shopReferenceContext = this.createShopReferenceContext(
      outlets,
      shopOwners,
      outletMatches,
      territoryById,
      warehouseById,
    );
    const promotionProductsByPromotionId = this.groupPromotionProducts(
      promotionProducts,
    );
    const promotionTerritoriesByPromotionId = this.groupPromotionTerritories(
      promotionTerritories,
    );

    const filteredOrders = orders.filter((order) =>
      this.isInRange(order.placedAt, filters),
    );
    const filteredRoutes = routes.filter((route) =>
      this.isInRange(route.startedAt ?? route.createdAt, filters),
    );
    const filteredReturns = orderReturns.filter((orderReturn) =>
      this.isInRange(orderReturn.createdAt, filters),
    );
    const completedVisits = visits.filter((visit) => visit.status === 'COMPLETED');
    const filteredVisits = completedVisits.filter((visit) =>
      this.isInRange(visit.visitEndedAt ?? visit.visitStartedAt, filters),
    );
    const filteredPromotions = promotions.filter((promotion) =>
      this.promotionTouchesRange(promotion, filters),
    );
    const filteredInventory = warehouseInventory.filter((item) =>
      this.isInRange(item.updatedAt, filters),
    );

    const orderInfos = new Map<string, OrderInfo>();
    const orderRows: Array<Record<string, unknown>> = [];
    const orderItemRows: Array<Record<string, unknown>> = [];

    for (const order of orders) {
      const resolvedShop = this.resolveOrderShopReference(
        order,
        shopReferenceContext,
      );
      const routeId = this.parseUuidFromNote(order.customerNote, 'Route');
      orderInfos.set(order.id, {
        order,
        canonicalShopId: resolvedShop.canonicalShopId,
        canonicalLinkSource: resolvedShop.linkSource,
        routeId,
      });

      if (this.isInRange(order.placedAt, filters)) {
        orderRows.push({
          order_id: order.id,
          order_code: order.orderCode,
          user_id: order.userId,
          canonical_shop_id: resolvedShop.canonicalShopId,
          canonical_link_source: resolvedShop.linkSource,
          shop_name: order.shopNameSnapshot,
          order_owner_role: order.user?.role ?? null,
          territory_id: order.territoryId,
          territory_name: order.territory?.name ?? null,
          warehouse_id: order.warehouseId,
          warehouse_name: order.warehouse?.name ?? null,
          route_id: routeId,
          status: order.status,
          source: order.source,
          applied_promotion_id: order.appliedPromotionId,
          applied_promotion_code: order.appliedPromotionCode,
          total_amount: Number(order.totalAmount ?? 0),
          subtotal_before_discount: Number(order.subtotalBeforeDiscount ?? 0),
          promotion_discount_total: Number(order.promotionDiscountTotal ?? 0),
          total_after_discount: Number(order.totalAfterDiscount ?? 0),
          placed_at: order.placedAt?.toISOString?.() ?? null,
          approved_at: order.approvedAt?.toISOString?.() ?? null,
          created_at: order.createdAt?.toISOString?.() ?? null,
          updated_at: order.updatedAt?.toISOString?.() ?? null,
          customer_note: order.customerNote ?? '',
        });
      }

      if (this.isInRange(order.placedAt, filters)) {
        for (const item of order.items) {
          const unitsPerCase = this.getUnitsPerCase(item.productId, productById);
          orderItemRows.push({
            order_item_id: item.id,
            order_id: order.id,
            canonical_shop_id: resolvedShop.canonicalShopId,
            product_id: item.productId,
            sku: item.skuSnapshot,
            product_name: item.productNameSnapshot,
            pack_size: item.packSizeSnapshot,
            units_per_case: unitsPerCase,
            quantity_cases: Number(item.quantity ?? 0),
            quantity_units: Number(item.quantity ?? 0) * unitsPerCase,
            case_price: Number(item.casePriceSnapshot ?? 0),
            line_total: Number(item.lineTotal ?? 0),
            placed_at: order.placedAt?.toISOString?.() ?? null,
            replenishment_demand_cases: Number(item.quantity ?? 0),
          });
        }
      }
    }

    const assignmentByOrderId = new Map<
      string,
      { assignment: DeliveryAssignment; dao: DeliveryAssignmentOrder }
    >();
    for (const assignment of assignments) {
      for (const dao of assignment.assignmentOrders ?? []) {
        if (dao.orderId) {
          assignmentByOrderId.set(dao.orderId, { assignment, dao });
        }
      }
    }

    const deliveryActivityByOrderId = this.groupDeliveryActivities(activityLogs);
    const deliveryRows: DeliveryRow[] = [];
    const deliveryItemRows: DeliveryItemRow[] = [];
    const allDeliveryItemRows: DeliveryItemRow[] = [];

    for (const order of orders) {
      const orderInfo = orderInfos.get(order.id);
      if (!orderInfo) {
        continue;
      }

      const assignmentLink = assignmentByOrderId.get(order.id) ?? null;
      const activities = deliveryActivityByOrderId.get(order.id) ?? [];
      const deliveredAt =
        activities[0]?.createdAt ?? this.resolveFallbackDeliveredAt(order, assignmentLink);
      const deliveryMode = assignmentLink
        ? 'ASSIGNED_DISTRIBUTOR'
        : activities.some((activity) =>
            ['SALES_REP_ORDER_DELIVERED', 'SALES_REP_ORDER_PARTIAL_DELIVERY'].includes(
              activity.type,
            ),
          )
          ? 'IMMEDIATE_SALES_REP'
          : 'ORDER_STATUS_ONLY';

      const derivedItems = this.deriveDeliveredItems(
        order,
        activities,
        productById,
      );

      if (derivedItems.length === 0 || !deliveredAt) {
        continue;
      }

      const deliveredAtIso = deliveredAt.toISOString();
      const isDeliveryInRange = this.isInRange(deliveredAt, filters);

      const deliveryId = assignmentLink
        ? `${assignmentLink.assignment.id}:${order.id}`
        : `delivery:${order.id}`;
      const deliveredCasesTotal = derivedItems.reduce(
        (sum, item) => sum + item.deliveredCases,
        0,
      );
      const dataQualityFlags: string[] = [];
      if (
        order.status === 'PARTIAL' &&
        !activities.some(
          (activity) => activity.type === 'SALES_REP_ORDER_PARTIAL_DELIVERY',
        )
      ) {
        dataQualityFlags.push('PARTIAL_DELIVERY_WITHOUT_ACTIVITY_DETAIL');
      }

      const deliveryRow: DeliveryRow = {
        delivery_id: deliveryId,
        order_id: order.id,
        assignment_id: assignmentLink?.assignment.id ?? null,
        canonical_shop_id: orderInfo.canonicalShopId,
        territory_id: order.territoryId,
        warehouse_id: order.warehouseId,
        distributor_id: assignmentLink?.assignment.distributorId ?? null,
        territory_manager_id:
          assignmentLink?.assignment.territoryManagerId ?? null,
        vehicle_id: assignmentLink?.assignment.vehicleId ?? null,
        delivery_date:
          assignmentLink?.assignment.deliveryDate ??
          this.dateKey(deliveredAt) ??
          null,
        delivered_at: deliveredAtIso,
        delivery_status: order.status,
        delivery_mode: deliveryMode,
        delivered_cases_total: this.roundNumber(deliveredCasesTotal),
        delivered_item_count: derivedItems.length,
        data_quality_flags: dataQualityFlags.join('|'),
      };

      if (isDeliveryInRange) {
        deliveryRows.push(deliveryRow);
      }

      for (const item of derivedItems) {
        const deliveryItemRow: DeliveryItemRow = {
          delivery_item_id: `${deliveryId}:${item.productId}`,
          delivery_id: deliveryId,
          order_id: order.id,
          canonical_shop_id: orderInfo.canonicalShopId,
          product_id: item.productId,
          sku: item.sku,
          product_name: item.productName,
          ordered_cases: item.orderedCases,
          delivered_cases: item.deliveredCases,
          delivered_units: item.deliveredCases * item.unitsPerCase,
          units_per_case: item.unitsPerCase,
          delivered_at: deliveredAtIso,
          delivery_status: order.status,
          data_quality_flags:
            order.status === 'PARTIAL' ? 'PARTIAL_DELIVERY' : '',
        };

        allDeliveryItemRows.push(deliveryItemRow);
        if (isDeliveryInRange) {
          deliveryItemRows.push(deliveryItemRow);
        }
      }
    }

    const returnRows: Array<Record<string, unknown>> = [];
    const returnItemRows: ReturnItemExportRow[] = [];
    const allReturnItemRows: ReturnItemExportRow[] = [];

    for (const orderReturn of orderReturns) {
      const linkedOrder = orderReturn.orderId
        ? orderInfos.get(orderReturn.orderId) ?? null
        : null;
      const canonicalShopId = linkedOrder?.canonicalShopId ?? null;

      if (this.isInRange(orderReturn.createdAt, filters)) {
        returnRows.push({
          return_id: orderReturn.id,
          assignment_id: orderReturn.assignmentId,
          order_id: orderReturn.orderId,
          distributor_id: orderReturn.distributorId,
          canonical_shop_id: canonicalShopId,
          return_type: orderReturn.returnType,
          tm_verified: orderReturn.tmVerified,
          verification_note: orderReturn.verificationNote ?? '',
          returned_at: orderReturn.createdAt.toISOString(),
        });
      }

      for (const item of orderReturn.items ?? []) {
        const unitsPerCase = this.getUnitsPerCase(item.productId, productById);
        const row: ReturnItemExportRow = {
          return_item_id: item.id,
          return_id: orderReturn.id,
          order_id: orderReturn.orderId,
          canonical_shop_id: canonicalShopId,
          product_id: item.productId,
          product_name: item.productNameSnapshot,
          quantity_cases: Number(item.quantity ?? 0),
          quantity_units: Number(item.quantity ?? 0) * unitsPerCase,
          units_per_case: unitsPerCase,
          reason: item.reason,
          return_type: orderReturn.returnType,
          tm_verified: orderReturn.tmVerified,
          returned_at: orderReturn.createdAt.toISOString(),
          data_quality_flags:
            unitsPerCase <= 1 && !item.productId
              ? 'MISSING_PRODUCT_REFERENCE'
              : 'RETURN_QUANTITY_ASSUMED_CASES',
        };

        allReturnItemRows.push(row);
        if (this.isInRange(orderReturn.createdAt, filters)) {
          returnItemRows.push(row);
        }
      }
    }

    const visitRows: VisitSummaryRow[] = [];
    const osaStockCounts: OsaStockCountRow[] = [];
    const stockoutEvents: StockoutEventRow[] = [];
    const damageExpiredRows: DamageExpiredRow[] = [];
    const inventorySnapshots: InventorySnapshotRow[] = [];

    const canonicalShopByVisitShopId = new Map<string, string>();

    for (const visit of completedVisits) {
      const canonicalShopId = visit.shopId
        ? this.ensureOutletReference(shopReferenceContext, visit.shopId)
        : `visit_only:${visit.id}`;

      if (visit.shopId) {
        canonicalShopByVisitShopId.set(visit.shopId, canonicalShopId);
      }

      const observedAt = visit.visitEndedAt ?? visit.visitStartedAt;
      const observedAtIso = observedAt?.toISOString?.() ?? visit.createdAt.toISOString();
      const observedDate = this.dateKey(observedAt);

      if (this.isInRange(observedAt, filters)) {
        visitRows.push({
          visit_id: visit.id,
          canonical_shop_id: canonicalShopId,
          shop_id: visit.shopId,
          route_id: visit.routeId,
          route_session_id: visit.routeSessionId,
          stop_id: visit.stopId,
          sales_rep_id: visit.salesRepId,
          territory_id: visit.territoryId,
          shop_name: visit.shopNameSnapshot,
          visit_started_at: visit.visitStartedAt.toISOString(),
          visit_ended_at: visit.visitEndedAt?.toISOString?.() ?? null,
          duration_minutes: visit.durationMinutes,
          duration_seconds: visit.durationSeconds,
          status: visit.status,
          has_pending_delivery: visit.hasPendingDelivery,
          planogram_ok: visit.planogramOk,
          posm_ok: visit.posmOk,
          photo_count: visit.photoUrls?.length ?? 0,
          created_at: visit.createdAt.toISOString(),
          updated_at: visit.updatedAt.toISOString(),
        });
      }

      const stockItems = Array.isArray(visit.shelfStockJson)
        ? visit.shelfStockJson
        : [];
      for (const stockItem of stockItems) {
        const stockRecord = stockItem as unknown as Record<string, unknown>;
        const productId = stockRecord.productId?.toString() ?? '';
        if (!productId) {
          continue;
        }

        const unitsPerCase = this.getUnitsPerCase(productId, productById);
        const shelfUnits = this.readNumber(stockRecord.shelfCount);
        const backroomUnits = this.readNumber(stockRecord.backroomCount);
        const currentStockUnits = shelfUnits + backroomUnits;
        const inStock =
          stockRecord.inStock === undefined
            ? currentStockUnits > 0
            : Boolean(stockRecord.inStock);
        const duplicateConflict = false;

        const row: OsaStockCountRow = {
          stock_count_id: `${visit.id}:${productId}`,
          visit_id: visit.id,
          canonical_shop_id: canonicalShopId,
          sales_rep_id: visit.salesRepId,
          route_id: visit.routeId,
          product_id: productId,
          product_name: stockRecord.productName?.toString() ?? 'Unknown Product',
          units_per_case: unitsPerCase,
          shelf_units: shelfUnits,
          backroom_units: backroomUnits,
          current_stock_units: currentStockUnits,
          current_stock_cases: this.roundNumber(
            unitsPerCase > 0 ? currentStockUnits / unitsPerCase : 0,
          ),
          estimated_sales_input_units: this.readNumber(stockRecord.estimatedSales),
          in_stock: inStock,
          oos_reason: stockRecord.oosReason?.toString() ?? '',
          observed_at: observedAtIso,
          observed_date: observedDate,
          verified: true,
          duplicate_visit_conflict: duplicateConflict,
        };

        osaStockCounts.push(row);

        const snapshotRow: InventorySnapshotRow = {
          snapshot_id: `visit_snapshot:${visit.id}:${productId}`,
          snapshot_source: 'STORE_VISIT',
          canonical_shop_id: canonicalShopId,
          warehouse_id: visit.route?.warehouseId ?? visit.routeId ?? null,
          product_id: productId,
          product_name: row.product_name,
          units_per_case: unitsPerCase,
          quantity_units: currentStockUnits,
          quantity_cases: row.current_stock_cases,
          snapshot_at: observedAtIso,
          snapshot_date: observedDate,
          reference_id: visit.id,
        };
        inventorySnapshots.push(snapshotRow);

        if (!inStock || currentStockUnits <= 0 || row.oos_reason.trim()) {
          stockoutEvents.push({
            stockout_event_id: `stockout:${visit.id}:${productId}`,
            visit_id: visit.id,
            canonical_shop_id: canonicalShopId,
            product_id: productId,
            product_name: row.product_name,
            observed_at: observedAtIso,
            observed_date: observedDate,
            stock_units: currentStockUnits,
            stockout_flag: true,
            oos_reason: row.oos_reason,
            detection_rule:
              !inStock || row.oos_reason.trim()
                ? 'VISIT_FLAG'
                : 'ZERO_STOCK_COUNT',
          });
        }
      }

      const expiryItems = Array.isArray(visit.expiryItemsJson)
        ? visit.expiryItemsJson
        : [];
      for (const expiryItem of expiryItems) {
        const expiryRecord = expiryItem as Record<string, unknown>;
        if (!Boolean(expiryRecord.hasExpiredItems)) {
          continue;
        }

        const productId = expiryRecord.productId?.toString() ?? null;
        const unitsPerCase = productId
          ? this.getUnitsPerCase(productId, productById)
          : null;

        damageExpiredRows.push({
          loss_event_id: `expiry:${visit.id}:${productId ?? 'unknown'}`,
          visit_id: visit.id,
          canonical_shop_id: canonicalShopId,
          product_id: productId,
          product_name:
            expiryRecord.productName?.toString() ?? 'Unknown Product',
          loss_type: 'EXPIRED',
          quantity_units: 0,
          quantity_cases: 0,
          units_per_case: unitsPerCase,
          observed_at: observedAtIso,
          observed_date: observedDate,
          notes: expiryRecord.notes?.toString() ?? '',
          count_source: 'BOOLEAN_FLAG_ONLY',
          data_quality_flags: 'NO_EXPLICIT_EXPIRED_QUANTITY',
        });
      }

      const osaIssues = Array.isArray(visit.osaIssuesJson)
        ? visit.osaIssuesJson
        : [];
      for (const issue of osaIssues) {
        const issueRecord = issue as unknown as Record<string, unknown>;
        const tag = issueRecord.tag?.toString().toLowerCase() ?? '';
        if (!tag.includes('damage')) {
          continue;
        }

        const productIds = Array.isArray(issueRecord.productIds)
          ? issueRecord.productIds.map((value) => String(value))
          : [];
        const productNames = Array.isArray(issueRecord.productNames)
          ? issueRecord.productNames.map((value) => String(value))
          : [];
        const resolvedProductId = productIds[0] ?? null;
        const unitsPerCase = resolvedProductId
          ? this.getUnitsPerCase(resolvedProductId, productById)
          : null;

        damageExpiredRows.push({
          loss_event_id: `damage:${visit.id}:${resolvedProductId ?? 'unknown'}`,
          visit_id: visit.id,
          canonical_shop_id: canonicalShopId,
          product_id: resolvedProductId,
          product_name: productNames[0] ?? 'Unknown Product',
          loss_type: 'DAMAGED',
          quantity_units: 0,
          quantity_cases: 0,
          units_per_case: unitsPerCase,
          observed_at: observedAtIso,
          observed_date: observedDate,
          notes: issueRecord.notes?.toString() ?? '',
          count_source: 'OSA_ISSUE_ONLY',
          data_quality_flags: 'NO_EXPLICIT_DAMAGE_QUANTITY',
        });
      }
    }

    const filteredOsaStockCounts = osaStockCounts.filter((row) =>
      this.isInRange(row.observed_at, filters),
    );
    const filteredStockoutEvents = stockoutEvents.filter((row) =>
      this.isInRange(row.observed_at, filters),
    );
    const filteredDamageExpiredRows = damageExpiredRows.filter((row) =>
      this.isInRange(row.observed_at, filters),
    );
    const filteredInventorySnapshots = inventorySnapshots.filter((row) =>
      this.isInRange(row.snapshot_at, filters),
    );

    const normalizedStockCounts = this.normalizeDuplicateStockCounts(
      osaStockCounts,
    );
    const deliveryEventsByKey = this.groupTimedQuantityRows(allDeliveryItemRows, 'delivered_at');
    const returnEventsByKey = this.groupTimedQuantityRows(allReturnItemRows, 'returned_at');
    const lossEventsByKey = this.groupLossRows(damageExpiredRows);
    const stockoutEventsByKey = this.groupStockoutRows(stockoutEvents);

    const estimatedRetailOfftake = this.buildEstimatedRetailOfftakeRows(
      normalizedStockCounts,
      deliveryEventsByKey,
      returnEventsByKey,
      lossEventsByKey,
      stockoutEventsByKey,
    );
    const filteredEstimatedRetailOfftake = estimatedRetailOfftake.filter((row) =>
      this.isInRange(row.current_observed_at, filters),
    );

    const promotionRows = filteredPromotions.map((promotion) => ({
      promotion_id: promotion.id,
      name: promotion.name,
      code: promotion.code,
      description: promotion.description,
      status: promotion.status,
      promotion_type: promotion.promotionType,
      discount_type: promotion.discountType,
      discount_value: Number(promotion.discountValue ?? 0),
      min_quantity: promotion.minQuantity,
      min_order_value: Number(promotion.minOrderValue ?? 0),
      usage_limit: promotion.usageLimit,
      per_shop_limit: promotion.perShopLimit,
      created_by: promotion.createdBy,
      start_date: promotion.startDate.toISOString(),
      end_date: promotion.endDate.toISOString(),
      eligible_product_ids: (promotionProductsByPromotionId.get(promotion.id) ?? [])
        .map((record) => record.productId)
        .join('|'),
      eligible_territory_ids: (
        promotionTerritoriesByPromotionId.get(promotion.id) ?? []
      )
        .map((record) => record.territoryId)
        .join('|'),
      created_at: promotion.createdAt.toISOString(),
      updated_at: promotion.updatedAt.toISOString(),
    }));

    const promotionProductRows = promotionProducts
      .filter((record) =>
        filteredPromotions.some((promotion) => promotion.id === record.promotionId),
      )
      .map((record) => {
        const product = productById.get(record.productId);
        return {
          promotion_product_id: record.id,
          promotion_id: record.promotionId,
          product_id: record.productId,
          sku: product?.sku ?? '',
          product_name: product?.productName ?? '',
          units_per_case: product?.productsPerCase ?? 1,
        };
      });

    const calendarBounds = this.resolveCalendarBounds(
      filters,
      filteredOrders,
      deliveryRows,
      filteredReturns,
      filteredVisits,
      filteredEstimatedRetailOfftake,
    );
    const calendarRows = this.buildCalendarRows(
      calendarBounds.startDate,
      this.addDays(calendarBounds.endDate, filters.forecastDays),
    );

    const replenishmentDaily = this.aggregateDailyOrderDemand(orderInfos, orders);
    const deliveredDaily = this.aggregateDailyDeliveredDemand(allDeliveryItemRows);
    const returnedDaily = this.aggregateDailyReturns(allReturnItemRows);
    const estimatedDaily = this.aggregateDailyEstimatedOfftake(
      estimatedRetailOfftake,
    );
    const stockoutDaily = this.aggregateDailyStockouts(stockoutEvents);
    const promotionFlagResolver = this.createPromotionFlagResolver(
      promotions,
      promotionProductsByPromotionId,
      promotionTerritoriesByPromotionId,
      shopReferenceContext,
    );

    const forecastHorizonStart =
      filters.toDate ?? calendarBounds.endDate ?? filters.generatedAt;
    const forecastReplenishmentRows = this.buildForecastRows(
      replenishmentDaily,
      shopReferenceContext,
      productById,
      forecastHorizonStart,
      filters.forecastDays,
      'REPLENISHMENT_DEMAND',
      promotionFlagResolver,
    );
    const forecastEstimatedRetailRows = this.buildForecastRows(
      estimatedDaily,
      shopReferenceContext,
      productById,
      forecastHorizonStart,
      filters.forecastDays,
      'ESTIMATED_RETAIL_OFFTAKE',
      promotionFlagResolver,
    );

    const combinedSignalRows = this.buildCombinedSignalRows(
      replenishmentDaily,
      deliveredDaily,
      returnedDaily,
      estimatedDaily,
      stockoutDaily,
      filteredEstimatedRetailOfftake,
      forecastReplenishmentRows,
      forecastEstimatedRetailRows,
      shopReferenceContext,
      productById,
      filters,
      promotionFlagResolver,
    );

    const shopReferenceRows = [...shopReferenceContext.rowsByCanonicalId.values()].sort(
      (left, right) => left.canonical_shop_id.localeCompare(right.canonical_shop_id),
    );

    const territoryRows = territories.map((territory) => ({
      territory_id: territory.id,
      name: territory.name,
      slug: territory.slug,
      latitude: territory.latitude,
      longitude: territory.longitude,
      created_at: territory.createdAt.toISOString(),
      updated_at: territory.updatedAt.toISOString(),
    }));

    const warehouseRows = warehouses.map((warehouse) => ({
      warehouse_id: warehouse.id,
      territory_id: warehouse.territoryId,
      territory_name: warehouse.territory?.name ?? '',
      name: warehouse.name,
      slug: warehouse.slug,
      address: warehouse.address,
      latitude: warehouse.latitude,
      longitude: warehouse.longitude,
      phone_number: warehouse.phoneNumber,
      manager_user_id: warehouse.managerUserId,
      created_at: warehouse.createdAt.toISOString(),
      updated_at: warehouse.updatedAt.toISOString(),
    }));

    const routeRows = filteredRoutes.map((route) => ({
      route_id: route.id,
      sales_rep_id: route.salesRepId,
      sales_rep_name:
        route.salesRep
          ? `${route.salesRep.firstName} ${route.salesRep.lastName}`.trim()
          : '',
      territory_id: route.territoryId,
      territory_name: route.territory?.name ?? '',
      warehouse_id: route.warehouseId,
      warehouse_name: route.warehouse?.name ?? '',
      vehicle_id: route.vehicleId,
      status: route.status,
      started_at: route.startedAt?.toISOString?.() ?? null,
      closed_at: route.closedAt?.toISOString?.() ?? null,
      created_at: route.createdAt.toISOString(),
      updated_at: route.updatedAt.toISOString(),
    }));

    const productRows = products.map((product) => ({
      product_id: product.id,
      sku: product.sku,
      product_name: product.productName,
      category_id: product.categoryId,
      category_name: product.category?.name ?? '',
      brand: product.brand,
      pack_size: product.packSize,
      unit_price: Number(product.unitPrice ?? 0),
      case_price: Number(product.casePrice ?? 0),
      units_per_case: product.productsPerCase,
      barcode: product.barcode,
      status: product.status,
      created_at: product.createdAt.toISOString(),
      updated_at: product.updatedAt.toISOString(),
    }));

    const inventoryWarehouseRows = filteredInventory.map((item) => ({
      snapshot_id: `warehouse_inventory:${item.id}`,
      snapshot_source: 'WAREHOUSE_SYSTEM',
      canonical_shop_id: '',
      warehouse_id: item.warehouseId,
      product_id: item.productId,
      product_name: item.product?.productName ?? '',
      units_per_case: item.product?.productsPerCase ?? 1,
      quantity_units:
        Number(item.quantityOnHand ?? 0) * (item.product?.productsPerCase ?? 1),
      quantity_cases: Number(item.quantityOnHand ?? 0),
      snapshot_at: item.updatedAt.toISOString(),
      snapshot_date: this.dateKey(item.updatedAt),
      reference_id: item.id,
    }));

    const allInventorySnapshots = [
      ...filteredInventorySnapshots,
      ...inventoryWarehouseRows,
    ];

    const manifest = {
      export_name: `ars_demand_forecast_export_${exportDate}.zip`,
      generated_at: filters.generatedAt.toISOString(),
      filters: {
        from_date: filters.fromDate ? this.dateKey(filters.fromDate) : null,
        to_date: filters.toDate ? this.dateKey(filters.toDate) : null,
        forecast_days: filters.forecastDays,
      },
      files: {
        'products.csv': productRows.length,
        'outlets.csv': shopReferenceRows.length,
        'territories.csv': territoryRows.length,
        'warehouses.csv': warehouseRows.length,
        'routes.csv': routeRows.length,
        'calendar.csv': calendarRows.length,
        'orders.csv': orderRows.length,
        'order_items.csv': orderItemRows.length,
        'deliveries.csv': deliveryRows.length,
        'delivery_items.csv': deliveryItemRows.length,
        'returns.csv': returnRows.length,
        'return_items.csv': returnItemRows.length,
        'sales_rep_visits.csv': visitRows.length,
        'osa_stock_counts.csv': filteredOsaStockCounts.length,
        'stockout_events.csv': filteredStockoutEvents.length,
        'damaged_expired_counts.csv': filteredDamageExpiredRows.length,
        'inventory_snapshots.csv': allInventorySnapshots.length,
        'promotions.csv': promotionRows.length,
        'promotion_products.csv': promotionProductRows.length,
        'estimated_retail_offtake.csv': filteredEstimatedRetailOfftake.length,
        'forecast_replenishment_demand.csv': forecastReplenishmentRows.length,
        'forecast_estimated_retail_offtake.csv':
          forecastEstimatedRetailRows.length,
        'forecast_demand_signals.csv': combinedSignalRows.length,
      },
      business_rules: [
        'Separate replenishment demand from estimated retail offtake.',
        'Calculate estimated retail offtake only between verified stock-count visits.',
        'Use delivered quantities, not ordered quantities, for stock movement calculations.',
        'Perform all stock movement calculations in base units before converting back to cases.',
        'Clamp negative estimated sold units to zero and flag the row for data quality review.',
      ],
      known_limitations: [
        'Damaged and expired quantities are not explicitly stored in the source system, so rows may carry zero quantities with quality flags.',
        'Direct shop-owner orders and outlet visits do not always share a single key, so canonical shop references use outlet matching heuristics where possible.',
        'Some delivery rows rely on order-completion status and activity timestamps because item-level delivery quantities are not persisted for every workflow.',
      ],
    };

    const dictionaryRows = this.buildDictionaryRows();
    const modifiedAt = filters.generatedAt;
    const zipBuffer = createZip([
      {
        name: 'manifest.json',
        data: JSON.stringify(manifest, null, 2),
        modifiedAt,
      },
      {
        name: 'data_dictionary.csv',
        data: toCsv(dictionaryRows, this.dictionaryColumns()),
        modifiedAt,
      },
      { name: 'products.csv', data: toCsv(productRows, this.productColumns()), modifiedAt },
      { name: 'outlets.csv', data: toCsv(shopReferenceRows, this.shopReferenceColumns()), modifiedAt },
      { name: 'territories.csv', data: toCsv(territoryRows, this.territoryColumns()), modifiedAt },
      { name: 'warehouses.csv', data: toCsv(warehouseRows, this.warehouseColumns()), modifiedAt },
      { name: 'routes.csv', data: toCsv(routeRows, this.routeColumns()), modifiedAt },
      { name: 'calendar.csv', data: toCsv(calendarRows, this.calendarColumns()), modifiedAt },
      { name: 'orders.csv', data: toCsv(orderRows, this.orderColumns()), modifiedAt },
      { name: 'order_items.csv', data: toCsv(orderItemRows, this.orderItemColumns()), modifiedAt },
      { name: 'deliveries.csv', data: toCsv(deliveryRows, this.deliveryColumns()), modifiedAt },
      { name: 'delivery_items.csv', data: toCsv(deliveryItemRows, this.deliveryItemColumns()), modifiedAt },
      { name: 'returns.csv', data: toCsv(returnRows, this.returnColumns()), modifiedAt },
      { name: 'return_items.csv', data: toCsv(returnItemRows, this.returnItemColumns()), modifiedAt },
      { name: 'sales_rep_visits.csv', data: toCsv(visitRows, this.visitColumns()), modifiedAt },
      { name: 'osa_stock_counts.csv', data: toCsv(filteredOsaStockCounts, this.osaColumns()), modifiedAt },
      { name: 'stockout_events.csv', data: toCsv(filteredStockoutEvents, this.stockoutColumns()), modifiedAt },
      { name: 'damaged_expired_counts.csv', data: toCsv(filteredDamageExpiredRows, this.damageColumns()), modifiedAt },
      { name: 'inventory_snapshots.csv', data: toCsv(allInventorySnapshots, this.inventoryColumns()), modifiedAt },
      { name: 'promotions.csv', data: toCsv(promotionRows, this.promotionColumns()), modifiedAt },
      { name: 'promotion_products.csv', data: toCsv(promotionProductRows, this.promotionProductColumns()), modifiedAt },
      { name: 'estimated_retail_offtake.csv', data: toCsv(filteredEstimatedRetailOfftake, this.retailOfftakeColumns()), modifiedAt },
      { name: 'forecast_replenishment_demand.csv', data: toCsv(forecastReplenishmentRows, this.forecastColumns()), modifiedAt },
      { name: 'forecast_estimated_retail_offtake.csv', data: toCsv(forecastEstimatedRetailRows, this.forecastColumns()), modifiedAt },
      { name: 'forecast_demand_signals.csv', data: toCsv(combinedSignalRows, this.combinedSignalColumns()), modifiedAt },
    ]);

    return {
      filename: `ars_demand_forecast_export_${exportDate}.zip`,
      buffer: zipBuffer,
    };
  }

  private normalizeFilters(query: ExportQuery): ExportFilters {
    const fromDate = query.fromDate?.trim()
      ? this.parseDateOnly(query.fromDate.trim(), 'fromDate')
      : null;
    const toDate = query.toDate?.trim()
      ? this.parseDateOnly(query.toDate.trim(), 'toDate')
      : null;

    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('fromDate cannot be after toDate.');
    }

    const rawForecastDays = Number(query.forecastDays ?? 30);
    if (!Number.isInteger(rawForecastDays) || rawForecastDays < 1 || rawForecastDays > 180) {
      throw new BadRequestException(
        'forecastDays must be an integer between 1 and 180.',
      );
    }

    const generatedAt = new Date();
    return {
      fromDate,
      toDate,
      forecastDays: rawForecastDays,
      generatedAt,
      exportDateKey: this.dateKey(generatedAt),
    };
  }

  private parseDateOnly(value: string, fieldName: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(
        `${fieldName} must use YYYY-MM-DD format.`,
      );
    }

    return new Date(`${value}T00:00:00.000Z`);
  }

  private isInRange(value: Date | string | null | undefined, filters: ExportFilters) {
    if (!value) {
      return false;
    }

    const date =
      value instanceof Date
        ? value
        : /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T00:00:00.000Z`)
          : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const fromTime = filters.fromDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    const toTime =
      (filters.toDate
        ? this.addDays(filters.toDate, 1).getTime() - 1
        : Number.POSITIVE_INFINITY);

    return date.getTime() >= fromTime && date.getTime() <= toTime;
  }

  private promotionTouchesRange(promotion: Promotion, filters: ExportFilters) {
    if (!filters.fromDate && !filters.toDate) {
      return true;
    }

    const fromTime = filters.fromDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    const toTime =
      filters.toDate
        ? this.addDays(filters.toDate, 1).getTime() - 1
        : Number.POSITIVE_INFINITY;

    return (
      promotion.endDate.getTime() >= fromTime &&
      promotion.startDate.getTime() <= toTime
    );
  }

  private buildOutletMatches(outlets: Outlet[], shopOwners: User[]) {
    const matchesByOutletId = new Map<string, OutletShopOwnerMatch | null>();
    const matchesByShopOwnerId = new Map<string, OutletShopOwnerMatch>();
    const eligibleShopOwners = shopOwners.filter(
      (user) =>
        user.accountStatus === AccountStatus.ACTIVE &&
        user.approvalStatus === ApprovalStatus.APPROVED,
    );

    for (const outlet of outlets) {
      const normalizedOutletName = this.normalizeText(outlet.outletName);
      const normalizedOwnerName = this.normalizeText(outlet.ownerName);
      const normalizedEmail = this.normalizeText(outlet.ownerEmail);
      const normalizedPhone = this.normalizePhone(outlet.ownerPhone);

      const candidates = eligibleShopOwners
        .map((shopOwner) => {
          const matchesTerritory =
            !outlet.territoryId || shopOwner.territoryId === outlet.territoryId;
          const matchesWarehouse =
            !outlet.warehouseId || shopOwner.warehouseId === outlet.warehouseId;
          const normalizedShopName = this.normalizeText(shopOwner.shopName);
          const normalizedUserName = this.normalizeText(
            `${shopOwner.firstName} ${shopOwner.lastName}`,
          );
          const normalizedUserEmail = this.normalizeText(shopOwner.email);
          const normalizedUserPhone = this.normalizePhone(shopOwner.phoneNumber);

          let score = 0;
          let matchSource = '';

          if (
            normalizedEmail &&
            normalizedEmail === normalizedUserEmail &&
            matchesTerritory
          ) {
            score = 400;
            matchSource = 'SHOP_OWNER_EMAIL';
          } else if (
            normalizedPhone &&
            normalizedPhone === normalizedUserPhone &&
            (matchesTerritory || matchesWarehouse)
          ) {
            score = 300;
            matchSource = 'SHOP_OWNER_PHONE';
          } else if (
            normalizedOutletName &&
            normalizedOutletName === normalizedShopName &&
            (matchesTerritory || matchesWarehouse)
          ) {
            score = 200;
            matchSource = 'SHOP_NAME';
          } else if (
            normalizedOwnerName &&
            normalizedOwnerName === normalizedUserName &&
            matchesTerritory
          ) {
            score = 100;
            matchSource = 'OWNER_NAME';
          }

          return {
            outletId: outlet.id,
            shopOwnerId: shopOwner.id,
            matchSource,
            score,
          } satisfies OutletShopOwnerMatch;
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);

      const bestMatch = candidates[0] ?? null;
      matchesByOutletId.set(outlet.id, bestMatch);
      if (!bestMatch) {
        continue;
      }

      const existing = matchesByShopOwnerId.get(bestMatch.shopOwnerId);
      if (!existing || existing.score < bestMatch.score) {
        matchesByShopOwnerId.set(bestMatch.shopOwnerId, bestMatch);
      }
    }

    return { matchesByOutletId, matchesByShopOwnerId };
  }

  private createShopReferenceContext(
    outlets: Outlet[],
    shopOwners: User[],
    outletMatches: {
      matchesByOutletId: Map<string, OutletShopOwnerMatch | null>;
      matchesByShopOwnerId: Map<string, OutletShopOwnerMatch>;
    },
    territoryById: Map<string, Territory>,
    warehouseById: Map<string, Warehouse>,
  ): ShopReferenceContext {
    const context: ShopReferenceContext = {
      rowsByCanonicalId: new Map<string, ShopReferenceRow>(),
      canonicalByOutletId: new Map<string, string>(),
      canonicalByShopOwnerId: new Map<
        string,
        { canonicalShopId: string; linkSource: string | null }
      >(),
    };

    for (const outlet of outlets) {
      const canonicalShopId = `outlet:${outlet.id}`;
      const match = outletMatches.matchesByOutletId.get(outlet.id) ?? null;
      const territory = outlet.territoryId
        ? territoryById.get(outlet.territoryId)
        : null;
      const warehouse = outlet.warehouseId
        ? warehouseById.get(outlet.warehouseId)
        : null;

      context.rowsByCanonicalId.set(canonicalShopId, {
        canonical_shop_id: canonicalShopId,
        source_type: 'OUTLET',
        outlet_id: outlet.id,
        linked_shop_owner_user_id: match?.shopOwnerId ?? null,
        link_match_source: match?.matchSource ?? null,
        outlet_name: outlet.outletName,
        owner_name: outlet.ownerName,
        owner_phone: outlet.ownerPhone,
        owner_email: outlet.ownerEmail,
        address: outlet.address,
        territory_id: outlet.territoryId,
        territory_name: territory?.name ?? null,
        warehouse_id: outlet.warehouseId,
        warehouse_name: warehouse?.name ?? null,
        latitude: outlet.latitude,
        longitude: outlet.longitude,
        status: outlet.status,
        registered_by_sales_rep_id: outlet.registeredBySalesRepId,
        created_at: outlet.createdAt.toISOString(),
        updated_at: outlet.updatedAt.toISOString(),
      });
      context.canonicalByOutletId.set(outlet.id, canonicalShopId);

      if (match?.shopOwnerId) {
        context.canonicalByShopOwnerId.set(match.shopOwnerId, {
          canonicalShopId,
          linkSource: match.matchSource,
        });
      }
    }

    for (const shopOwner of shopOwners) {
      if (context.canonicalByShopOwnerId.has(shopOwner.id)) {
        continue;
      }

      const canonicalShopId = `shop_owner:${shopOwner.id}`;
      context.rowsByCanonicalId.set(canonicalShopId, {
        canonical_shop_id: canonicalShopId,
        source_type: 'SHOP_OWNER_ACCOUNT',
        outlet_id: null,
        linked_shop_owner_user_id: shopOwner.id,
        link_match_source: null,
        outlet_name:
          shopOwner.shopName?.trim() ||
          `${shopOwner.firstName} ${shopOwner.lastName}`.trim(),
        owner_name: `${shopOwner.firstName} ${shopOwner.lastName}`.trim(),
        owner_phone: shopOwner.phoneNumber,
        owner_email: shopOwner.email,
        address: shopOwner.address,
        territory_id: shopOwner.territoryId,
        territory_name: shopOwner.territory?.name ?? null,
        warehouse_id: shopOwner.warehouseId,
        warehouse_name: shopOwner.warehouse?.name ?? shopOwner.warehouseName,
        latitude: shopOwner.latitude,
        longitude: shopOwner.longitude,
        status: shopOwner.accountStatus,
        registered_by_sales_rep_id: null,
        created_at: shopOwner.createdAt.toISOString(),
        updated_at: shopOwner.updatedAt.toISOString(),
      });
      context.canonicalByShopOwnerId.set(shopOwner.id, {
        canonicalShopId,
        linkSource: null,
      });
    }

    return context;
  }

  private ensureOutletReference(
    context: ShopReferenceContext,
    outletId: string,
  ) {
    const existing = context.canonicalByOutletId.get(outletId);
    if (existing) {
      return existing;
    }

    const canonicalShopId = `outlet_ref:${outletId}`;
    context.rowsByCanonicalId.set(canonicalShopId, {
      canonical_shop_id: canonicalShopId,
      source_type: 'OUTLET_REFERENCE_ONLY',
      outlet_id: outletId,
      linked_shop_owner_user_id: null,
      link_match_source: null,
      outlet_name: `Outlet ${outletId}`,
      owner_name: null,
      owner_phone: null,
      owner_email: null,
      address: null,
      territory_id: null,
      territory_name: null,
      warehouse_id: null,
      warehouse_name: null,
      latitude: null,
      longitude: null,
      status: 'UNKNOWN',
      registered_by_sales_rep_id: null,
      created_at: null,
      updated_at: null,
    });
    context.canonicalByOutletId.set(outletId, canonicalShopId);
    return canonicalShopId;
  }

  private resolveOrderShopReference(
    order: Order,
    context: ShopReferenceContext,
  ) {
    const outletIdFromNote = this.parseUuidFromNote(order.customerNote, 'Shop');
    if (outletIdFromNote) {
      return {
        canonicalShopId: this.ensureOutletReference(context, outletIdFromNote),
        linkSource: 'CUSTOMER_NOTE_SHOP',
      };
    }

    const mappedShopOwner = context.canonicalByShopOwnerId.get(order.userId);
    if (mappedShopOwner) {
      return {
        canonicalShopId: mappedShopOwner.canonicalShopId,
        linkSource: mappedShopOwner.linkSource ?? 'DIRECT_SHOP_OWNER',
      };
    }

    const mappedOutlet = context.canonicalByOutletId.get(order.userId);
    if (mappedOutlet) {
      return {
        canonicalShopId: mappedOutlet,
        linkSource: 'ORDER_USER_MATCHES_OUTLET_ID',
      };
    }

    const fallbackCanonicalShopId = `order_user_ref:${order.userId}`;
    if (!context.rowsByCanonicalId.has(fallbackCanonicalShopId)) {
      context.rowsByCanonicalId.set(fallbackCanonicalShopId, {
        canonical_shop_id: fallbackCanonicalShopId,
        source_type: 'ORDER_USER_REFERENCE_ONLY',
        outlet_id: null,
        linked_shop_owner_user_id: order.userId,
        link_match_source: null,
        outlet_name: order.shopNameSnapshot,
        owner_name: null,
        owner_phone: null,
        owner_email: null,
        address: null,
        territory_id: order.territoryId,
        territory_name: order.territory?.name ?? null,
        warehouse_id: order.warehouseId,
        warehouse_name: order.warehouse?.name ?? null,
        latitude: null,
        longitude: null,
        status: order.user?.accountStatus ?? 'UNKNOWN',
        registered_by_sales_rep_id: null,
        created_at: order.user?.createdAt?.toISOString?.() ?? null,
        updated_at: order.user?.updatedAt?.toISOString?.() ?? null,
      });
    }

    return {
      canonicalShopId: fallbackCanonicalShopId,
      linkSource: 'UNMAPPED_ORDER_USER',
    };
  }

  private parseUuidFromNote(
    note: string | null | undefined,
    label: string,
  ): string | null {
    if (!note?.trim()) {
      return null;
    }

    const expression = new RegExp(
      `${label}:\\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
      'i',
    );
    const match = note.match(expression);
    return match?.[1] ?? null;
  }

  private groupPromotionProducts(records: PromotionProduct[]) {
    const grouped = new Map<string, PromotionProduct[]>();
    for (const record of records) {
      const existing = grouped.get(record.promotionId) ?? [];
      existing.push(record);
      grouped.set(record.promotionId, existing);
    }
    return grouped;
  }

  private groupPromotionTerritories(records: PromotionTerritory[]) {
    const grouped = new Map<string, PromotionTerritory[]>();
    for (const record of records) {
      const existing = grouped.get(record.promotionId) ?? [];
      existing.push(record);
      grouped.set(record.promotionId, existing);
    }
    return grouped;
  }

  private groupDeliveryActivities(activityLogs: ActivityLog[]) {
    const grouped = new Map<string, ActivityLog[]>();
    for (const activity of activityLogs) {
      if (
        ![
          'ORDER_COMPLETED',
          'SALES_REP_ORDER_DELIVERED',
          'SALES_REP_ORDER_PARTIAL_DELIVERY',
        ].includes(activity.type)
      ) {
        continue;
      }

      const orderId = activity.metadata?.orderId?.toString?.() ?? null;
      if (!orderId) {
        continue;
      }

      const existing = grouped.get(orderId) ?? [];
      existing.push(activity);
      grouped.set(
        orderId,
        existing.sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        ),
      );
    }
    return grouped;
  }

  private resolveFallbackDeliveredAt(
    order: Order,
    assignmentLink:
      | { assignment: DeliveryAssignment; dao: DeliveryAssignmentOrder }
      | null,
  ) {
    if (order.status === 'COMPLETED' || order.status === 'PARTIAL') {
      return order.updatedAt ?? order.placedAt;
    }

    if (assignmentLink?.assignment.updatedAt) {
      return assignmentLink.assignment.updatedAt;
    }

    return null;
  }

  private deriveDeliveredItems(
    order: Order,
    activities: ActivityLog[],
    productById: Map<string, Product>,
  ) {
    const salesRepActivity = activities.find((activity) =>
      ['SALES_REP_ORDER_DELIVERED', 'SALES_REP_ORDER_PARTIAL_DELIVERY'].includes(
        activity.type,
      ),
    );
    const metadataItems = Array.isArray(salesRepActivity?.metadata?.deliveredItems)
      ? (salesRepActivity?.metadata?.deliveredItems as unknown[])
      : [];

    if (metadataItems.length > 0) {
      return metadataItems
        .map((item) => {
          const record = item as Record<string, unknown>;
          const productId = record.productId?.toString() ?? '';
          if (!productId) {
            return null;
          }

          const product = productById.get(productId);
          return {
            productId,
            sku: product?.sku ?? '',
            productName:
              record.productName?.toString() ?? product?.productName ?? '',
            orderedCases:
              order.items.find((orderItem) => orderItem.productId === productId)
                ?.quantity ?? 0,
            deliveredCases: this.readNumber(record.quantityCases),
            unitsPerCase: product?.productsPerCase ?? 1,
          };
        })
        .filter(
          (
            item,
          ): item is {
            productId: string;
            sku: string;
            productName: string;
            orderedCases: number;
            deliveredCases: number;
            unitsPerCase: number;
          } => !!item && item.deliveredCases > 0,
        );
    }

    if (order.status !== 'COMPLETED') {
      return [];
    }

    return order.items
      .filter((item) => !!item.productId && Number(item.quantity ?? 0) > 0)
      .map((item) => {
        const product = item.productId ? productById.get(item.productId) : null;
        return {
          productId: item.productId!,
          sku: item.skuSnapshot,
          productName: item.productNameSnapshot,
          orderedCases: Number(item.quantity ?? 0),
          deliveredCases: Number(item.quantity ?? 0),
          unitsPerCase: product?.productsPerCase ?? 1,
        };
      });
  }

  private normalizeDuplicateStockCounts(rows: OsaStockCountRow[]) {
    const grouped = new Map<string, OsaStockCountRow[]>();
    for (const row of rows) {
      const key = `${row.canonical_shop_id}|${row.product_id}|${row.observed_date}`;
      const existing = grouped.get(key) ?? [];
      existing.push(row);
      grouped.set(key, existing);
    }

    const normalized: OsaStockCountRow[] = [];
    for (const groupRows of grouped.values()) {
      const sorted = [...groupRows].sort((left, right) =>
        left.observed_at.localeCompare(right.observed_at),
      );
      const latest = sorted[sorted.length - 1];
      normalized.push({
        ...latest,
        duplicate_visit_conflict: sorted.length > 1,
      });
    }

    return normalized.sort((left, right) => {
      const keyCompare = `${left.canonical_shop_id}|${left.product_id}`.localeCompare(
        `${right.canonical_shop_id}|${right.product_id}`,
      );
      if (keyCompare !== 0) {
        return keyCompare;
      }
      return left.observed_at.localeCompare(right.observed_at);
    });
  }

  private groupTimedQuantityRows<
    T extends {
      canonical_shop_id?: string | null;
      product_id?: string | null;
      quantity_units?: number;
      delivered_units?: number;
    },
  >(rows: T[], timeKey: keyof T) {
    const grouped = new Map<
      string,
      Array<{ timestamp: Date; quantityUnits: number }>
    >();

    for (const row of rows) {
      if (!row.canonical_shop_id || !row.product_id) {
        continue;
      }

      const rawTime = row[timeKey];
      if (typeof rawTime !== 'string' || !rawTime) {
        continue;
      }

      const timestamp = new Date(rawTime);
      if (Number.isNaN(timestamp.getTime())) {
        continue;
      }

      const quantityUnits = this.readNumber(
        row.delivered_units ?? row.quantity_units ?? 0,
      );
      const key = `${row.canonical_shop_id}|${row.product_id}`;
      const existing = grouped.get(key) ?? [];
      existing.push({ timestamp, quantityUnits });
      grouped.set(
        key,
        existing.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      );
    }

    return grouped;
  }

  private groupLossRows(rows: DamageExpiredRow[]) {
    const grouped = new Map<
      string,
      Array<{ timestamp: Date; quantityUnits: number; lossType: string }>
    >();

    for (const row of rows) {
      if (!row.product_id) {
        continue;
      }

      const timestamp = new Date(row.observed_at);
      if (Number.isNaN(timestamp.getTime())) {
        continue;
      }

      const key = `${row.canonical_shop_id}|${row.product_id}`;
      const existing = grouped.get(key) ?? [];
      existing.push({
        timestamp,
        quantityUnits: this.readNumber(row.quantity_units),
        lossType: row.loss_type,
      });
      grouped.set(
        key,
        existing.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      );
    }

    return grouped;
  }

  private groupStockoutRows(rows: StockoutEventRow[]) {
    const grouped = new Map<string, Array<{ timestamp: Date }>>();
    for (const row of rows) {
      const timestamp = new Date(row.observed_at);
      if (Number.isNaN(timestamp.getTime())) {
        continue;
      }

      const key = `${row.canonical_shop_id}|${row.product_id}`;
      const existing = grouped.get(key) ?? [];
      existing.push({ timestamp });
      grouped.set(
        key,
        existing.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      );
    }
    return grouped;
  }

  private buildEstimatedRetailOfftakeRows(
    stockCounts: OsaStockCountRow[],
    deliveryEventsByKey: Map<string, Array<{ timestamp: Date; quantityUnits: number }>>,
    returnEventsByKey: Map<string, Array<{ timestamp: Date; quantityUnits: number }>>,
    lossEventsByKey: Map<
      string,
      Array<{ timestamp: Date; quantityUnits: number; lossType: string }>
    >,
    stockoutEventsByKey: Map<string, Array<{ timestamp: Date }>>,
  ) {
    const rowsByKey = new Map<string, OsaStockCountRow[]>();
    for (const row of stockCounts) {
      const key = `${row.canonical_shop_id}|${row.product_id}`;
      const existing = rowsByKey.get(key) ?? [];
      existing.push(row);
      rowsByKey.set(key, existing);
    }

    const results: RetailOfftakeRow[] = [];
    for (const [key, rows] of rowsByKey.entries()) {
      const sorted = [...rows].sort((left, right) =>
        left.observed_at.localeCompare(right.observed_at),
      );

      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        const previousTime = new Date(previous.observed_at);
        const currentTime = new Date(current.observed_at);
        const gapDays = Math.max(
          1,
          Math.round(
            (currentTime.getTime() - previousTime.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        );

        const deliveredUnits = this.sumQuantityBetween(
          deliveryEventsByKey.get(key) ?? [],
          previousTime,
          currentTime,
        );
        const returnedUnits = this.sumQuantityBetween(
          returnEventsByKey.get(key) ?? [],
          previousTime,
          currentTime,
        );
        const damagedUnits = this.sumLossBetween(
          lossEventsByKey.get(key) ?? [],
          previousTime,
          currentTime,
          'DAMAGED',
        );
        const expiredUnits = this.sumLossBetween(
          lossEventsByKey.get(key) ?? [],
          previousTime,
          currentTime,
          'EXPIRED',
        );
        const rawEstimatedSoldUnits =
          previous.current_stock_units +
          deliveredUnits -
          returnedUnits -
          damagedUnits -
          expiredUnits -
          current.current_stock_units;
        const estimatedSoldUnits = Math.max(0, rawEstimatedSoldUnits);
        const stockoutFlag = this.hasEventBetween(
          stockoutEventsByKey.get(key) ?? [],
          previousTime,
          currentTime,
        );
        const negativeClamped = rawEstimatedSoldUnits < 0;
        const qualityFlags: string[] = [];
        if (previous.duplicate_visit_conflict || current.duplicate_visit_conflict) {
          qualityFlags.push('DUPLICATE_VISIT_CONFLICT');
        }
        if (negativeClamped) {
          qualityFlags.push('NEGATIVE_ESTIMATED_SALES_CLAMPED');
        }
        if (gapDays > 30) {
          qualityFlags.push('LONG_VISIT_GAP');
        }
        if (current.units_per_case <= 0) {
          qualityFlags.push('UNITS_PER_CASE_MISSING');
        }
        const confidence = this.computeRetailConfidenceScore({
          gapDays,
          duplicateVisitConflict:
            previous.duplicate_visit_conflict || current.duplicate_visit_conflict,
          negativeClamped,
          stockoutFlag,
        });

        results.push({
          estimated_retail_offtake_id: `${current.visit_id}:${current.product_id}`,
          canonical_shop_id: current.canonical_shop_id,
          product_id: current.product_id,
          product_name: current.product_name,
          units_per_case: current.units_per_case,
          baseline_visit_id: previous.visit_id,
          current_visit_id: current.visit_id,
          baseline_observed_at: previous.observed_at,
          current_observed_at: current.observed_at,
          gap_days: gapDays,
          previous_stock_units: previous.current_stock_units,
          delivered_units_since_previous_visit: deliveredUnits,
          returned_units_since_previous_visit: returnedUnits,
          damaged_units_since_previous_visit: damagedUnits,
          expired_units_since_previous_visit: expiredUnits,
          current_stock_units: current.current_stock_units,
          estimated_sold_units_raw: this.roundNumber(rawEstimatedSoldUnits),
          estimated_sold_units: this.roundNumber(estimatedSoldUnits),
          estimated_sold_cases: this.roundNumber(
            current.units_per_case > 0
              ? estimatedSoldUnits / current.units_per_case
              : 0,
          ),
          estimated_sold_cases_per_day: this.roundNumber(
            current.units_per_case > 0
              ? estimatedSoldUnits / current.units_per_case / gapDays
              : 0,
          ),
          stockout_flag: stockoutFlag,
          duplicate_visit_conflict:
            previous.duplicate_visit_conflict || current.duplicate_visit_conflict,
          negative_clamped_flag: negativeClamped,
          confidence_score: confidence.score,
          confidence_level: confidence.level,
          data_quality_flags: qualityFlags.join('|'),
          signal_date: current.observed_date,
        });
      }
    }

    return results.sort((left, right) =>
      `${left.signal_date}|${left.canonical_shop_id}|${left.product_id}`.localeCompare(
        `${right.signal_date}|${right.canonical_shop_id}|${right.product_id}`,
      ),
    );
  }

  private sumQuantityBetween(
    rows: Array<{ timestamp: Date; quantityUnits: number }>,
    fromExclusive: Date,
    toInclusive: Date,
  ) {
    return this.roundNumber(
      rows
        .filter(
          (row) =>
            row.timestamp.getTime() > fromExclusive.getTime() &&
            row.timestamp.getTime() <= toInclusive.getTime(),
        )
        .reduce((sum, row) => sum + row.quantityUnits, 0),
    );
  }

  private sumLossBetween(
    rows: Array<{ timestamp: Date; quantityUnits: number; lossType: string }>,
    fromExclusive: Date,
    toInclusive: Date,
    lossType: string,
  ) {
    return this.roundNumber(
      rows
        .filter(
          (row) =>
            row.lossType === lossType &&
            row.timestamp.getTime() > fromExclusive.getTime() &&
            row.timestamp.getTime() <= toInclusive.getTime(),
        )
        .reduce((sum, row) => sum + row.quantityUnits, 0),
    );
  }

  private hasEventBetween(
    rows: Array<{ timestamp: Date }>,
    fromExclusive: Date,
    toInclusive: Date,
  ) {
    return rows.some(
      (row) =>
        row.timestamp.getTime() > fromExclusive.getTime() &&
        row.timestamp.getTime() <= toInclusive.getTime(),
    );
  }

  private computeRetailConfidenceScore(params: {
    gapDays: number;
    duplicateVisitConflict: boolean;
    negativeClamped: boolean;
    stockoutFlag: boolean;
  }) {
    let score = 1;

    if (params.gapDays > 45) {
      score -= 0.45;
    } else if (params.gapDays > 30) {
      score -= 0.3;
    } else if (params.gapDays > 14) {
      score -= 0.15;
    }

    if (params.duplicateVisitConflict) {
      score -= 0.15;
    }
    if (params.negativeClamped) {
      score -= 0.2;
    }
    if (params.stockoutFlag) {
      score -= 0.1;
    }

    const normalizedScore = Math.max(0.05, Math.min(1, this.roundNumber(score)));
    return {
      score: normalizedScore,
      level:
        normalizedScore >= 0.8
          ? 'HIGH'
          : normalizedScore >= 0.55
            ? 'MEDIUM'
            : 'LOW',
    };
  }

  private resolveCalendarBounds(
    filters: ExportFilters,
    orders: Order[],
    deliveries: DeliveryRow[],
    returns: OrderReturn[],
    visits: StoreVisit[],
    retailOfftake: RetailOfftakeRow[],
  ) {
    const candidates = [
      ...(filters.fromDate ? [filters.fromDate] : []),
      ...orders.map((order) => order.placedAt),
      ...deliveries
        .map((delivery) =>
          delivery.delivered_at ? new Date(delivery.delivered_at) : null,
        )
        .filter((value): value is Date => !!value),
      ...returns.map((orderReturn) => orderReturn.createdAt),
      ...visits.map((visit) => visit.visitEndedAt ?? visit.visitStartedAt),
      ...retailOfftake.map((row) => new Date(row.current_observed_at)),
      filters.generatedAt,
      ...(filters.toDate ? [filters.toDate] : []),
    ].filter((value): value is Date => !!value && !Number.isNaN(value.getTime()));

    const sorted = [...candidates].sort(
      (left, right) => left.getTime() - right.getTime(),
    );

    return {
      startDate: sorted[0] ?? filters.generatedAt,
      endDate: sorted[sorted.length - 1] ?? filters.generatedAt,
    };
  }

  private buildCalendarRows(startDate: Date, endDate: Date) {
    const rows: Array<Record<string, unknown>> = [];
    const current = new Date(startDate);

    while (current.getTime() <= endDate.getTime()) {
      const day = current.getUTCDay();
      rows.push({
        date: this.dateKey(current),
        day_of_week: day,
        day_name: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
        is_weekend: day === 0 || day === 6,
        month: current.getUTCMonth() + 1,
        quarter: Math.floor(current.getUTCMonth() / 3) + 1,
        year: current.getUTCFullYear(),
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return rows;
  }

  private aggregateDailyOrderDemand(
    orderInfos: Map<string, OrderInfo>,
    orders: Order[],
  ) {
    const daily = new Map<string, number>();

    for (const order of orders) {
      if (!DIRECT_ORDER_STATUSES.has(order.status)) {
        continue;
      }

      const orderInfo = orderInfos.get(order.id);
      if (!orderInfo) {
        continue;
      }

      const dateKey = this.dateKey(order.placedAt);
      for (const item of order.items) {
        if (!item.productId) {
          continue;
        }
        this.incrementMetric(
          daily,
          `${dateKey}|${orderInfo.canonicalShopId}|${item.productId}`,
          Number(item.quantity ?? 0),
        );
      }
    }

    return daily;
  }

  private aggregateDailyDeliveredDemand(rows: DeliveryItemRow[]) {
    const daily = new Map<string, number>();
    for (const row of rows) {
      const dateKey = row.delivered_at ? this.dateKey(row.delivered_at) : null;
      if (!dateKey) {
        continue;
      }
      this.incrementMetric(
        daily,
        `${dateKey}|${row.canonical_shop_id}|${row.product_id}`,
        row.delivered_cases,
      );
    }
    return daily;
  }

  private aggregateDailyReturns(rows: ReturnItemExportRow[]) {
    const daily = new Map<string, number>();
    for (const row of rows) {
      if (!row.canonical_shop_id || !row.product_id) {
        continue;
      }
      const dateKey = this.dateKey(row.returned_at);
      this.incrementMetric(
        daily,
        `${dateKey}|${row.canonical_shop_id}|${row.product_id}`,
        row.quantity_cases,
      );
    }
    return daily;
  }

  private aggregateDailyEstimatedOfftake(rows: RetailOfftakeRow[]) {
    const daily = new Map<string, number>();
    for (const row of rows) {
      this.incrementMetric(
        daily,
        `${row.signal_date}|${row.canonical_shop_id}|${row.product_id}`,
        row.estimated_sold_cases_per_day,
      );
    }
    return daily;
  }

  private aggregateDailyStockouts(rows: StockoutEventRow[]) {
    const daily = new Map<string, boolean>();
    for (const row of rows) {
      daily.set(
        `${row.observed_date}|${row.canonical_shop_id}|${row.product_id}`,
        true,
      );
    }
    return daily;
  }

  private createPromotionFlagResolver(
    promotions: Promotion[],
    promotionProductsByPromotionId: Map<string, PromotionProduct[]>,
    promotionTerritoriesByPromotionId: Map<string, PromotionTerritory[]>,
    shopReferenceContext: ShopReferenceContext,
  ) {
    const activePromotions = promotions.filter((promotion) =>
      ACTIVE_PROMOTION_STATUSES.has(promotion.status.toLowerCase()),
    );
    const cache = new Map<string, boolean>();

    return (
      dateKey: string,
      canonicalShopId: string,
      productId: string,
    ): boolean => {
      const cacheKey = `${dateKey}|${canonicalShopId}|${productId}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const shopReference = shopReferenceContext.rowsByCanonicalId.get(
        canonicalShopId,
      );
      const territoryId = shopReference?.territory_id ?? null;

      const result = activePromotions.some((promotion) => {
        const startsOnOrBefore = this.dateKey(promotion.startDate) <= dateKey;
        const endsOnOrAfter = this.dateKey(promotion.endDate) >= dateKey;
        if (!startsOnOrBefore || !endsOnOrAfter) {
          return false;
        }

        const productLinks = promotionProductsByPromotionId.get(promotion.id) ?? [];
        const territoryLinks =
          promotionTerritoriesByPromotionId.get(promotion.id) ?? [];
        const productEligible =
          productLinks.length === 0 ||
          productLinks.some((link) => link.productId === productId);
        const territoryEligible =
          territoryLinks.length === 0 ||
          territoryLinks.some((link) => link.territoryId === territoryId);

        return productEligible && territoryEligible;
      });

      cache.set(cacheKey, result);
      return result;
    };
  }

  private buildForecastRows(
    dailyMetrics: Map<string, number>,
    shopReferenceContext: ShopReferenceContext,
    productById: Map<string, Product>,
    horizonStart: Date,
    forecastDays: number,
    signalSource: string,
    promotionFlagResolver: (
      dateKey: string,
      canonicalShopId: string,
      productId: string,
    ) => boolean,
  ) {
    const rowsByKey = new Map<string, Array<{ dateKey: string; value: number }>>();
    for (const [key, value] of dailyMetrics.entries()) {
      const [dateKey, canonicalShopId, productId] = key.split('|');
      const seriesKey = `${canonicalShopId}|${productId}`;
      const existing = rowsByKey.get(seriesKey) ?? [];
      existing.push({ dateKey, value });
      rowsByKey.set(seriesKey, existing);
    }

    const results: ForecastRow[] = [];
    const forecastBase = this.addDays(horizonStart, 1);

    for (const [seriesKey, series] of rowsByKey.entries()) {
      const [canonicalShopId, productId] = seriesKey.split('|');
      const shopReference = shopReferenceContext.rowsByCanonicalId.get(
        canonicalShopId,
      );
      const product = productById.get(productId);
      const sorted = [...series].sort((left, right) =>
        left.dateKey.localeCompare(right.dateKey),
      );
      const seriesMap = new Map(sorted.map((entry) => [entry.dateKey, entry.value]));
      const historyEndDate = this.addDays(forecastBase, -1);
      const historyDates = this.lastDateKeys(historyEndDate, 28);
      const lastSeven = historyDates.slice(-7).map((dateKey) => seriesMap.get(dateKey) ?? 0);
      const lastTwentyEight = historyDates.map((dateKey) => seriesMap.get(dateKey) ?? 0);
      const avg7 = this.average(lastSeven);
      const avg28 = this.average(lastTwentyEight);
      const forecastCases = this.roundNumber(avg7 * 0.6 + avg28 * 0.4);
      const nonZeroCount = lastTwentyEight.filter((value) => value > 0).length;
      const confidenceScore = this.roundNumber(
        Math.max(0.2, Math.min(0.95, 0.35 + nonZeroCount / 28 * 0.6)),
      );
      const confidenceLevel =
        confidenceScore >= 0.8
          ? 'HIGH'
          : confidenceScore >= 0.55
            ? 'MEDIUM'
            : 'LOW';

      for (let offset = 0; offset < forecastDays; offset += 1) {
        const forecastDate = this.addDays(forecastBase, offset);
        const forecastDateKey = this.dateKey(forecastDate);

        results.push({
          forecast_date: forecastDateKey,
          canonical_shop_id: canonicalShopId,
          product_id: productId,
          product_name: product?.productName ?? 'Unknown Product',
          territory_id: shopReference?.territory_id ?? null,
          warehouse_id: shopReference?.warehouse_id ?? null,
          history_window_start: historyDates[0] ?? null,
          history_window_end: historyDates[historyDates.length - 1] ?? null,
          avg_daily_cases_7d: this.roundNumber(avg7),
          avg_daily_cases_28d: this.roundNumber(avg28),
          forecast_cases: forecastCases,
          promotion_flag: promotionFlagResolver(
            forecastDateKey,
            canonicalShopId,
            productId,
          ),
          confidence_score: confidenceScore,
          confidence_level: confidenceLevel,
          signal_source: signalSource,
        });
      }
    }

    return results.sort((left, right) =>
      `${left.forecast_date}|${left.canonical_shop_id}|${left.product_id}`.localeCompare(
        `${right.forecast_date}|${right.canonical_shop_id}|${right.product_id}`,
      ),
    );
  }

  private buildCombinedSignalRows(
    replenishmentDaily: Map<string, number>,
    deliveredDaily: Map<string, number>,
    returnedDaily: Map<string, number>,
    estimatedDaily: Map<string, number>,
    stockoutDaily: Map<string, boolean>,
    retailRows: RetailOfftakeRow[],
    forecastReplenishmentRows: ForecastRow[],
    forecastEstimatedRows: ForecastRow[],
    shopReferenceContext: ShopReferenceContext,
    productById: Map<string, Product>,
    filters: ExportFilters,
    promotionFlagResolver: (
      dateKey: string,
      canonicalShopId: string,
      productId: string,
    ) => boolean,
  ) {
    const historicalKeys = new Set<string>([
      ...replenishmentDaily.keys(),
      ...deliveredDaily.keys(),
      ...returnedDaily.keys(),
      ...estimatedDaily.keys(),
      ...stockoutDaily.keys(),
    ]);
    const retailByKey = new Map(
      retailRows.map((row) => [
        `${row.signal_date}|${row.canonical_shop_id}|${row.product_id}`,
        row,
      ]),
    );
    const forecastReplenishmentByKey = new Map(
      forecastReplenishmentRows.map((row) => [
        `${row.forecast_date}|${row.canonical_shop_id}|${row.product_id}`,
        row,
      ]),
    );
    const forecastEstimatedByKey = new Map(
      forecastEstimatedRows.map((row) => [
        `${row.forecast_date}|${row.canonical_shop_id}|${row.product_id}`,
        row,
      ]),
    );
    const forecastKeys = new Set<string>([
      ...forecastReplenishmentByKey.keys(),
      ...forecastEstimatedByKey.keys(),
    ]);

    const rows: CombinedSignalRow[] = [];

    for (const key of [...historicalKeys].sort()) {
      const [signalDate, canonicalShopId, productId] = key.split('|');
      if (!this.isInRange(signalDate, filters)) {
        continue;
      }
      const shopReference = shopReferenceContext.rowsByCanonicalId.get(
        canonicalShopId,
      );
      const product = productById.get(productId);
      const retailRow = retailByKey.get(key);
      const orderedCases = replenishmentDaily.get(key) ?? 0;
      const deliveredCases = deliveredDaily.get(key) ?? 0;
      const returnedCases = returnedDaily.get(key) ?? 0;
      const estimatedSoldCases = retailRow?.estimated_sold_cases ?? 0;
      const estimatedSoldCasesPerDay = estimatedDaily.get(key) ?? 0;
      const confidenceScore = retailRow?.confidence_score ?? 0.7;
      const confidenceLevel = retailRow?.confidence_level ?? 'MEDIUM';
      const dataQualityFlags = retailRow?.data_quality_flags ?? '';

      rows.push({
        signal_kind: 'HISTORICAL',
        signal_date: signalDate,
        canonical_shop_id: canonicalShopId,
        product_id: productId,
        product_name: product?.productName ?? retailRow?.product_name ?? 'Unknown Product',
        territory_id: shopReference?.territory_id ?? null,
        warehouse_id: shopReference?.warehouse_id ?? null,
        ordered_cases: this.roundNumber(orderedCases),
        delivered_cases: this.roundNumber(deliveredCases),
        unfulfilled_cases: this.roundNumber(
          Math.max(0, orderedCases - deliveredCases),
        ),
        returned_cases: this.roundNumber(returnedCases),
        estimated_sold_cases: this.roundNumber(estimatedSoldCases),
        estimated_sold_cases_per_day: this.roundNumber(estimatedSoldCasesPerDay),
        forecast_replenishment_cases: 0,
        forecast_estimated_retail_cases: 0,
        stockout_flag: stockoutDaily.get(key) ?? false,
        promotion_flag: promotionFlagResolver(signalDate, canonicalShopId, productId),
        confidence_score: confidenceScore,
        confidence_level: confidenceLevel,
        data_quality_flags: dataQualityFlags,
      });
    }

    for (const key of [...forecastKeys].sort()) {
      const [signalDate, canonicalShopId, productId] = key.split('|');
      const forecastReplenishment = forecastReplenishmentByKey.get(key);
      const forecastEstimated = forecastEstimatedByKey.get(key);
      const shopReference = shopReferenceContext.rowsByCanonicalId.get(
        canonicalShopId,
      );
      const product = productById.get(productId);
      const confidenceScore = this.roundNumber(
        (
          (forecastReplenishment?.confidence_score ?? 0.5) +
          (forecastEstimated?.confidence_score ?? 0.5)
        ) / 2,
      );
      const confidenceLevel =
        confidenceScore >= 0.8
          ? 'HIGH'
          : confidenceScore >= 0.55
            ? 'MEDIUM'
            : 'LOW';

      rows.push({
        signal_kind: 'FORECAST',
        signal_date: signalDate,
        canonical_shop_id: canonicalShopId,
        product_id: productId,
        product_name:
          product?.productName ??
          forecastReplenishment?.product_name ??
          forecastEstimated?.product_name ??
          'Unknown Product',
        territory_id: shopReference?.territory_id ?? null,
        warehouse_id: shopReference?.warehouse_id ?? null,
        ordered_cases: 0,
        delivered_cases: 0,
        unfulfilled_cases: 0,
        returned_cases: 0,
        estimated_sold_cases: 0,
        estimated_sold_cases_per_day: 0,
        forecast_replenishment_cases:
          forecastReplenishment?.forecast_cases ?? 0,
        forecast_estimated_retail_cases:
          forecastEstimated?.forecast_cases ?? 0,
        stockout_flag: false,
        promotion_flag: promotionFlagResolver(signalDate, canonicalShopId, productId),
        confidence_score: confidenceScore,
        confidence_level: confidenceLevel,
        data_quality_flags: '',
      });
    }

    return rows.sort((left, right) =>
      `${left.signal_date}|${left.canonical_shop_id}|${left.product_id}|${left.signal_kind}`.localeCompare(
        `${right.signal_date}|${right.canonical_shop_id}|${right.product_id}|${right.signal_kind}`,
      ),
    );
  }

  private incrementMetric(map: Map<string, number>, key: string, amount: number) {
    map.set(key, this.roundNumber((map.get(key) ?? 0) + amount));
  }

  private average(values: number[]) {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private lastDateKeys(endDate: Date, length: number) {
    const result: string[] = [];
    for (let offset = length - 1; offset >= 0; offset -= 1) {
      result.push(this.dateKey(this.addDays(endDate, -offset)));
    }
    return result;
  }

  private getUnitsPerCase(
    productId: string | null | undefined,
    productById: Map<string, Product>,
  ) {
    if (!productId) {
      return 1;
    }

    return productById.get(productId)?.productsPerCase ?? 1;
  }

  private readNumber(value: unknown) {
    const numericValue = Number(value ?? 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  private roundNumber(value: number) {
    return Number(value.toFixed(4));
  }

  private normalizeText(value?: string | null) {
    return value?.trim().toLowerCase() ?? '';
  }

  private normalizePhone(value?: string | null) {
    return value?.replace(/\D/g, '') ?? '';
  }

  private dateKey(value: Date | string | null | undefined) {
    if (!value) {
      return '';
    }
    const date =
      value instanceof Date
        ? value
        : /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T00:00:00.000Z`)
          : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString().slice(0, 10);
  }

  private addDays(date: Date, days: number) {
    const nextDate = new Date(date);
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return nextDate;
  }

  private dictionaryColumns(): CsvColumn<DictionaryRow>[] {
    return [
      { key: 'file_name', header: 'file_name' },
      { key: 'column_name', header: 'column_name' },
      { key: 'data_type', header: 'data_type' },
      { key: 'description', header: 'description' },
    ];
  }

  private productColumns() {
    return this.columnsForKeys([
      'product_id',
      'sku',
      'product_name',
      'category_id',
      'category_name',
      'brand',
      'pack_size',
      'unit_price',
      'case_price',
      'units_per_case',
      'barcode',
      'status',
      'created_at',
      'updated_at',
    ]);
  }

  private shopReferenceColumns() {
    return this.columnsForKeys([
      'canonical_shop_id',
      'source_type',
      'outlet_id',
      'linked_shop_owner_user_id',
      'link_match_source',
      'outlet_name',
      'owner_name',
      'owner_phone',
      'owner_email',
      'address',
      'territory_id',
      'territory_name',
      'warehouse_id',
      'warehouse_name',
      'latitude',
      'longitude',
      'status',
      'registered_by_sales_rep_id',
      'created_at',
      'updated_at',
    ]);
  }

  private territoryColumns() {
    return this.columnsForKeys([
      'territory_id',
      'name',
      'slug',
      'latitude',
      'longitude',
      'created_at',
      'updated_at',
    ]);
  }

  private warehouseColumns() {
    return this.columnsForKeys([
      'warehouse_id',
      'territory_id',
      'territory_name',
      'name',
      'slug',
      'address',
      'latitude',
      'longitude',
      'phone_number',
      'manager_user_id',
      'created_at',
      'updated_at',
    ]);
  }

  private routeColumns() {
    return this.columnsForKeys([
      'route_id',
      'sales_rep_id',
      'sales_rep_name',
      'territory_id',
      'territory_name',
      'warehouse_id',
      'warehouse_name',
      'vehicle_id',
      'status',
      'started_at',
      'closed_at',
      'created_at',
      'updated_at',
    ]);
  }

  private calendarColumns() {
    return this.columnsForKeys([
      'date',
      'day_of_week',
      'day_name',
      'is_weekend',
      'month',
      'quarter',
      'year',
    ]);
  }

  private orderColumns() {
    return this.columnsForKeys([
      'order_id',
      'order_code',
      'user_id',
      'canonical_shop_id',
      'canonical_link_source',
      'shop_name',
      'order_owner_role',
      'territory_id',
      'territory_name',
      'warehouse_id',
      'warehouse_name',
      'route_id',
      'status',
      'source',
      'applied_promotion_id',
      'applied_promotion_code',
      'total_amount',
      'subtotal_before_discount',
      'promotion_discount_total',
      'total_after_discount',
      'placed_at',
      'approved_at',
      'created_at',
      'updated_at',
      'customer_note',
    ]);
  }

  private orderItemColumns() {
    return this.columnsForKeys([
      'order_item_id',
      'order_id',
      'canonical_shop_id',
      'product_id',
      'sku',
      'product_name',
      'pack_size',
      'units_per_case',
      'quantity_cases',
      'quantity_units',
      'case_price',
      'line_total',
      'placed_at',
      'replenishment_demand_cases',
    ]);
  }

  private deliveryColumns() {
    return this.columnsForKeys([
      'delivery_id',
      'order_id',
      'assignment_id',
      'canonical_shop_id',
      'territory_id',
      'warehouse_id',
      'distributor_id',
      'territory_manager_id',
      'vehicle_id',
      'delivery_date',
      'delivered_at',
      'delivery_status',
      'delivery_mode',
      'delivered_cases_total',
      'delivered_item_count',
      'data_quality_flags',
    ]);
  }

  private deliveryItemColumns() {
    return this.columnsForKeys([
      'delivery_item_id',
      'delivery_id',
      'order_id',
      'canonical_shop_id',
      'product_id',
      'sku',
      'product_name',
      'ordered_cases',
      'delivered_cases',
      'delivered_units',
      'units_per_case',
      'delivered_at',
      'delivery_status',
      'data_quality_flags',
    ]);
  }

  private returnColumns() {
    return this.columnsForKeys([
      'return_id',
      'assignment_id',
      'order_id',
      'distributor_id',
      'canonical_shop_id',
      'return_type',
      'tm_verified',
      'verification_note',
      'returned_at',
    ]);
  }

  private returnItemColumns() {
    return this.columnsForKeys([
      'return_item_id',
      'return_id',
      'order_id',
      'canonical_shop_id',
      'product_id',
      'product_name',
      'quantity_cases',
      'quantity_units',
      'units_per_case',
      'reason',
      'return_type',
      'tm_verified',
      'returned_at',
      'data_quality_flags',
    ]);
  }

  private visitColumns() {
    return this.columnsForKeys([
      'visit_id',
      'canonical_shop_id',
      'shop_id',
      'route_id',
      'route_session_id',
      'stop_id',
      'sales_rep_id',
      'territory_id',
      'shop_name',
      'visit_started_at',
      'visit_ended_at',
      'duration_minutes',
      'duration_seconds',
      'status',
      'has_pending_delivery',
      'planogram_ok',
      'posm_ok',
      'photo_count',
      'created_at',
      'updated_at',
    ]);
  }

  private osaColumns() {
    return this.columnsForKeys([
      'stock_count_id',
      'visit_id',
      'canonical_shop_id',
      'sales_rep_id',
      'route_id',
      'product_id',
      'product_name',
      'units_per_case',
      'shelf_units',
      'backroom_units',
      'current_stock_units',
      'current_stock_cases',
      'estimated_sales_input_units',
      'in_stock',
      'oos_reason',
      'observed_at',
      'observed_date',
      'verified',
      'duplicate_visit_conflict',
    ]);
  }

  private stockoutColumns() {
    return this.columnsForKeys([
      'stockout_event_id',
      'visit_id',
      'canonical_shop_id',
      'product_id',
      'product_name',
      'observed_at',
      'observed_date',
      'stock_units',
      'stockout_flag',
      'oos_reason',
      'detection_rule',
    ]);
  }

  private damageColumns() {
    return this.columnsForKeys([
      'loss_event_id',
      'visit_id',
      'canonical_shop_id',
      'product_id',
      'product_name',
      'loss_type',
      'quantity_units',
      'quantity_cases',
      'units_per_case',
      'observed_at',
      'observed_date',
      'notes',
      'count_source',
      'data_quality_flags',
    ]);
  }

  private inventoryColumns() {
    return this.columnsForKeys([
      'snapshot_id',
      'snapshot_source',
      'canonical_shop_id',
      'warehouse_id',
      'product_id',
      'product_name',
      'units_per_case',
      'quantity_units',
      'quantity_cases',
      'snapshot_at',
      'snapshot_date',
      'reference_id',
    ]);
  }

  private promotionColumns() {
    return this.columnsForKeys([
      'promotion_id',
      'name',
      'code',
      'description',
      'status',
      'promotion_type',
      'discount_type',
      'discount_value',
      'min_quantity',
      'min_order_value',
      'usage_limit',
      'per_shop_limit',
      'created_by',
      'start_date',
      'end_date',
      'eligible_product_ids',
      'eligible_territory_ids',
      'created_at',
      'updated_at',
    ]);
  }

  private promotionProductColumns() {
    return this.columnsForKeys([
      'promotion_product_id',
      'promotion_id',
      'product_id',
      'sku',
      'product_name',
      'units_per_case',
    ]);
  }

  private retailOfftakeColumns() {
    return this.columnsForKeys([
      'estimated_retail_offtake_id',
      'canonical_shop_id',
      'product_id',
      'product_name',
      'units_per_case',
      'baseline_visit_id',
      'current_visit_id',
      'baseline_observed_at',
      'current_observed_at',
      'gap_days',
      'previous_stock_units',
      'delivered_units_since_previous_visit',
      'returned_units_since_previous_visit',
      'damaged_units_since_previous_visit',
      'expired_units_since_previous_visit',
      'current_stock_units',
      'estimated_sold_units_raw',
      'estimated_sold_units',
      'estimated_sold_cases',
      'estimated_sold_cases_per_day',
      'stockout_flag',
      'duplicate_visit_conflict',
      'negative_clamped_flag',
      'confidence_score',
      'confidence_level',
      'data_quality_flags',
      'signal_date',
    ]);
  }

  private forecastColumns() {
    return this.columnsForKeys([
      'forecast_date',
      'canonical_shop_id',
      'product_id',
      'product_name',
      'territory_id',
      'warehouse_id',
      'history_window_start',
      'history_window_end',
      'avg_daily_cases_7d',
      'avg_daily_cases_28d',
      'forecast_cases',
      'promotion_flag',
      'confidence_score',
      'confidence_level',
      'signal_source',
    ]);
  }

  private combinedSignalColumns() {
    return this.columnsForKeys([
      'signal_kind',
      'signal_date',
      'canonical_shop_id',
      'product_id',
      'product_name',
      'territory_id',
      'warehouse_id',
      'ordered_cases',
      'delivered_cases',
      'unfulfilled_cases',
      'returned_cases',
      'estimated_sold_cases',
      'estimated_sold_cases_per_day',
      'forecast_replenishment_cases',
      'forecast_estimated_retail_cases',
      'stockout_flag',
      'promotion_flag',
      'confidence_score',
      'confidence_level',
      'data_quality_flags',
    ]);
  }

  private columnsForKeys(keys: string[]) {
    return keys.map((key) => ({ key, header: key })) as CsvColumn<
      Record<string, unknown>
    >[];
  }

  private buildDictionaryRows(): DictionaryRow[] {
    return [
      {
        file_name: 'orders.csv',
        column_name: 'canonical_shop_id',
        data_type: 'string',
        description:
          'Canonical shop key used to reconcile outlet visits, direct orders, and assisted orders.',
      },
      {
        file_name: 'order_items.csv',
        column_name: 'replenishment_demand_cases',
        data_type: 'number',
        description:
          'Actual replenishment demand in cases derived from the ordered line quantity.',
      },
      {
        file_name: 'deliveries.csv',
        column_name: 'delivery_mode',
        data_type: 'string',
        description:
          'Indicates whether the delivery was distributor-assigned, immediate sales-rep delivery, or inferred from order status.',
      },
      {
        file_name: 'delivery_items.csv',
        column_name: 'delivered_units',
        data_type: 'number',
        description:
          'Delivered quantity converted to base units using the product units-per-case value.',
      },
      {
        file_name: 'osa_stock_counts.csv',
        column_name: 'current_stock_units',
        data_type: 'number',
        description:
          'Physical stock on hand at the visit, calculated as shelf units plus backroom units.',
      },
      {
        file_name: 'stockout_events.csv',
        column_name: 'detection_rule',
        data_type: 'string',
        description:
          'Explains whether the stockout came from an explicit field flag or a zero-stock observation.',
      },
      {
        file_name: 'damaged_expired_counts.csv',
        column_name: 'count_source',
        data_type: 'string',
        description:
          'Documents whether the loss quantity came from a true count or only from a boolean/issue flag.',
      },
      {
        file_name: 'estimated_retail_offtake.csv',
        column_name: 'estimated_sold_units',
        data_type: 'number',
        description:
          'Estimated retail offtake in base units between the baseline and current verified stock-count visits.',
      },
      {
        file_name: 'estimated_retail_offtake.csv',
        column_name: 'estimated_sold_cases_per_day',
        data_type: 'number',
        description:
          'Estimated retail offtake normalized to a daily cases rate over the visit gap.',
      },
      {
        file_name: 'estimated_retail_offtake.csv',
        column_name: 'data_quality_flags',
        data_type: 'string',
        description:
          'Pipe-separated quality signals such as duplicate visits, long gaps, or negative clamping.',
      },
      {
        file_name: 'forecast_replenishment_demand.csv',
        column_name: 'forecast_cases',
        data_type: 'number',
        description:
          'Forecast daily replenishment demand generated from recent replenishment order history.',
      },
      {
        file_name: 'forecast_estimated_retail_offtake.csv',
        column_name: 'forecast_cases',
        data_type: 'number',
        description:
          'Forecast daily consumer offtake generated from recent visit-based retail offtake estimates.',
      },
      {
        file_name: 'forecast_demand_signals.csv',
        column_name: 'signal_kind',
        data_type: 'string',
        description:
          'Distinguishes historical actual signal rows from future forecast rows.',
      },
      {
        file_name: 'forecast_demand_signals.csv',
        column_name: 'promotion_flag',
        data_type: 'boolean',
        description:
          'Indicates that a promotion active for the product and territory overlaps the signal date.',
      },
      {
        file_name: 'outlets.csv',
        column_name: 'link_match_source',
        data_type: 'string',
        description:
          'Shows how a shop-owner account was matched to an outlet when canonical shop IDs were resolved.',
      },
      {
        file_name: 'inventory_snapshots.csv',
        column_name: 'snapshot_source',
        data_type: 'string',
        description:
          'Identifies whether the inventory snapshot came from a store visit or warehouse system stock.',
      },
    ];
  }
}
