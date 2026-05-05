import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { StoreVisit, StoreVisitStatus } from '../store-visits/entities/store-visit.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { toCsv, type CsvColumn } from '../exports/utils/csv.util';
import { createZip } from '../exports/utils/zip.util';

type ForecastEngineQuery = {
  fromDate?: string;
  toDate?: string;
  forecastDays?: string;
  backtestDays?: string;
};

type ForecastFilters = {
  fromDate: Date;
  toDate: Date;
  forecastDays: number;
  backtestDays: number;
  generatedAt: Date;
  exportDateKey: string;
};

type DemandType = 'REPLENISHMENT_DEMAND' | 'ESTIMATED_RETAIL_OFFTAKE';

type DailySignal = {
  signal_date: string;
  demand_type: DemandType;
  product_id: string;
  product_name: string;
  territory_id: string | null;
  warehouse_id: string | null;
  demand_cases: number;
  source_count: number;
  stockout_flag: boolean;
  visit_gap_days: number | null;
};

type ForecastOutputRow = {
  forecast_id: string;
  forecast_date: string;
  demand_type: DemandType;
  product_id: string;
  product_name: string;
  territory_id: string | null;
  warehouse_id: string | null;
  weighted_recent_demand_cases: number;
  seasonal_pattern_adjustment_cases: number;
  promotion_adjustment_cases: number;
  stockout_adjustment_cases: number;
  visit_frequency_adjustment_cases: number;
  incident_or_disruption_adjustment_cases: number;
  forecast_cases: number;
  confidence_score: number;
  confidence_level: string;
  model_version: string;
  explanation: string;
};

type AccuracyRow = {
  demand_type: DemandType;
  product_id: string;
  product_name: string;
  territory_id: string | null;
  warehouse_id: string | null;
  backtest_start_date: string;
  backtest_end_date: string;
  actual_cases: number;
  forecast_cases: number;
  absolute_error_cases: number;
  wape: number;
  mape: number;
  forecast_bias: number;
  tested_days: number;
};

type ExceptionRow = {
  exception_id: string;
  exception_date: string;
  demand_type: DemandType;
  product_id: string;
  product_name: string;
  territory_id: string | null;
  warehouse_id: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  exception_type: string;
  reason: string;
  recommended_action: string;
};

type ConfidenceRow = {
  forecast_id: string;
  forecast_date: string;
  demand_type: DemandType;
  product_id: string;
  product_name: string;
  data_completeness_score: number;
  visit_recency_score: number;
  count_quality_score: number;
  delivery_accuracy_score: number;
  uncertainty_penalty: number;
  confidence_score: number;
  confidence_level: string;
};

type AiExplanationRow = {
  explanation_id: string;
  source_type: string;
  source_id: string;
  signal_date: string;
  product_id: string | null;
  product_name: string | null;
  territory_id: string | null;
  extracted_signal: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence_score: number;
  forecast_adjustment_reason: string;
  business_explanation: string;
};

type ForecastResult = {
  summary: {
    generatedAt: string;
    forecastStartDate: string;
    forecastEndDate: string;
    historyStartDate: string;
    historyEndDate: string;
    forecastRows: number;
    exceptions: number;
    aiSignals: number;
    averageConfidenceScore: number;
    averageWape: number | null;
    modelVersion: string;
  };
  forecastOutput: ForecastOutputRow[];
  accuracyReport: AccuracyRow[];
  exceptions: ExceptionRow[];
  confidenceScores: ConfidenceRow[];
  aiExplanations: AiExplanationRow[];
};

const MODEL_VERSION = 'ARS-HYBRID-WMA-1.0';
const ACTIVE_PROMOTION_STATUSES = new Set(['active', 'scheduled']);
const ORDER_DEMAND_STATUSES = new Set([
  'PLACED',
  'APPROVED',
  'PROCEED',
  'COMPLETED',
  'PARTIAL',
  'DELAYED',
]);

