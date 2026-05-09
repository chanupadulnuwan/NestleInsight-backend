import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument from 'pdfkit';
import { Repository } from 'typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { FeedbackSubmission } from '../activity/entities/feedback-submission.entity';
import { OrderFeedback } from '../activity/entities/order-feedback.entity';
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
  warehouseId: string | null;
  warehouseName: string | null;
  observedAt: string;
  observedDate: string;
  stockUnits: number;
  reason: string;
};

type LossEvent = {
  timestamp: Date;
  canonicalShopId: string;
  productId: string | null;
  productName: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
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
  warehouseName: string | null;
  salesRepName: string;
  competitorNotes: string | null;
  outletFeedback: string | null;
  planogramOk: boolean | null;
  posmOk: boolean | null;
  outletFeedbackAnswers: Array<Record<string, unknown>>;
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

type OsaIssueObservation = {
  issueId: string;
  observedDate: string;
  canonicalShopId: string;
  shopName: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  productId: string | null;
  productName: string | null;
  issueTag: string;
  notes: string;
};

type ShopFeedbackObservation = {
  feedbackId: string;
  feedbackDate: string;
  canonicalShopId: string | null;
  shopName: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  rating: number | null;
  comment: string;
  sourceType: 'ORDER_FEEDBACK' | 'VISIT_FEEDBACK';
};

type ComplianceObservation = {
  visitId: string;
  observedDate: string;
  canonicalShopId: string;
  shopName: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  violationType: 'PLANOGRAM' | 'POSM';
};

type SalesRepIssueObservation = {
  issueId: string;
  issueDate: string;
  salesRepId: string | null;
  salesRepName: string;
  territoryId: string | null;
  territoryName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  issueType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  summary: string;
  sourceType: 'SALES_INCIDENT' | 'DAILY_REPORT';
};

type OperationalDataset = {
  orderEvents: DemandEvent[];
  allOrderEvents: DemandEvent[];
  deliveryEvents: DeliveryEvent[];
  allDeliveryEvents: DeliveryEvent[];
  returnEvents: ReturnEvent[];
  allReturnEvents: ReturnEvent[];
  lossEvents: LossEvent[];
  retailOfftakeRows: RetailOfftakeRow[];
  allRetailOfftakeRows: RetailOfftakeRow[];
  stockCounts: StockCountRow[];
  stockoutEvents: StockoutEvent[];
  visits: VisitRow[];
  fieldSignals: FieldSignal[];
  osaIssues: OsaIssueObservation[];
  shopFeedback: ShopFeedbackObservation[];
  complianceViolations: ComplianceObservation[];
  salesRepIssues: SalesRepIssueObservation[];
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

type InsightPromotionProductImpactRow = {
  product_id: string;
  product_name: string;
  promoted_ordered_cases: number;
  promoted_estimated_retail_offtake_cases: number;
  total_ordered_cases: number;
  total_estimated_retail_offtake_cases: number;
};

type InsightProductDamageRow = {
  product_id: string | null;
  product_name: string;
  damaged_units: number;
  expired_units: number;
  total_loss_units: number;
};

type InsightWarehouseDamageRow = {
  warehouse_id: string | null;
  warehouse_name: string;
  damaged_units: number;
  expired_units: number;
  total_loss_units: number;
  affected_products: number;
};

type InsightOsaIssueRow = {
  label: string;
  issue_type: string;
  product_name: string | null;
  warehouse_name: string;
  issue_count: number;
  affected_outlets: number;
};

type InsightCompetitorRiskVsSalesRow = {
  label: string;
  competitor_mentions: number;
  ordered_cases: number;
  estimated_retail_offtake_cases: number;
};

type InsightDissatisfiedShopRow = {
  shop_name: string;
  territory_name: string;
  warehouse_name: string;
  average_rating: number;
  feedback_count: number;
  latest_comment: string;
};

type InsightSalesRepIssueRow = {
  sales_rep_name: string;
  territory_name: string;
  warehouse_name: string;
  issue_count: number;
  warehouse_issue_count: number;
  route_issue_count: number;
  critical_count: number;
  dominant_issue: string;
};

type InsightComplianceViolationRow = {
  shop_name: string;
  territory_name: string;
  warehouse_name: string;
  violation_count: number;
  planogram_failures: number;
  posm_failures: number;
  violated_rules: string[];
};

type InsightWarehouseRiskRow = {
  warehouse_name: string;
  delivery_gap_cases: number;
  stockout_count: number;
  damage_units: number;
  warehouse_issue_count: number;
  risk_score: number;
};

type InsightRecommendedActionRow = {
  title: string;
  owner: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  metric: string;
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
    @InjectRepository(FeedbackSubmission)
    private readonly feedbackSubmissionsRepo: Repository<FeedbackSubmission>,
    @InjectRepository(DailyReport)
    private readonly dailyReportsRepo: Repository<DailyReport>,
    @InjectRepository(DeliveryAssignment)
    private readonly assignmentsRepo: Repository<DeliveryAssignment>,
    @InjectRepository(DeliveryAssignmentOrder)
    private readonly assignmentOrdersRepo: Repository<DeliveryAssignmentOrder>,
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    @InjectRepository(OrderFeedback)
    private readonly orderFeedbacksRepo: Repository<OrderFeedback>,
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
    this.ensureExplicitReportWindow(query);
    const dashboard = await this.generateDashboard(query);
    const filename = `demand_planner_insight_center_${dashboard.summary.generatedAt.slice(0, 10)}.csv`;
    const rows = this.buildReportRows(dashboard);

    return {
      filename,
      csv: toCsv(rows, this.reportColumns()),
    };
  }

  async generatePdfReport(query: InsightCenterQuery) {
    this.ensureExplicitReportWindow(query);
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
      periods: ['7d', '30d', '90d', '180d', '365d', 'ytd', 'custom'],
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
      feedbackSubmissions,
      assignments,
      assignmentOrders,
      orderFeedbacks,
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
      this.feedbackSubmissionsRepo.find({ order: { createdAt: 'ASC' } }),
      this.assignmentsRepo.find({
        relations: {
          assignmentOrders: {
            order: { items: { product: true } },
          },
        },
        order: { createdAt: 'ASC' },
      }),
      this.assignmentOrdersRepo.find({ relations: { assignment: true } }),
      this.orderFeedbacksRepo.find({
        relations: { order: true, shopOwner: true },
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
      this.dailyReportsRepo.find({
        relations: { salesRep: true },
        order: { reportDate: 'ASC' },
      }),
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
    const userById = new Map(users.map((user) => [user.id, user]));
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
      osaIssueRows,
      complianceRows,
    } = this.buildVisitSignals(
      visits,
      productById,
      territoryById,
      warehouseById,
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
    const allShopFeedback = this.buildShopFeedbackRows(
      orderFeedbacks,
      feedbackSubmissions,
      visitRows,
      users,
      orderInfos,
      shopContext,
      filters,
    );
    const allSalesRepIssues = this.buildSalesRepIssueRows(
      incidents,
      dailyReports,
      users,
      shopContext,
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
    const filteredLossEvents = lossEvents.filter(
      (event) =>
        this.isInRange(event.timestamp, filters) &&
        this.matchesFilters(event, filters),
    );
    const filteredVisits = visitRows.filter(
      (visit) =>
        this.isInRange(visit.timestamp, filters) &&
        this.matchesFilters(visit, filters),
    );
    const filteredOsaIssues = osaIssueRows.filter(
      (row) =>
        this.isInRange(row.observedDate, filters) &&
        this.matchesFilters(row, filters),
    );
    const filteredShopFeedback = allShopFeedback.filter(
      (row) =>
        this.isInRange(row.feedbackDate, filters) &&
        this.matchesFilters(row, filters),
    );
    const filteredComplianceRows = complianceRows.filter(
      (row) =>
        this.isInRange(row.observedDate, filters) &&
        this.matchesFilters(row, filters),
    );
    const filteredSalesRepIssues = allSalesRepIssues.filter(
      (row) =>
        this.isInRange(row.issueDate, filters) &&
        this.matchesFilters(row, filters),
    );

    return {
      orderEvents: filteredOrderEvents,
      allOrderEvents,
      deliveryEvents: filteredDeliveryEvents,
      allDeliveryEvents,
      returnEvents: filteredReturnEvents,
      allReturnEvents,
      lossEvents: filteredLossEvents,
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
      osaIssues: filteredOsaIssues,
      shopFeedback: filteredShopFeedback,
      complianceViolations: filteredComplianceRows,
      salesRepIssues: filteredSalesRepIssues,
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
    warehouseById: Map<string, Warehouse>,
    shopContext: ShopReferenceContext,
    filters: InsightFilters,
  ) {
    const stockCounts: StockCountRow[] = [];
    const stockoutEvents: StockoutEvent[] = [];
    const lossEvents: LossEvent[] = [];
    const visitRows: VisitRow[] = [];
    const visitFieldSignals: FieldSignal[] = [];
    const osaIssueRows: OsaIssueObservation[] = [];
    const complianceRows: ComplianceObservation[] = [];

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
      const warehouseName = warehouseId
        ? warehouseById.get(warehouseId)?.name ?? shop?.warehouseName ?? null
        : shop?.warehouseName ?? null;
      const outletFeedbackAnswers = Array.isArray(visit.outletFeedbackAnswersJson)
        ? visit.outletFeedbackAnswersJson
        : [];
      const salesRepName =
        `${visit.salesRep?.firstName ?? ''} ${visit.salesRep?.lastName ?? ''}`.trim() ||
        visit.salesRep?.username ||
        'Unknown sales rep';

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
        warehouseName,
        salesRepName,
        competitorNotes: visit.competitorNotes,
        outletFeedback: visit.outletFeedback,
        planogramOk: visit.planogramOk,
        posmOk: visit.posmOk,
        outletFeedbackAnswers,
      };
      visitRows.push(visitRow);

      this.addVisitFieldSignals(visitRow, visitFieldSignals, filters);
      this.addVisitOsaIssues(
        visit,
        visitRow,
        productById,
        warehouseName,
        osaIssueRows,
      );
      this.addComplianceViolations(visitRow, complianceRows);

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
            warehouseId,
            warehouseName,
            observedAt: observedAt.toISOString(),
            observedDate,
            stockUnits: currentStockUnits,
            reason: oosReason,
          });
        }
      }

      this.addLossEvents(
        visit,
        productById,
        canonicalShopId,
        observedAt,
        visitRow,
        lossEvents,
      );
    }

    return {
      stockCounts,
      stockoutEvents,
      lossEvents,
      visitRows,
      visitFieldSignals,
      osaIssueRows,
      complianceRows,
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
    const totalDamageUnits = this.sum(dataset.lossEvents, 'quantityUnits');
    const competitorPressureScore = this.calculateCompetitorPressure(dataset);
    const dissatisfiedShops = new Set(
      dataset.shopFeedback
        .filter((row) => row.rating !== null && (row.rating ?? 0) <= 2)
        .map((row) => row.canonicalShopId ?? row.shopName),
    ).size;

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
      {
        key: 'damage_units_flagged',
        label: 'Damage units flagged',
        value: this.roundNumber(totalDamageUnits),
        unit: 'units',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Damaged or expired units captured through sales-rep visit evidence.',
      },
      {
        key: 'osa_issue_count',
        label: 'OSA issues',
        value: dataset.osaIssues.length,
        unit: 'issues',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Out-of-stock and availability issues captured by sales reps in the selected window.',
      },
      {
        key: 'competitor_pressure_score',
        label: 'Competitor pressure score',
        value: competitorPressureScore,
        unit: 'score',
        sourceType: 'hybrid',
        confidenceScore: null,
        caption: 'Signal score built from competitor and substitution notes in visits and reports.',
      },
      {
        key: 'dissatisfied_shops',
        label: 'Dissatisfied shops',
        value: dissatisfiedShops,
        unit: 'shops',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Shops with weak feedback ratings in the selected time window.',
      },
      {
        key: 'compliance_violations',
        label: 'Marketing rule violations',
        value: dataset.complianceViolations.length,
        unit: 'violations',
        sourceType: 'exact',
        confidenceScore: null,
        caption: 'Planogram or POSM violations captured during store visits.',
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
      promotionProductImpact: this.buildPromotionProductImpact(dataset),
      productMomentum: this.buildProductMomentum(dataset),
      customerSalesByProduct: this.buildCustomerSalesByProduct(dataset),
      orderVsCustomerSales: this.buildOrderVsCustomerSales(dataset),
      stockoutImpact: this.buildStockoutImpact(dataset),
      damageByProduct: this.buildDamageByProduct(dataset),
      damageByWarehouse: this.buildDamageByWarehouse(dataset),
      osaIssues: this.buildOsaIssuePressure(dataset),
      competitorPressure: this.buildCompetitorPressure(dataset),
      competitorRiskVsSales: this.buildCompetitorRiskVsSales(dataset),
      feedbackThemes: this.buildFeedbackThemes(dataset),
      dissatisfiedShops: this.buildDissatisfiedShops(dataset),
      complianceViolations: this.buildComplianceViolations(dataset),
      salesRepIssues: this.buildSalesRepIssuePressure(dataset),
      warehouseRisk: this.buildWarehouseRisk(dataset),
      visitCoverageConfidence: this.buildVisitCoverage(dataset, filters),
      waterfall: this.buildWaterfall(dataset, forecastDataset),
      exceptions: this.buildExceptions(dataset, forecastDataset),
      recommendedActions: this.buildRecommendedActions(dataset, forecastDataset),
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

    const highest = ranked.slice(0, Math.min(5, ranked.length));
    const highestIds = new Set(highest.map((row) => row.product_id));
    const lowestPool = ranked.filter((row) => !highestIds.has(row.product_id));
    const lowestSource = lowestPool.length > 0 ? lowestPool : ranked;
    const lowest = lowestSource
      .slice(Math.max(0, lowestSource.length - 5))
      .sort((left, right) => left.demand_signal_cases - right.demand_signal_cases);

    return {
      highest,
      lowest,
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

  private buildPromotionProductImpact(
    dataset: OperationalDataset,
  ): InsightPromotionProductImpactRow[] {
    const grouped = new Map<string, InsightPromotionProductImpactRow>();

    const ensure = (productId: string, productName: string) => {
      const existing = grouped.get(productId);
      if (existing) {
        return existing;
      }
      const next: InsightPromotionProductImpactRow = {
        product_id: productId,
        product_name: productName,
        promoted_ordered_cases: 0,
        promoted_estimated_retail_offtake_cases: 0,
        total_ordered_cases: 0,
        total_estimated_retail_offtake_cases: 0,
      };
      grouped.set(productId, next);
      return next;
    };

    for (const event of dataset.orderEvents) {
      const row = ensure(event.productId, event.productName);
      row.total_ordered_cases += event.quantityCases;
      if (event.promotionFlag) {
        row.promoted_ordered_cases += event.quantityCases;
      }
    }

    for (const row of dataset.retailOfftakeRows) {
      const target = ensure(row.productId, row.productName);
      target.total_estimated_retail_offtake_cases += row.estimatedSoldCases;
      if (row.promotionFlag) {
        target.promoted_estimated_retail_offtake_cases += row.estimatedSoldCases;
      }
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        promoted_ordered_cases: this.roundNumber(row.promoted_ordered_cases),
        promoted_estimated_retail_offtake_cases: this.roundNumber(
          row.promoted_estimated_retail_offtake_cases,
        ),
        total_ordered_cases: this.roundNumber(row.total_ordered_cases),
        total_estimated_retail_offtake_cases: this.roundNumber(
          row.total_estimated_retail_offtake_cases,
        ),
      }))
      .filter(
        (row) =>
          row.promoted_ordered_cases > 0 ||
          row.promoted_estimated_retail_offtake_cases > 0,
      )
      .sort(
        (left, right) =>
          right.promoted_ordered_cases +
          right.promoted_estimated_retail_offtake_cases -
          (left.promoted_ordered_cases + left.promoted_estimated_retail_offtake_cases),
      )
      .slice(0, 8);
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

  private buildDamageByProduct(
    dataset: OperationalDataset,
  ): InsightProductDamageRow[] {
    const grouped = new Map<
      string,
      { product_id: string | null; product_name: string; damaged_units: number; expired_units: number }
    >();

    for (const row of dataset.lossEvents) {
      const key = row.productId ?? row.productName;
      const existing =
        grouped.get(key) ??
        {
          product_id: row.productId,
          product_name: row.productName,
          damaged_units: 0,
          expired_units: 0,
        };
      if (row.lossType === 'DAMAGED') {
        existing.damaged_units += row.quantityUnits;
      } else {
        existing.expired_units += row.quantityUnits;
      }
      grouped.set(key, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        damaged_units: this.roundNumber(row.damaged_units),
        expired_units: this.roundNumber(row.expired_units),
        total_loss_units: this.roundNumber(row.damaged_units + row.expired_units),
      }))
      .filter((row) => row.total_loss_units > 0)
      .sort((left, right) => right.total_loss_units - left.total_loss_units)
      .slice(0, 8);
  }

  private buildDamageByWarehouse(
    dataset: OperationalDataset,
  ): InsightWarehouseDamageRow[] {
    const grouped = new Map<
      string,
      {
        warehouse_id: string | null;
        warehouse_name: string;
        damaged_units: number;
        expired_units: number;
        products: Set<string>;
      }
    >();

    for (const row of dataset.lossEvents) {
      const key = row.warehouseId ?? row.warehouseName ?? 'Unassigned';
      const existing =
        grouped.get(key) ??
        {
          warehouse_id: row.warehouseId,
          warehouse_name: row.warehouseName ?? 'Unassigned',
          damaged_units: 0,
          expired_units: 0,
          products: new Set<string>(),
        };
      if (row.productId) {
        existing.products.add(row.productId);
      } else {
        existing.products.add(row.productName);
      }
      if (row.lossType === 'DAMAGED') {
        existing.damaged_units += row.quantityUnits;
      } else {
        existing.expired_units += row.quantityUnits;
      }
      grouped.set(key, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        damaged_units: this.roundNumber(row.damaged_units),
        expired_units: this.roundNumber(row.expired_units),
        total_loss_units: this.roundNumber(row.damaged_units + row.expired_units),
        affected_products: row.products.size,
      }))
      .filter((row) => row.total_loss_units > 0)
      .sort((left, right) => right.total_loss_units - left.total_loss_units)
      .slice(0, 8);
  }

  private buildOsaIssuePressure(
    dataset: OperationalDataset,
  ): InsightOsaIssueRow[] {
    const grouped = new Map<
      string,
      {
        label: string;
        issue_type: string;
        product_name: string | null;
        warehouse_name: string;
        issue_count: number;
        outlets: Set<string>;
      }
    >();

    for (const row of dataset.osaIssues) {
      const key = `${row.issueTag}|${row.productId ?? row.productName ?? 'none'}|${row.warehouseId ?? row.warehouseName ?? 'none'}`;
      const existing =
        grouped.get(key) ??
        {
          label: row.productName
            ? `${row.issueTag} - ${row.productName}`
            : row.issueTag,
          issue_type: row.issueTag,
          product_name: row.productName,
          warehouse_name: row.warehouseName ?? 'Unassigned',
          issue_count: 0,
          outlets: new Set<string>(),
        };
      existing.issue_count += 1;
      existing.outlets.add(row.canonicalShopId);
      grouped.set(key, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        label: row.label,
        issue_type: row.issue_type,
        product_name: row.product_name,
        warehouse_name: row.warehouse_name,
        issue_count: row.issue_count,
        affected_outlets: row.outlets.size,
      }))
      .sort((left, right) => right.issue_count - left.issue_count)
      .slice(0, 10);
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

  private buildCompetitorRiskVsSales(
    dataset: OperationalDataset,
  ): InsightCompetitorRiskVsSalesRow[] {
    const grouped = new Map<
      string,
      InsightCompetitorRiskVsSalesRow
    >();

    const ensure = (label: string) => {
      const existing = grouped.get(label);
      if (existing) {
        return existing;
      }
      const next: InsightCompetitorRiskVsSalesRow = {
        label,
        competitor_mentions: 0,
        ordered_cases: 0,
        estimated_retail_offtake_cases: 0,
      };
      grouped.set(label, next);
      return next;
    };

    for (const signal of dataset.fieldSignals.filter((row) =>
      row.signalType.includes('competitor'),
    )) {
      ensure(signal.territoryName ?? 'Unassigned').competitor_mentions += 1;
    }

    for (const event of dataset.orderEvents) {
      ensure(event.territoryName ?? 'Unassigned').ordered_cases += event.quantityCases;
    }

    for (const row of dataset.retailOfftakeRows) {
      ensure(row.territoryName ?? 'Unassigned').estimated_retail_offtake_cases +=
        row.estimatedSoldCases;
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        ordered_cases: this.roundNumber(row.ordered_cases),
        estimated_retail_offtake_cases: this.roundNumber(
          row.estimated_retail_offtake_cases,
        ),
      }))
      .sort((left, right) => right.competitor_mentions - left.competitor_mentions)
      .slice(0, 8);
  }

  private buildFeedbackThemes(dataset: OperationalDataset) {
    const themes = new Map<string, number>();
    for (const feedback of dataset.shopFeedback) {
      const text = feedback.comment.toLowerCase();
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

  private buildDissatisfiedShops(
    dataset: OperationalDataset,
  ): InsightDissatisfiedShopRow[] {
    const grouped = new Map<
      string,
      {
        shop_name: string;
        territory_name: string;
        warehouse_name: string;
        ratings: number[];
        feedback_count: number;
        latest_comment: string;
      }
    >();

    for (const row of dataset.shopFeedback.filter((item) => item.rating !== null)) {
      const key = row.canonicalShopId ?? row.shopName;
      const existing =
        grouped.get(key) ??
        {
          shop_name: row.shopName,
          territory_name: row.territoryName ?? 'Unassigned',
          warehouse_name: row.warehouseName ?? 'Unassigned',
          ratings: [] as number[],
          feedback_count: 0,
          latest_comment: '',
        };
      if (row.rating !== null) {
        existing.ratings.push(row.rating);
      }
      existing.feedback_count += 1;
      if (row.comment && !existing.latest_comment) {
        existing.latest_comment = row.comment;
      }
      grouped.set(key, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        shop_name: row.shop_name,
        territory_name: row.territory_name,
        warehouse_name: row.warehouse_name,
        average_rating: this.roundNumber(this.average(row.ratings)),
        feedback_count: row.feedback_count,
        latest_comment: row.latest_comment,
      }))
      .sort((left, right) => left.average_rating - right.average_rating)
      .slice(0, 8);
  }

  private buildComplianceViolations(
    dataset: OperationalDataset,
  ): InsightComplianceViolationRow[] {
    const grouped = new Map<
      string,
      InsightComplianceViolationRow
    >();

    for (const row of dataset.complianceViolations) {
      const key = row.canonicalShopId;
      const existing =
        grouped.get(key) ??
        {
          shop_name: row.shopName,
          territory_name: row.territoryName ?? 'Unassigned',
          warehouse_name: row.warehouseName ?? 'Unassigned',
          violation_count: 0,
          planogram_failures: 0,
          posm_failures: 0,
          violated_rules: [] as string[],
        };
      existing.violation_count += 1;
      if (row.violationType === 'PLANOGRAM') {
        existing.planogram_failures += 1;
      } else {
        existing.posm_failures += 1;
      }
      grouped.set(key, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        violated_rules: [
          row.planogram_failures > 0 ? 'Planogram not followed' : null,
          row.posm_failures > 0 ? 'POSM missing or not compliant' : null,
        ].filter((value): value is string => Boolean(value)),
      }))
      .sort((left, right) => right.violation_count - left.violation_count)
      .slice(0, 8);
  }

  private buildSalesRepIssuePressure(
    dataset: OperationalDataset,
  ): InsightSalesRepIssueRow[] {
    const grouped = new Map<
      string,
      {
        sales_rep_name: string;
        territory_name: string;
        warehouse_name: string;
        issue_count: number;
        warehouse_issue_count: number;
        route_issue_count: number;
        critical_count: number;
        typeCounts: Map<string, number>;
      }
    >();

    for (const row of dataset.salesRepIssues) {
      const key = row.salesRepId ?? row.salesRepName;
      const existing =
        grouped.get(key) ??
        {
          sales_rep_name: row.salesRepName,
          territory_name: row.territoryName ?? 'Unassigned',
          warehouse_name: row.warehouseName ?? 'Unassigned',
          issue_count: 0,
          warehouse_issue_count: 0,
          route_issue_count: 0,
          critical_count: 0,
          typeCounts: new Map<string, number>(),
        };
      existing.issue_count += 1;
      existing.warehouse_issue_count += row.issueType.includes('WAREHOUSE') ? 1 : 0;
      existing.route_issue_count += row.issueType.includes('ROUTE') ? 1 : 0;
      existing.critical_count += row.severity === 'CRITICAL' ? 1 : 0;
      existing.typeCounts.set(
        row.issueType,
        (existing.typeCounts.get(row.issueType) ?? 0) + 1,
      );
      grouped.set(key, existing);
    }

    return [...grouped.values()]
      .map((row) => ({
        sales_rep_name: row.sales_rep_name,
        territory_name: row.territory_name,
        warehouse_name: row.warehouse_name,
        issue_count: row.issue_count,
        warehouse_issue_count: row.warehouse_issue_count,
        route_issue_count: row.route_issue_count,
        critical_count: row.critical_count,
        dominant_issue:
          [...row.typeCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
          'GENERAL_ISSUE',
      }))
      .sort((left, right) => right.issue_count - left.issue_count)
      .slice(0, 8);
  }

  private buildWarehouseRisk(
    dataset: OperationalDataset,
  ): InsightWarehouseRiskRow[] {
    const grouped = new Map<
      string,
      {
        warehouse_name: string;
        ordered_cases: number;
        delivered_cases: number;
        stockout_count: number;
        damage_units: number;
        warehouse_issue_count: number;
      }
    >();

    const ensure = (warehouseName: string | null | undefined) => {
      const label = warehouseName ?? 'Unassigned';
      const existing = grouped.get(label);
      if (existing) {
        return existing;
      }
      const next = {
        warehouse_name: label,
        ordered_cases: 0,
        delivered_cases: 0,
        stockout_count: 0,
        damage_units: 0,
        warehouse_issue_count: 0,
      };
      grouped.set(label, next);
      return next;
    };

    for (const event of dataset.orderEvents) {
      ensure(this.lookupWarehouseName(dataset, event.warehouseId)).ordered_cases +=
        event.quantityCases;
    }
    for (const event of dataset.deliveryEvents) {
      ensure(this.lookupWarehouseName(dataset, event.warehouseId)).delivered_cases +=
        event.quantityCases;
    }
    for (const event of dataset.stockoutEvents) {
      ensure(this.lookupWarehouseName(dataset, event.warehouseId)).stockout_count += 1;
    }
    for (const row of dataset.lossEvents) {
      ensure(row.warehouseName).damage_units += row.quantityUnits;
    }
    for (const row of dataset.salesRepIssues) {
      if (row.issueType.includes('WAREHOUSE')) {
        ensure(row.warehouseName).warehouse_issue_count += 1;
      }
    }

    return [...grouped.values()]
      .map((row) => {
        const deliveryGap = Math.max(0, row.ordered_cases - row.delivered_cases);
        return {
          warehouse_name: row.warehouse_name,
          delivery_gap_cases: this.roundNumber(deliveryGap),
          stockout_count: row.stockout_count,
          damage_units: this.roundNumber(row.damage_units),
          warehouse_issue_count: row.warehouse_issue_count,
          risk_score: this.roundNumber(
            deliveryGap * 0.2 +
              row.stockout_count * 1.5 +
              row.damage_units * 0.05 +
              row.warehouse_issue_count * 2,
          ),
        };
      })
      .filter(
        (row) =>
          row.risk_score > 0 ||
          row.delivery_gap_cases > 0 ||
          row.stockout_count > 0 ||
          row.damage_units > 0 ||
          row.warehouse_issue_count > 0,
      )
      .sort((left, right) => right.risk_score - left.risk_score)
      .slice(0, 8);
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
    const grouped = new Map<
      string,
      {
        severity: 'LOW' | 'MEDIUM' | 'HIGH';
        exception_type: string;
        recommended_action: string;
        reasons: Set<string>;
        count: number;
      }
    >();

    const pushException = (
      severity: 'LOW' | 'MEDIUM' | 'HIGH',
      exceptionType: string,
      reason: string,
      recommendedAction: string,
    ) => {
      const key = `${exceptionType}|${recommendedAction}`;
      const existing =
        grouped.get(key) ??
        {
          severity,
          exception_type: exceptionType,
          recommended_action: recommendedAction,
          reasons: new Set<string>(),
          count: 0,
        };
      existing.count += 1;
      existing.reasons.add(reason);
      if (this.exceptionSeverityWeight(severity) > this.exceptionSeverityWeight(existing.severity)) {
        existing.severity = severity;
      }
      grouped.set(key, existing);
    };

    for (const row of forecastDataset.exceptions.slice(0, 40)) {
      pushException(row.severity, row.exception_type, row.reason, row.recommended_action);
    }

    for (const row of dataset.retailOfftakeRows.filter(
      (item) => item.negativeClampedFlag || item.duplicateVisitConflict,
    )) {
      pushException(
        row.negativeClampedFlag ? 'HIGH' : 'MEDIUM',
        row.negativeClampedFlag
          ? 'NEGATIVE_ESTIMATED_SALES_CLAMPED'
          : 'DUPLICATE_VISIT_CONFLICT',
        `${row.shopName} / ${row.productName}: ${row.dataQualityFlags}`,
        'Review the stock count sequence before using this estimated retail offtake value in planning.',
      );
    }

    return [...grouped.values()]
      .map((row) => ({
        severity: row.severity,
        exception_type: row.exception_type,
        reason:
          row.count > 1
            ? `${row.count} rows flagged. ${[...row.reasons][0]}`
            : [...row.reasons][0],
        recommended_action: row.recommended_action,
      }))
      .sort(
        (left, right) =>
          this.exceptionSeverityWeight(right.severity) -
          this.exceptionSeverityWeight(left.severity),
      )
      .slice(0, 12);
  }

  private buildRecommendedActions(
    dataset: OperationalDataset,
    forecastDataset: ForecastDataset,
  ): InsightRecommendedActionRow[] {
    const actions: InsightRecommendedActionRow[] = [];
    const orderedCases = this.sum(dataset.orderEvents, 'quantityCases');
    const deliveredCases = this.sum(dataset.deliveryEvents, 'quantityCases');
    const deliveryRate =
      orderedCases > 0 ? deliveredCases / Math.max(orderedCases, 1) : 0;
    const topWarehouseRisk = this.buildWarehouseRisk(dataset)[0];
    const topDamagedProduct = this.buildDamageByProduct(dataset)[0];
    const topOsaIssue = this.buildOsaIssuePressure(dataset)[0];
    const topCompetitorRisk = this.buildCompetitorRiskVsSales(dataset)[0];
    const topDissatisfiedShop = this.buildDissatisfiedShops(dataset)[0];
    const topRepIssue = this.buildSalesRepIssuePressure(dataset)[0];
    const topException = this.buildExceptions(dataset, forecastDataset)[0];

    if (orderedCases > 0 && deliveryRate < 0.6) {
      actions.push({
        title: 'Escalate the fill-rate gap with warehouse dispatch',
        owner: topWarehouseRisk?.warehouse_name ?? 'Warehouse operations',
        priority: 'HIGH',
        reason:
          'Delivered cases are materially behind ordered cases, which is likely inflating stockouts and planner risk.',
        metric: `${this.roundNumber(deliveryRate * 100)}% delivery rate`,
      });
    }

    if (topWarehouseRisk && topWarehouseRisk.risk_score > 0) {
      actions.push({
        title: `Review warehouse risk at ${topWarehouseRisk.warehouse_name}`,
        owner: topWarehouseRisk.warehouse_name,
        priority: topWarehouseRisk.warehouse_issue_count > 0 ? 'HIGH' : 'MEDIUM',
        reason:
          'This warehouse is surfacing the strongest mix of delivery gap, stockout pressure, damage, or warehouse-reported issues.',
        metric: `Risk score ${this.roundNumber(topWarehouseRisk.risk_score)}`,
      });
    }

    if (topDamagedProduct && topDamagedProduct.total_loss_units > 0) {
      actions.push({
        title: `Inspect repeated damage on ${topDamagedProduct.product_name}`,
        owner: 'Trade quality / warehouse',
        priority: 'MEDIUM',
        reason:
          'Sales-rep evidence shows the highest combined damaged and expired units on this product.',
        metric: `${this.roundNumber(topDamagedProduct.total_loss_units)} units flagged`,
      });
    }

    if (topOsaIssue) {
      actions.push({
        title: `Resolve OSA issue: ${topOsaIssue.issue_type}`,
        owner: topOsaIssue.warehouse_name,
        priority: 'MEDIUM',
        reason:
          'OSA issues collected in visits are recurring and directly suppress visible consumer movement.',
        metric: `${topOsaIssue.issue_count} issue records`,
      });
    }

    if (topCompetitorRisk && topCompetitorRisk.competitor_mentions > 0) {
      actions.push({
        title: `Defend competitor pressure in ${topCompetitorRisk.label}`,
        owner: 'Commercial planning',
        priority: 'MEDIUM',
        reason:
          'Field notes show competitor pressure where our customer movement should be defended with availability or commercial response.',
        metric: `${topCompetitorRisk.competitor_mentions} competitor mentions`,
      });
    }

    if (topDissatisfiedShop) {
      actions.push({
        title: `Recover dissatisfied shop: ${topDissatisfiedShop.shop_name}`,
        owner: topDissatisfiedShop.warehouse_name,
        priority: 'MEDIUM',
        reason:
          'This shop-owner account is currently showing the weakest feedback rating in the selected window.',
        metric: `${this.roundNumber(topDissatisfiedShop.average_rating)} / 5 rating`,
      });
    }

    if (topRepIssue) {
      actions.push({
        title: `Coach and unblock ${topRepIssue.sales_rep_name}`,
        owner: topRepIssue.warehouse_name,
        priority: topRepIssue.critical_count > 0 ? 'HIGH' : 'LOW',
        reason:
          'Sales-rep reports and incidents show repeated route, warehouse, or market problems affecting execution quality.',
        metric: `${topRepIssue.issue_count} field issues`,
      });
    }

    if (topException) {
      actions.push({
        title: `Planner caution: ${topException.exception_type}`,
        owner: 'Demand planner',
        priority: topException.severity === 'HIGH' ? 'HIGH' : 'LOW',
        reason: topException.recommended_action,
        metric: topException.severity,
      });
    }

    return actions.slice(0, 8);
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
    const topDamage = charts.damageByProduct[0];
    const topWarehouseRisk = charts.warehouseRisk[0];
    const topCompetitor = charts.competitorRiskVsSales[0];
    const topAction = charts.recommendedActions[0];

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
    if (topDamage && topDamage.total_loss_units > 0) {
      summaries.push(
        `${topDamage.product_name} is the most frequently damaged or expired product in the selected window at ${this.roundNumber(topDamage.total_loss_units)} units.`,
      );
    }
    if (topWarehouseRisk && topWarehouseRisk.risk_score > 0) {
      summaries.push(
        `${topWarehouseRisk.warehouse_name} is currently the warehouse with the strongest combined delivery, stockout, and issue risk.`,
      );
    }
    if (topCompetitor && topCompetitor.competitor_mentions > 0) {
      summaries.push(
        `${topCompetitor.label} is carrying the highest competitor pressure while still contributing visible customer movement.`,
      );
    }
    if (topAction) {
      summaries.push(`Planner action: ${topAction.title}. ${topAction.reason}`);
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

    for (const row of dashboard.charts.damageByProduct.slice(0, 10)) {
      rows.push({
        section: 'Damage by Product',
        metric: row.product_name,
        value: row.total_loss_units,
        unit: 'units',
        source_type: 'exact',
        confidence_score: '',
        notes: `Damaged: ${row.damaged_units} | Expired: ${row.expired_units}`,
      });
    }

    for (const row of dashboard.charts.osaIssues.slice(0, 10)) {
      rows.push({
        section: 'OSA Issues',
        metric: row.label,
        value: row.issue_count,
        unit: 'issues',
        source_type: 'exact',
        confidence_score: '',
        notes: `Outlets: ${row.affected_outlets} | Warehouse: ${row.warehouse_name}`,
      });
    }

    for (const row of dashboard.charts.recommendedActions.slice(0, 10)) {
      rows.push({
        section: 'Recommended Actions',
        metric: row.title,
        value: row.priority,
        unit: '',
        source_type: 'hybrid',
        confidence_score: '',
        notes: `${row.owner} | ${row.metric} | ${row.reason}`,
      });
    }

    for (const row of dashboard.charts.complianceViolations.slice(0, 10)) {
      rows.push({
        section: 'Marketing Rule Violations',
        metric: row.shop_name,
        value: row.violation_count,
        unit: 'violations',
        source_type: 'exact',
        confidence_score: '',
        notes: `${row.territory_name} | ${row.warehouse_name} | Rules: ${row.violated_rules.join(', ') || 'n/a'}`,
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
    const topDamagedProduct = dashboard.charts.damageByProduct[0];
    const topWarehouseRisk = dashboard.charts.warehouseRisk[0];
    const topOsaIssue = dashboard.charts.osaIssues[0];
    const topDissatisfiedShop = dashboard.charts.dissatisfiedShops[0];
    const actions = [
      ...new Set(
        dashboard.charts.recommendedActions
          .slice(0, 6)
          .map((row: Record<string, unknown>) =>
            `${String(row.title || '').trim()}: ${String(row.reason || '').trim()}`,
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
          title: 'Product movement and customer sales',
          purpose: 'Highlight the strongest-moving products, weakest movement, and customer-sales ranking.',
          dataSummary: topMomentum
            ? `Highest movement: ${topMomentum.product_name} at ${this.roundNumber(topMomentum.demand_signal_cases)} cases. Lowest movement: ${weakestMomentum?.product_name ?? 'n/a'} at ${this.roundNumber(weakestMomentum?.demand_signal_cases ?? 0)} cases. Highest customer-sales product: ${topSalesProduct?.product_name ?? 'n/a'}.`
            : 'No product movement rows were available.',
        },
        {
          title: 'Order versus customer sales',
          purpose: 'Show which products have the largest gap between ordering and estimated customer movement.',
          dataSummary: topGapProduct
            ? `${topGapProduct.product_name} shows the largest gap at ${this.roundNumber(topGapProduct.gap_cases)} cases.`
            : 'No order-versus-customer-sales rows were available.',
        },
        {
          title: 'Field execution and risk',
          purpose: 'Summarize damage, OSA issues, dissatisfied shops, and warehouse risk captured by sales reps.',
          dataSummary: [
            topDamagedProduct
              ? `Top damaged product: ${topDamagedProduct.product_name} (${this.roundNumber(topDamagedProduct.total_loss_units)} units).`
              : null,
            topOsaIssue
              ? `Top OSA issue: ${topOsaIssue.issue_type} at ${topOsaIssue.issue_count} records.`
              : null,
            topWarehouseRisk
              ? `Highest warehouse risk: ${topWarehouseRisk.warehouse_name} score ${this.roundNumber(topWarehouseRisk.risk_score)}.`
              : null,
            topDissatisfiedShop
              ? `Lowest shop rating: ${topDissatisfiedShop.shop_name} at ${this.roundNumber(topDissatisfiedShop.average_rating)} / 5.`
              : null,
          ]
            .filter(Boolean)
            .join(' '),
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
        topDamagedProduct
          ? `${topDamagedProduct.product_name} is also the most damaged or expired product observed by sales reps.`
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
        'Demand, promotion, and sales movement',
        'Field execution, damage, and OSA risk',
        'Warehouse, compliance, and action watchlist',
      ],
      chartCaptions: [
        'Orders, deliveries, customer movement, and forecast are shown across the selected time window.',
        'Promotion-active phases and products are compared against baseline movement.',
        'The report highlights customer sales, damage, OSA, and competitor risk captured by the field team.',
        'Warehouse risk, dissatisfied shops, and compliance violations are summarized with actions.',
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

    const callouts = [...new Set([...narrative.callouts, ...dashboard.summary.aiSummary])].slice(
      0,
      5,
    );
    const summaryMetrics = dashboard.kpis.slice(0, 6);
    const summaryMomentumRows = [
      ...dashboard.charts.productMomentum.highest.slice(0, 3).map((row) => ({
        product_name: `Highest: ${row.product_name}`,
        demand_signal_cases: row.demand_signal_cases,
      })),
      ...dashboard.charts.productMomentum.lowest.slice(0, 3).map((row) => ({
        product_name: `Lowest: ${row.product_name}`,
        demand_signal_cases: row.demand_signal_cases,
      })),
    ];
    const competitorSalesRows = dashboard.charts.competitorRiskVsSales
      .slice(0, 6)
      .map((row) => ({
        label: `${row.label} (${row.competitor_mentions} mentions)`,
        ordered_cases: row.ordered_cases,
        estimated_retail_offtake_cases: row.estimated_retail_offtake_cases,
      }));

    document.fillColor('#6f8566').fontSize(10).text('DEMAND PLANNER INSIGHT REPORT');
    document.moveDown(0.35);
    document.fillColor('#243022').fontSize(24).text(narrative.reportTitle, {
      width: pageWidth,
    });
    document.moveDown(0.25);
    document.fillColor('#51604d').fontSize(10).text(
      `Generated ${dashboard.summary.generatedAt.slice(0, 10)} | Window ${dashboard.summary.historyStartDate} to ${dashboard.summary.historyEndDate} | ${dashboard.summary.granularity} view`,
      { width: pageWidth },
    );
    document.moveDown(0.7);

    this.drawPdfHighlightBox(
      document,
      narrative.headline,
      narrative.executiveSummary,
      pageWidth,
      '#eef6f2',
      '#d6e4de',
    );
    this.drawPdfBulletList(document, 'What changed in this window', callouts, pageWidth);
    this.drawPdfHighlightBox(
      document,
      'Data integrity note',
      dashboard.summary.dataIntegrityWarning,
      pageWidth,
      '#fffaf4',
      '#eadfd3',
    );
    this.drawPdfMetricGrid(document, summaryMetrics, pageWidth);
    this.drawPdfDetailCards(
      document,
      'Immediate actions for the planner and warehouse team',
      'These actions are generated from delivery gaps, warehouse pressure, OSA, field issues, and shop-owner feedback.',
      dashboard.charts.recommendedActions.slice(0, 4).map((row) => ({
        title: `${row.priority} | ${row.title}`,
        value: row.metric,
        detail: `${row.owner}: ${row.reason}`,
      })),
      pageWidth,
      '#f6fbf8',
      '#dce8e4',
    );

    document.addPage();
    this.drawPdfSectionHeader(
      document,
      narrative.sectionTitles[1] ?? 'Demand, fulfilment, and consumer movement',
      narrative.storyOfTheNumbers,
      pageWidth,
    );
    this.drawInsightTrendChartV2(
      document,
      this.sampleRows(dashboard.charts.trend, 12),
      pageWidth,
      'Order, delivery, and consumer-demand trend',
      'Y axis shows cases. X axis shows the selected time buckets across the report window.',
    );
    this.drawGroupedBarChartV2(
      document,
      dashboard.charts.orderVsCustomerSales.slice(0, 6),
      pageWidth,
      'Ordering versus customer sales by product',
      'This compares shop ordering with estimated consumer movement so the planner can see which products are over-ordered or under-moving.',
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
    this.drawHorizontalBarChartV2(
      document,
      summaryMomentumRows,
      pageWidth,
      'Highest and lowest visible product movement',
      'Products are ranked by the strongest visible demand signal in the selected window.',
      'product_name',
      'demand_signal_cases',
      '#8f6a3c',
      'cases',
    );

    document.addPage();
    this.drawPdfSectionHeader(
      document,
      'Promotion and customer-sales response',
      'These charts show whether promotions are lifting ordering and estimated customer sales, and which promoted products are carrying that effect.',
      pageWidth,
    );
    this.drawGroupedBarChartV2(
      document,
      dashboard.charts.promotionImpact,
      pageWidth,
      'Promotion impact on orders and customer sales',
      'Baseline, promotion-active, and uplift phases are compared in cases.',
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
    this.drawGroupedBarChartV2(
      document,
      dashboard.charts.promotionProductImpact.slice(0, 6),
      pageWidth,
      'Products most affected by promotions',
      'This focuses on promoted demand only, so the planner can see which products are reacting most strongly while promotions are active.',
      'product_name',
      [
        { key: 'promoted_ordered_cases', label: 'Promoted orders', color: '#5c7f56' },
        {
          key: 'promoted_estimated_retail_offtake_cases',
          label: 'Promoted customer sales',
          color: '#b6793f',
        },
      ],
    );
    this.drawHorizontalBarChartV2(
      document,
      dashboard.charts.customerSalesByProduct.slice(0, 6),
      pageWidth,
      'Customer sales by product',
      'Estimated retail offtake by product in the selected window. This shows what consumers appear to be buying, not only what shops ordered.',
      'product_name',
      'estimated_retail_offtake_cases',
      '#54715a',
      'cases',
    );

    document.addPage();
    this.drawPdfSectionHeader(
      document,
      'Damage, OSA, and field-execution evidence',
      'These are direct observations captured by sales reps. They highlight physical product loss, on-shelf availability problems, and where execution issues are suppressing movement.',
      pageWidth,
    );
    this.drawHorizontalBarChartV2(
      document,
      dashboard.charts.damageByProduct.slice(0, 6),
      pageWidth,
      'Most damaged or expired products',
      'Higher bars indicate products repeatedly flagged by sales reps for damage or expiry.',
      'product_name',
      'total_loss_units',
      '#a76d4c',
      'units',
    );
    this.drawHorizontalBarChartV2(
      document,
      dashboard.charts.damageByWarehouse.slice(0, 6),
      pageWidth,
      'Warehouses associated with repeated damage',
      'This shows which warehouses are most often linked to damaged or expired units in the selected window.',
      'warehouse_name',
      'total_loss_units',
      '#8e6a3b',
      'units',
    );
    this.drawHorizontalBarChartV2(
      document,
      dashboard.charts.osaIssues.slice(0, 6),
      pageWidth,
      'OSA issues captured in outlet visits',
      'Higher bars indicate more repeated on-shelf availability issues that directly suppress sell-through.',
      'label',
      'issue_count',
      '#b6793f',
      'issues',
    );

    document.addPage();
    this.drawPdfSectionHeader(
      document,
      'Competitor pressure, shop-owner feedback, and compliance',
      'This page connects competitor pressure, customer movement, shop-owner sentiment, and in-store rule violations so the planner can see commercial and execution risk together.',
      pageWidth,
    );
    this.drawGroupedBarChartV2(
      document,
      competitorSalesRows,
      pageWidth,
      'Competitor pressure versus our sales',
      'Each territory label includes competitor mentions, while the bars show our visible orders and estimated customer sales in the same area.',
      'label',
      [
        { key: 'ordered_cases', label: 'Orders', color: '#5c7f56' },
        {
          key: 'estimated_retail_offtake_cases',
          label: 'Customer sales',
          color: '#b6793f',
        },
      ],
    );
    this.drawPdfDetailCards(
      document,
      'Most dissatisfied shop owners',
      'These accounts have the weakest ratings or most concerning recent feedback comments in the selected window.',
      dashboard.charts.dissatisfiedShops.slice(0, 4).map((row) => ({
        title: `${row.shop_name} | ${this.roundNumber(row.average_rating)} / 5`,
        value: `${row.feedback_count} feedbacks`,
        detail: `${row.territory_name} | ${row.warehouse_name}${row.latest_comment ? ` | ${row.latest_comment}` : ''}`,
      })),
      pageWidth,
      '#fffaf4',
      '#eadfd3',
    );
    this.drawPdfDetailCards(
      document,
      'Shops violating marketing rules',
      'These shops are repeatedly failing planogram or POSM execution checks during store visits.',
      dashboard.charts.complianceViolations.slice(0, 4).map((row) => ({
        title: `${row.shop_name} | ${row.violation_count} violations`,
        value: `${row.planogram_failures} planogram / ${row.posm_failures} POSM`,
        detail: `${row.territory_name} | ${row.warehouse_name} | Rules broken: ${row.violated_rules.join(', ')}`,
      })),
      pageWidth,
      '#fffaf4',
      '#eadfd3',
    );

    document.addPage();
    this.drawPdfSectionHeader(
      document,
      narrative.sectionTitles[3] ?? 'Warehouse, field-team, and planner watchlist',
      narrative.managementRecommendation,
      pageWidth,
    );
    this.drawPdfDetailCards(
      document,
      'Sales-rep report issues',
      'These rows summarize the sales reps carrying the heaviest route, warehouse, or market-execution burden in the selected window.',
      dashboard.charts.salesRepIssues.slice(0, 4).map((row) => ({
        title: `${row.sales_rep_name} | ${row.issue_count} issues`,
        value: `${row.critical_count} critical`,
        detail: `${row.territory_name} | ${row.warehouse_name} | dominant issue: ${row.dominant_issue}`,
      })),
      pageWidth,
      '#f6fbf8',
      '#dce8e4',
    );
    this.drawPdfDetailCards(
      document,
      'Warehouse risk watchlist',
      'These warehouses combine delivery gaps, stockouts, product loss, and warehouse-reported issues into a single operational watchlist.',
      dashboard.charts.warehouseRisk.slice(0, 4).map((row) => ({
        title: `${row.warehouse_name} | risk ${this.roundNumber(row.risk_score)}`,
        value: `${this.roundNumber(row.delivery_gap_cases)} gap`,
        detail: `${row.stockout_count} stockouts | ${this.roundNumber(row.damage_units)} damaged units | ${row.warehouse_issue_count} warehouse issues`,
      })),
      pageWidth,
      '#f6fbf8',
      '#dce8e4',
    );
    this.drawPdfDetailCards(
      document,
      'Planner action watchlist',
      'These are the recommended actions generated from the current data window. They combine warehouse, field, customer, and forecast evidence.',
      dashboard.charts.recommendedActions.slice(0, 6).map((row) => ({
        title: `${row.priority} | ${row.title}`,
        value: row.metric,
        detail: `${row.owner}: ${row.reason}`,
      })),
      pageWidth,
      '#eef6f2',
      '#d6e4de',
    );
    this.drawPdfDetailCards(
      document,
      'Exception watchlist',
      'Repeated forecast or data-quality issues are grouped once here so the planner sees the risk clearly instead of reading the same warning multiple times.',
      dashboard.charts.exceptions.slice(0, 6).map((row) => ({
        title: `${row.exception_type} | ${row.severity}`,
        value: row.recommended_action,
        detail: row.reason,
      })),
      pageWidth,
      '#fffaf4',
      '#eadfd3',
    );

    document.end();
    return await new Promise<Buffer>((resolve) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
    });

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

  private drawPdfSectionHeader(
    document: any,
    title: string,
    body: string,
    width: number,
  ) {
    document.x = document.page.margins.left;
    document.fillColor('#243022').fontSize(18).text(title, {
      width,
    });
    document.moveDown(0.3);
    document.fillColor('#5d6d60').fontSize(10).text(body, {
      width,
    });
    document.moveDown(0.5);
  }

  private drawPdfHighlightBox(
    document: any,
    title: string,
    body: string,
    width: number,
    fillColor: string,
    strokeColor: string,
  ) {
    const left = document.page.margins.left;
    document.x = left;
    document.fontSize(14);
    const titleHeight = document.heightOfString(title, { width: width - 28 });
    document.fontSize(10);
    const bodyHeight = document.heightOfString(body, { width: width - 28 });
    const boxHeight = Math.max(70, 30 + titleHeight + bodyHeight);
    this.ensurePdfSpace(document, boxHeight + 12);
    const top = document.y;

    document.roundedRect(left, top, width, boxHeight, 12).fillAndStroke(fillColor, strokeColor);
    document.fillColor('#243022').fontSize(14).text(title, left + 14, top + 12, {
      width: width - 28,
    });
    document.fillColor('#5d6d60').fontSize(10).text(body, left + 14, top + 28 + titleHeight / 2, {
      width: width - 28,
    });
    document.y = top + boxHeight + 10;
  }

  private drawPdfBulletList(
    document: any,
    title: string,
    items: string[],
    width: number,
  ) {
    if (items.length === 0) {
      return;
    }
    const estimatedHeight = 40 + items.length * 18;
    this.ensurePdfSpace(document, estimatedHeight);
    document.x = document.page.margins.left;
    document.fillColor('#243022').fontSize(13).text(title, {
      width,
    });
    document.moveDown(0.2);
    for (const item of items) {
      document.fillColor('#5d6d60').fontSize(10).text(`- ${item}`, {
        width,
      });
      document.moveDown(0.12);
    }
    document.moveDown(0.35);
  }

  private drawPdfMetricGrid(document: any, metrics: KpiCard[], width: number) {
    if (metrics.length === 0) {
      return;
    }
    const columns = 2;
    const gap = 10;
    const cardWidth = (width - gap) / columns;
    const cardHeight = 78;
    const rows = Math.ceil(metrics.length / columns);
    this.ensurePdfSpace(document, rows * (cardHeight + gap) + 12);
    const left = document.page.margins.left;
    document.x = left;
    const top = document.y;

    metrics.forEach((kpi, index) => {
      const rowIndex = Math.floor(index / columns);
      const columnIndex = index % columns;
      const x = left + columnIndex * (cardWidth + gap);
      const y = top + rowIndex * (cardHeight + gap);

      document.roundedRect(x, y, cardWidth, cardHeight, 10).fillAndStroke('#f8fbf5', '#d7e4d2');
      document.fillColor('#687561').fontSize(9).text(kpi.label, x + 10, y + 10, {
        width: cardWidth - 20,
      });
      document.fillColor('#243022').fontSize(16).text(
        `${this.roundNumber(kpi.value)} ${kpi.unit}`,
        x + 10,
        y + 28,
        {
          width: cardWidth - 20,
        },
      );
      document.fillColor('#6d645c').fontSize(8).text(kpi.caption, x + 10, y + 48, {
        width: cardWidth - 20,
      });
    });

    document.y = top + rows * (cardHeight + gap) + 4;
  }

  private drawPdfDetailCards(
    document: any,
    title: string,
    subtitle: string,
    rows: Array<{ title: string; value: string; detail: string }>,
    width: number,
    fillColor: string,
    strokeColor: string,
  ) {
    if (rows.length === 0) {
      return;
    }
    const left = document.page.margins.left;
    document.x = left;
    const top = document.y;

    const headerHeight = 40;
    const measuredRows = rows.map((row) => {
      document.fontSize(10)
      const titleHeight = document.heightOfString(row.title, {
        width: width - 120,
      })
      document.fontSize(8.5)
      const detailHeight = document.heightOfString(row.detail, {
        width: width - 24,
      })
      return {
        ...row,
        height: Math.max(54, 22 + titleHeight + detailHeight),
      }
    })
    const totalHeight =
      headerHeight + measuredRows.reduce((sum, row) => sum + row.height + 8, 0)
    this.ensurePdfSpace(document, totalHeight)

    document.fillColor('#243022').fontSize(14).text(title, left, top, { width });
    document.fillColor('#5d6d60').fontSize(9).text(subtitle, left, top + 18, { width });

    let rowTop = top + 40;
    for (const row of measuredRows) {
      document.roundedRect(left, rowTop, width, row.height, 10).fillAndStroke(fillColor, strokeColor);
      document.fillColor('#243022').fontSize(10).text(row.title, left + 12, rowTop + 10, {
        width: width - 120,
      });
      document.fillColor('#6f8566').fontSize(8).text(row.value, left + width - 96, rowTop + 12, {
        width: 84,
        align: 'right',
      });
      document.fillColor('#6d645c').fontSize(8.5).text(row.detail, left + 12, rowTop + 26, {
        width: width - 24,
      });
      rowTop += row.height + 8;
    }

    document.y = rowTop + 2;
  }

  private drawInsightTrendChartV2(
    document: any,
    rows: Record<string, unknown>[],
    width: number,
    title: string,
    subtitle: string,
  ) {
    if (rows.length === 0) {
      return;
    }

    const chartHeight = 228;
    this.ensurePdfSpace(document, chartHeight + 16);
    const left = document.page.margins.left;
    document.x = left;
    const top = document.y;
    const plotLeft = left + 44;
    const plotRight = left + width - 10;
    const plotTop = top + 46;
    const plotBottom = top + chartHeight - 42;
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

    document.fillColor('#243022').fontSize(14).text(title, left, top, { width });
    document.fillColor('#5d6d60').fontSize(10).text(subtitle, left, top + 18, { width });

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

    const drawSeries = (
      color: string,
      extractor: (row: Record<string, unknown>) => number,
    ) => {
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
      rows.forEach((row, index) => {
        const x = plotLeft + spacing * index;
        const y = plotBottom - (extractor(row) / maxValue) * plotHeight;
        document.fillColor(color).circle(x, y, 2.5).fill();
      });
    };

    drawSeries('#567454', (row) => Number(row.display_ordered_cases ?? row.ordered_cases ?? 0));
    drawSeries('#8da69b', (row) => Number(row.display_delivered_cases ?? row.delivered_cases ?? 0));
    drawSeries('#b6793f', (row) =>
      Number(
        row.display_estimated_retail_offtake_cases ??
          row.estimated_retail_offtake_cases ??
          0,
      ),
    );
    drawSeries('#7c88a6', (row) => Number(row.display_forecast_cases ?? row.forecast_cases ?? 0));

    const labelIndexes = [
      ...new Set([
        0,
        Math.floor((rows.length - 1) / 3),
        Math.floor(((rows.length - 1) * 2) / 3),
        rows.length - 1,
      ]),
    ];
    labelIndexes.forEach((index) => {
      const row = rows[index];
      const x = plotLeft + spacing * index;
      document.fillColor('#7a8772').fontSize(8).text(
        String(row.label ?? row.date ?? ''),
        x - 26,
        plotBottom + 6,
        {
          width: 52,
          align: 'center',
        },
      );
    });

    document.fillColor('#7a8772').fontSize(8).text('Cases', left, plotTop - 14, {
      width: 36,
      align: 'right',
    });
    document.fillColor('#7a8772').fontSize(8).text('Time window', plotLeft, plotBottom + 20, {
      width: plotWidth,
      align: 'center',
    });

    const legendY = plotBottom + 32;
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

  private drawGroupedBarChartV2(
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

    const chartHeight = 220;
    this.ensurePdfSpace(document, chartHeight + 16);
    const left = document.page.margins.left;
    document.x = left;
    const top = document.y;
    const plotLeft = left + 42;
    const plotRight = left + width - 10;
    const plotTop = top + 44;
    const plotBottom = top + chartHeight - 40;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    const maxValue = Math.max(
      1,
      ...rows.flatMap((row) => series.map((item) => Number(row[item.key] ?? 0))),
    );
    const groupWidth = plotWidth / rows.length;
    const barWidth = Math.max(8, Math.min(18, (groupWidth - 12) / series.length));

    document.fillColor('#243022').fontSize(14).text(title, left, top, { width });
    document.fillColor('#5d6d60').fontSize(10).text(subtitle, left, top + 18, { width });

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

    rows.forEach((row, rowIndex) => {
      const baseX = plotLeft + rowIndex * groupWidth + 6;
      series.forEach((item, seriesIndex) => {
        const value = Number(row[item.key] ?? 0);
        const barHeight = (value / maxValue) * plotHeight;
        const x = baseX + seriesIndex * (barWidth + 4);
        const y = plotBottom - barHeight;
        document.fillColor(item.color).rect(x, y, barWidth, barHeight).fill();
      });

      document.fillColor('#7a8772').fontSize(7).text(
        this.truncateLabelSafe(String(row[labelKey] ?? ''), 18),
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
    document.fillColor('#7a8772').fontSize(8).text('Cases', left, plotTop - 14, {
      width: 36,
      align: 'right',
    });

    document.y = top + chartHeight;
  }

  private drawHorizontalBarChartV2(
    document: any,
    rows: Record<string, unknown>[],
    width: number,
    title: string,
    subtitle: string,
    labelKey: string,
    valueKey: string,
    color: string,
    unitLabel = 'value',
  ) {
    if (rows.length === 0) {
      return;
    }

    const rowHeight = 22;
    const chartHeight = 60 + rows.length * rowHeight;
    this.ensurePdfSpace(document, chartHeight + 12);
    const left = document.page.margins.left;
    document.x = left;
    const top = document.y;
    const labelWidth = 175;
    const barLeft = left + labelWidth;
    const barRight = left + width - 48;
    const barWidth = barRight - barLeft;
    const maxValue = Math.max(1, ...rows.map((row) => Number(row[valueKey] ?? 0)));

    document.fillColor('#243022').fontSize(14).text(title, left, top, { width });
    document.fillColor('#5d6d60').fontSize(10).text(subtitle, left, top + 18, { width });
    document.fillColor('#7a8772').fontSize(8).text(unitLabel, barRight - 60, top + 34, {
      width: 54,
      align: 'right',
    });

    rows.forEach((row, index) => {
      const y = top + 48 + index * rowHeight;
      const value = Number(row[valueKey] ?? 0);
      const widthValue = (value / maxValue) * barWidth;
      document.fillColor('#687561').fontSize(8).text(
        this.truncateLabelSafe(String(row[labelKey] ?? ''), 30),
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

  private ensurePdfSpace(document: any, requiredHeight: number) {
    const bottom = document.page.height - document.page.margins.bottom;
    if (document.y + requiredHeight > bottom) {
      document.addPage();
    }
  }

  private sampleRows<T>(rows: T[], maxRows: number) {
    if (rows.length <= maxRows) {
      return rows;
    }
    const sampled: T[] = [];
    const seenIndexes = new Set<number>();
    for (let index = 0; index < maxRows; index += 1) {
      const sampleIndex = Math.round((index * (rows.length - 1)) / (maxRows - 1));
      if (!seenIndexes.has(sampleIndex)) {
        sampled.push(rows[sampleIndex]);
        seenIndexes.add(sampleIndex);
      }
    }
    return sampled;
  }

  private truncateLabelSafe(value: string, maxLength: number) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
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

  private ensureExplicitReportWindow(query: InsightCenterQuery) {
    if (!query.fromDate?.trim() || !query.toDate?.trim()) {
      throw new BadRequestException(
        'Select both from and to dates before generating the Insight Center report.',
      );
    }
  }

  private summarizeVisitAnswers(rows: Array<Record<string, unknown>>) {
    return rows
      .slice(0, 3)
      .map((row) => {
        const question = row.question?.toString().trim() ?? '';
        const answer = row.answer?.toString().trim() ?? '';
        return question && answer ? `${question}: ${answer}` : '';
      })
      .filter(Boolean)
      .join(' | ');
  }

  private inferDailyReportSeverity(text: string) {
    const normalized = text.toLowerCase();
    if (
      normalized.includes('critical') ||
      normalized.includes('urgent') ||
      normalized.includes('blocked')
    ) {
      return 'HIGH' as const;
    }
    if (
      normalized.includes('delay') ||
      normalized.includes('damage') ||
      normalized.includes('stock') ||
      normalized.includes('warehouse')
    ) {
      return 'MEDIUM' as const;
    }
    return 'LOW' as const;
  }

  private exceptionSeverityWeight(severity: 'LOW' | 'MEDIUM' | 'HIGH') {
    if (severity === 'HIGH') return 3;
    if (severity === 'MEDIUM') return 2;
    return 1;
  }

  private lookupWarehouseName(
    dataset: OperationalDataset,
    warehouseId: string | null,
  ) {
    if (!warehouseId) {
      return 'Unassigned';
    }
    return (
      dataset.warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ??
      'Unassigned'
    );
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
    if (period === '180d') return this.addDays(toDate, -179);
    if (period === '365d') return this.addDays(toDate, -364);
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
    visitRow: VisitRow,
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
      const productName =
        (productId ? productById.get(productId)?.productName : null) ??
        record.productName?.toString() ??
        'Unknown product';
      lossEvents.push({
        timestamp: observedAt,
        canonicalShopId,
        productId,
        productName,
        territoryId: visitRow.territoryId,
        territoryName: visitRow.territoryName,
        warehouseId: visitRow.warehouseId,
        warehouseName: visitRow.warehouseName,
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
      const productName =
        record.productNames && Array.isArray(record.productNames)
          ? String(record.productNames[0] ?? product?.productName ?? 'Unknown product')
          : product?.productName ?? 'Unknown product';
      const quantityCases = this.readNumber(record.quantityCases);
      const quantityUnits =
        this.readNumber(record.quantityUnits) ||
        quantityCases * (product?.productsPerCase ?? 1);

      lossEvents.push({
        timestamp: observedAt,
        canonicalShopId,
        productId,
        productName,
        territoryId: visitRow.territoryId,
        territoryName: visitRow.territoryName,
        warehouseId: visitRow.warehouseId,
        warehouseName: visitRow.warehouseName,
        lossType: 'DAMAGED',
        quantityUnits,
      });
    }
  }

  private addVisitOsaIssues(
    visit: StoreVisit,
    visitRow: VisitRow,
    productById: Map<string, Product>,
    warehouseName: string | null,
    rows: OsaIssueObservation[],
  ) {
    const issues = Array.isArray(visit.osaIssuesJson) ? visit.osaIssuesJson : [];

    for (const issue of issues) {
      const record = issue as unknown as Record<string, unknown>;
      const issueTag = record.tag?.toString().trim() || 'OSA_ISSUE';
      const notes = record.notes?.toString().trim() || '';
      const productIds = Array.isArray(record.productIds)
        ? record.productIds.map((value) => String(value))
        : [];
      const productNames = Array.isArray(record.productNames)
        ? record.productNames.map((value) => String(value))
        : [];

      if (productIds.length === 0 && productNames.length === 0) {
        rows.push({
          issueId: `${visit.id}:${issueTag}:${rows.length}`,
          observedDate: visitRow.visitDate,
          canonicalShopId: visitRow.canonicalShopId,
          shopName: visitRow.shopName,
          territoryId: visitRow.territoryId,
          territoryName: visitRow.territoryName,
          warehouseId: visitRow.warehouseId,
          warehouseName: warehouseName ?? 'Unassigned',
          productId: null,
          productName: null,
          issueTag,
          notes,
        });
        continue;
      }

      const rowCount = Math.max(productIds.length, productNames.length);
      for (let index = 0; index < rowCount; index += 1) {
        const productId = productIds[index] ?? null;
        const productName =
          productNames[index] ??
          (productId ? productById.get(productId)?.productName : null) ??
          null;
        rows.push({
          issueId: `${visit.id}:${issueTag}:${productId ?? productName ?? index}`,
          observedDate: visitRow.visitDate,
          canonicalShopId: visitRow.canonicalShopId,
          shopName: visitRow.shopName,
          territoryId: visitRow.territoryId,
          territoryName: visitRow.territoryName,
          warehouseId: visitRow.warehouseId,
          warehouseName: warehouseName ?? 'Unassigned',
          productId,
          productName,
          issueTag,
          notes,
        });
      }
    }
  }

  private addComplianceViolations(
    visitRow: VisitRow,
    rows: ComplianceObservation[],
  ) {
    if (visitRow.planogramOk === false) {
      rows.push({
        visitId: `${visitRow.visitId}:PLANOGRAM`,
        observedDate: visitRow.visitDate,
        canonicalShopId: visitRow.canonicalShopId,
        shopName: visitRow.shopName,
        territoryId: visitRow.territoryId,
        territoryName: visitRow.territoryName,
        warehouseId: visitRow.warehouseId,
        warehouseName: visitRow.warehouseName,
        violationType: 'PLANOGRAM',
      });
    }
    if (visitRow.posmOk === false) {
      rows.push({
        visitId: `${visitRow.visitId}:POSM`,
        observedDate: visitRow.visitDate,
        canonicalShopId: visitRow.canonicalShopId,
        shopName: visitRow.shopName,
        territoryId: visitRow.territoryId,
        territoryName: visitRow.territoryName,
        warehouseId: visitRow.warehouseId,
        warehouseName: visitRow.warehouseName,
        violationType: 'POSM',
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

  private buildShopFeedbackRows(
    orderFeedbacks: OrderFeedback[],
    feedbackSubmissions: FeedbackSubmission[],
    visitRows: VisitRow[],
    users: User[],
    orderInfos: Map<string, OrderInfo>,
    shopContext: ShopReferenceContext,
    filters: InsightFilters,
  ) {
    const usersById = new Map(users.map((user) => [user.id, user]));
    const rows: ShopFeedbackObservation[] = [];

    for (const feedback of orderFeedbacks) {
      const orderInfo = orderInfos.get(feedback.orderId);
      const shop = orderInfo
        ? shopContext.rowsByCanonicalId.get(orderInfo.canonicalShopId) ?? null
        : null;
      const owner = usersById.get(feedback.shopOwnerId);

      rows.push({
        feedbackId: feedback.id,
        feedbackDate: this.dateKey(feedback.createdAt),
        canonicalShopId: orderInfo?.canonicalShopId ?? null,
        shopName:
          shop?.name ??
          owner?.shopName?.trim() ??
          `${owner?.firstName ?? ''} ${owner?.lastName ?? ''}`.trim() ??
          'Unknown shop',
        territoryId: shop?.territoryId ?? feedback.territoryId ?? owner?.territoryId ?? null,
        territoryName:
          shop?.territoryName ?? owner?.territory?.name ?? 'Unassigned',
        warehouseId: shop?.warehouseId ?? owner?.warehouseId ?? null,
        warehouseName:
          shop?.warehouseName ?? owner?.warehouse?.name ?? owner?.warehouseName ?? 'Unassigned',
        rating: Number.isFinite(feedback.rating) ? Number(feedback.rating) : null,
        comment: feedback.comment?.trim() ?? '',
        sourceType: 'ORDER_FEEDBACK',
      });
    }

    for (const visit of visitRows) {
      const answerComment = this.summarizeVisitAnswers(visit.outletFeedbackAnswers);
      const comment = [visit.outletFeedback?.trim() ?? '', answerComment]
        .filter(Boolean)
        .join(' | ');
      if (!comment) {
        continue;
      }
      rows.push({
        feedbackId: `visit:${visit.visitId}`,
        feedbackDate: visit.visitDate,
        canonicalShopId: visit.canonicalShopId,
        shopName: visit.shopName,
        territoryId: visit.territoryId,
        territoryName: visit.territoryName ?? 'Unassigned',
        warehouseId: visit.warehouseId,
        warehouseName: visit.warehouseName ?? 'Unassigned',
        rating: null,
        comment,
        sourceType: 'VISIT_FEEDBACK',
      });
    }

    for (const feedback of feedbackSubmissions) {
      const user = usersById.get(feedback.userId);
      if (!user || user.role !== Role.SHOP_OWNER) {
        continue;
      }
      rows.push({
        feedbackId: feedback.id,
        feedbackDate: this.dateKey(feedback.createdAt),
        canonicalShopId: shopContext.canonicalByShopOwnerId.get(user.id)?.canonicalShopId ?? null,
        shopName:
          user.shopName?.trim() ||
          `${user.firstName} ${user.lastName}`.trim() ||
          user.username,
        territoryId: user.territoryId,
        territoryName: user.territory?.name ?? 'Unassigned',
        warehouseId: user.warehouseId,
        warehouseName: user.warehouse?.name ?? user.warehouseName ?? 'Unassigned',
        rating: null,
        comment: feedback.message?.trim() ?? '',
        sourceType: 'VISIT_FEEDBACK',
      });
    }

    return rows.filter(
      (row) =>
        this.isInRange(row.feedbackDate, filters) && this.matchesFilters(row, filters),
    );
  }

  private buildSalesRepIssueRows(
    incidents: SalesIncident[],
    dailyReports: DailyReport[],
    users: User[],
    shopContext: ShopReferenceContext,
    filters: InsightFilters,
  ) {
    const usersById = new Map(users.map((user) => [user.id, user]));
    const rows: SalesRepIssueObservation[] = [];

    for (const incident of incidents) {
      const salesRep = usersById.get(incident.salesRepId);
      const shop = incident.shopId
        ? shopContext.rowsByCanonicalId.get(
            shopContext.canonicalByOutletId.get(incident.shopId) ?? '',
          ) ?? null
        : null;

      rows.push({
        issueId: incident.id,
        issueDate: this.dateKey(incident.createdAt),
        salesRepId: incident.salesRepId,
        salesRepName:
          `${salesRep?.firstName ?? ''} ${salesRep?.lastName ?? ''}`.trim() ||
          salesRep?.username ||
          'Unknown sales rep',
        territoryId: shop?.territoryId ?? salesRep?.territoryId ?? null,
        territoryName: shop?.territoryName ?? salesRep?.territory?.name ?? 'Unassigned',
        warehouseId: shop?.warehouseId ?? salesRep?.warehouseId ?? null,
        warehouseName:
          shop?.warehouseName ??
          salesRep?.warehouse?.name ??
          salesRep?.warehouseName ??
          'Unassigned',
        issueType: incident.incidentType,
        severity: incident.severity,
        summary: incident.description?.trim() || incident.incidentType,
        sourceType: 'SALES_INCIDENT',
      });
    }

    for (const report of dailyReports) {
      const salesRep = usersById.get(report.salesRepId);
      const incidentCount = this.readNumber(
        (report.incidentSummaryJson as Record<string, unknown> | null)?.incidentCount,
      );
      const osaCount = this.readNumber(
        (report.osaSummaryJson as Record<string, unknown> | null)?.issueCount,
      );
      const summaryParts = [report.repComments?.trim() ?? ''];
      if (incidentCount > 0) {
        summaryParts.push(`${incidentCount} incident(s) logged`);
      }
      if (osaCount > 0) {
        summaryParts.push(`${osaCount} OSA issue(s) logged`);
      }
      const summary = summaryParts.filter(Boolean).join(' | ');
      if (!summary) {
        continue;
      }
      rows.push({
        issueId: report.id,
        issueDate: report.reportDate,
        salesRepId: report.salesRepId,
        salesRepName:
          `${salesRep?.firstName ?? ''} ${salesRep?.lastName ?? ''}`.trim() ||
          salesRep?.username ||
          'Unknown sales rep',
        territoryId: salesRep?.territoryId ?? null,
        territoryName: salesRep?.territory?.name ?? 'Unassigned',
        warehouseId: salesRep?.warehouseId ?? null,
        warehouseName:
          salesRep?.warehouse?.name ?? salesRep?.warehouseName ?? 'Unassigned',
        issueType: 'DAILY_REPORT_ISSUE',
        severity: this.inferDailyReportSeverity(report.repComments ?? ''),
        summary,
        sourceType: 'DAILY_REPORT',
      });
    }

    return rows.filter(
      (row) =>
        this.isInRange(row.issueDate, filters) && this.matchesFilters(row, filters),
    );
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
