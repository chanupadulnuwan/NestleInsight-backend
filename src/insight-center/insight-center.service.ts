import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument from 'pdfkit';
import { Repository } from 'typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import {
  AiWriterService,
  type InsightWriterRequest,
  type InsightWriterResponse,
} from '../ai-writer/ai-writer.service';
import { Role } from '../common/enums/role.enum';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { DeliveryAssignmentOrder } from '../delivery-assignments/entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from '../delivery-assignments/entities/delivery-assignment.entity';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { ForecastEngineService } from '../forecast-engine/forecast-engine.service';
import { Order } from '../orders/entities/order.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { StoreVisit, StoreVisitStatus } from '../store-visits/entities/store-visit.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { toCsv, type CsvColumn } from '../exports/utils/csv.util';

type InsightCenterQuery = {
  period?: string;
  fromDate?: string;
  toDate?: string;
  granularity?: string;
  demandType?: string;
  viewMode?: string;
  confidenceLevel?: string;
  compareMode?: string;
  source?: string;
  territoryId?: string;
  warehouseId?: string;
  routeId?: string;
  shopId?: string;
  productId?: string;
};

type Granularity = 'daily' | 'weekly' | 'monthly';
type DemandFilter = 'all' | 'replenishment' | 'estimated_retail_offtake';
type ViewMode = 'absolute' | 'normalized' | 'confidence_adjusted';
type ConfidenceFilter = 'all' | 'high_only';
type CompareMode = 'previous_period' | 'previous_month' | 'previous_year';

type InsightFilters = {
  period: string;
  fromDate: Date;
  toDate: Date;
  granularity: Granularity;
  demandType: DemandFilter;
  viewMode: ViewMode;
  confidenceLevel: ConfidenceFilter;
  compareMode: CompareMode;
  source: string;
  territoryId: string | null;
  warehouseId: string | null;
  routeId: string | null;
  shopId: string | null;
  productId: string | null;
  generatedAt: Date;
};

type ShopReference = {
  canonicalShopId: string;
  sourceType: string;
  outletId: string | null;
  name: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
};

type ShopReferenceContext = {
  rowsByCanonicalId: Map<string, ShopReference>;
  canonicalByOutletId: Map<string, string>;
  canonicalByShopOwnerId: Map<string, { canonicalShopId: string; linkSource: string | null }>;
};

type OrderInfo = {
  order: Order;
  canonicalShopId: string;
  shop: ShopReference | null;
  routeId: string | null;
};

type DemandEvent = {
  eventId: string;
  eventDate: string;
  timestamp: Date;
  canonicalShopId: string;
  shopName: string;
  productId: string;
  productName: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  routeId: string | null;
  source: string;
  quantityCases: number;
  confidenceScore: number;
  promotionFlag: boolean;
};

type DeliveryEvent = DemandEvent & {
  deliveredUnits: number;
};

type ReturnEvent = DemandEvent & {
  returnedUnits: number;
};

type StockCountRow = {
  stockCountId: string;
  visitId: string;
  canonicalShopId: string;
  shopName: string;
  salesRepId: string;
  routeId: string | null;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  productId: string;
  productName: string;
  unitsPerCase: number;
  shelfUnits: number;
  backroomUnits: number;
  currentStockUnits: number;
  currentStockCases: number;
  inStock: boolean;
  observedAt: string;
  observedDate: string;
  duplicateVisitConflict: boolean;
};

type StockoutEvent = {
  stockoutEventId: string;
  visitId: string;
  canonicalShopId: string;
  productId: string;
  productName: string;
  territoryId: string | null;
  territoryName: string | null;
  observedAt: string;
  observedDate: string;
  stockUnits: number;
  reason: string;
};

type LossEvent = {
  timestamp: Date;
  canonicalShopId: string;
  productId: string | null;
  lossType: 'DAMAGED' | 'EXPIRED';
  quantityUnits: number;
};

type RetailOfftakeRow = {
  estimatedRetailOfftakeId: string;
  signalDate: string;
  canonicalShopId: string;
  shopName: string;
  productId: string;
  productName: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  routeId: string | null;
  baselineVisitId: string;
  currentVisitId: string;
  baselineObservedAt: string;
  currentObservedAt: string;
  gapDays: number;
  previousStockUnits: number;
  deliveredUnitsSincePreviousVisit: number;
  returnedUnitsSincePreviousVisit: number;
  damagedUnitsSincePreviousVisit: number;
  expiredUnitsSincePreviousVisit: number;
  currentStockUnits: number;
  estimatedSoldUnitsRaw: number;
  estimatedSoldUnits: number;
  estimatedSoldCases: number;
  estimatedSoldCasesPerDay: number;
  stockoutFlag: boolean;
  duplicateVisitConflict: boolean;
  negativeClampedFlag: boolean;
  confidenceScore: number;
  confidenceLevel: string;
  dataQualityFlags: string;
  promotionFlag: boolean;
};

type VisitRow = {
  visitId: string;
  visitDate: string;
  timestamp: Date;
  canonicalShopId: string;
  shopName: string;
  salesRepId: string;
  routeId: string | null;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  competitorNotes: string | null;
  outletFeedback: string | null;
};

type FieldSignal = {
  signalId: string;
  signalDate: string;
  sourceType: string;
  territoryId: string | null;
  territoryName: string | null;
  productId: string | null;
  productName: string | null;
  signalType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceScore: number;
  summary: string;
};

type OperationalDataset = {
  orderEvents: DemandEvent[];
  allOrderEvents: DemandEvent[];
  deliveryEvents: DeliveryEvent[];
  allDeliveryEvents: DeliveryEvent[];
  returnEvents: ReturnEvent[];
  allReturnEvents: ReturnEvent[];
  retailOfftakeRows: RetailOfftakeRow[];
  allRetailOfftakeRows: RetailOfftakeRow[];
  stockCounts: StockCountRow[];
  stockoutEvents: StockoutEvent[];
  visits: VisitRow[];
  fieldSignals: FieldSignal[];
  shopsById: Map<string, ShopReference>;
  territories: Territory[];
  warehouses: Warehouse[];
};

type KpiCard = {
  key: string;
  label: string;
  value: number;
  unit: string;
  sourceType: 'exact' | 'estimated' | 'hybrid';
  confidenceScore: number | null;
  caption: string;
};

type ReportRow = {
  section: string;
  metric: string;
  value: string | number;
  unit: string;
  source_type: string;
  confidence_score: number | string;
  notes: string;
};

type InsightFilterOption = {
  value: string;
  label: string;
};

type InsightWarehouseOption = InsightFilterOption & {
  territoryId: string | null;
};

type ForecastDataset = Awaited<
  ReturnType<ForecastEngineService['generateForecastData']>
>;

type InsightDashboard = Awaited<
  ReturnType<InsightCenterService['generateDashboard']>
>;

type InsightReportNarrative = {
  reportTitle: string;
  headline: string;
  executiveSummary: string;
  storyOfTheNumbers: string;
  anomalyExplanation: string;
  managementRecommendation: string;
  sectionTitles: string[];
  chartCaptions: string[];
  callouts: string[];
};

const ORDER_DEMAND_STATUSES = new Set([
  'PLACED',
  'APPROVED',
  'PROCEED',
  'COMPLETED',
  'PARTIAL',
  'DELAYED',
]);

const ACTIVE_PROMOTION_STATUSES = new Set(['active', 'scheduled']);
const HIGH_CONFIDENCE_THRESHOLD = 0.8;