@Injectable()
export class ForecastEngineService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityLogsRepo: Repository<ActivityLog>,
    @InjectRepository(DailyReport)
    private readonly dailyReportsRepo: Repository<DailyReport>,
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
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
    @InjectRepository(WarehouseInventoryItem)
    private readonly warehouseInventoryRepo: Repository<WarehouseInventoryItem>,
  ) {}

  async generateForecastPreview(query: ForecastEngineQuery) {
    const result = await this.buildForecastResult(query);

    return {
      summary: result.summary,
      forecastOutput: result.forecastOutput.slice(0, 60),
      accuracyReport: result.accuracyReport.slice(0, 40),
      exceptions: result.exceptions.slice(0, 50),
      confidenceScores: result.confidenceScores.slice(0, 60),
      aiExplanations: result.aiExplanations.slice(0, 40),
    };
  }

  async generateForecastReport(query: ForecastEngineQuery) {
    const result = await this.buildForecastResult(query);
    const modifiedAt = new Date(result.summary.generatedAt);
    const filename = `ars_demand_forecast_engine_${result.summary.generatedAt.slice(0, 10)}.zip`;

    const manifest = {
      export_name: filename,
      generated_at: result.summary.generatedAt,
      model_version: MODEL_VERSION,
      feature_pairing:
        'Consumes the same operational demand signals exposed by the ARS Demand Export and publishes forecast, confidence, exception, backtest, and explanation outputs.',
      files: {
        'manifest.json': 1,
        'forecast_output.csv': result.forecastOutput.length,
        'forecast_accuracy_report.csv': result.accuracyReport.length,
        'forecast_exceptions.csv': result.exceptions.length,
        'forecast_confidence_scores.csv': result.confidenceScores.length,
        'forecast_ai_explanations.csv': result.aiExplanations.length,
      },
    };

    const buffer = createZip([
      { name: 'manifest.json', data: JSON.stringify(manifest, null, 2), modifiedAt },
      { name: 'forecast_output.csv', data: toCsv(result.forecastOutput, this.forecastColumns()), modifiedAt },
      { name: 'forecast_accuracy_report.csv', data: toCsv(result.accuracyReport, this.accuracyColumns()), modifiedAt },
      { name: 'forecast_exceptions.csv', data: toCsv(result.exceptions, this.exceptionColumns()), modifiedAt },
      { name: 'forecast_confidence_scores.csv', data: toCsv(result.confidenceScores, this.confidenceColumns()), modifiedAt },
      { name: 'forecast_ai_explanations.csv', data: toCsv(result.aiExplanations, this.aiExplanationColumns()), modifiedAt },
    ]);

    return { filename, buffer };
  }

  private async buildForecastResult(query: ForecastEngineQuery): Promise<ForecastResult> {
    const filters = this.normalizeFilters(query);

    const [
      products,
      orders,
      visits,
      promotions,
      promotionProducts,
      promotionTerritories,
      incidents,
      dailyReports,
      activityLogs,
      inventoryItems,
    ] = await Promise.all([
      this.productsRepo.find({ order: { productName: 'ASC' } }),
      this.ordersRepo.find({
        relations: {
          territory: true,
          warehouse: true,
          items: { product: true },
        },
        order: { placedAt: 'ASC' },
      }),
      this.storeVisitsRepo.find({
        order: { visitStartedAt: 'ASC' },
      }),
      this.promotionsRepo.find({ order: { startDate: 'ASC' } }),
      this.promotionProductsRepo.find(),
      this.promotionTerritoriesRepo.find(),
      this.salesIncidentsRepo.find({ order: { createdAt: 'ASC' } }),
      this.dailyReportsRepo.find({ order: { reportDate: 'ASC' } }),
      this.activityLogsRepo.find({ order: { createdAt: 'ASC' } }),
      this.warehouseInventoryRepo.find({ relations: { product: true } }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const promotionProductsByPromotionId = this.groupByPromotionId(promotionProducts);
    const promotionTerritoriesByPromotionId = this.groupTerritoriesByPromotionId(
      promotionTerritories,
    );

    const signals = [
      ...this.buildReplenishmentSignals(orders, filters),
      ...this.buildRetailOfftakeSignals(visits, productById, filters),
    ];
    const aiExplanations = this.buildAiExplanations(
      incidents,
      dailyReports,
      activityLogs,
      productById,
      filters,
    );
    const incidentAdjustment = this.resolveIncidentAdjustment(aiExplanations);
    const stockoutBySeries = this.buildStockoutCounts(signals);
    const visitGapBySeries = this.buildVisitGapBySeries(signals);
    const promotionResolver = this.createPromotionResolver(
      promotions,
      promotionProductsByPromotionId,
      promotionTerritoriesByPromotionId,
    );

    const forecastOutput = this.buildForecastOutput({
      signals,
      productById,
      filters,
      stockoutBySeries,
      visitGapBySeries,
      promotionResolver,
      incidentAdjustment,
    });
    const confidenceScores = forecastOutput.map((row) =>
      this.buildConfidenceRow(row, signals, stockoutBySeries, visitGapBySeries),
    );
    const accuracyReport = this.buildAccuracyReport(
      signals,
      filters,
      productById,
      promotionResolver,
      stockoutBySeries,
      visitGapBySeries,
      incidentAdjustment,
    );
    const exceptions = this.buildExceptions(
      forecastOutput,
      confidenceScores,
      accuracyReport,
      inventoryItems,
      aiExplanations,
    );

    const averageConfidenceScore = this.average(
      forecastOutput.map((row) => row.confidence_score),
    );
    const wapeValues = accuracyReport
      .map((row) => row.wape)
      .filter((value) => Number.isFinite(value));
    const averageWape = wapeValues.length > 0 ? this.roundNumber(this.average(wapeValues)) : null;
    const forecastStartDate = this.dateKey(this.addDays(filters.toDate, 1));
    const forecastEndDate = this.dateKey(this.addDays(filters.toDate, filters.forecastDays));

    return {
      summary: {
        generatedAt: filters.generatedAt.toISOString(),
        forecastStartDate,
        forecastEndDate,
        historyStartDate: this.dateKey(filters.fromDate),
        historyEndDate: this.dateKey(filters.toDate),
        forecastRows: forecastOutput.length,
        exceptions: exceptions.length,
        aiSignals: aiExplanations.length,
        averageConfidenceScore: this.roundNumber(averageConfidenceScore),
        averageWape,
        modelVersion: MODEL_VERSION,
      },
      forecastOutput,
      accuracyReport,
      exceptions,
      confidenceScores,
      aiExplanations,
    };
  }

  private normalizeFilters(query: ForecastEngineQuery): ForecastFilters {
    const generatedAt = new Date();
    const toDate = query.toDate?.trim()
      ? this.parseDateOnly(query.toDate.trim(), 'toDate')
      : this.parseDateOnly(this.dateKey(generatedAt), 'toDate');
    const fromDate = query.fromDate?.trim()
      ? this.parseDateOnly(query.fromDate.trim(), 'fromDate')
      : this.addDays(toDate, -90);

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('fromDate cannot be after toDate.');
    }

    const forecastDays = this.parseBoundedInteger(
      query.forecastDays,
      30,
      1,
      180,
      'forecastDays',
    );
    const backtestDays = this.parseBoundedInteger(
      query.backtestDays,
      14,
      1,
      90,
      'backtestDays',
    );

    return {
      fromDate,
      toDate,
      forecastDays,
      backtestDays,
      generatedAt,
      exportDateKey: this.dateKey(generatedAt),
    };
  }

  private buildReplenishmentSignals(
    orders: Order[],
    filters: ForecastFilters,
  ): DailySignal[] {
    const grouped = new Map<string, DailySignal>();

    for (const order of orders) {
      if (!ORDER_DEMAND_STATUSES.has(order.status) || !this.isInRange(order.placedAt, filters)) {
        continue;
      }

      const signalDate = this.dateKey(order.placedAt);
      for (const item of order.items ?? []) {
        if (!item.productId) {
          continue;
        }
        const key = this.seriesDateKey(
          signalDate,
          'REPLENISHMENT_DEMAND',
          item.productId,
          order.territoryId,
          order.warehouseId,
        );
        const existing = grouped.get(key);
        if (existing) {
          existing.demand_cases = this.roundNumber(existing.demand_cases + Number(item.quantity ?? 0));
          existing.source_count += 1;
        } else {
          grouped.set(key, {
            signal_date: signalDate,
            demand_type: 'REPLENISHMENT_DEMAND',
            product_id: item.productId,
            product_name: item.productNameSnapshot,
            territory_id: order.territoryId,
            warehouse_id: order.warehouseId,
            demand_cases: Number(item.quantity ?? 0),
            source_count: 1,
            stockout_flag: false,
            visit_gap_days: null,
          });
        }
      }
    }

    return [...grouped.values()];
  }

  private buildRetailOfftakeSignals(
    visits: StoreVisit[],
    productById: Map<string, Product>,
    filters: ForecastFilters,
  ): DailySignal[] {
    const grouped = new Map<string, DailySignal>();
    const lastVisitByShop = new Map<string, Date>();

    for (const visit of visits) {
      if (visit.status !== StoreVisitStatus.COMPLETED) {
        continue;
      }

      const observedAt = visit.visitEndedAt ?? visit.visitStartedAt;
      if (!this.isInRange(observedAt, filters)) {
        continue;
      }

      const signalDate = this.dateKey(observedAt);
      const shopKey = visit.shopId ?? visit.shopNameSnapshot;
      const previousVisit = lastVisitByShop.get(shopKey) ?? null;
      const visitGapDays = previousVisit
        ? Math.max(1, Math.round((observedAt.getTime() - previousVisit.getTime()) / 86400000))
        : null;
      lastVisitByShop.set(shopKey, observedAt);

      for (const item of this.readVisitEstimatedSalesItems(visit)) {
        const product = productById.get(item.productId);
        const unitsPerCase = product?.productsPerCase && product.productsPerCase > 0
          ? product.productsPerCase
          : 1;
        const demandCases = item.estimatedSalesUnits / unitsPerCase;
        const key = this.seriesDateKey(
          signalDate,
          'ESTIMATED_RETAIL_OFFTAKE',
          item.productId,
          visit.territoryId,
          null,
        );
        const existing = grouped.get(key);
        if (existing) {
          existing.demand_cases = this.roundNumber(existing.demand_cases + demandCases);
          existing.source_count += 1;
          existing.stockout_flag = existing.stockout_flag || item.stockoutFlag;
          existing.visit_gap_days = Math.max(existing.visit_gap_days ?? 0, visitGapDays ?? 0) || null;
        } else {
          grouped.set(key, {
            signal_date: signalDate,
            demand_type: 'ESTIMATED_RETAIL_OFFTAKE',
            product_id: item.productId,
            product_name: item.productName || product?.productName || 'Unknown Product',
            territory_id: visit.territoryId,
            warehouse_id: null,
            demand_cases: this.roundNumber(demandCases),
            source_count: 1,
            stockout_flag: item.stockoutFlag,
            visit_gap_days: visitGapDays,
          });
        }
      }
    }

    return [...grouped.values()];
  }

  private readVisitEstimatedSalesItems(visit: StoreVisit) {
    const estimates = Array.isArray(visit.estimatedSellThroughJson)
      ? visit.estimatedSellThroughJson
      : [];
    const stockItems = Array.isArray(visit.shelfStockJson)
      ? visit.shelfStockJson
      : [];
    const stockoutByProduct = new Map<string, boolean>();

    for (const stockItem of stockItems) {
      const record = stockItem as unknown as Record<string, unknown>;
      const productId = record.productId?.toString() ?? '';
      if (!productId) {
        continue;
      }
      const currentStockUnits =
        this.readNumber(record.shelfCount) + this.readNumber(record.backroomCount);
      stockoutByProduct.set(
        productId,
        record.inStock === false || currentStockUnits <= 0,
      );
    }

    return estimates
      .map((item) => {
        const record = item as Record<string, unknown>;
        const productId = record.productId?.toString() ?? '';
        return {
          productId,
          productName: record.productName?.toString() ?? '',
          estimatedSalesUnits: Math.max(0, this.readNumber(record.estimatedSales)),
          stockoutFlag: stockoutByProduct.get(productId) ?? false,
        };
      })
      .filter((item) => item.productId && item.estimatedSalesUnits > 0);
  }

  private buildForecastOutput(params: {
    signals: DailySignal[];
    productById: Map<string, Product>;
    filters: ForecastFilters;
    stockoutBySeries: Map<string, number>;
    visitGapBySeries: Map<string, number>;
    promotionResolver: (dateKey: string, productId: string, territoryId: string | null) => boolean;
    incidentAdjustment: number;
  }) {
    const series = this.groupSignalsBySeries(params.signals);
    const forecastStart = this.addDays(params.filters.toDate, 1);
    const rows: ForecastOutputRow[] = [];

    for (const [seriesKey, signalRows] of series.entries()) {
      const [demandType, productId, territoryIdRaw, warehouseIdRaw] = seriesKey.split('|');
      const territoryId = territoryIdRaw === 'none' ? null : territoryIdRaw;
      const warehouseId = warehouseIdRaw === 'none' ? null : warehouseIdRaw;
      const product = params.productById.get(productId);

      for (let offset = 0; offset < params.filters.forecastDays; offset += 1) {
        const forecastDate = this.addDays(forecastStart, offset);
        const forecastDateKey = this.dateKey(forecastDate);
        const components = this.calculateForecastComponents(
          signalRows,
          forecastDate,
          params.promotionResolver,
          params.stockoutBySeries.get(seriesKey) ?? 0,
          params.visitGapBySeries.get(seriesKey) ?? 0,
          params.incidentAdjustment,
          productId,
          territoryId,
        );
        const confidence = this.calculateConfidence(
          demandType as DemandType,
          signalRows,
          params.stockoutBySeries.get(seriesKey) ?? 0,
          params.visitGapBySeries.get(seriesKey) ?? 0,
        );
        const forecastCases = this.roundNumber(
          Math.max(
            0,
            components.weightedRecentDemand +
              components.seasonalAdjustment +
              components.promotionAdjustment +
              components.stockoutAdjustment +
              components.visitFrequencyAdjustment +
              components.incidentAdjustment,
          ),
        );

        rows.push({
          forecast_id: `${seriesKey}|${forecastDateKey}`,
          forecast_date: forecastDateKey,
          demand_type: demandType as DemandType,
          product_id: productId,
          product_name: product?.productName ?? signalRows[0]?.product_name ?? 'Unknown Product',
          territory_id: territoryId,
          warehouse_id: warehouseId,
          weighted_recent_demand_cases: this.roundNumber(components.weightedRecentDemand),
          seasonal_pattern_adjustment_cases: this.roundNumber(components.seasonalAdjustment),
          promotion_adjustment_cases: this.roundNumber(components.promotionAdjustment),
          stockout_adjustment_cases: this.roundNumber(components.stockoutAdjustment),
          visit_frequency_adjustment_cases: this.roundNumber(components.visitFrequencyAdjustment),
          incident_or_disruption_adjustment_cases: this.roundNumber(components.incidentAdjustment),
          forecast_cases: forecastCases,
          confidence_score: confidence.score,
          confidence_level: confidence.level,
          model_version: MODEL_VERSION,
          explanation: this.buildForecastExplanation(
            demandType as DemandType,
            forecastCases,
            components,
            confidence.level,
          ),
        });
      }
    }

    return rows.sort((left, right) =>
      `${left.forecast_date}|${left.demand_type}|${left.product_name}`.localeCompare(
        `${right.forecast_date}|${right.demand_type}|${right.product_name}`,
      ),
    );
  }

  private calculateForecastComponents(
    signals: DailySignal[],
    forecastDate: Date,
    promotionResolver: (dateKey: string, productId: string, territoryId: string | null) => boolean,
    recentStockouts: number,
    visitGapDays: number,
    incidentAdjustmentFactor: number,
    productId: string,
    territoryId: string | null,
  ) {
    const historyEnd = this.addDays(forecastDate, -1);
    const lastSeven = this.valuesForLastDays(signals, historyEnd, 7);
    const lastTwentyEight = this.valuesForLastDays(signals, historyEnd, 28);
    const avg7 = this.average(lastSeven);
    const avg28 = this.average(lastTwentyEight);
    const weightedRecentDemand = avg7 * 0.6 + avg28 * 0.4;
    const weekdayAverage = this.average(
      signals
        .filter((signal) => new Date(`${signal.signal_date}T00:00:00.000Z`).getUTCDay() === forecastDate.getUTCDay())
        .slice(-8)
        .map((signal) => signal.demand_cases),
    );
    const seasonalAdjustment = this.clamp(
      (weekdayAverage - avg28) * 0.2,
      -weightedRecentDemand * 0.2,
      weightedRecentDemand * 0.2,
    );
    const promotionAdjustment = promotionResolver(this.dateKey(forecastDate), productId, territoryId)
      ? weightedRecentDemand * 0.15
      : 0;
    const stockoutAdjustment = weightedRecentDemand * Math.min(0.3, recentStockouts * 0.05);
    const visitFrequencyAdjustment =
      visitGapDays > 30
        ? -weightedRecentDemand * 0.08
        : visitGapDays > 14
          ? -weightedRecentDemand * 0.04
          : visitGapDays > 0
            ? weightedRecentDemand * 0.02
            : 0;
    const incidentAdjustment = weightedRecentDemand * incidentAdjustmentFactor;

    return {
      weightedRecentDemand,
      seasonalAdjustment,
      promotionAdjustment,
      stockoutAdjustment,
      visitFrequencyAdjustment,
      incidentAdjustment,
    };
  }

  private buildAccuracyReport(
    signals: DailySignal[],
    filters: ForecastFilters,
    productById: Map<string, Product>,
    promotionResolver: (dateKey: string, productId: string, territoryId: string | null) => boolean,
    stockoutBySeries: Map<string, number>,
    visitGapBySeries: Map<string, number>,
    incidentAdjustment: number,
  ): AccuracyRow[] {
    const series = this.groupSignalsBySeries(signals);
    const backtestStart = this.addDays(filters.toDate, -filters.backtestDays + 1);
    const results: AccuracyRow[] = [];

    for (const [seriesKey, signalRows] of series.entries()) {
      const [demandType, productId, territoryIdRaw, warehouseIdRaw] = seriesKey.split('|');
      const territoryId = territoryIdRaw === 'none' ? null : territoryIdRaw;
      const warehouseId = warehouseIdRaw === 'none' ? null : warehouseIdRaw;
      const actualByDate = new Map(signalRows.map((row) => [row.signal_date, row.demand_cases]));
      let actualTotal = 0;
      let forecastTotal = 0;
      let absoluteErrorTotal = 0;
      let percentageErrorTotal = 0;
      let percentageErrorDays = 0;
      let testedDays = 0;

      for (let offset = 0; offset < filters.backtestDays; offset += 1) {
        const testDate = this.addDays(backtestStart, offset);
        const testDateKey = this.dateKey(testDate);
        const trainingRows = signalRows.filter((row) => row.signal_date < testDateKey);
        if (trainingRows.length < 3) {
          continue;
        }
        const components = this.calculateForecastComponents(
          trainingRows,
          testDate,
          promotionResolver,
          stockoutBySeries.get(seriesKey) ?? 0,
          visitGapBySeries.get(seriesKey) ?? 0,
          incidentAdjustment,
          productId,
          territoryId,
        );
        const forecastCases = Math.max(
          0,
          components.weightedRecentDemand +
            components.seasonalAdjustment +
            components.promotionAdjustment +
            components.stockoutAdjustment +
            components.visitFrequencyAdjustment +
            components.incidentAdjustment,
        );
        const actualCases = actualByDate.get(testDateKey) ?? 0;
        const absoluteError = Math.abs(actualCases - forecastCases);
        actualTotal += actualCases;
        forecastTotal += forecastCases;
        absoluteErrorTotal += absoluteError;
        testedDays += 1;

        if (actualCases > 0) {
          percentageErrorTotal += absoluteError / actualCases;
          percentageErrorDays += 1;
        }
      }

      if (testedDays === 0) {
        continue;
      }

      const product = productById.get(productId);
      results.push({
        demand_type: demandType as DemandType,
        product_id: productId,
        product_name: product?.productName ?? signalRows[0]?.product_name ?? 'Unknown Product',
        territory_id: territoryId,
        warehouse_id: warehouseId,
        backtest_start_date: this.dateKey(backtestStart),
        backtest_end_date: this.dateKey(filters.toDate),
        actual_cases: this.roundNumber(actualTotal),
        forecast_cases: this.roundNumber(forecastTotal),
        absolute_error_cases: this.roundNumber(absoluteErrorTotal),
        wape: actualTotal > 0 ? this.roundNumber(absoluteErrorTotal / actualTotal) : 0,
        mape: percentageErrorDays > 0
          ? this.roundNumber(percentageErrorTotal / percentageErrorDays)
          : 0,
        forecast_bias: actualTotal > 0
          ? this.roundNumber((forecastTotal - actualTotal) / actualTotal)
          : 0,
        tested_days: testedDays,
      });
    }

    return results.sort((left, right) => right.absolute_error_cases - left.absolute_error_cases);
  }

  private buildExceptions(
    forecasts: ForecastOutputRow[],
    confidenceRows: ConfidenceRow[],
    accuracyRows: AccuracyRow[],
    inventoryItems: WarehouseInventoryItem[],
    aiRows: AiExplanationRow[],
  ) {
    const exceptions: ExceptionRow[] = [];
    const confidenceById = new Map(confidenceRows.map((row) => [row.forecast_id, row]));
    const accuracyBySeries = new Map(
      accuracyRows.map((row) => [
        this.seriesKey(row.demand_type, row.product_id, row.territory_id, row.warehouse_id),
        row,
      ]),
    );
    const inventoryByProductWarehouse = new Map(
      inventoryItems.map((item) => [`${item.productId}|${item.warehouseId}`, item]),
    );

    for (const forecast of forecasts) {
      const confidence = confidenceById.get(forecast.forecast_id);
      const accuracy = accuracyBySeries.get(
        this.seriesKey(forecast.demand_type, forecast.product_id, forecast.territory_id, forecast.warehouse_id),
      );

      if (forecast.confidence_score < 0.5) {
        exceptions.push(this.exceptionForForecast(forecast, 'HIGH', 'LOW_CONFIDENCE', 'Forecast confidence is below the Demand Planner review threshold.', 'Review stock-count quality, visit gaps, and recent movement before using this forecast for planning.'));
      } else if (forecast.confidence_score < 0.65) {
        exceptions.push(this.exceptionForForecast(forecast, 'MEDIUM', 'DIRECTIONAL_FORECAST_ONLY', 'Forecast is directionally useful but has incomplete or uncertain signals.', 'Use as a planning input with local demand context.'));
      }

      if (accuracy && accuracy.wape > 0.45) {
        exceptions.push(this.exceptionForForecast(forecast, 'HIGH', 'BACKTEST_ERROR_HIGH', 'Backtest WAPE is above 45%, so recent predictions have not matched actuals well.', 'Inspect recent promotions, missed stockouts, and unusual order timing.'));
      }

      if (forecast.warehouse_id) {
        const inventory = inventoryByProductWarehouse.get(`${forecast.product_id}|${forecast.warehouse_id}`);
        if (inventory && forecast.forecast_cases > inventory.quantityOnHand) {
          exceptions.push(this.exceptionForForecast(forecast, 'MEDIUM', 'WAREHOUSE_STOCK_RISK', 'Forecasted cases exceed current warehouse stock on hand.', 'Check replenishment or transfer options before approving the plan.'));
        }
      }

      if ((confidence?.uncertainty_penalty ?? 0) > 0.25) {
        exceptions.push(this.exceptionForForecast(forecast, 'MEDIUM', 'HIGH_UNCERTAINTY_PENALTY', 'Stockout, visit gap, or conflicting signal penalties are materially reducing confidence.', 'Confirm recent shelf counts and route execution notes.'));
      }
    }

    for (const aiRow of aiRows.filter((row) => row.severity !== 'LOW')) {
      exceptions.push({
        exception_id: `ai|${aiRow.explanation_id}`,
        exception_date: aiRow.signal_date,
        demand_type: 'ESTIMATED_RETAIL_OFFTAKE',
        product_id: aiRow.product_id ?? '',
        product_name: aiRow.product_name ?? 'Unmapped product',
        territory_id: aiRow.territory_id,
        warehouse_id: null,
        severity: aiRow.severity,
        exception_type: aiRow.extracted_signal,
        reason: aiRow.business_explanation,
        recommended_action: 'Review the field note and decide whether hidden demand or disruption should influence the plan.',
      });
    }

    return exceptions.slice(0, 500);
  }

  private exceptionForForecast(
    forecast: ForecastOutputRow,
    severity: 'LOW' | 'MEDIUM' | 'HIGH',
    exceptionType: string,
    reason: string,
    recommendedAction: string,
  ): ExceptionRow {
    return {
      exception_id: `${exceptionType}|${forecast.forecast_id}`,
      exception_date: forecast.forecast_date,
      demand_type: forecast.demand_type,
      product_id: forecast.product_id,
      product_name: forecast.product_name,
      territory_id: forecast.territory_id,
      warehouse_id: forecast.warehouse_id,
      severity,
      exception_type: exceptionType,
      reason,
      recommended_action: recommendedAction,
    };
  }

  private buildConfidenceRow(
    forecast: ForecastOutputRow,
    signals: DailySignal[],
    stockoutBySeries: Map<string, number>,
    visitGapBySeries: Map<string, number>,
  ): ConfidenceRow {
    const seriesSignals = signals.filter(
      (signal) =>
        signal.demand_type === forecast.demand_type &&
        signal.product_id === forecast.product_id &&
        signal.territory_id === forecast.territory_id &&
        signal.warehouse_id === forecast.warehouse_id,
    );
    const activeDays = new Set(seriesSignals.map((signal) => signal.signal_date)).size;
    const seriesKey = this.seriesKey(
      forecast.demand_type,
      forecast.product_id,
      forecast.territory_id,
      forecast.warehouse_id,
    );
    const stockoutCount = stockoutBySeries.get(seriesKey) ?? 0;
    const visitGap = visitGapBySeries.get(seriesKey) ?? 0;
    const dataCompletenessScore = this.roundNumber(Math.min(1, activeDays / 28));
    const visitRecencyScore = this.roundNumber(visitGap === 0 ? 0.7 : Math.max(0.2, 1 - visitGap / 45));
    const countQualityScore = forecast.demand_type === 'REPLENISHMENT_DEMAND'
      ? 0.9
      : this.roundNumber(Math.max(0.35, 1 - stockoutCount * 0.08));
    const deliveryAccuracyScore = forecast.demand_type === 'REPLENISHMENT_DEMAND' ? 0.85 : 0.65;
    const uncertaintyPenalty = this.roundNumber(
      Math.min(0.45, stockoutCount * 0.04 + (visitGap > 30 ? 0.18 : visitGap > 14 ? 0.08 : 0)),
    );

    return {
      forecast_id: forecast.forecast_id,
      forecast_date: forecast.forecast_date,
      demand_type: forecast.demand_type,
      product_id: forecast.product_id,
      product_name: forecast.product_name,
      data_completeness_score: dataCompletenessScore,
      visit_recency_score: visitRecencyScore,
      count_quality_score: countQualityScore,
      delivery_accuracy_score: deliveryAccuracyScore,
      uncertainty_penalty: uncertaintyPenalty,
      confidence_score: forecast.confidence_score,
      confidence_level: forecast.confidence_level,
    };
  }

  private calculateConfidence(
    demandType: DemandType,
    signals: DailySignal[],
    recentStockouts: number,
    visitGapDays: number,
  ) {
    const activeDays = new Set(signals.map((signal) => signal.signal_date)).size;
    let score = demandType === 'REPLENISHMENT_DEMAND' ? 0.62 : 0.48;
    score += Math.min(0.22, activeDays / 28 * 0.22);
    score += Math.min(0.12, signals.length / 20 * 0.12);

    if (demandType === 'ESTIMATED_RETAIL_OFFTAKE') {
      score += visitGapDays > 0 && visitGapDays <= 14 ? 0.08 : 0;
      score -= recentStockouts * 0.03;
      score -= visitGapDays > 30 ? 0.18 : visitGapDays > 14 ? 0.08 : 0;
    }

    const normalized = this.roundNumber(Math.max(0.05, Math.min(0.98, score)));
    return {
      score: normalized,
      level: normalized >= 0.8 ? 'HIGH' : normalized >= 0.6 ? 'MEDIUM' : 'LOW',
    };
  }

  private buildAiExplanations(
    incidents: SalesIncident[],
    dailyReports: DailyReport[],
    activityLogs: ActivityLog[],
    productById: Map<string, Product>,
    filters: ForecastFilters,
  ): AiExplanationRow[] {
    const rows: AiExplanationRow[] = [];
    const products = [...productById.values()];

    const addExplanation = (
      sourceType: string,
      sourceId: string,
      signalDate: string,
      text: string | null | undefined,
      territoryId: string | null,
    ) => {
      const normalized = text?.trim() ?? '';
      if (!normalized || !this.isInRange(signalDate, filters)) {
        return;
      }
      const extracted = this.extractAiSignal(normalized);
      if (!extracted) {
        return;
      }
      const product = this.findProductMention(normalized, products);
      rows.push({
        explanation_id: `${sourceType}|${sourceId}`,
        source_type: sourceType,
        source_id: sourceId,
        signal_date: signalDate,
        product_id: product?.id ?? null,
        product_name: product?.productName ?? null,
        territory_id: territoryId,
        extracted_signal: extracted.signal,
        severity: extracted.severity,
        confidence_score: extracted.confidence,
        forecast_adjustment_reason: extracted.reason,
        business_explanation: extracted.explanation,
      });
    };

    for (const incident of incidents) {
      addExplanation(
        'sales_incident',
        incident.id,
        this.dateKey(incident.createdAt),
        `${incident.incidentType} ${incident.severity} ${incident.description}`,
        null,
      );
    }

    for (const report of dailyReports) {
      addExplanation(
        'daily_report',
        report.id,
        report.reportDate,
        [
          report.repComments,
          JSON.stringify(report.incidentSummaryJson ?? {}),
          JSON.stringify(report.osaSummaryJson ?? {}),
          JSON.stringify(report.deliverySummaryJson ?? {}),
        ].join(' '),
        null,
      );
    }

    for (const activity of activityLogs) {
      addExplanation(
        'activity_log',
        activity.id,
        this.dateKey(activity.createdAt),
        `${activity.title} ${activity.message} ${JSON.stringify(activity.metadata ?? {})}`,
        null,
      );
    }

    return rows.sort((left, right) => right.confidence_score - left.confidence_score);
  }

  private extractAiSignal(text: string) {
    const normalized = text.toLowerCase();
    const hasStockout =
      normalized.includes('out of stock') ||
      normalized.includes('stockout') ||
      normalized.includes('oos') ||
      normalized.includes('unavailable');
    const hasCompetitor =
      normalized.includes('competitor') ||
      normalized.includes('substitute') ||
      normalized.includes('switch');
    const hasDelay =
      normalized.includes('delay') ||
      normalized.includes('late') ||
      normalized.includes('vehicle') ||
      normalized.includes('warehouse issue');
    const hasPromotion =
      normalized.includes('promotion') ||
      normalized.includes('discount') ||
      normalized.includes('offer');

    if (hasStockout && hasCompetitor) {
      return {
        signal: 'stockout_hidden_demand',
        severity: 'HIGH' as const,
        confidence: 0.86,
        reason: 'stockout_hidden_demand',
        explanation:
          'Field text suggests stockout pressure with possible competitor substitution, so observed demand may understate true consumer demand.',
      };
    }

    if (hasStockout) {
      return {
        signal: 'stockout_risk',
        severity: 'MEDIUM' as const,
        confidence: 0.76,
        reason: 'stockout_uncertainty',
        explanation:
          'Field text mentions a stockout or unavailable product, which can suppress observed sales and reduce forecast confidence.',
      };
    }

    if (hasDelay) {
      return {
        signal: 'delivery_or_route_disruption',
        severity: 'MEDIUM' as const,
        confidence: 0.72,
        reason: 'incident_or_disruption_adjustment',
        explanation:
          'Field text points to a delivery, route, vehicle, or warehouse disruption that may distort recent demand signals.',
      };
    }

    if (hasPromotion) {
      return {
        signal: 'promotion_demand_shift',
        severity: 'LOW' as const,
        confidence: 0.66,
        reason: 'promotion_adjustment',
        explanation:
          'Field text references a promotion or offer, so the forecast should treat the period as campaign-influenced.',
      };
    }

    return null;
  }

  private resolveIncidentAdjustment(rows: AiExplanationRow[]) {
    const highSeverityCount = rows.filter((row) => row.severity === 'HIGH').length;
    const mediumSeverityCount = rows.filter((row) => row.severity === 'MEDIUM').length;
    return Math.min(0.18, highSeverityCount * 0.04 + mediumSeverityCount * 0.02);
  }

  private findProductMention(text: string, products: Product[]) {
    const normalized = text.toLowerCase();
    return products.find((product) => {
      const productName = product.productName.toLowerCase();
      const sku = product.sku.toLowerCase();
      return normalized.includes(productName) || normalized.includes(sku);
    });
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
        const territoryLinks = promotionTerritoriesByPromotionId.get(promotion.id) ?? [];
        const productEligible =
          productLinks.length === 0 ||
          productLinks.some((link) => link.productId === productId);
        const territoryEligible =
          territoryLinks.length === 0 ||
          territoryLinks.some((link) => link.territoryId === territoryId);
        return productEligible && territoryEligible;
      });
  }

  private buildStockoutCounts(signals: DailySignal[]) {
    const counts = new Map<string, number>();
    for (const signal of signals) {
      if (!signal.stockout_flag) {
        continue;
      }
      const key = this.seriesKey(
        signal.demand_type,
        signal.product_id,
        signal.territory_id,
        signal.warehouse_id,
      );
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private buildVisitGapBySeries(signals: DailySignal[]) {
    const gaps = new Map<string, number>();
    for (const signal of signals) {
      if (!signal.visit_gap_days) {
        continue;
      }
      const key = this.seriesKey(
        signal.demand_type,
        signal.product_id,
        signal.territory_id,
        signal.warehouse_id,
      );
      gaps.set(key, Math.max(gaps.get(key) ?? 0, signal.visit_gap_days));
    }
    return gaps;
  }

  private groupSignalsBySeries(signals: DailySignal[]) {
    const grouped = new Map<string, DailySignal[]>();
    for (const signal of signals) {
      const key = this.seriesKey(
        signal.demand_type,
        signal.product_id,
        signal.territory_id,
        signal.warehouse_id,
      );
      const existing = grouped.get(key) ?? [];
      existing.push(signal);
      grouped.set(
        key,
        existing.sort((left, right) => left.signal_date.localeCompare(right.signal_date)),
      );
    }
    return grouped;
  }

  private buildForecastExplanation(
    demandType: DemandType,
    forecastCases: number,
    components: ReturnType<ForecastEngineService['calculateForecastComponents']>,
    confidenceLevel: string,
  ) {
    const drivers: string[] = [];
    if (components.promotionAdjustment > 0) {
      drivers.push('promotion uplift');
    }
    if (components.stockoutAdjustment > 0) {
      drivers.push('hidden demand from stockouts');
    }
    if (components.incidentAdjustment > 0) {
      drivers.push('field disruption signals');
    }
    if (components.visitFrequencyAdjustment < 0) {
      drivers.push('sparse visit cadence');
    }

    const demandLabel =
      demandType === 'REPLENISHMENT_DEMAND'
        ? 'replenishment demand'
        : 'estimated retail offtake';
    const driverText = drivers.length > 0 ? drivers.join(', ') : 'recent demand history';
    return `${this.roundNumber(forecastCases)} cases forecast for ${demandLabel}, driven by ${driverText}. Confidence is ${confidenceLevel.toLowerCase()}.`;
  }

  private valuesForLastDays(signals: DailySignal[], endDate: Date, days: number) {
    const byDate = new Map(signals.map((signal) => [signal.signal_date, signal.demand_cases]));
    const values: number[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      values.push(byDate.get(this.dateKey(this.addDays(endDate, -offset))) ?? 0);
    }
    return values;
  }

  private groupByPromotionId(records: PromotionProduct[]) {
    const grouped = new Map<string, PromotionProduct[]>();
    for (const record of records) {
      const existing = grouped.get(record.promotionId) ?? [];
      existing.push(record);
      grouped.set(record.promotionId, existing);
    }
    return grouped;
  }

  private groupTerritoriesByPromotionId(records: PromotionTerritory[]) {
    const grouped = new Map<string, PromotionTerritory[]>();
    for (const record of records) {
      const existing = grouped.get(record.promotionId) ?? [];
      existing.push(record);
      grouped.set(record.promotionId, existing);
    }
    return grouped;
  }

  private seriesDateKey(
    signalDate: string,
    demandType: DemandType,
    productId: string,
    territoryId: string | null,
    warehouseId: string | null,
  ) {
    return `${signalDate}|${this.seriesKey(demandType, productId, territoryId, warehouseId)}`;
  }

  private seriesKey(
    demandType: string,
    productId: string,
    territoryId: string | null,
    warehouseId: string | null,
  ) {
    return `${demandType}|${productId}|${territoryId ?? 'none'}|${warehouseId ?? 'none'}`;
  }

  private parseBoundedInteger(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
    fieldName: string,
  ) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(`${fieldName} must be an integer between ${min} and ${max}.`);
    }
    return parsed;
  }

  private parseDateOnly(value: string, fieldName: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${fieldName} must use YYYY-MM-DD format.`);
    }
    return new Date(`${value}T00:00:00.000Z`);
  }

  private isInRange(value: Date | string | null | undefined, filters: ForecastFilters) {
    if (!value) {
      return false;
    }
    const date = value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00.000Z`)
        : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    const toTime = this.addDays(filters.toDate, 1).getTime() - 1;
    return date.getTime() >= filters.fromDate.getTime() && date.getTime() <= toTime;
  }

  private dateKey(value: Date | string | null | undefined) {
    if (!value) {
      return '';
    }
    const date = value instanceof Date
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

  private readNumber(value: unknown) {
    const numericValue = Number(value ?? 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  private roundNumber(value: number) {
    return Number(value.toFixed(4));
  }

  private average(values: number[]) {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private columnsForKeys<T extends Record<string, unknown>>(keys: string[]) {
    return keys.map((key) => ({ key, header: key })) as CsvColumn<T>[];
  }

  private forecastColumns() {
    return this.columnsForKeys<ForecastOutputRow>([
      'forecast_id',
      'forecast_date',
      'demand_type',
      'product_id',
      'product_name',
      'territory_id',
      'warehouse_id',
      'weighted_recent_demand_cases',
      'seasonal_pattern_adjustment_cases',
      'promotion_adjustment_cases',
      'stockout_adjustment_cases',
      'visit_frequency_adjustment_cases',
      'incident_or_disruption_adjustment_cases',
      'forecast_cases',
      'confidence_score',
      'confidence_level',
      'model_version',
      'explanation',
    ]);
  }

  private accuracyColumns() {
    return this.columnsForKeys<AccuracyRow>([
      'demand_type',
      'product_id',
      'product_name',
      'territory_id',
      'warehouse_id',
      'backtest_start_date',
      'backtest_end_date',
      'actual_cases',
      'forecast_cases',
      'absolute_error_cases',
      'wape',
      'mape',
      'forecast_bias',
      'tested_days',
    ]);
  }

  private exceptionColumns() {
    return this.columnsForKeys<ExceptionRow>([
      'exception_id',
      'exception_date',
      'demand_type',
      'product_id',
      'product_name',
      'territory_id',
      'warehouse_id',
      'severity',
      'exception_type',
      'reason',
      'recommended_action',
    ]);
  }

  private confidenceColumns() {
    return this.columnsForKeys<ConfidenceRow>([
      'forecast_id',
      'forecast_date',
      'demand_type',
      'product_id',
      'product_name',
      'data_completeness_score',
      'visit_recency_score',
      'count_quality_score',
      'delivery_accuracy_score',
      'uncertainty_penalty',
      'confidence_score',
      'confidence_level',
    ]);
  }

  private aiExplanationColumns() {
    return this.columnsForKeys<AiExplanationRow>([
      'explanation_id',
      'source_type',
      'source_id',
      'signal_date',
      'product_id',
      'product_name',
      'territory_id',
      'extracted_signal',
      'severity',
      'confidence_score',
      'forecast_adjustment_reason',
      'business_explanation',
    ]);
  }
}