@Injectable()
export class InsightCenterService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityLogsRepo: Repository<ActivityLog>,
    @InjectRepository(DailyReport)
    private readonly dailyReportsRepo: Repository<DailyReport>,
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
    @InjectRepository(SalesIncident)
    private readonly salesIncidentsRepo: Repository<SalesIncident>,
    @InjectRepository(StoreVisit)
    private readonly storeVisitsRepo: Repository<StoreVisit>,
    @InjectRepository(Territory)
    private readonly territoriesRepo: Repository<Territory>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepo: Repository<Warehouse>,
    private readonly forecastEngineService: ForecastEngineService,
    private readonly aiWriterService: AiWriterService,
  ) {}

  async generateDashboard(query: InsightCenterQuery) {
    const filters = this.normalizeFilters(query);
    const forecastQuery = {
      fromDate: this.dateKey(filters.fromDate),
      toDate: this.dateKey(filters.toDate),
      forecastDays: '30',
      backtestDays: '14',
    };

    const [dataset, fullForecastDataset] = await Promise.all([
      this.buildOperationalDataset(filters),
      this.forecastEngineService.generateForecastData(forecastQuery),
    ]);
    const forecastDataset = this.filterForecastDataset(fullForecastDataset, filters);

    const denominators = this.buildDenominators(dataset, filters);
    const kpis = this.buildKpis(dataset, forecastDataset, denominators);
    const charts = this.buildCharts(dataset, forecastDataset, filters, denominators);
    const insights = this.buildInsightSummary(kpis, charts, dataset);

    return {
      summary: {
        generatedAt: filters.generatedAt.toISOString(),
        historyStartDate: this.dateKey(filters.fromDate),
        historyEndDate: this.dateKey(filters.toDate),
        period: filters.period,
        granularity: filters.granularity,
        demandType: filters.demandType,
        viewMode: filters.viewMode,
        confidenceLevel: filters.confidenceLevel,
        compareMode: filters.compareMode,
        exactSignalLabel: 'Exact operational demand',
        estimatedSignalLabel: 'Estimated Retail Offtake',
        dataIntegrityWarning:
          'Estimated Retail Offtake is not exact transactional sales. It is calculated from verified stock-count movement and must be read with its confidence score.',
        aiSummary: insights,
      },
      controls: this.buildControls(dataset),
      kpis,
      charts,
      drilldowns: this.buildDrilldowns(dataset, denominators),
      reportLinks: {
        csv: '/insight-center/report.csv',
        pdf: '/insight-center/report.pdf',
      },
    };
  }

  async generateCsvReport(query: InsightCenterQuery) {
    const dashboard = await this.generateDashboard(query);
    const filename = `demand_planner_insight_center_${dashboard.summary.generatedAt.slice(0, 10)}.csv`;
    const rows = this.buildReportRows(dashboard);

    return {
      filename,
      csv: toCsv(rows, this.reportColumns()),
    };
  }

  async generatePdfReport(query: InsightCenterQuery) {
    const dashboard = await this.generateDashboard(query);
    const filename = `demand_planner_insight_center_${dashboard.summary.generatedAt.slice(0, 10)}.pdf`;
    const narrative = await this.buildInsightReportNarrative(dashboard);

    return {
      filename,
      buffer: await this.createInsightPdf(dashboard, narrative),
    };
  }

  private buildControls(dataset: OperationalDataset) {
    const territories: InsightFilterOption[] = dataset.territories.map((territory) => ({
      value: territory.id,
      label: territory.name,
    }));
    const warehouses: InsightWarehouseOption[] = dataset.warehouses.map((warehouse) => ({
      value: warehouse.id,
      label: warehouse.name,
      territoryId: warehouse.territoryId,
    }));

    return {
      periods: ['7d', '30d', '90d', 'ytd', 'custom'],
      granularities: ['daily', 'weekly', 'monthly'],
      demandTypes: ['all', 'replenishment', 'estimated_retail_offtake'],
      viewModes: ['absolute', 'normalized', 'confidence_adjusted'],
      confidenceLevels: ['all', 'high_only'],
      compareModes: ['previous_period', 'previous_month', 'previous_year'],
      normalizers: [
        'total_volume',
        'per_shop',
        'per_active_outlet',
        'per_visit',
        'per_sales_rep',
        'per_route_day',
        'per_promotion_active_shop',
        'per_100_visits',
      ],
      territories,
      warehouses,
    };
  }

  private async buildOperationalDataset(
    filters: InsightFilters,
  ): Promise<OperationalDataset> {
    const [
      activityLogs,
      assignments,
      assignmentOrders,
      orders,
      orderReturns,
      outlets,
      products,
      promotions,
      promotionProducts,
      promotionTerritories,
      incidents,
      dailyReports,
      visits,
      territories,
      users,
      warehouses,
    ] = await Promise.all([
      this.activityLogsRepo.find({ order: { createdAt: 'ASC' } }),
      this.assignmentsRepo.find({
        relations: {
          assignmentOrders: {
            order: { items: { product: true } },
          },
        },
        order: { createdAt: 'ASC' },
      }),
      this.assignmentOrdersRepo.find({ relations: { assignment: true } }),
      this.ordersRepo.find({
        relations: {
          user: true,
          territory: true,
          warehouse: true,
          items: { product: true },
        },
        order: { placedAt: 'ASC' },
      }),
      this.orderReturnsRepo.find({
        relations: { items: { product: true } },
        order: { createdAt: 'ASC' },
      }),
      this.outletsRepo.find({ order: { createdAt: 'ASC' } }),
      this.productsRepo.find({ order: { productName: 'ASC' } }),
      this.promotionsRepo.find({ order: { startDate: 'ASC' } }),
      this.promotionProductsRepo.find(),
      this.promotionTerritoriesRepo.find(),
      this.salesIncidentsRepo.find({ order: { createdAt: 'ASC' } }),
      this.dailyReportsRepo.find({ order: { reportDate: 'ASC' } }),
      this.storeVisitsRepo.find({
        relations: { salesRep: true, route: true },
        order: { visitStartedAt: 'ASC' },
      }),
      this.territoriesRepo.find({ order: { name: 'ASC' } }),
      this.usersRepo.find({
        relations: { territory: true, warehouse: true },
        order: { createdAt: 'ASC' },
      }),
      this.warehousesRepo.find({ relations: { territory: true } }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const territoryById = new Map(
      territories.map((territory) => [territory.id, territory]),
    );
    const warehouseById = new Map(
      warehouses.map((warehouse) => [warehouse.id, warehouse]),
    );
    const shopOwners = users.filter((user) => user.role === Role.SHOP_OWNER);
    const shopContext = this.createShopReferenceContext(
      outlets,
      shopOwners,
      territoryById,
      warehouseById,
    );
    const promotionProductsByPromotionId =
      this.groupPromotionProducts(promotionProducts);
    const promotionTerritoriesByPromotionId =
      this.groupPromotionTerritories(promotionTerritories);
    const promotionResolver = this.createPromotionResolver(
      promotions,
      promotionProductsByPromotionId,
      promotionTerritoriesByPromotionId,
    );

    const orderInfos = new Map<string, OrderInfo>();
    for (const order of orders) {
      const resolvedShop = this.resolveOrderShopReference(order, shopContext);
      orderInfos.set(order.id, {
        order,
        canonicalShopId: resolvedShop.canonicalShopId,
        shop: shopContext.rowsByCanonicalId.get(resolvedShop.canonicalShopId) ?? null,
        routeId: this.parseUuidFromNote(order.customerNote, 'Route'),
      });
    }

    const allOrderEvents = this.buildOrderEvents(
      orders,
      orderInfos,
      productById,
      promotionResolver,
    );
    const deliveryActivityByOrderId = this.groupDeliveryActivities(activityLogs);
    const assignmentByOrderId = this.createAssignmentByOrderId(
      assignments,
      assignmentOrders,
    );
    const allDeliveryEvents = this.buildDeliveryEvents(
      orders,
      orderInfos,
      productById,
      deliveryActivityByOrderId,
      assignmentByOrderId,
      promotionResolver,
    );
    const allReturnEvents = this.buildReturnEvents(
      orderReturns,
      orderInfos,
      productById,
      promotionResolver,
    );

    const {
      stockCounts,
      stockoutEvents,
      lossEvents,
      visitRows,
      visitFieldSignals,
    } = this.buildVisitSignals(
      visits,
      productById,
      territoryById,
      shopContext,
      filters,
    );

    const normalizedStockCounts = this.normalizeDuplicateStockCounts(stockCounts);
    const allRetailOfftakeRows = this.buildEstimatedRetailOfftakeRows(
      normalizedStockCounts,
      this.groupTimedEvents(allDeliveryEvents, 'deliveredUnits'),
      this.groupTimedEvents(allReturnEvents, 'returnedUnits'),
      this.groupLossEvents(lossEvents),
      this.groupStockoutEvents(stockoutEvents),
      promotionResolver,
    );

    const reportSignals = this.buildReportAndIncidentSignals(
      incidents,
      dailyReports,
      activityLogs,
      products,
      filters,
    );

    const filteredOrderEvents = allOrderEvents.filter(
      (event) =>
        this.isInRange(event.timestamp, filters) &&
        this.matchesFilters(event, filters) &&
        this.matchesOrderSource(event, filters.source) &&
        filters.demandType !== 'estimated_retail_offtake',
    );
    const filteredDeliveryEvents = allDeliveryEvents.filter(
      (event) =>
        this.isInRange(event.timestamp, filters) &&
        this.matchesFilters(event, filters) &&
        filters.demandType !== 'estimated_retail_offtake',
    );
    const filteredReturnEvents = allReturnEvents.filter(
      (event) =>
        this.isInRange(event.timestamp, filters) &&
        this.matchesFilters(event, filters) &&
        filters.demandType !== 'estimated_retail_offtake',
    );
    const filteredRetailOfftakeRows = allRetailOfftakeRows.filter(
      (row) =>
        this.isInRange(row.currentObservedAt, filters) &&
        this.matchesFilters(row, filters) &&
        filters.demandType !== 'replenishment' &&
        (filters.confidenceLevel === 'all' ||
          row.confidenceScore >= HIGH_CONFIDENCE_THRESHOLD),
    );
    const filteredStockCounts = normalizedStockCounts.filter(
      (row) =>
        this.isInRange(row.observedAt, filters) && this.matchesFilters(row, filters),
    );
    const filteredStockouts = stockoutEvents.filter(
      (event) =>
        this.isInRange(event.observedAt, filters) &&
        this.matchesFilters(event, filters),
    );
    const filteredVisits = visitRows.filter(
      (visit) =>
        this.isInRange(visit.timestamp, filters) &&
        this.matchesFilters(visit, filters),
    );

    return {
      orderEvents: filteredOrderEvents,
      allOrderEvents,
      deliveryEvents: filteredDeliveryEvents,
      allDeliveryEvents,
      returnEvents: filteredReturnEvents,
      allReturnEvents,
      retailOfftakeRows: filteredRetailOfftakeRows,
      allRetailOfftakeRows,
      stockCounts: filteredStockCounts,
      stockoutEvents: filteredStockouts,
      visits: filteredVisits,
      fieldSignals: [...visitFieldSignals, ...reportSignals].filter(
        (signal) =>
          this.isInRange(signal.signalDate, filters) &&
          this.matchesFilters(signal, filters),
      ),
      shopsById: shopContext.rowsByCanonicalId,
      territories,
      warehouses,
    };
  }

  private buildOrderEvents(
    orders: Order[],
    orderInfos: Map<string, OrderInfo>,
    productById: Map<string, Product>,
    promotionResolver: (
      dateKey: string,
      productId: string,
      territoryId: string | null,
    ) => boolean,
  ) {
    const events: DemandEvent[] = [];

    for (const order of orders) {
      if (!ORDER_DEMAND_STATUSES.has(order.status)) {
        continue;
      }

      const orderInfo = orderInfos.get(order.id);
      if (!orderInfo) {
        continue;
      }

      const eventDate = this.dateKey(order.placedAt);
      for (const item of order.items ?? []) {
        if (!item.productId) {
          continue;
        }

        const product = productById.get(item.productId);
        const productName =
          item.productNameSnapshot || product?.productName || 'Unknown Product';
        const promotionFlag =
          !!order.appliedPromotionId ||
          promotionResolver(eventDate, item.productId, order.territoryId);

        events.push({
          eventId: `order:${order.id}:${item.id}`,
          eventDate,
          timestamp: order.placedAt,
          canonicalShopId: orderInfo.canonicalShopId,
          shopName: orderInfo.shop?.name ?? order.shopNameSnapshot,
          productId: item.productId,
          productName,
          territoryId: order.territoryId,
          territoryName:
            order.territory?.name ?? orderInfo.shop?.territoryName ?? null,
          warehouseId: order.warehouseId,
          routeId: orderInfo.routeId,
          source: order.source,
          quantityCases: this.roundNumber(Number(item.quantity ?? 0)),
          confidenceScore: 0.96,
          promotionFlag,
        });
      }
    }

    return events;
  }

  private buildDeliveryEvents(
    orders: Order[],
    orderInfos: Map<string, OrderInfo>,
    productById: Map<string, Product>,
    deliveryActivityByOrderId: Map<string, ActivityLog[]>,
    assignmentByOrderId: Map<
      string,
      { assignment: DeliveryAssignment; dao: DeliveryAssignmentOrder }
    >,
    promotionResolver: (
      dateKey: string,
      productId: string,
      territoryId: string | null,
    ) => boolean,
  ) {
    const events: DeliveryEvent[] = [];

    for (const order of orders) {
      const orderInfo = orderInfos.get(order.id);
      if (!orderInfo) {
        continue;
      }

      const activities = deliveryActivityByOrderId.get(order.id) ?? [];
      const deliveredAt =
        activities[0]?.createdAt ??
        this.resolveFallbackDeliveredAt(order, assignmentByOrderId.get(order.id) ?? null);
      const derivedItems = this.deriveDeliveredItems(order, activities, productById);

      if (!deliveredAt || derivedItems.length === 0) {
        continue;
      }

      const eventDate = this.dateKey(deliveredAt);
      for (const item of derivedItems) {
        events.push({
          eventId: `delivery:${order.id}:${item.productId}`,
          eventDate,
          timestamp: deliveredAt,
          canonicalShopId: orderInfo.canonicalShopId,
          shopName: orderInfo.shop?.name ?? order.shopNameSnapshot,
          productId: item.productId,
          productName: item.productName,
          territoryId: order.territoryId,
          territoryName:
            order.territory?.name ?? orderInfo.shop?.territoryName ?? null,
          warehouseId: order.warehouseId,
          routeId: orderInfo.routeId,
          source: 'DELIVERY',
          quantityCases: this.roundNumber(item.deliveredCases),
          deliveredUnits: this.roundNumber(item.deliveredCases * item.unitsPerCase),
          confidenceScore: 0.92,
          promotionFlag: promotionResolver(eventDate, item.productId, order.territoryId),
        });
      }
    }

    return events;
  }

  private buildReturnEvents(
    orderReturns: OrderReturn[],
    orderInfos: Map<string, OrderInfo>,
    productById: Map<string, Product>,
    promotionResolver: (
      dateKey: string,
      productId: string,
      territoryId: string | null,
    ) => boolean,
  ) {
    const events: ReturnEvent[] = [];

    for (const orderReturn of orderReturns) {
      const orderInfo = orderReturn.orderId
        ? orderInfos.get(orderReturn.orderId)
        : null;
      const eventDate = this.dateKey(orderReturn.createdAt);

      for (const item of orderReturn.items ?? []) {
        if (!item.productId) {
          continue;
        }

        const product = productById.get(item.productId);
        const unitsPerCase = this.getUnitsPerCase(item.productId, productById);
        const quantityCases = this.readNumber(item.quantity);
        events.push({
          eventId: `return:${orderReturn.id}:${item.id}`,
          eventDate,
          timestamp: orderReturn.createdAt,
          canonicalShopId:
            orderInfo?.canonicalShopId ?? `return_order_ref:${orderReturn.orderId ?? orderReturn.id}`,
          shopName: orderInfo?.shop?.name ?? 'Returned order',
          productId: item.productId,
          productName:
            item.productNameSnapshot || product?.productName || 'Unknown Product',
          territoryId: orderInfo?.order.territoryId ?? null,
          territoryName:
            orderInfo?.order.territory?.name ?? orderInfo?.shop?.territoryName ?? null,
          warehouseId: orderInfo?.order.warehouseId ?? null,
          routeId: orderInfo?.routeId ?? null,
          source: 'RETURN',
          quantityCases,
          returnedUnits: this.roundNumber(quantityCases * unitsPerCase),
          confidenceScore: orderReturn.tmVerified ? 0.92 : 0.75,
          promotionFlag: item.productId
            ? promotionResolver(
                eventDate,
                item.productId,
                orderInfo?.order.territoryId ?? null,
              )
            : false,
        });
      }
    }

    return events;
  }

  private buildVisitSignals(
    visits: StoreVisit[],
    productById: Map<string, Product>,
    territoryById: Map<string, Territory>,
    shopContext: ShopReferenceContext,
    filters: InsightFilters,
  ) {
    const stockCounts: StockCountRow[] = [];
    const stockoutEvents: StockoutEvent[] = [];
    const lossEvents: LossEvent[] = [];
    const visitRows: VisitRow[] = [];
    const visitFieldSignals: FieldSignal[] = [];

    for (const visit of visits) {
      if (visit.status !== StoreVisitStatus.COMPLETED) {
        continue;
      }

      const canonicalShopId = visit.shopId
        ? this.ensureOutletReference(shopContext, visit.shopId)
        : `visit_only:${visit.id}`;
      const shop = shopContext.rowsByCanonicalId.get(canonicalShopId);
      const observedAt = visit.visitEndedAt ?? visit.visitStartedAt;
      const observedDate = this.dateKey(observedAt);
      const territory = visit.territoryId
        ? territoryById.get(visit.territoryId)
        : null;
      const territoryName = territory?.name ?? shop?.territoryName ?? null;
      const warehouseId = visit.route?.warehouseId ?? shop?.warehouseId ?? null;

      const visitRow: VisitRow = {
        visitId: visit.id,
        visitDate: observedDate,
        timestamp: observedAt,
        canonicalShopId,
        shopName: shop?.name ?? visit.shopNameSnapshot,
        salesRepId: visit.salesRepId,
        routeId: visit.routeId,
        territoryId: visit.territoryId ?? shop?.territoryId ?? null,
        territoryName,
        warehouseId,
        competitorNotes: visit.competitorNotes,
        outletFeedback: visit.outletFeedback,
      };
      visitRows.push(visitRow);

      this.addVisitFieldSignals(visitRow, visitFieldSignals, filters);

      const stockItems = Array.isArray(visit.shelfStockJson)
        ? visit.shelfStockJson
        : [];
      for (const stockItem of stockItems) {
        const stockRecord = stockItem as unknown as Record<string, unknown>;
        const productId = stockRecord.productId?.toString() ?? '';
        if (!productId) {
          continue;
        }

        const product = productById.get(productId);
        const unitsPerCase = this.getUnitsPerCase(productId, productById);
        const shelfUnits = this.readStockUnits(stockRecord, 'shelf');
        const backroomUnits = this.readStockUnits(stockRecord, 'backroom');
        const currentStockUnits = shelfUnits + backroomUnits;
        const inStock =
          stockRecord.inStock === undefined
            ? currentStockUnits > 0
            : Boolean(stockRecord.inStock);
        const productName =
          stockRecord.productName?.toString() ??
          product?.productName ??
          'Unknown Product';

        stockCounts.push({
          stockCountId: `${visit.id}:${productId}`,
          visitId: visit.id,
          canonicalShopId,
          shopName: visitRow.shopName,
          salesRepId: visit.salesRepId,
          routeId: visit.routeId,
          territoryId: visitRow.territoryId,
          territoryName,
          warehouseId,
          productId,
          productName,
          unitsPerCase,
          shelfUnits,
          backroomUnits,
          currentStockUnits,
          currentStockCases: this.roundNumber(
            unitsPerCase > 0 ? currentStockUnits / unitsPerCase : 0,
          ),
          inStock,
          observedAt: observedAt.toISOString(),
          observedDate,
          duplicateVisitConflict: false,
        });

        const oosReason = stockRecord.oosReason?.toString() ?? '';
        if (!inStock || currentStockUnits <= 0 || oosReason.trim()) {
          stockoutEvents.push({
            stockoutEventId: `stockout:${visit.id}:${productId}`,
            visitId: visit.id,
            canonicalShopId,
            productId,
            productName,
            territoryId: visitRow.territoryId,
            territoryName,
            observedAt: observedAt.toISOString(),
            observedDate,
            stockUnits: currentStockUnits,
            reason: oosReason,
          });
        }
      }

      this.addLossEvents(visit, productById, canonicalShopId, observedAt, lossEvents);
    }

    return {
      stockCounts,
      stockoutEvents,
      lossEvents,
      visitRows,
      visitFieldSignals,
    };
  }

  private buildEstimatedRetailOfftakeRows(
    stockCounts: StockCountRow[],
    deliveryEventsByKey: Map<string, Array<{ timestamp: Date; quantityUnits: number }>>,
    returnEventsByKey: Map<string, Array<{ timestamp: Date; quantityUnits: number }>>,
    lossEventsByKey: Map<
      string,
      Array<{ timestamp: Date; quantityUnits: number; lossType: string }>
    >,
    stockoutEventsByKey: Map<string, Array<{ timestamp: Date }>>,
    promotionResolver: (
      dateKey: string,
      productId: string,
      territoryId: string | null,
    ) => boolean,
  ) {
    const rowsByShopProduct = new Map<string, StockCountRow[]>();
    for (const stockCount of stockCounts) {
      const key = `${stockCount.canonicalShopId}|${stockCount.productId}`;
      const existing = rowsByShopProduct.get(key) ?? [];
      existing.push(stockCount);
      rowsByShopProduct.set(key, existing);
    }

    const results: RetailOfftakeRow[] = [];

    for (const [key, rows] of rowsByShopProduct.entries()) {
      const sorted = [...rows].sort((left, right) =>
        left.observedAt.localeCompare(right.observedAt),
      );

      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        const previousTime = new Date(previous.observedAt);
        const currentTime = new Date(current.observedAt);
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
          previous.currentStockUnits +
          deliveredUnits -
          returnedUnits -
          damagedUnits -
          expiredUnits -
          current.currentStockUnits;
        const estimatedSoldUnits = Math.max(0, rawEstimatedSoldUnits);
        const stockoutFlag = this.hasEventBetween(
          stockoutEventsByKey.get(key) ?? [],
          previousTime,
          currentTime,
        );
        const negativeClamped = rawEstimatedSoldUnits < 0;
        const qualityFlags: string[] = [];
        if (previous.duplicateVisitConflict || current.duplicateVisitConflict) {
          qualityFlags.push('DUPLICATE_VISIT_CONFLICT');
        }
        if (negativeClamped) {
          qualityFlags.push('NEGATIVE_ESTIMATED_SALES_CLAMPED');
        }
        if (gapDays > 30) {
          qualityFlags.push('LONG_VISIT_GAP');
        }
        if (current.unitsPerCase <= 0) {
          qualityFlags.push('UNITS_PER_CASE_MISSING');
        }
        const confidence = this.computeRetailConfidenceScore({
          gapDays,
          duplicateVisitConflict:
            previous.duplicateVisitConflict || current.duplicateVisitConflict,
          negativeClamped,
          stockoutFlag,
        });

        results.push({
          estimatedRetailOfftakeId: `${current.visitId}:${current.productId}`,
          signalDate: current.observedDate,
          canonicalShopId: current.canonicalShopId,
          shopName: current.shopName,
          productId: current.productId,
          productName: current.productName,
          territoryId: current.territoryId,
          territoryName: current.territoryName,
          warehouseId: current.warehouseId,
          routeId: current.routeId,
          baselineVisitId: previous.visitId,
          currentVisitId: current.visitId,
          baselineObservedAt: previous.observedAt,
          currentObservedAt: current.observedAt,
          gapDays,
          previousStockUnits: previous.currentStockUnits,
          deliveredUnitsSincePreviousVisit: deliveredUnits,
          returnedUnitsSincePreviousVisit: returnedUnits,
          damagedUnitsSincePreviousVisit: damagedUnits,
          expiredUnitsSincePreviousVisit: expiredUnits,
          currentStockUnits: current.currentStockUnits,
          estimatedSoldUnitsRaw: this.roundNumber(rawEstimatedSoldUnits),
          estimatedSoldUnits: this.roundNumber(estimatedSoldUnits),
          estimatedSoldCases: this.roundNumber(
            current.unitsPerCase > 0 ? estimatedSoldUnits / current.unitsPerCase : 0,
          ),
          estimatedSoldCasesPerDay: this.roundNumber(
            current.unitsPerCase > 0
              ? estimatedSoldUnits / current.unitsPerCase / gapDays
              : 0,
          ),
          stockoutFlag,
          duplicateVisitConflict:
            previous.duplicateVisitConflict || current.duplicateVisitConflict,
          negativeClampedFlag: negativeClamped,
          confidenceScore: confidence.score,
          confidenceLevel: confidence.level,
          dataQualityFlags: qualityFlags.join('|'),
          promotionFlag: promotionResolver(
            current.observedDate,
            current.productId,
            current.territoryId,
          ),
        });
      }
    }

    return results.sort((left, right) =>
      `${left.signalDate}|${left.canonicalShopId}|${left.productId}`.localeCompare(
        `${right.signalDate}|${right.canonicalShopId}|${right.productId}`,
      ),
    );
  }

  private filterForecastDataset(
    forecastDataset: ForecastDataset,
    filters: InsightFilters,
  ): ForecastDataset {
    const forecastOutput = forecastDataset.forecastOutput.filter((row) =>
      this.matchesForecastFilters(row, filters),
    );
    const accuracyReport = forecastDataset.accuracyReport.filter((row) =>
      this.matchesForecastFilters(row, filters),
    );
    const exceptions = forecastDataset.exceptions.filter((row) =>
      this.matchesForecastFilters(row, filters),
    );
    const confidenceScores = forecastDataset.confidenceScores.filter((row) =>
      this.matchesForecastFilters(row, filters),
    );
    const aiExplanations = forecastDataset.aiExplanations.filter((row) =>
      this.matchesForecastAiFilters(row, filters),
    );

    const confidenceValues = confidenceScores
      .map((row) => row.confidence_score)
      .filter((value) => Number.isFinite(value));
    const wapeValues = accuracyReport
      .map((row) => row.wape)
      .filter((value) => Number.isFinite(value));

    return {
      summary: {
        ...forecastDataset.summary,
        forecastRows: forecastOutput.length,
        exceptions: exceptions.length,
        aiSignals: aiExplanations.length,
        averageConfidenceScore:
          confidenceValues.length > 0
            ? this.roundNumber(this.average(confidenceValues))
            : 0,
        averageWape:
          wapeValues.length > 0
            ? this.roundNumber(this.average(wapeValues))
            : null,
      },
      forecastOutput,
      accuracyReport,
      exceptions,
      confidenceScores,
      aiExplanations,
    };
  }

  private buildKpis(
    dataset: OperationalDataset,
    forecastDataset: ForecastDataset,
    denominators: ReturnType<InsightCenterService['buildDenominators']>,
  ): KpiCard[] {
    const orderedCases = this.sum(dataset.orderEvents, 'quantityCases');
    const deliveredCases = this.sum(dataset.deliveryEvents, 'quantityCases');
    const returnedCases = this.sum(dataset.returnEvents, 'quantityCases');
    const estimatedRetailCases = this.sum(
      dataset.retailOfftakeRows,
      'estimatedSoldCases',
    );
    const forecastCases = this.sum(
      forecastDataset.forecastOutput,
      'forecast_cases',
    );
    const stockoutRate =
      dataset.stockCounts.length > 0
        ? dataset.stockoutEvents.length / dataset.stockCounts.length
        : 0;
    const returnRate =
      deliveredCases > 0 ? returnedCases / Math.max(1, deliveredCases) : 0;
    const activeTerritories = new Set(
      [
        ...dataset.orderEvents.map((row) => row.territoryId),
        ...dataset.deliveryEvents.map((row) => row.territoryId),
        ...dataset.retailOfftakeRows.map((row) => row.territoryId),
        ...dataset.visits.map((row) => row.territoryId),
      ].filter((territoryId): territoryId is string => Boolean(territoryId)),
    ).size;
    const activeOutlets = new Set(
      [
        ...dataset.orderEvents.map((row) => row.canonicalShopId),
        ...dataset.deliveryEvents.map((row) => row.canonicalShopId),
        ...dataset.retailOfftakeRows.map((row) => row.canonicalShopId),
        ...dataset.visits.map((row) => row.canonicalShopId),
      ].filter(Boolean),
    ).size;
    const averageRetailSignalConfidence = this.average(
      dataset.retailOfftakeRows.map((row) => row.confidenceScore),
    );

    return [
      {
        key: 'total_ordered_cases',
        label: 'Total ordered cases',
        value: this.applyViewMode(orderedCases, denominators, 'exact'),
        unit: 'cases',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Exact replenishment demand placed by shops.',
      },
      {
        key: 'total_delivered_cases',
        label: 'Total delivered cases',
        value: this.applyViewMode(deliveredCases, denominators, 'exact'),
        unit: 'cases',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Exact fulfillment movement delivered into the market.',
      },
      {
        key: 'estimated_retail_offtake',
        label: 'Estimated retail offtake',
        value: this.applyViewMode(
          estimatedRetailCases,
          denominators,
          'estimated',
          averageRetailSignalConfidence,
        ),
        unit: 'estimated cases',
        sourceType: 'estimated',
        confidenceScore: averageRetailSignalConfidence || null,
        caption: 'Estimated from verified stock-count movement, not POS sales.',
      },
      {
        key: 'forecast_next_period',
        label: 'Forecast next period',
        value: this.applyViewMode(
          forecastCases,
          denominators,
          'hybrid',
          forecastDataset.summary.averageConfidenceScore,
        ),
        unit: 'cases',
        sourceType: 'hybrid',
        confidenceScore: forecastDataset.summary.averageConfidenceScore || null,
        caption: 'Hybrid statistical forecast from the Forecast Engine.',
      },
      {
        key: 'stockout_rate',
        label: 'Stockout rate',
        value: this.roundNumber(stockoutRate),
        unit: 'rate',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Share of verified stock counts that indicated a stockout.',
      },
      {
        key: 'return_rate',
        label: 'Return rate',
        value: this.roundNumber(returnRate),
        unit: 'rate',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Returned quantity compared with delivered quantity.',
      },
      {
        key: 'active_territories',
        label: 'Active territories',
        value: activeTerritories,
        unit: 'territories',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Current territories that contributed demand or visit data in this window.',
      },
      {
        key: 'active_outlets',
        label: 'Active outlets',
        value: activeOutlets,
        unit: 'outlets',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Distinct outlets or shop-owner locations with activity in this window.',
      },
      {
        key: 'verified_visits',
        label: 'Verified visits',
        value: dataset.visits.length,
        unit: 'visits',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Store visits with captured notes or stock observations in the selected window.',
      },
      {
        key: 'avg_retail_signal_confidence',
        label: 'Avg retail signal confidence',
        value: this.roundNumber(averageRetailSignalConfidence),
        unit: 'rate',
        sourceType: 'estimated',
        confidenceScore: null,
        caption: 'Average confidence across estimated retail-offtake intervals.',
      },
    ];
  }

  private buildCharts(
    dataset: OperationalDataset,
    forecastDataset: ForecastDataset,
    filters: InsightFilters,
    denominators: ReturnType<InsightCenterService['buildDenominators']>,
  ) {
    const trend = this.buildTrendChart(
      dataset,
      forecastDataset,
      filters,
      denominators,
    );
    return {
      tabs: [
        'Overview',
        'Demand Trends',
        'Forecast',
        'Promotions',
        'Competitors & Feedback',
        'Operations & Risks',
        'Shop / SKU Drilldown',
        'Report',
      ],
      trend,
      actualVsForecast: forecastDataset.accuracyReport.slice(0, 20).map((row) => ({
        demand_type: row.demand_type,
        product_id: row.product_id,
        product_name: row.product_name,
        territory_id: row.territory_id,
        actual_cases: row.actual_cases,
        forecast_cases: row.forecast_cases,
        wape: row.wape,
        forecast_bias: row.forecast_bias,
      })),
      territoryHeatmap: this.buildTerritoryHeatmap(dataset),
      demandSplit: this.buildDemandSplit(dataset),
      promotionImpact: this.buildPromotionImpact(dataset),
      productMomentum: this.buildProductMomentum(dataset),
      customerSalesByProduct: this.buildCustomerSalesByProduct(dataset),
      orderVsCustomerSales: this.buildOrderVsCustomerSales(dataset),
      stockoutImpact: this.buildStockoutImpact(dataset),
      competitorPressure: this.buildCompetitorPressure(dataset),
      feedbackThemes: this.buildFeedbackThemes(dataset),
      visitCoverageConfidence: this.buildVisitCoverage(dataset, filters),
      waterfall: this.buildWaterfall(dataset, forecastDataset),
      exceptions: this.buildExceptions(dataset, forecastDataset),
    };
  }

  private buildTrendChart(
    dataset: OperationalDataset,
    forecastDataset: ForecastDataset,
    filters: InsightFilters,
    denominators: ReturnType<InsightCenterService['buildDenominators']>,
  ) {
    const averageRetailConfidence = this.average(
      dataset.retailOfftakeRows.map((row) => row.confidenceScore),
    );
    const buckets = new Map<
      string,
      {
        date: string;
        label: string;
        ordered_cases: number;
        delivered_cases: number;
        estimated_retail_offtake_cases: number;
        forecast_cases: number;
        confidence_score: number;
        stockout_count: number;
      }
    >();

    for (const dateKey of this.bucketKeys(filters.fromDate, filters.toDate, filters.granularity)) {
      buckets.set(dateKey, {
        date: dateKey,
        label: this.formatBucketLabel(dateKey, filters.granularity),
        ordered_cases: 0,
        delivered_cases: 0,
        estimated_retail_offtake_cases: 0,
        forecast_cases: 0,
        confidence_score: 0,
        stockout_count: 0,
      });
    }

    for (const event of dataset.orderEvents) {
      const bucket = this.ensureTrendBucket(buckets, event.eventDate, filters.granularity);
      bucket.ordered_cases = this.roundNumber(bucket.ordered_cases + event.quantityCases);
      bucket.confidence_score = Math.max(bucket.confidence_score, event.confidenceScore);
    }
    for (const event of dataset.deliveryEvents) {
      const bucket = this.ensureTrendBucket(buckets, event.eventDate, filters.granularity);
      bucket.delivered_cases = this.roundNumber(bucket.delivered_cases + event.quantityCases);
    }
    for (const row of dataset.retailOfftakeRows) {
      const bucket = this.ensureTrendBucket(buckets, row.signalDate, filters.granularity);
      bucket.estimated_retail_offtake_cases = this.roundNumber(
        bucket.estimated_retail_offtake_cases + row.estimatedSoldCases,
      );
      bucket.confidence_score = Math.max(bucket.confidence_score, row.confidenceScore);
    }
    for (const event of dataset.stockoutEvents) {
      const bucket = this.ensureTrendBucket(buckets, event.observedDate, filters.granularity);
      bucket.stockout_count += 1;
    }
    for (const row of forecastDataset.forecastOutput) {
      const bucket = this.ensureTrendBucket(
        buckets,
        row.forecast_date,
        filters.granularity,
      );
      bucket.forecast_cases = this.roundNumber(bucket.forecast_cases + row.forecast_cases);
      bucket.confidence_score = Math.max(bucket.confidence_score, row.confidence_score);
    }

    return [...buckets.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((row) => ({
        ...row,
        display_ordered_cases: this.applyViewMode(row.ordered_cases, denominators, 'exact'),
        display_delivered_cases: this.applyViewMode(row.delivered_cases, denominators, 'exact'),
        display_estimated_retail_offtake_cases: this.applyViewMode(
          row.estimated_retail_offtake_cases,
          denominators,
          'estimated',
          row.confidence_score || averageRetailConfidence,
        ),
        display_forecast_cases: this.applyViewMode(
          row.forecast_cases,
          denominators,
          'hybrid',
          row.confidence_score || forecastDataset.summary.averageConfidenceScore,
        ),
      }));
  }

  private buildProductMomentum(dataset: OperationalDataset) {
    const grouped = new Map<
      string,
      {
        product_id: string;
        product_name: string;
        ordered_cases: number;
        delivered_cases: number;
        estimated_retail_offtake_cases: number;
      }
    >();

    const ensure = (productId: string, productName: string) => {
      const existing = grouped.get(productId);
      if (existing) return existing;
      const next = {
        product_id: productId,
        product_name: productName,
        ordered_cases: 0,
        delivered_cases: 0,
        estimated_retail_offtake_cases: 0,
      };
      grouped.set(productId, next);
      return next;
    };

    for (const event of dataset.orderEvents) {
      ensure(event.productId, event.productName).ordered_cases += event.quantityCases;
    }
    for (const event of dataset.deliveryEvents) {
      ensure(event.productId, event.productName).delivered_cases += event.quantityCases;
    }
    for (const row of dataset.retailOfftakeRows) {
      ensure(row.productId, row.productName).estimated_retail_offtake_cases +=
        row.estimatedSoldCases;
    }

    const ranked = [...grouped.values()]
      .map((row) => ({
        ...row,
        demand_signal_cases: this.roundNumber(
          Math.max(row.ordered_cases, row.estimated_retail_offtake_cases),
        ),
      }))
      .filter((row) => row.demand_signal_cases > 0)
      .sort((left, right) => right.demand_signal_cases - left.demand_signal_cases);

    return {
      highest: ranked.slice(0, 5),
      lowest: [...ranked].reverse().slice(0, 5).reverse(),
    };
  }

  private buildCustomerSalesByProduct(dataset: OperationalDataset) {
    const grouped = new Map<
      string,
      {
        product_id: string;
        product_name: string;
        estimated_retail_offtake_cases: number;
        confidenceValues: number[];
      }
    >();

    for (const row of dataset.retailOfftakeRows) {
      const existing =
        grouped.get(row.productId) ??
        {
          product_id: row.productId,
          product_name: row.productName,
          estimated_retail_offtake_cases: 0,
          confidenceValues: [] as number[],
        };
      existing.estimated_retail_offtake_cases += row.estimatedSoldCases;
      existing.confidenceValues.push(row.confidenceScore);
      grouped.set(row.productId, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        estimated_retail_offtake_cases: this.roundNumber(
          row.estimated_retail_offtake_cases,
        ),
        confidence_score: this.roundNumber(this.average(row.confidenceValues)),
      }))
      .sort(
        (left, right) =>
          right.estimated_retail_offtake_cases - left.estimated_retail_offtake_cases,
      )
      .slice(0, 10);
  }

  private buildOrderVsCustomerSales(dataset: OperationalDataset) {
    const grouped = new Map<
      string,
      {
        product_id: string;
        product_name: string;
        ordered_cases: number;
        estimated_retail_offtake_cases: number;
      }
    >();

    const ensure = (productId: string, productName: string) => {
      const existing = grouped.get(productId);
      if (existing) return existing;
      const next = {
        product_id: productId,
        product_name: productName,
        ordered_cases: 0,
        estimated_retail_offtake_cases: 0,
      };
      grouped.set(productId, next);
      return next;
    };

    for (const event of dataset.orderEvents) {
      ensure(event.productId, event.productName).ordered_cases += event.quantityCases;
    }
    for (const row of dataset.retailOfftakeRows) {
      ensure(row.productId, row.productName).estimated_retail_offtake_cases +=
        row.estimatedSoldCases;
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        ordered_cases: this.roundNumber(row.ordered_cases),
        estimated_retail_offtake_cases: this.roundNumber(
          row.estimated_retail_offtake_cases,
        ),
        gap_cases: this.roundNumber(
          row.ordered_cases - row.estimated_retail_offtake_cases,
        ),
      }))
      .sort((left, right) => Math.abs(right.gap_cases) - Math.abs(left.gap_cases))
      .slice(0, 10);
  }

  private buildTerritoryHeatmap(dataset: OperationalDataset) {
    const grouped = new Map<
      string,
      {
        territory_id: string | null;
        territory_name: string;
        product_id: string;
        product_name: string;
        ordered_cases: number;
        delivered_cases: number;
        estimated_retail_offtake_cases: number;
        stockouts: number;
        confidenceValues: number[];
      }
    >();

    const ensure = (
      territoryId: string | null,
      territoryName: string | null,
      productId: string,
      productName: string,
    ) => {
      const key = `${territoryId ?? 'none'}|${productId}`;
      const existing = grouped.get(key);
      if (existing) return existing;
      const next = {
        territory_id: territoryId,
        territory_name: territoryName ?? 'Unassigned',
        product_id: productId,
        product_name: productName,
        ordered_cases: 0,
        delivered_cases: 0,
        estimated_retail_offtake_cases: 0,
        stockouts: 0,
        confidenceValues: [] as number[],
      };
      grouped.set(key, next);
      return next;
    };

    for (const event of dataset.orderEvents) {
      const row = ensure(
        event.territoryId,
        event.territoryName,
        event.productId,
        event.productName,
      );
      row.ordered_cases += event.quantityCases;
    }
    for (const event of dataset.deliveryEvents) {
      const row = ensure(
        event.territoryId,
        event.territoryName,
        event.productId,
        event.productName,
      );
      row.delivered_cases += event.quantityCases;
    }
    for (const row of dataset.retailOfftakeRows) {
      const target = ensure(
        row.territoryId,
        row.territoryName,
        row.productId,
        row.productName,
      );
      target.estimated_retail_offtake_cases += row.estimatedSoldCases;
      target.confidenceValues.push(row.confidenceScore);
    }
    for (const event of dataset.stockoutEvents) {
      const row = ensure(
        event.territoryId,
        event.territoryName,
        event.productId,
        event.productName,
      );
      row.stockouts += 1;
    }

    return [...grouped.values()]
      .map((row) => ({
        territory_id: row.territory_id,
        territory_name: row.territory_name,
        product_id: row.product_id,
        product_name: row.product_name,
        ordered_cases: this.roundNumber(row.ordered_cases),
        delivered_cases: this.roundNumber(row.delivered_cases),
        estimated_retail_offtake_cases: this.roundNumber(
          row.estimated_retail_offtake_cases,
        ),
        demand_gap_cases: this.roundNumber(
          Math.max(0, row.ordered_cases - row.delivered_cases),
        ),
        stockout_count: row.stockouts,
        confidence_score: this.roundNumber(this.average(row.confidenceValues)),
        intensity_score: this.roundNumber(
          row.stockouts * 0.25 +
            Math.max(0, row.ordered_cases - row.delivered_cases) * 0.05,
        ),
      }))
      .sort((left, right) => right.intensity_score - left.intensity_score)
      .slice(0, 24);
  }

  private buildDemandSplit(dataset: OperationalDataset) {
    const shopOwnerOrders = dataset.orderEvents
      .filter((event) => event.source === 'SHOP_OWNER')
      .reduce((sum, event) => sum + event.quantityCases, 0);
    const assistedOrders = dataset.orderEvents
      .filter((event) => event.source !== 'SHOP_OWNER')
      .reduce((sum, event) => sum + event.quantityCases, 0);
    const delivered = this.sum(dataset.deliveryEvents, 'quantityCases');
    const ordered = this.sum(dataset.orderEvents, 'quantityCases');
    const returns = this.sum(dataset.returnEvents, 'quantityCases');

    return [
      { segment: 'Shop-owner orders', cases: this.roundNumber(shopOwnerOrders), source_type: 'exact' },
      { segment: 'Assisted orders', cases: this.roundNumber(assistedOrders), source_type: 'exact' },
      { segment: 'Backorders / unfulfilled', cases: this.roundNumber(Math.max(0, ordered - delivered)), source_type: 'exact' },
      { segment: 'Returns', cases: this.roundNumber(returns), source_type: 'exact' },
      {
        segment: 'Estimated Retail Offtake',
        cases: this.roundNumber(this.sum(dataset.retailOfftakeRows, 'estimatedSoldCases')),
        source_type: 'estimated',
      },
    ];
  }

  private buildPromotionImpact(dataset: OperationalDataset) {
    const promotionOrders = dataset.orderEvents.filter((event) => event.promotionFlag);
    const baselineOrders = dataset.orderEvents.filter((event) => !event.promotionFlag);
    const promotionCases = this.sum(promotionOrders, 'quantityCases');
    const baselineCases = this.sum(baselineOrders, 'quantityCases');
    const promotionOfftake = dataset.retailOfftakeRows
      .filter((row) => row.promotionFlag)
      .reduce((sum, row) => sum + row.estimatedSoldCases, 0);
    const baselineOfftake = dataset.retailOfftakeRows
      .filter((row) => !row.promotionFlag)
      .reduce((sum, row) => sum + row.estimatedSoldCases, 0);

    return [
      {
        phase: 'Baseline',
        ordered_cases: this.roundNumber(baselineCases),
        estimated_retail_offtake_cases: this.roundNumber(baselineOfftake),
      },
      {
        phase: 'Promotion active',
        ordered_cases: this.roundNumber(promotionCases),
        estimated_retail_offtake_cases: this.roundNumber(promotionOfftake),
      },
      {
        phase: 'Uplift',
        ordered_cases: this.roundNumber(Math.max(0, promotionCases - baselineCases)),
        estimated_retail_offtake_cases: this.roundNumber(
          Math.max(0, promotionOfftake - baselineOfftake),
        ),
      },
    ];
  }

  private buildStockoutImpact(dataset: OperationalDataset) {
    const avgEstimatedCases =
      dataset.retailOfftakeRows.length > 0
        ? this.sum(dataset.retailOfftakeRows, 'estimatedSoldCases') /
          dataset.retailOfftakeRows.length
        : 0;
    const grouped = new Map<
      string,
      {
        product_id: string;
        product_name: string;
        territory_name: string;
        stockout_count: number;
      }
    >();

    for (const event of dataset.stockoutEvents) {
      const key = `${event.territoryId ?? 'none'}|${event.productId}`;
      const existing =
        grouped.get(key) ??
        {
          product_id: event.productId,
          product_name: event.productName,
          territory_name: event.territoryName ?? 'Unassigned',
          stockout_count: 0,
        };
      existing.stockout_count += 1;
      grouped.set(key, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        estimated_lost_demand_cases: this.roundNumber(
          row.stockout_count * avgEstimatedCases,
        ),
      }))
      .sort((left, right) => right.stockout_count - left.stockout_count)
      .slice(0, 12);
  }

  private buildCompetitorPressure(dataset: OperationalDataset) {
    const grouped = new Map<string, { label: string; mentions: number; high_severity: number }>();

    for (const signal of dataset.fieldSignals.filter((row) =>
      ['competitor_substitution', 'competitor_pressure'].includes(row.signalType),
    )) {
      const key = `${signal.territoryId ?? 'none'}|${signal.signalDate.slice(0, 7)}`;
      const existing =
        grouped.get(key) ??
        {
          label: `${signal.territoryName ?? 'Unassigned'} ${signal.signalDate.slice(0, 7)}`,
          mentions: 0,
          high_severity: 0,
        };
      existing.mentions += 1;
      existing.high_severity += signal.severity === 'HIGH' ? 1 : 0;
      grouped.set(key, existing);
    }

    return [...grouped.values()].sort((left, right) => right.mentions - left.mentions);
  }

  private buildFeedbackThemes(dataset: OperationalDataset) {
    const themes = new Map<string, number>();
    for (const visit of dataset.visits) {
      const text = `${visit.outletFeedback ?? ''} ${visit.competitorNotes ?? ''}`.toLowerCase();
      const add = (theme: string) => themes.set(theme, (themes.get(theme) ?? 0) + 1);
      if (text.includes('late') || text.includes('delay')) add('Late delivery');
      if (text.includes('stock') || text.includes('unavailable')) add('Unavailable stock');
      if (text.includes('price') || text.includes('expensive')) add('Pricing');
      if (text.includes('damage') || text.includes('expired')) add('Damaged goods');
      if (text.includes('competitor') || text.includes('substitute')) add('Competitor activity');
      if (text.includes('good') || text.includes('happy') || text.includes('satisfied')) add('Positive service');
    }

    return [...themes.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((left, right) => right.count - left.count);
  }

  private buildVisitCoverage(dataset: OperationalDataset, filters: InsightFilters) {
    const grouped = new Map<
      string,
      {
        territory_id: string | null;
        territory_name: string;
        shop_count: Set<string>;
        visit_count: number;
        latest_visit_at: Date | null;
        confidenceValues: number[];
      }
    >();

    for (const visit of dataset.visits) {
      const key = visit.territoryId ?? 'none';
      const existing =
        grouped.get(key) ??
        {
          territory_id: visit.territoryId,
          territory_name: visit.territoryName ?? 'Unassigned',
          shop_count: new Set<string>(),
          visit_count: 0,
          latest_visit_at: null,
          confidenceValues: [],
        };
      existing.shop_count.add(visit.canonicalShopId);
      existing.visit_count += 1;
      existing.latest_visit_at =
        !existing.latest_visit_at || existing.latest_visit_at < visit.timestamp
          ? visit.timestamp
          : existing.latest_visit_at;
      grouped.set(key, existing);
    }

    for (const row of dataset.retailOfftakeRows) {
      const key = row.territoryId ?? 'none';
      const existing = grouped.get(key);
      if (existing) {
        existing.confidenceValues.push(row.confidenceScore);
      }
    }

    return [...grouped.values()].map((row) => ({
      territory_id: row.territory_id,
      territory_name: row.territory_name,
      active_outlets: row.shop_count.size,
      visit_count: row.visit_count,
      days_since_last_visit: row.latest_visit_at
        ? Math.max(
            0,
            Math.round(
              (filters.toDate.getTime() - row.latest_visit_at.getTime()) / 86400000,
            ),
          )
        : null,
      confidence_score: this.roundNumber(this.average(row.confidenceValues)),
    }));
  }

  private buildWaterfall(
    dataset: OperationalDataset,
    forecastDataset: ForecastDataset,
  ) {
    const baseDemand = this.sum(dataset.orderEvents, 'quantityCases');
    const delivered = this.sum(dataset.deliveryEvents, 'quantityCases');
    const promotionBaseline = this.average(
      dataset.orderEvents
        .filter((event) => !event.promotionFlag)
        .map((event) => event.quantityCases),
    );
    const promotionUpliftCases = dataset.orderEvents
      .filter((event) => event.promotionFlag)
      .reduce(
        (sum, event) => sum + Math.max(0, event.quantityCases - promotionBaseline),
        0,
      );
    const stockoutDrag = this.buildStockoutImpact(dataset).reduce(
      (sum, row) => sum + row.estimated_lost_demand_cases,
      0,
    );
    const incidentDrag = dataset.fieldSignals.filter(
      (row) => row.signalType.includes('disruption') || row.signalType.includes('delay'),
    ).length;
    const competitorPressure = dataset.fieldSignals.filter((row) =>
      row.signalType.includes('competitor'),
    ).length;
    const forecastCases = this.sum(forecastDataset.forecastOutput, 'forecast_cases');

    return [
      { driver: 'Base ordered demand', cases: this.roundNumber(baseDemand), direction: 'base' },
      { driver: 'Delivered fulfillment', cases: this.roundNumber(delivered - baseDemand), direction: delivered >= baseDemand ? 'up' : 'down' },
      { driver: 'Promotion uplift', cases: this.roundNumber(promotionUpliftCases), direction: 'up' },
      { driver: 'Stockout hidden demand', cases: this.roundNumber(stockoutDrag), direction: 'up' },
      { driver: 'Incident / disruption drag', cases: this.roundNumber(-incidentDrag), direction: 'down' },
      { driver: 'Competitor pressure', cases: this.roundNumber(-competitorPressure), direction: 'down' },
      { driver: 'Forecast next period', cases: this.roundNumber(forecastCases), direction: 'total' },
    ];
  }

  private buildExceptions(
    dataset: OperationalDataset,
    forecastDataset: ForecastDataset,
  ) {
    const exceptions = forecastDataset.exceptions.slice(0, 12).map((row) => ({
      severity: row.severity,
      exception_type: row.exception_type,
      reason: row.reason,
      recommended_action: row.recommended_action,
    }));

    for (const row of dataset.retailOfftakeRows.filter(
      (item) => item.negativeClampedFlag || item.duplicateVisitConflict,
    )) {
      exceptions.push({
        severity: row.negativeClampedFlag ? 'HIGH' : 'MEDIUM',
        exception_type: row.negativeClampedFlag
          ? 'NEGATIVE_ESTIMATED_SALES_CLAMPED'
          : 'DUPLICATE_VISIT_CONFLICT',
        reason: `${row.shopName} / ${row.productName}: ${row.dataQualityFlags}`,
        recommended_action:
          'Review the stock count sequence before using this estimated retail offtake value in planning.',
      });
    }

    return exceptions.slice(0, 18);
  }

  private buildDrilldowns(
    dataset: OperationalDataset,
    denominators: ReturnType<InsightCenterService['buildDenominators']>,
  ) {
    const grouped = new Map<
      string,
      {
        shop_name: string;
        product_name: string;
        ordered_cases: number;
        delivered_cases: number;
        estimated_retail_offtake_cases: number;
        confidenceValues: number[];
        stockouts: number;
      }
    >();

    const ensure = (shopId: string, shopName: string, productId: string, productName: string) => {
      const key = `${shopId}|${productId}`;
      const existing = grouped.get(key);
      if (existing) return existing;
      const next = {
        shop_name: shopName,
        product_name: productName,
        ordered_cases: 0,
        delivered_cases: 0,
        estimated_retail_offtake_cases: 0,
        confidenceValues: [] as number[],
        stockouts: 0,
      };
      grouped.set(key, next);
      return next;
    };

    for (const event of dataset.orderEvents) {
      ensure(event.canonicalShopId, event.shopName, event.productId, event.productName).ordered_cases += event.quantityCases;
    }
    for (const event of dataset.deliveryEvents) {
      ensure(event.canonicalShopId, event.shopName, event.productId, event.productName).delivered_cases += event.quantityCases;
    }
    for (const row of dataset.retailOfftakeRows) {
      const target = ensure(row.canonicalShopId, row.shopName, row.productId, row.productName);
      target.estimated_retail_offtake_cases += row.estimatedSoldCases;
      target.confidenceValues.push(row.confidenceScore);
    }
    for (const event of dataset.stockoutEvents) {
      ensure(
        event.canonicalShopId,
        dataset.shopsById.get(event.canonicalShopId)?.name ?? 'Unknown shop',
        event.productId,
        event.productName,
      ).stockouts += 1;
    }

    return [...grouped.values()]
      .map((row) => ({
        shop_name: row.shop_name,
        product_name: row.product_name,
        ordered_cases: this.roundNumber(row.ordered_cases),
        delivered_cases: this.roundNumber(row.delivered_cases),
        estimated_retail_offtake_cases: this.applyViewMode(
          row.estimated_retail_offtake_cases,
          denominators,
          'estimated',
          this.average(row.confidenceValues),
        ),
        demand_gap_cases: this.roundNumber(Math.max(0, row.ordered_cases - row.delivered_cases)),
        stockout_count: row.stockouts,
        confidence_score: this.roundNumber(this.average(row.confidenceValues)),
      }))
      .sort((left, right) => right.demand_gap_cases - left.demand_gap_cases)
      .slice(0, 20);
  }

  private buildInsightSummary(
    kpis: KpiCard[],
    charts: ReturnType<InsightCenterService['buildCharts']>,
    dataset: OperationalDataset,
  ) {
    const ordered = this.sum(dataset.orderEvents, 'quantityCases');
    const delivered = this.sum(dataset.deliveryEvents, 'quantityCases');
    const confidence = this.average(
      dataset.retailOfftakeRows.map((row) => row.confidenceScore),
    );
    const stockoutRate =
      dataset.stockCounts.length > 0
        ? dataset.stockoutEvents.length / dataset.stockCounts.length
        : 0;
    const topHeatmap = charts.territoryHeatmap[0];
    const topException = charts.exceptions[0];

    const summaries = [
      `Exact replenishment demand is ${this.roundNumber(ordered)} cases, while delivered fulfillment is ${this.roundNumber(delivered)} cases.`,
      `Estimated Retail Offtake is based on ${dataset.retailOfftakeRows.length} verified stock-count intervals and carries an average confidence score of ${this.roundNumber(confidence * 100)}%.`,
      stockoutRate > 0.15
        ? `Stockout pressure is elevated at ${this.roundNumber(stockoutRate * 100)}%, so hidden demand may be higher than observed movement.`
        : `Stockout pressure is currently controlled at ${this.roundNumber(stockoutRate * 100)}% of verified counts.`,
    ];

    if (topHeatmap) {
      summaries.push(
        `${topHeatmap.territory_name} / ${topHeatmap.product_name} is the highest hotspot by demand gap and stockout intensity.`,
      );
    }
    if (topException) {
      summaries.push(`Planner action: ${topException.recommended_action}`);
    }

    return summaries;
  }

  private buildReportRows(dashboard: Awaited<ReturnType<InsightCenterService['generateDashboard']>>) {
    const rows: ReportRow[] = [];

    for (const kpi of dashboard.kpis) {
      rows.push({
        section: 'KPI',
        metric: kpi.label,
        value: this.roundNumber(kpi.value),
        unit: kpi.unit,
        source_type: kpi.sourceType,
        confidence_score: kpi.confidenceScore ?? '',
        notes: kpi.caption,
      });
    }

    for (const insight of dashboard.summary.aiSummary) {
      rows.push({
        section: 'AI Insight Summary',
        metric: 'Insight',
        value: insight,
        unit: '',
        source_type: 'hybrid',
        confidence_score: '',
        notes: dashboard.summary.dataIntegrityWarning,
      });
    }

    for (const row of dashboard.charts.territoryHeatmap.slice(0, 20)) {
      rows.push({
        section: 'Territory Heatmap',
        metric: `${row.territory_name} / ${row.product_name}`,
        value: row.demand_gap_cases,
        unit: 'demand_gap_cases',
        source_type: 'hybrid',
        confidence_score: row.confidence_score,
        notes: `Stockouts: ${row.stockout_count}`,
      });
    }

    for (const row of dashboard.charts.exceptions.slice(0, 20)) {
      rows.push({
        section: 'Exceptions',
        metric: row.exception_type,
        value: row.severity,
        unit: '',
        source_type: 'hybrid',
        confidence_score: '',
        notes: `${row.reason} Action: ${row.recommended_action}`,
      });
    }

    return rows;
  }

  private async buildInsightReportNarrative(
    dashboard: InsightDashboard,
  ): Promise<InsightReportNarrative> {
    const metricMap = new Map(
      dashboard.kpis.map((kpi) => [kpi.key, `${this.roundNumber(kpi.value)} ${kpi.unit}`]),
    );
    const topMomentum = dashboard.charts.productMomentum.highest[0];
    const weakestMomentum = dashboard.charts.productMomentum.lowest[0];
    const topSalesProduct = dashboard.charts.customerSalesByProduct[0];
    const topGapProduct = dashboard.charts.orderVsCustomerSales[0];
    const actions = [
      ...new Set(
        dashboard.charts.exceptions
          .slice(0, 6)
          .map((row: Record<string, unknown>) =>
            String(row.recommended_action || '').trim(),
          )
          .filter(Boolean),
      ),
    ];
    const anomalies = dashboard.charts.exceptions
      .slice(0, 6)
      .map((row: Record<string, unknown>) => String(row.reason || '').trim())
      .filter(Boolean);

    const request: InsightWriterRequest = {
      reportType: 'insight_center',
      audience: 'demand_planner',
      window: {
        fromDate: dashboard.summary.historyStartDate,
        toDate: dashboard.summary.historyEndDate,
      },
      filters: {
        period: dashboard.summary.period,
        granularity: dashboard.summary.granularity,
        demandType: dashboard.summary.demandType,
        viewMode: dashboard.summary.viewMode,
        confidenceLevel: dashboard.summary.confidenceLevel,
        compareMode: dashboard.summary.compareMode,
      },
      metrics: {
        totalOrderedCases: metricMap.get('total_ordered_cases') ?? null,
        totalDeliveredCases: metricMap.get('total_delivered_cases') ?? null,
        estimatedRetailOfftake: metricMap.get('estimated_retail_offtake') ?? null,
        forecastNextPeriod: metricMap.get('forecast_next_period') ?? null,
        stockoutRate: metricMap.get('stockout_rate') ?? null,
        activeOutlets: metricMap.get('active_outlets') ?? null,
        activeTerritories: metricMap.get('active_territories') ?? null,
        verifiedVisits: metricMap.get('verified_visits') ?? null,
      },
      charts: [
        {
          title: 'Order and demand trend',
          purpose: 'Explain how ordered cases, delivered cases, retail offtake, and forecast moved through the selected window.',
          dataSummary:
            dashboard.charts.trend.length > 0
              ? `The trend chart contains ${dashboard.charts.trend.length} buckets from ${dashboard.summary.historyStartDate} to ${dashboard.summary.historyEndDate}.`
              : 'No trend buckets were available.',
        },
        {
          title: 'Promotion impact',
          purpose: 'Compare baseline versus promotion-active movement for ordering and customer offtake.',
          dataSummary:
            dashboard.charts.promotionImpact.length > 0
              ? dashboard.charts.promotionImpact
                  .map(
                    (row: Record<string, unknown>) =>
                      `${row.phase}: orders ${row.ordered_cases}, customer sales ${row.estimated_retail_offtake_cases}`,
                  )
                  .join(' | ')
              : 'No promotion impact rows were available.',
        },
        {
          title: 'Product momentum',
          purpose: 'Highlight the strongest and weakest-moving products in the selected window.',
          dataSummary: topMomentum
            ? `Highest movement: ${topMomentum.product_name} at ${this.roundNumber(topMomentum.demand_signal_cases)} cases. Lowest movement: ${weakestMomentum?.product_name ?? 'n/a'} at ${this.roundNumber(weakestMomentum?.demand_signal_cases ?? 0)} cases.`
            : 'No product momentum rows were available.',
        },
        {
          title: 'Order versus customer sales',
          purpose: 'Show which products have the largest gap between ordering and estimated customer movement.',
          dataSummary: topGapProduct
            ? `${topGapProduct.product_name} shows the largest gap at ${this.roundNumber(topGapProduct.gap_cases)} cases.`
            : 'No order-versus-customer-sales rows were available.',
        },
      ],
      anomalies,
      recommendedActions: actions,
    };

    try {
      const narrative = await this.aiWriterService.writeInsightCenterNarrative(
        request,
      );
      if (narrative) {
        return narrative;
      }
    } catch {
      // Fall back to deterministic wording when the external writer is unavailable.
    }

    return {
      reportTitle: 'Demand Planner Insight Report',
      headline: topGapProduct
        ? `${topGapProduct.product_name} is showing the clearest gap between ordering and customer movement in the selected window.`
        : 'The selected window highlights demand movement, fulfilment gaps, and planner caution points.',
      executiveSummary: dashboard.summary.aiSummary.join(' '),
      storyOfTheNumbers: [
        metricMap.get('total_ordered_cases')
          ? `Ordered demand reached ${metricMap.get('total_ordered_cases')}, while delivered movement reached ${metricMap.get('total_delivered_cases')}.`
          : null,
        topSalesProduct
          ? `${topSalesProduct.product_name} leads estimated customer movement at ${this.roundNumber(topSalesProduct.estimated_retail_offtake_cases)} cases.`
          : null,
        topMomentum
          ? `${topMomentum.product_name} is currently the strongest-moving product in the selected window.`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
      anomalyExplanation: anomalies[0]
        ? `The main anomaly to investigate is: ${anomalies[0]}`
        : 'No major anomaly text was available beyond the current KPI and exception set.',
      managementRecommendation: actions[0]
        ? `Recommended planner action: ${actions[0]}`
        : 'Use the KPI, trend, and exception charts together before committing a planning change.',
      sectionTitles: [
        'Executive summary',
        'Demand and fulfilment trend',
        'Promotion and product movement',
        'Gap and exception watchlist',
      ],
      chartCaptions: [
        'Orders, deliveries, customer movement, and forecast are shown across the selected time window.',
        'Promotion-active phases are compared against baseline movement.',
        'The report highlights both the strongest and weakest-moving products.',
        'Ordering is compared against estimated customer sales to show demand mismatches.',
      ],
      callouts: dashboard.summary.aiSummary.slice(0, 4),
    };
  }

  private async createInsightPdf(
    dashboard: InsightDashboard,
    narrative: InsightReportNarrative,
  ) {
    const document = new PDFDocument({
      size: 'A4',
      margin: 42,
      info: {
        Title: narrative.reportTitle,
        Author: 'Nestle Insight Demand Planner Portal',
      },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const pageWidth =
      document.page.width - document.page.margins.left - document.page.margins.right;

    const drawMetricCard = (
      x: number,
      y: number,
      width: number,
      label: string,
      value: string,
      caption: string,
    ) => {
      document.roundedRect(x, y, width, 72, 10).fillAndStroke('#f8fbf5', '#d7e4d2');
      document.fillColor('#687561').fontSize(9).text(label, x + 10, y + 10, {
        width: width - 20,
      });
      document.fillColor('#243022').fontSize(16).text(value, x + 10, y + 26, {
        width: width - 20,
      });
      document.fillColor('#6d645c').fontSize(8).text(caption, x + 10, y + 48, {
        width: width - 20,
      });
    };

    document.fillColor('#6f8566').fontSize(11).text('DEMAND PLANNER INSIGHT REPORT');
    document.moveDown(0.35);
    document.fillColor('#243022').fontSize(24).text(narrative.reportTitle, {
      width: pageWidth,
    });
    document.moveDown(0.35);
    document.fillColor('#51604d').fontSize(10).text(
      `Generated ${dashboard.summary.generatedAt.slice(0, 10)} | Window ${dashboard.summary.historyStartDate} to ${dashboard.summary.historyEndDate} | ${dashboard.summary.granularity} view`,
      { width: pageWidth },
    );

    document.moveDown(0.8);
    document.roundedRect(document.x, document.y, pageWidth, 76, 12).fillAndStroke(
      '#eef6f2',
      '#d6e4de',
    );
    document.fillColor('#243022').fontSize(15).text(
      narrative.headline,
      document.x + 14,
      document.y + 12,
      { width: pageWidth - 28 },
    );
    document.fillColor('#5d6d60').fontSize(10).text(
      narrative.executiveSummary,
      document.x + 14,
      document.y + 34,
      { width: pageWidth - 28 },
    );

    document.y += 92;
    document
      .fillColor('#7b8f75')
      .fontSize(10)
      .text('Data integrity note', { width: pageWidth });
    document
      .moveDown(0.2)
      .fillColor('#6d645c')
      .fontSize(10)
      .text(dashboard.summary.dataIntegrityWarning, { width: pageWidth });

    const metricCards = dashboard.kpis.slice(0, 6);
    const metricWidth = (pageWidth - 16) / 3;
    const metricBaseY = document.y + 18;
    metricCards.forEach((kpi, index) => {
      const row = Math.floor(index / 3);
      const column = index % 3;
      drawMetricCard(
        document.x + column * (metricWidth + 8),
        metricBaseY + row * 82,
        metricWidth,
        kpi.label,
        `${this.roundNumber(kpi.value)} ${kpi.unit}`,
        kpi.caption,
      );
    });

    document.y = metricBaseY + 172;
    this.drawInsightTrendChart(document, dashboard.charts.trend.slice(-12), pageWidth);

    document.addPage();
    document.fillColor('#243022').fontSize(18).text(
      narrative.sectionTitles[1] ?? 'Promotion and product movement',
      { width: pageWidth },
    );
    document.moveDown(0.3);
    document.fillColor('#5d6d60').fontSize(10).text(
      narrative.storyOfTheNumbers,
      { width: pageWidth },
    );
    document.moveDown(0.6);
    this.drawGroupedBarChart(
      document,
      dashboard.charts.promotionImpact,
      pageWidth,
      'Promotion impact on orders and customer sales',
      narrative.chartCaptions[1] ??
        'Promotion-active movement is compared against baseline demand.',
      'phase',
      [
        { key: 'ordered_cases', label: 'Orders', color: '#5c7f56' },
        {
          key: 'estimated_retail_offtake_cases',
          label: 'Customer sales',
          color: '#b6793f',
        },
      ],
    );
    document.moveDown(0.8);
    this.drawHorizontalBarChart(
      document,
      dashboard.charts.customerSalesByProduct.slice(0, 6),
      pageWidth,
      'Customer sales by product',
      'Estimated Retail Offtake by product in the selected window.',
      'product_name',
      'estimated_retail_offtake_cases',
      '#54715a',
    );

    document.addPage();
    document.fillColor('#243022').fontSize(18).text(
      narrative.sectionTitles[2] ?? 'Gap and exception watchlist',
      { width: pageWidth },
    );
    document.moveDown(0.3);
    document.fillColor('#5d6d60').fontSize(10).text(
      narrative.anomalyExplanation,
      { width: pageWidth },
    );
    document.moveDown(0.6);

    const momentumRows = [
      ...dashboard.charts.productMomentum.highest.map((row: Record<string, unknown>) => ({
        product_name: `High: ${row.product_name}`,
        demand_signal_cases: row.demand_signal_cases,
      })),
      ...dashboard.charts.productMomentum.lowest.map((row: Record<string, unknown>) => ({
        product_name: `Low: ${row.product_name}`,
        demand_signal_cases: row.demand_signal_cases,
      })),
    ];
    this.drawHorizontalBarChart(
      document,
      momentumRows.slice(0, 8),
      pageWidth,
      'Highest and lowest product movement',
      'Products are ranked by visible demand movement in the selected window.',
      'product_name',
      'demand_signal_cases',
      '#8f6a3c',
    );

    document.moveDown(0.8);
    this.drawGroupedBarChart(
      document,
      dashboard.charts.orderVsCustomerSales.slice(0, 6),
      pageWidth,
      'Ordering versus customer sales gap',
      narrative.chartCaptions[3] ??
        'Ordered cases are compared against estimated customer movement.',
      'product_name',
      [
        { key: 'ordered_cases', label: 'Orders', color: '#5c7f56' },
        {
          key: 'estimated_retail_offtake_cases',
          label: 'Customer sales',
          color: '#b6793f',
        },
      ],
    );

    document.addPage();
    document.fillColor('#243022').fontSize(18).text(
      narrative.sectionTitles[3] ?? 'Management recommendation',
      { width: pageWidth },
    );
    document.moveDown(0.3);
    document.fillColor('#5d6d60').fontSize(10).text(
      narrative.managementRecommendation,
      { width: pageWidth },
    );
    document.moveDown(0.6);

    document.fillColor('#243022').fontSize(14).text('Top planner actions', {
      width: pageWidth,
    });
    document.moveDown(0.3);
    for (const action of [
      ...new Set(
        dashboard.charts.exceptions
          .slice(0, 8)
          .map((row: Record<string, unknown>) =>
            String(row.recommended_action || '').trim(),
          )
          .filter(Boolean),
      ),
    ].slice(0, 6)) {
      document.fillColor('#5d6d60').fontSize(10).text(`• ${action}`, {
        width: pageWidth,
      });
      document.moveDown(0.2);
    }

    document.moveDown(0.6);
    document.fillColor('#243022').fontSize(14).text('Exception watchlist', {
      width: pageWidth,
    });
    document.moveDown(0.3);
    for (const row of dashboard.charts.exceptions.slice(0, 8)) {
      document.roundedRect(document.x, document.y, pageWidth, 42, 10).fillAndStroke(
        '#fffaf4',
        '#eadfd3',
      );
      document.fillColor('#243022').fontSize(10).text(
        `${row.exception_type} | ${row.severity}`,
        document.x + 10,
        document.y + 8,
        { width: pageWidth - 20 },
      );
      document.fillColor('#6d645c').fontSize(9).text(
        `${row.reason}`,
        document.x + 10,
        document.y + 22,
        { width: pageWidth - 20 },
      );
      document.y += 50;
    }

    document.end();
    return await new Promise<Buffer>((resolve) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private drawInsightTrendChart(document: any, rows: Record<string, unknown>[], width: number) {
    if (rows.length === 0) {
      return;
    }

    const chartHeight = 220;
    const left = document.x;
    const top = document.y;
    const plotLeft = left + 44;
    const plotRight = left + width - 10;
    const plotTop = top + 46;
    const plotBottom = top + chartHeight - 34;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    const maxValue = Math.max(
      1,
      ...rows.flatMap((row) => [
        Number(row.display_ordered_cases ?? row.ordered_cases ?? 0),
        Number(row.display_delivered_cases ?? row.delivered_cases ?? 0),
        Number(
          row.display_estimated_retail_offtake_cases ??
            row.estimated_retail_offtake_cases ??
            0,
        ),
        Number(row.display_forecast_cases ?? row.forecast_cases ?? 0),
      ]),
    );
    const spacing = rows.length > 1 ? plotWidth / (rows.length - 1) : 0;

    document.fillColor('#243022').fontSize(14).text('Order and demand trend', left, top, {
      width,
    });
    document.fillColor('#5d6d60').fontSize(10).text(
      'Orders, deliveries, customer movement, and forecast are shown across the selected window.',
      left,
      top + 18,
      { width },
    );

    document.lineWidth(1).strokeColor('#e8efe4');
    for (let index = 0; index < 4; index += 1) {
      const y = plotTop + (plotHeight / 3) * index;
      document.moveTo(plotLeft, y).lineTo(plotRight, y).stroke();
      document.fillColor('#7a8772').fontSize(8).text(
        this.roundNumber(maxValue - (maxValue / 3) * index).toString(),
        left,
        y - 4,
        { width: 34, align: 'right' },
      );
    }

    const drawSeries = (color: string, extractor: (row: Record<string, unknown>) => number) => {
      document.strokeColor(color).lineWidth(2);
      rows.forEach((row, index) => {
        const x = plotLeft + spacing * index;
        const y = plotBottom - (extractor(row) / maxValue) * plotHeight;
        if (index === 0) {
          document.moveTo(x, y);
        } else {
          document.lineTo(x, y);
        }
      });
      document.stroke();
    };

    drawSeries('#567454', (row) => Number(row.display_ordered_cases ?? row.ordered_cases ?? 0));
    drawSeries('#8da69b', (row) =>
      Number(row.display_delivered_cases ?? row.delivered_cases ?? 0),
    );
    drawSeries('#b6793f', (row) =>
      Number(
        row.display_estimated_retail_offtake_cases ??
          row.estimated_retail_offtake_cases ??
          0,
      ),
    );
    drawSeries('#7c88a6', (row) => Number(row.display_forecast_cases ?? row.forecast_cases ?? 0));

    const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
    labelIndexes.forEach((index) => {
      const row = rows[index];
      const x = plotLeft + spacing * index;
      document.fillColor('#7a8772').fontSize(8).text(
        String(row.label ?? row.date ?? ''),
        x - 24,
        plotBottom + 6,
        {
          width: 48,
          align: 'center',
        },
      );
    });

    const legendY = plotBottom + 20;
    [
      ['#567454', 'Orders'],
      ['#8da69b', 'Deliveries'],
      ['#b6793f', 'Customer sales'],
      ['#7c88a6', 'Forecast'],
    ].forEach(([color, label], index) => {
      document.fillColor(color).circle(left + index * 110 + 6, legendY + 4, 3).fill();
      document.fillColor('#5d6d60').fontSize(8).text(label, left + index * 110 + 16, legendY, {
        width: 84,
      });
    });

    document.y = top + chartHeight;
  }

  private drawGroupedBarChart(
    document: any,
    rows: Record<string, unknown>[],
    width: number,
    title: string,
    subtitle: string,
    labelKey: string,
    series: Array<{ key: string; label: string; color: string }>,
  ) {
    if (rows.length === 0) {
      return;
    }

    const chartHeight = 210;
    const left = document.x;
    const top = document.y;
    const plotLeft = left + 42;
    const plotRight = left + width - 10;
    const plotTop = top + 44;
    const plotBottom = top + chartHeight - 40;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    const maxValue = Math.max(
      1,
      ...rows.flatMap((row) =>
        series.map((item) => Number(row[item.key] ?? 0)),
      ),
    );
    const groupWidth = plotWidth / rows.length;
    const barWidth = Math.max(8, Math.min(18, (groupWidth - 12) / series.length));

    document.fillColor('#243022').fontSize(14).text(title, left, top, { width });
    document.fillColor('#5d6d60').fontSize(10).text(subtitle, left, top + 18, { width });

    document.lineWidth(1).strokeColor('#e8efe4');
    for (let index = 0; index < 4; index += 1) {
      const y = plotTop + (plotHeight / 3) * index;
      document.moveTo(plotLeft, y).lineTo(plotRight, y).stroke();
    }

    rows.forEach((row, rowIndex) => {
      const baseX = plotLeft + rowIndex * groupWidth + 6;
      series.forEach((item, seriesIndex) => {
        const value = Number(row[item.key] ?? 0);
        const barHeight = (value / maxValue) * plotHeight;
        const x = baseX + seriesIndex * (barWidth + 4);
        const y = plotBottom - barHeight;
        document
          .fillColor(item.color)
          .rect(x, y, barWidth, barHeight)
          .fill();
      });

      document.fillColor('#7a8772').fontSize(7).text(
        this.truncateLabel(String(row[labelKey] ?? ''), 14),
        baseX - 6,
        plotBottom + 6,
        {
          width: groupWidth,
          align: 'center',
        },
      );
    });

    const legendY = plotBottom + 20;
    series.forEach((item, index) => {
      document.fillColor(item.color).circle(left + index * 120 + 6, legendY + 4, 3).fill();
      document.fillColor('#5d6d60').fontSize(8).text(item.label, left + index * 120 + 16, legendY, {
        width: 96,
      });
    });

    document.y = top + chartHeight;
  }

  private drawHorizontalBarChart(
    document: any,
    rows: Record<string, unknown>[],
    width: number,
    title: string,
    subtitle: string,
    labelKey: string,
    valueKey: string,
    color: string,
  ) {
    if (rows.length === 0) {
      return;
    }

    const rowHeight = 22;
    const chartHeight = 60 + rows.length * rowHeight;
    const left = document.x;
    const top = document.y;
    const labelWidth = 170;
    const barLeft = left + labelWidth;
    const barRight = left + width - 48;
    const barWidth = barRight - barLeft;
    const maxValue = Math.max(1, ...rows.map((row) => Number(row[valueKey] ?? 0)));

    document.fillColor('#243022').fontSize(14).text(title, left, top, { width });
    document.fillColor('#5d6d60').fontSize(10).text(subtitle, left, top + 18, { width });

    rows.forEach((row, index) => {
      const y = top + 48 + index * rowHeight;
      const value = Number(row[valueKey] ?? 0);
      const widthValue = (value / maxValue) * barWidth;
      document.fillColor('#687561').fontSize(8).text(
        this.truncateLabel(String(row[labelKey] ?? ''), 30),
        left,
        y + 2,
        { width: labelWidth - 8 },
      );
      document.roundedRect(barLeft, y + 4, barWidth, 10, 4).fillAndStroke('#f3f7f1', '#e0e9dc');
      document.roundedRect(barLeft, y + 4, widthValue, 10, 4).fill(color);
      document.fillColor('#243022').fontSize(8).text(
        this.roundNumber(value).toString(),
        barRight + 6,
        y + 2,
        { width: 40, align: 'right' },
      );
    });

    document.y = top + chartHeight;
  }

  private truncateLabel(value: string, maxLength: number) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
  }

  private normalizeFilters(query: InsightCenterQuery): InsightFilters {
    const generatedAt = new Date();
    const toDate = query.toDate?.trim()
      ? this.parseDateOnly(query.toDate.trim(), 'toDate')
      : this.parseDateOnly(this.dateKey(generatedAt), 'toDate');
    const period = query.period?.trim().toLowerCase() || '30d';
    const fromDate = query.fromDate?.trim()
      ? this.parseDateOnly(query.fromDate.trim(), 'fromDate')
      : this.resolvePeriodStart(period, toDate);

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('fromDate cannot be after toDate.');
    }

    return {
      period,
      fromDate,
      toDate,
      granularity: this.parseEnum(
        query.granularity,
        ['daily', 'weekly', 'monthly'],
        'daily',
      ),
      demandType: this.parseEnum(
        query.demandType,
        ['all', 'replenishment', 'estimated_retail_offtake'],
        'all',
      ),
      viewMode: this.parseEnum(
        query.viewMode,
        ['absolute', 'normalized', 'confidence_adjusted'],
        'absolute',
      ),
      confidenceLevel: this.parseEnum(
        query.confidenceLevel,
        ['all', 'high_only'],
        'all',
      ),
      compareMode: this.parseEnum(
        query.compareMode,
        ['previous_period', 'previous_month', 'previous_year'],
        'previous_period',
      ),
      source: query.source?.trim() || 'all',
      territoryId: query.territoryId?.trim() || null,
      warehouseId: query.warehouseId?.trim() || null,
      routeId: query.routeId?.trim() || null,
      shopId: query.shopId?.trim() || null,
      productId: query.productId?.trim() || null,
      generatedAt,
    };
  }

  private resolvePeriodStart(period: string, toDate: Date) {
    if (period === '7d') return this.addDays(toDate, -6);
    if (period === '90d') return this.addDays(toDate, -89);
    if (period === 'ytd') {
      return new Date(Date.UTC(toDate.getUTCFullYear(), 0, 1));
    }
    return this.addDays(toDate, -29);
  }

  private createShopReferenceContext(
    outlets: Outlet[],
    shopOwners: User[],
    territoryById: Map<string, Territory>,
    warehouseById: Map<string, Warehouse>,
  ): ShopReferenceContext {
    const context: ShopReferenceContext = {
      rowsByCanonicalId: new Map<string, ShopReference>(),
      canonicalByOutletId: new Map<string, string>(),
      canonicalByShopOwnerId: new Map<
        string,
        { canonicalShopId: string; linkSource: string | null }
      >(),
    };
    const matchedShopOwnerIds = new Set<string>();

    for (const outlet of outlets) {
      const canonicalShopId = `outlet:${outlet.id}`;
      const match = this.findOutletShopOwnerMatch(outlet, shopOwners);
      if (match) {
        matchedShopOwnerIds.add(match.id);
        context.canonicalByShopOwnerId.set(match.id, {
          canonicalShopId,
          linkSource: 'OUTLET_SHOP_OWNER_MATCH',
        });
      }
      const territory = outlet.territoryId
        ? territoryById.get(outlet.territoryId)
        : null;
      const warehouse = outlet.warehouseId
        ? warehouseById.get(outlet.warehouseId)
        : null;

      context.rowsByCanonicalId.set(canonicalShopId, {
        canonicalShopId,
        sourceType: 'OUTLET',
        outletId: outlet.id,
        name: outlet.outletName,
        territoryId: outlet.territoryId,
        territoryName: territory?.name ?? null,
        warehouseId: outlet.warehouseId,
        warehouseName: warehouse?.name ?? null,
      });
      context.canonicalByOutletId.set(outlet.id, canonicalShopId);
    }

    for (const shopOwner of shopOwners) {
      if (matchedShopOwnerIds.has(shopOwner.id)) {
        continue;
      }

      const canonicalShopId = `shop_owner:${shopOwner.id}`;
      context.rowsByCanonicalId.set(canonicalShopId, {
        canonicalShopId,
        sourceType: 'SHOP_OWNER_ACCOUNT',
        outletId: null,
        name:
          shopOwner.shopName?.trim() ||
          `${shopOwner.firstName} ${shopOwner.lastName}`.trim() ||
          shopOwner.username,
        territoryId: shopOwner.territoryId,
        territoryName: shopOwner.territory?.name ?? null,
        warehouseId: shopOwner.warehouseId,
        warehouseName: shopOwner.warehouse?.name ?? shopOwner.warehouseName,
      });
      context.canonicalByShopOwnerId.set(shopOwner.id, {
        canonicalShopId,
        linkSource: 'DIRECT_SHOP_OWNER',
      });
    }

    return context;
  }

  private findOutletShopOwnerMatch(outlet: Outlet, shopOwners: User[]) {
    const outletPhone = this.normalizePhone(outlet.ownerPhone);
    const outletEmail = this.normalizeText(outlet.ownerEmail);
    const outletName = this.normalizeText(outlet.outletName);
    const ownerName = this.normalizeText(outlet.ownerName);

    return shopOwners.find((shopOwner) => {
      const phoneMatches =
        outletPhone && outletPhone === this.normalizePhone(shopOwner.phoneNumber);
      const emailMatches =
        outletEmail && outletEmail === this.normalizeText(shopOwner.email);
      const shopNameMatches =
        outletName &&
        outletName === this.normalizeText(shopOwner.shopName) &&
        (!outlet.territoryId || outlet.territoryId === shopOwner.territoryId);
      const ownerNameMatches =
        ownerName &&
        ownerName ===
          this.normalizeText(`${shopOwner.firstName} ${shopOwner.lastName}`) &&
        (!outlet.territoryId || outlet.territoryId === shopOwner.territoryId);

      return phoneMatches || emailMatches || shopNameMatches || ownerNameMatches;
    });
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
      return mappedShopOwner;
    }

    const fallbackCanonicalShopId = `order_user_ref:${order.userId}`;
    if (!context.rowsByCanonicalId.has(fallbackCanonicalShopId)) {
      context.rowsByCanonicalId.set(fallbackCanonicalShopId, {
        canonicalShopId: fallbackCanonicalShopId,
        sourceType: 'ORDER_USER_REFERENCE_ONLY',
        outletId: null,
        name: order.shopNameSnapshot,
        territoryId: order.territoryId,
        territoryName: order.territory?.name ?? null,
        warehouseId: order.warehouseId,
        warehouseName: order.warehouse?.name ?? null,
      });
    }

    return {
      canonicalShopId: fallbackCanonicalShopId,
      linkSource: 'UNMAPPED_ORDER_USER',
    };
  }

  private ensureOutletReference(context: ShopReferenceContext, outletId: string) {
    const existing = context.canonicalByOutletId.get(outletId);
    if (existing) {
      return existing;
    }

    const canonicalShopId = `outlet_ref:${outletId}`;
    context.rowsByCanonicalId.set(canonicalShopId, {
      canonicalShopId,
      sourceType: 'OUTLET_REFERENCE_ONLY',
      outletId,
      name: `Outlet ${outletId}`,
      territoryId: null,
      territoryName: null,
      warehouseId: null,
      warehouseName: null,
    });
    context.canonicalByOutletId.set(outletId, canonicalShopId);
    return canonicalShopId;
  }

  private createAssignmentByOrderId(
    assignments: DeliveryAssignment[],
    assignmentOrders: DeliveryAssignmentOrder[],
  ) {
    const grouped = new Map<
      string,
      { assignment: DeliveryAssignment; dao: DeliveryAssignmentOrder }
    >();

    for (const assignment of assignments) {
      for (const dao of assignment.assignmentOrders ?? []) {
        if (dao.orderId) {
          grouped.set(dao.orderId, { assignment, dao });
        }
      }
    }

    for (const dao of assignmentOrders) {
      if (dao.orderId && dao.assignment && !grouped.has(dao.orderId)) {
        grouped.set(dao.orderId, { assignment: dao.assignment, dao });
      }
    }

    return grouped;
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
            productName:
              record.productName?.toString() ?? product?.productName ?? 'Unknown Product',
            deliveredCases: this.readNumber(record.quantityCases),
            unitsPerCase: product?.productsPerCase ?? 1,
          };
        })
        .filter(
          (
            item,
          ): item is {
            productId: string;
            productName: string;
            deliveredCases: number;
            unitsPerCase: number;
          } => !!item && item.deliveredCases > 0,
        );
    }

    if (order.status !== 'COMPLETED') {
      return [];
    }

    return (order.items ?? [])
      .filter((item) => !!item.productId && Number(item.quantity ?? 0) > 0)
      .map((item) => {
        const product = item.productId ? productById.get(item.productId) : null;
        return {
          productId: item.productId!,
          productName: item.productNameSnapshot,
          deliveredCases: Number(item.quantity ?? 0),
          unitsPerCase: product?.productsPerCase ?? 1,
        };
      });
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

    return assignmentLink?.assignment.updatedAt ?? null;
  }

  private addLossEvents(
    visit: StoreVisit,
    productById: Map<string, Product>,
    canonicalShopId: string,
    observedAt: Date,
    lossEvents: LossEvent[],
  ) {
    const expiryItems = Array.isArray(visit.expiryItemsJson)
      ? visit.expiryItemsJson
      : [];
    for (const item of expiryItems) {
      const record = item as Record<string, unknown>;
      if (!Boolean(record.hasExpiredItems)) {
        continue;
      }
      const productId = record.productId?.toString() ?? null;
      lossEvents.push({
        timestamp: observedAt,
        canonicalShopId,
        productId,
        lossType: 'EXPIRED',
        quantityUnits: this.readNumber(record.quantityUnits),
      });
    }

    const osaIssues = Array.isArray(visit.osaIssuesJson)
      ? visit.osaIssuesJson
      : [];
    for (const issue of osaIssues) {
      const record = issue as unknown as Record<string, unknown>;
      const tag = record.tag?.toString().toLowerCase() ?? '';
      if (!tag.includes('damage')) {
        continue;
      }

      const productIds = Array.isArray(record.productIds)
        ? record.productIds.map((value) => String(value))
        : [];
      const productId = productIds[0] ?? null;
      const product = productId ? productById.get(productId) : null;
      const quantityCases = this.readNumber(record.quantityCases);
      const quantityUnits =
        this.readNumber(record.quantityUnits) ||
        quantityCases * (product?.productsPerCase ?? 1);

      lossEvents.push({
        timestamp: observedAt,
        canonicalShopId,
        productId,
        lossType: 'DAMAGED',
        quantityUnits,
      });
    }
  }

  private addVisitFieldSignals(
    visit: VisitRow,
    rows: FieldSignal[],
    filters: InsightFilters,
  ) {
    const addSignal = (sourceType: string, text: string | null | undefined) => {
      const normalized = text?.trim() ?? '';
      if (!normalized || !this.isInRange(visit.timestamp, filters)) {
        return;
      }
      const extracted = this.extractFieldSignal(normalized);
      if (!extracted) {
        return;
      }
      rows.push({
        signalId: `${sourceType}:${visit.visitId}:${rows.length}`,
        signalDate: visit.visitDate,
        sourceType,
        territoryId: visit.territoryId,
        territoryName: visit.territoryName,
        productId: null,
        productName: null,
        signalType: extracted.signalType,
        severity: extracted.severity,
        confidenceScore: extracted.confidenceScore,
        summary: extracted.summary,
      });
    };

    addSignal('competitor_note', visit.competitorNotes);
    addSignal('outlet_feedback', visit.outletFeedback);
  }

  private buildReportAndIncidentSignals(
    incidents: SalesIncident[],
    dailyReports: DailyReport[],
    activityLogs: ActivityLog[],
    products: Product[],
    filters: InsightFilters,
  ) {
    const rows: FieldSignal[] = [];
    const addSignal = (
      sourceType: string,
      sourceId: string,
      date: Date | string,
      text: string | null | undefined,
    ) => {
      const dateKey = this.dateKey(date);
      const normalized = text?.trim() ?? '';
      if (!normalized || !this.isInRange(dateKey, filters)) {
        return;
      }
      const extracted = this.extractFieldSignal(normalized);
      if (!extracted) {
        return;
      }
      const product = this.findProductMention(normalized, products);
      rows.push({
        signalId: `${sourceType}:${sourceId}`,
        signalDate: dateKey,
        sourceType,
        territoryId: null,
        territoryName: null,
        productId: product?.id ?? null,
        productName: product?.productName ?? null,
        signalType: extracted.signalType,
        severity: extracted.severity,
        confidenceScore: extracted.confidenceScore,
        summary: extracted.summary,
      });
    };

    for (const incident of incidents) {
      addSignal(
        'sales_incident',
        incident.id,
        incident.createdAt,
        `${incident.incidentType} ${incident.severity} ${incident.description}`,
      );
    }
    for (const report of dailyReports) {
      addSignal(
        'daily_report',
        report.id,
        report.reportDate,
        [
          report.repComments,
          JSON.stringify(report.incidentSummaryJson ?? {}),
          JSON.stringify(report.osaSummaryJson ?? {}),
          JSON.stringify(report.deliverySummaryJson ?? {}),
        ].join(' '),
      );
    }
    for (const activity of activityLogs) {
      addSignal(
        'activity_log',
        activity.id,
        activity.createdAt,
        `${activity.title} ${activity.message} ${JSON.stringify(activity.metadata ?? {})}`,
      );
    }

    return rows;
  }

  private extractFieldSignal(text: string) {
    const normalized = text.toLowerCase();
    const hasCompetitor =
      normalized.includes('competitor') ||
      normalized.includes('substitute') ||
      normalized.includes('switch');
    const hasStockout =
      normalized.includes('out of stock') ||
      normalized.includes('stockout') ||
      normalized.includes('unavailable') ||
      normalized.includes('oos');
    const hasDelay =
      normalized.includes('delay') ||
      normalized.includes('late') ||
      normalized.includes('vehicle') ||
      normalized.includes('warehouse');
    const hasDamage =
      normalized.includes('damage') || normalized.includes('expired');
    const hasPromotion =
      normalized.includes('promotion') ||
      normalized.includes('discount') ||
      normalized.includes('offer');

    if (hasStockout && hasCompetitor) {
      return {
        signalType: 'competitor_substitution',
        severity: 'HIGH' as const,
        confidenceScore: 0.86,
        summary:
          'Field note suggests stockout pressure with competitor substitution risk.',
      };
    }
    if (hasCompetitor) {
      return {
        signalType: 'competitor_pressure',
        severity: 'MEDIUM' as const,
        confidenceScore: 0.76,
        summary: 'Field note mentions competitor or substitution pressure.',
      };
    }
    if (hasStockout) {
      return {
        signalType: 'stockout_hidden_demand',
        severity: 'MEDIUM' as const,
        confidenceScore: 0.78,
        summary: 'Field note suggests hidden demand caused by stockout.',
      };
    }
    if (hasDelay) {
      return {
        signalType: 'delivery_or_route_disruption',
        severity: 'MEDIUM' as const,
        confidenceScore: 0.72,
        summary: 'Field note indicates route, delivery, or warehouse disruption.',
      };
    }
    if (hasDamage) {
      return {
        signalType: 'quality_or_damage_issue',
        severity: 'LOW' as const,
        confidenceScore: 0.66,
        summary: 'Field note indicates damaged or expired product risk.',
      };
    }
    if (hasPromotion) {
      return {
        signalType: 'promotion_demand_shift',
        severity: 'LOW' as const,
        confidenceScore: 0.66,
        summary: 'Field note references a promotion or offer.',
      };
    }

    return null;
  }

  private normalizeDuplicateStockCounts(rows: StockCountRow[]) {
    const grouped = new Map<string, StockCountRow[]>();
    for (const row of rows) {
      const key = `${row.canonicalShopId}|${row.productId}|${row.observedDate}`;
      const existing = grouped.get(key) ?? [];
      existing.push(row);
      grouped.set(key, existing);
    }

    const normalized: StockCountRow[] = [];
    for (const groupRows of grouped.values()) {
      const sorted = [...groupRows].sort((left, right) =>
        left.observedAt.localeCompare(right.observedAt),
      );
      const latest = sorted[sorted.length - 1];
      normalized.push({
        ...latest,
        duplicateVisitConflict: sorted.length > 1,
      });
    }

    return normalized.sort((left, right) =>
      `${left.canonicalShopId}|${left.productId}|${left.observedAt}`.localeCompare(
        `${right.canonicalShopId}|${right.productId}|${right.observedAt}`,
      ),
    );
  }

  private groupTimedEvents<T extends DemandEvent>(
    rows: T[],
    quantityKey: keyof T,
  ) {
    const grouped = new Map<
      string,
      Array<{ timestamp: Date; quantityUnits: number }>
    >();

    for (const row of rows) {
      const quantityUnits = this.readNumber(row[quantityKey]);
      const key = `${row.canonicalShopId}|${row.productId}`;
      const existing = grouped.get(key) ?? [];
      existing.push({ timestamp: row.timestamp, quantityUnits });
      grouped.set(
        key,
        existing.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      );
    }

    return grouped;
  }

  private groupLossEvents(rows: LossEvent[]) {
    const grouped = new Map<
      string,
      Array<{ timestamp: Date; quantityUnits: number; lossType: string }>
    >();

    for (const row of rows) {
      if (!row.productId) {
        continue;
      }
      const key = `${row.canonicalShopId}|${row.productId}`;
      const existing = grouped.get(key) ?? [];
      existing.push({
        timestamp: row.timestamp,
        quantityUnits: row.quantityUnits,
        lossType: row.lossType,
      });
      grouped.set(
        key,
        existing.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      );
    }

    return grouped;
  }

  private groupStockoutEvents(rows: StockoutEvent[]) {
    const grouped = new Map<string, Array<{ timestamp: Date }>>();

    for (const row of rows) {
      const key = `${row.canonicalShopId}|${row.productId}`;
      const existing = grouped.get(key) ?? [];
      existing.push({ timestamp: new Date(row.observedAt) });
      grouped.set(
        key,
        existing.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      );
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

  private createPromotionResolver(
    promotions: Promotion[],
    promotionProductsByPromotionId: Map<string, PromotionProduct[]>,
    promotionTerritoriesByPromotionId: Map<string, PromotionTerritory[]>,
  ) {
    const activePromotions = promotions.filter((promotion) =>
      ACTIVE_PROMOTION_STATUSES.has(promotion.status.toLowerCase()),
    );

    return (dateKey: string, productId: string, territoryId: string | null) =>
      activePromotions.some((promotion) => {
        if (
          this.dateKey(promotion.startDate) > dateKey ||
          this.dateKey(promotion.endDate) < dateKey
        ) {
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
  }

  private buildDenominators(dataset: OperationalDataset, filters: InsightFilters) {
    const activeOutlets = new Set<string>();
    const salesReps = new Set<string>();
    const routeDays = new Set<string>();
    const promotionActiveShops = new Set<string>();

    for (const event of [
      ...dataset.orderEvents,
      ...dataset.deliveryEvents,
      ...dataset.returnEvents,
    ]) {
      activeOutlets.add(event.canonicalShopId);
      if (event.promotionFlag) {
        promotionActiveShops.add(event.canonicalShopId);
      }
    }
    for (const row of dataset.retailOfftakeRows) {
      activeOutlets.add(row.canonicalShopId);
      if (row.promotionFlag) {
        promotionActiveShops.add(row.canonicalShopId);
      }
    }
    for (const visit of dataset.visits) {
      activeOutlets.add(visit.canonicalShopId);
      salesReps.add(visit.salesRepId);
      if (visit.routeId) {
        routeDays.add(`${visit.routeId}|${visit.visitDate}`);
      }
    }

    return {
      viewMode: filters.viewMode,
      activeOutlets: Math.max(1, activeOutlets.size),
      visits: Math.max(1, dataset.visits.length),
      salesReps: Math.max(1, salesReps.size),
      routeDays: Math.max(1, routeDays.size),
      promotionActiveShops: Math.max(1, promotionActiveShops.size),
    };
  }

  private applyViewMode(
    value: number,
    denominators: ReturnType<InsightCenterService['buildDenominators']>,
    sourceKind: 'exact' | 'estimated' | 'hybrid',
    confidenceScore = 1,
  ) {
    if (denominators.viewMode === 'normalized') {
      return this.roundNumber(value / denominators.activeOutlets);
    }
    if (denominators.viewMode === 'confidence_adjusted') {
      return sourceKind === 'exact'
        ? this.roundNumber(value)
        : this.roundNumber(value * Math.max(0, Math.min(1, confidenceScore || 0)));
    }
    return this.roundNumber(value);
  }

  private calculatePromotionUplift(orderEvents: DemandEvent[]) {
    const promotionEvents = orderEvents.filter((event) => event.promotionFlag);
    const baselineEvents = orderEvents.filter((event) => !event.promotionFlag);
    const promotionAverage = this.average(
      promotionEvents.map((event) => event.quantityCases),
    );
    const baselineAverage = this.average(
      baselineEvents.map((event) => event.quantityCases),
    );

    if (baselineAverage <= 0) {
      return promotionAverage > 0 ? 1 : 0;
    }

    return this.roundNumber((promotionAverage - baselineAverage) / baselineAverage);
  }

  private calculateCompetitorPressure(dataset: OperationalDataset) {
    const competitorSignals = dataset.fieldSignals.filter((signal) =>
      signal.signalType.includes('competitor'),
    );
    const highSeverity = competitorSignals.filter(
      (signal) => signal.severity === 'HIGH',
    ).length;
    const score = competitorSignals.length * 10 + highSeverity * 8;
    return this.roundNumber(Math.min(100, score));
  }

  private calculateFeedbackScore(visits: VisitRow[]) {
    if (visits.length === 0) {
      return 0;
    }

    let score = 75;
    for (const visit of visits) {
      const text = `${visit.outletFeedback ?? ''} ${visit.competitorNotes ?? ''}`.toLowerCase();
      if (text.includes('happy') || text.includes('good') || text.includes('satisfied')) {
        score += 2;
      }
      if (
        text.includes('complaint') ||
        text.includes('late') ||
        text.includes('damage') ||
        text.includes('unavailable')
      ) {
        score -= 3;
      }
      if (text.includes('competitor')) {
        score -= 2;
      }
    }

    return this.roundNumber(Math.max(0, Math.min(100, score)));
  }

  private calculateDataConfidence(dataset: OperationalDataset) {
    const orderCoverage = dataset.orderEvents.length > 0 ? 0.18 : 0;
    const deliveryCoverage = dataset.deliveryEvents.length > 0 ? 0.12 : 0;
    const visitCoverage = dataset.visits.length > 0 ? 0.15 : 0;
    const retailConfidence = this.average(
      dataset.retailOfftakeRows.map((row) => row.confidenceScore),
    );
    const retailComponent = retailConfidence > 0 ? retailConfidence * 0.45 : 0;
    return this.roundNumber(
      Math.max(0.05, Math.min(1, 0.25 + orderCoverage + deliveryCoverage + visitCoverage + retailComponent)),
    );
  }

  private computeRetailConfidenceScore(params: {
    gapDays: number;
    duplicateVisitConflict: boolean;
    negativeClamped: boolean;
    stockoutFlag: boolean;
  }) {
    let score = 1;

    if (params.gapDays > 45) score -= 0.45;
    else if (params.gapDays > 30) score -= 0.3;
    else if (params.gapDays > 14) score -= 0.15;

    if (params.duplicateVisitConflict) score -= 0.15;
    if (params.negativeClamped) score -= 0.2;
    if (params.stockoutFlag) score -= 0.1;

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

  private matchesFilters(
    row: {
      productId?: string | null;
      territoryId?: string | null;
      warehouseId?: string | null;
      routeId?: string | null;
      canonicalShopId?: string | null;
    },
    filters: InsightFilters,
  ) {
    if (filters.productId && row.productId !== filters.productId) return false;
    if (filters.territoryId && row.territoryId !== filters.territoryId) return false;
    if (filters.warehouseId && row.warehouseId !== filters.warehouseId) return false;
    if (filters.routeId && row.routeId !== filters.routeId) return false;
    if (
      filters.shopId &&
      row.canonicalShopId !== filters.shopId &&
      row.canonicalShopId !== `outlet:${filters.shopId}` &&
      row.canonicalShopId !== `shop_owner:${filters.shopId}`
    ) {
      return false;
    }
    return true;
  }

  private matchesForecastFilters(
    row: {
      demand_type: 'REPLENISHMENT_DEMAND' | 'ESTIMATED_RETAIL_OFFTAKE';
      product_id?: string | null;
      territory_id?: string | null;
      warehouse_id?: string | null;
    },
    filters: InsightFilters,
  ) {
    if (
      filters.demandType === 'replenishment' &&
      row.demand_type !== 'REPLENISHMENT_DEMAND'
    ) {
      return false;
    }
    if (
      filters.demandType === 'estimated_retail_offtake' &&
      row.demand_type !== 'ESTIMATED_RETAIL_OFFTAKE'
    ) {
      return false;
    }
    if (filters.productId && row.product_id !== filters.productId) return false;
    if (filters.territoryId && row.territory_id !== filters.territoryId) return false;
    if (filters.warehouseId && row.warehouse_id !== filters.warehouseId) return false;
    return true;
  }

  private matchesForecastAiFilters(
    row: {
      product_id?: string | null;
      territory_id?: string | null;
    },
    filters: InsightFilters,
  ) {
    if (filters.productId && row.product_id !== filters.productId) return false;
    if (filters.territoryId && row.territory_id !== filters.territoryId) return false;
    return true;
  }

  private matchesOrderSource(event: DemandEvent, source: string) {
    if (source === 'all') return true;
    if (source === 'shop_owner_orders') return event.source === 'SHOP_OWNER';
    if (source === 'assisted_orders') return event.source !== 'SHOP_OWNER';
    if (source === 'deliveries' || source === 'returns') return false;
    return true;
  }

  private readStockUnits(record: Record<string, unknown>, location: 'shelf' | 'backroom') {
    if (location === 'shelf') {
      return (
        this.readNumber(record.shelfCount) ||
        this.readNumber(record.quantityUnits) ||
        this.readNumber(record.quantityCases) * this.readNumber(record.unitsPerCase)
      );
    }

    return (
      this.readNumber(record.backroomCount) ||
      this.readNumber(record.backroomUnits) ||
      this.readNumber(record.backroomCases) * this.readNumber(record.unitsPerCase)
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

  private ensureTrendBucket(
    buckets: Map<
      string,
      {
        date: string;
        label: string;
        ordered_cases: number;
        delivered_cases: number;
        estimated_retail_offtake_cases: number;
        forecast_cases: number;
        confidence_score: number;
        stockout_count: number;
      }
    >,
    dateKey: string,
    granularity: Granularity,
  ) {
    const bucketKey = this.bucketKey(dateKey, granularity);
    const existing = buckets.get(bucketKey);
    if (existing) return existing;
    const next = {
      date: bucketKey,
      label: this.formatBucketLabel(bucketKey, granularity),
      ordered_cases: 0,
      delivered_cases: 0,
      estimated_retail_offtake_cases: 0,
      forecast_cases: 0,
      confidence_score: 0,
      stockout_count: 0,
    };
    buckets.set(bucketKey, next);
    return next;
  }

  private bucketKeys(fromDate: Date, toDate: Date, granularity: Granularity) {
    const keys = new Set<string>();
    const current = new Date(fromDate);
    while (current.getTime() <= toDate.getTime()) {
      keys.add(this.bucketKey(this.dateKey(current), granularity));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return [...keys].sort();
  }

  private bucketKey(dateKey: string, granularity: Granularity) {
    const date = this.parseDateOnly(dateKey, 'date');
    if (granularity === 'monthly') {
      return `${dateKey.slice(0, 7)}-01`;
    }
    if (granularity === 'weekly') {
      const day = date.getUTCDay();
      const offset = day === 0 ? -6 : 1 - day;
      return this.dateKey(this.addDays(date, offset));
    }
    return dateKey;
  }

  private formatBucketLabel(dateKey: string, granularity: Granularity) {
    if (granularity === 'monthly') return dateKey.slice(0, 7);
    if (granularity === 'weekly') return `Week of ${dateKey}`;
    return dateKey;
  }

  private parseUuidFromNote(
    note: string | null | undefined,
    label: string,
  ): string | null {
    if (!note?.trim()) return null;
    const expression = new RegExp(
      `${label}:\\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
      'i',
    );
    const match = note.match(expression);
    return match?.[1] ?? null;
  }

  private parseDateOnly(value: string, fieldName: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${fieldName} must use YYYY-MM-DD format.`);
    }
    return new Date(`${value}T00:00:00.000Z`);
  }

  private parseEnum<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    fallback: T,
  ): T {
    const normalized = value?.trim().toLowerCase();
    return allowed.includes(normalized as T) ? (normalized as T) : fallback;
  }

  private isInRange(value: Date | string | null | undefined, filters: InsightFilters) {
    if (!value) return false;
    const date =
      value instanceof Date
        ? value
        : /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T00:00:00.000Z`)
          : new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const toTime = this.addDays(filters.toDate, 1).getTime() - 1;
    return date.getTime() >= filters.fromDate.getTime() && date.getTime() <= toTime;
  }

  private dateKey(value: Date | string | null | undefined) {
    if (!value) return '';
    const date =
      value instanceof Date
        ? value
        : /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T00:00:00.000Z`)
          : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  private addDays(date: Date, days: number) {
    const nextDate = new Date(date);
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return nextDate;
  }

  private readNumber(value: unknown) {
    const numericValue = Number(value ?? 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  private roundNumber(value: number) {
    return Number(value.toFixed(4));
  }

  private average(values: number[]) {
    const finiteValues = values.filter((value) => Number.isFinite(value));
    if (finiteValues.length === 0) {
      return 0;
    }
    return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  }

  private sum<T>(rows: T[], key: keyof T) {
    return this.roundNumber(
      rows.reduce((total, row) => total + this.readNumber(row[key]), 0),
    );
  }

  private getUnitsPerCase(productId: string | null | undefined, productById: Map<string, Product>) {
    if (!productId) return 1;
    const unitsPerCase = productById.get(productId)?.productsPerCase ?? 1;
    return unitsPerCase > 0 ? unitsPerCase : 1;
  }

  private normalizeText(value?: string | null) {
    return value?.trim().toLowerCase() ?? '';
  }

  private normalizePhone(value?: string | null) {
    return value?.replace(/\D/g, '') ?? '';
  }

  private findProductMention(text: string, products: Product[]) {
    const normalized = text.toLowerCase();
    return products.find((product) => {
      const productName = product.productName.toLowerCase();
      const sku = product.sku.toLowerCase();
      return normalized.includes(productName) || normalized.includes(sku);
    });
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

  private reportColumns(): CsvColumn<ReportRow>[] {
    return [
      { key: 'section', header: 'section' },
      { key: 'metric', header: 'metric' },
      { key: 'value', header: 'value' },
      { key: 'unit', header: 'unit' },
      { key: 'source_type', header: 'source_type' },
      { key: 'confidence_score', header: 'confidence_score' },
      { key: 'notes', header: 'notes' },
    ];
  }

  private createSimplePdf(lines: string[]) {
    const escapedLines = lines.map((line) => this.escapePdfText(line));
    const textCommands = escapedLines
      .map((line, index) => {
        const y = 760 - index * 14;
        return `BT /F1 10 Tf 42 ${y} Td (${line}) Tj ET`;
      })
      .join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(textCommands, 'utf8')} >>\nstream\n${textCommands}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }

  private escapePdfText(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}
