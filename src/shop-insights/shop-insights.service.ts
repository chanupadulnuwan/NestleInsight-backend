import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { Order } from '../orders/entities/order.entity';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const INSIGHT_PERIODS = [
  { key: '30d', label: '30D', days: 30, rangeLabel: 'Last 30 days' },
  { key: '90d', label: '90D', days: 90, rangeLabel: 'Last 90 days' },
  { key: '180d', label: '6M', days: 180, rangeLabel: 'Last 6 months' },
  { key: '365d', label: '12M', days: 365, rangeLabel: 'Last 12 months' },
] as const;

type PeriodConfig = (typeof INSIGHT_PERIODS)[number];
type TrendDirection = 'up' | 'down' | 'steady' | 'new';
type MovementType = 'fast' | 'steady' | 'slow';
type UrgencyLevel = 'high' | 'medium' | 'low' | 'none';
type RiskLevel = 'high' | 'medium' | 'none';

interface MonthBucket {
  key: string;
  label: string;
  shortLabel: string;
  revenue: number;
  cases: number;
}

interface ProductEvent {
  placedAt: Date;
  quantity: number;
  revenue: number;
}

interface ProductAggregate {
  productName: string;
  totalCases: number;
  totalRevenue: number;
  lastOrderDate: Date;
  lastOrderCases: number;
  monthMap: Map<string, { cases: number; revenue: number }>;
  events: ProductEvent[];
}

interface ProductMonthlyPoint {
  key: string;
  label: string;
  cases: number;
  revenue: number;
}

interface PeriodProduct {
  productName: string;
  totalCases: number;
  totalRevenue: number;
  sellOutCasesPerMonth: number;
  lastOrderDate: string;
  previousCases: number;
  changePercent: number;
  trendDirection: TrendDirection;
  movementType: MovementType;
  reorderUrgency: UrgencyLevel;
  reorderSuggestedCases: number;
  reorderReason: string;
  stockRiskLevel: RiskLevel;
  stockRiskReason: string;
  daysSinceLastOrder: number;
  lastOrderCases: number;
  monthlyPoints: ProductMonthlyPoint[];
}

interface PeriodRecommendation {
  productName: string;
  reason: string;
  trendDirection: TrendDirection;
  totalCases: number;
  totalRevenue: number;
}

interface ReorderSuggestion {
  productName: string;
  urgency: UrgencyLevel;
  suggestedCases: number;
  reason: string;
  lastOrderDate: string;
}

interface StockRiskAlert {
  productName: string;
  severity: RiskLevel;
  message: string;
  lastOrderDate: string;
  totalCases: number;
}

interface SeasonalInsight {
  title: string;
  message: string;
  emphasis: 'high' | 'watch' | 'steady';
}

interface PeriodInsight {
  key: string;
  label: string;
  rangeLabel: string;
  metrics: {
    totalRevenue: number;
    totalCases: number;
    totalOrders: number;
    activeProducts: number;
    averageOrderValue: number;
    growthRate: number;
  };
  summary: {
    headline: string;
    body: string;
    highlights: string[];
  };
  products: PeriodProduct[];
  recommendations: PeriodRecommendation[];
  fastMoving: PeriodProduct[];
  slowMoving: PeriodProduct[];
  reorderSuggestions: ReorderSuggestion[];
  stockRiskAlerts: StockRiskAlert[];
  seasonalInsights: SeasonalInsight[];
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function subtractDays(value: Date, days: number): Date {
  const clone = new Date(value);
  clone.setDate(clone.getDate() - days);
  return clone;
}

function formatMonthKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}`;
}

function buildMonthBuckets(now: Date, totalMonths: number): MonthBucket[] {
  return Array.from({ length: totalMonths }, (_, index) => {
    const offset = totalMonths - 1 - index;
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const shortLabel = MONTH_NAMES[date.getMonth()];
    return {
      key: formatMonthKey(date),
      label: `${shortLabel} ${date.getFullYear()}`,
      shortLabel,
      revenue: 0,
      cases: 0,
    };
  });
}

function roundRevenue(value: number): number {
  return Math.round(value);
}

function formatCurrency(value: number): string {
  return `LKR ${roundRevenue(value).toLocaleString('en-US')}`;
}

function formatIsoDate(value: Date): string {
  return value.toISOString().split('T')[0];
}

function normalizeProductName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Unnamed product';
}

function calculateChangePercent(current: number, previous: number): number {
  if (current <= 0 && previous <= 0) {
    return 0;
  }

  if (previous <= 0) {
    return 100;
  }

  return Math.round(((current - previous) / previous) * 100);
}

function classifyTrend(
  currentCases: number,
  previousCases: number,
  changePercent: number,
): TrendDirection {
  if (currentCases > 0 && previousCases <= 0) {
    return 'new';
  }

  if (changePercent >= 20) {
    return 'up';
  }

  if (changePercent <= -20) {
    return 'down';
  }

  return 'steady';
}

function daysBetween(now: Date, value: Date): number {
  const diff = startOfDay(now).getTime() - startOfDay(value).getTime();
  return Math.max(0, Math.floor(diff / DAY_MS));
}

function totalsForRange(
  events: ProductEvent[],
  start: Date,
  end: Date,
  includeEnd = true,
): { cases: number; revenue: number } {
  return events.reduce(
    (totals, event) => {
      const placedAtMs = event.placedAt.getTime();
      const endCheck = includeEnd
        ? placedAtMs <= end.getTime()
        : placedAtMs < end.getTime();

      if (placedAtMs < start.getTime() || !endCheck) {
        return totals;
      }

      return {
        cases: totals.cases + event.quantity,
        revenue: totals.revenue + event.revenue,
      };
    },
    { cases: 0, revenue: 0 },
  );
}

function compareUrgency(left: UrgencyLevel, right: UrgencyLevel): number {
  const score: Record<UrgencyLevel, number> = {
    high: 3,
    medium: 2,
    low: 1,
    none: 0,
  };
  return score[right] - score[left];
}

function compareRisk(left: RiskLevel, right: RiskLevel): number {
  const score: Record<RiskLevel, number> = {
    high: 3,
    medium: 2,
    none: 0,
  };
  return score[right] - score[left];
}

function recommendationReason(product: PeriodProduct): string {
  switch (product.trendDirection) {
    case 'new':
      return `${product.productName} started moving in this period with ${product.totalCases} cases sold.`;
    case 'up':
      return `${product.productName} is up ${product.changePercent}% versus the previous period.`;
    case 'down':
      return `${product.productName} is still selling, but demand dropped ${Math.abs(product.changePercent)}% from the previous period.`;
    case 'steady':
    default:
      return `${product.productName} is a steady seller at about ${product.sellOutCasesPerMonth} cases per month.`;
  }
}

@Injectable()
export class ShopInsightsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {}

  async getMyInsights(userId: string) {
    const now = new Date();

    if (!userId) {
      return this.buildEmptyResponse(now);
    }

    const lookbackStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const orders = await this.orderRepo.find({
      where: { userId, placedAt: MoreThanOrEqual(lookbackStart) },
      relations: ['items'],
    });

    const monthBuckets = buildMonthBuckets(now, 12);
    const monthMap = new Map(
      monthBuckets.map((bucket) => [bucket.key, bucket]),
    );
    const productMap = new Map<string, ProductAggregate>();

    for (const order of orders) {
      const placedAt = new Date(order.placedAt);
      const monthKey = formatMonthKey(placedAt);
      const monthBucket = monthMap.get(monthKey);
      const orderCases = order.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );

      if (monthBucket) {
        monthBucket.revenue += roundRevenue(order.totalAmount);
        monthBucket.cases += orderCases;
      }

      for (const item of order.items) {
        const productName = normalizeProductName(item.productNameSnapshot);
        const entry = productMap.get(productName) ?? {
          productName,
          totalCases: 0,
          totalRevenue: 0,
          lastOrderDate: placedAt,
          lastOrderCases: item.quantity,
          monthMap: new Map<string, { cases: number; revenue: number }>(),
          events: [],
        };

        entry.totalCases += item.quantity;
        entry.totalRevenue += item.lineTotal;
        entry.events.push({
          placedAt,
          quantity: item.quantity,
          revenue: item.lineTotal,
        });

        if (placedAt.getTime() >= entry.lastOrderDate.getTime()) {
          entry.lastOrderDate = placedAt;
          entry.lastOrderCases = item.quantity;
        }

        const bucketTotals = entry.monthMap.get(monthKey) ?? {
          cases: 0,
          revenue: 0,
        };
        bucketTotals.cases += item.quantity;
        bucketTotals.revenue += item.lineTotal;
        entry.monthMap.set(monthKey, bucketTotals);

        productMap.set(productName, entry);
      }
    }

    const periods = INSIGHT_PERIODS.map((period) =>
      this.buildPeriodInsight(period, now, orders, monthBuckets, productMap),
    );

    const defaultPeriod =
      periods.find((period) => period.key === '180d') ?? periods[0];
    const sixMonthBuckets = monthBuckets.slice(-6);
    const averageMonthlyRevenue = roundRevenue(
      sixMonthBuckets.reduce((sum, bucket) => sum + bucket.revenue, 0) / 6,
    );

    return {
      monthlySales: sixMonthBuckets.map((bucket) => ({
        month: bucket.shortLabel,
        actual: roundRevenue(bucket.revenue),
        estimated: averageMonthlyRevenue,
      })),
      topProducts: defaultPeriod.products.slice(0, 5).map((product) => ({
        productName: product.productName,
        totalCases: product.totalCases,
        totalRevenue: product.totalRevenue,
        sellOutCasesPerMonth: product.sellOutCasesPerMonth,
        lastOrderDate: product.lastOrderDate,
      })),
      availablePeriods: INSIGHT_PERIODS.map(({ key, label, rangeLabel }) => ({
        key,
        label,
        rangeLabel,
      })),
      periods,
      generatedAt: now.toISOString(),
    };
  }

  private buildEmptyResponse(now: Date) {
    return {
      monthlySales: [] as Array<{
        month: string;
        actual: number;
        estimated: number;
      }>,
      topProducts: [] as Array<{
        productName: string;
        totalCases: number;
        totalRevenue: number;
        sellOutCasesPerMonth: number;
        lastOrderDate: string;
      }>,
      availablePeriods: INSIGHT_PERIODS.map(({ key, label, rangeLabel }) => ({
        key,
        label,
        rangeLabel,
      })),
      periods: INSIGHT_PERIODS.map((period) => this.emptyPeriod(period)),
      generatedAt: now.toISOString(),
    };
  }

  private emptyPeriod(period: PeriodConfig): PeriodInsight {
    return {
      key: period.key,
      label: period.label,
      rangeLabel: period.rangeLabel,
      metrics: {
        totalRevenue: 0,
        totalCases: 0,
        totalOrders: 0,
        activeProducts: 0,
        averageOrderValue: 0,
        growthRate: 0,
      },
      summary: {
        headline: 'No sales recorded yet',
        body: 'Once this shop starts placing orders, the insight cards, trending products, and stock recommendations will appear here.',
        highlights: [],
      },
      products: [],
      recommendations: [],
      fastMoving: [],
      slowMoving: [],
      reorderSuggestions: [],
      stockRiskAlerts: [],
      seasonalInsights: [],
    };
  }

  private buildPeriodInsight(
    period: PeriodConfig,
    now: Date,
    orders: Order[],
    monthBuckets: MonthBucket[],
    productMap: Map<string, ProductAggregate>,
  ): PeriodInsight {
    const currentStart = subtractDays(startOfDay(now), period.days - 1);
    const previousStart = subtractDays(currentStart, period.days);

    const currentOrders = orders.filter((order) => {
      const placedAt = new Date(order.placedAt);
      return (
        placedAt.getTime() >= currentStart.getTime() &&
        placedAt.getTime() <= now.getTime()
      );
    });

    const previousOrders = orders.filter((order) => {
      const placedAt = new Date(order.placedAt);
      return (
        placedAt.getTime() >= previousStart.getTime() &&
        placedAt.getTime() < currentStart.getTime()
      );
    });

    const totalRevenue = roundRevenue(
      currentOrders.reduce((sum, order) => sum + order.totalAmount, 0),
    );
    const previousRevenue = roundRevenue(
      previousOrders.reduce((sum, order) => sum + order.totalAmount, 0),
    );
    const totalCases = currentOrders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    );
    const averageOrderValue = currentOrders.length
      ? roundRevenue(totalRevenue / currentOrders.length)
      : 0;
    const growthRate = calculateChangePercent(totalRevenue, previousRevenue);
    const periodMonths = Math.max(1, period.days / 30);

    const baseProducts: PeriodProduct[] = [];

    for (const entry of productMap.values()) {
      const currentTotals = totalsForRange(entry.events, currentStart, now);
      if (currentTotals.cases <= 0) {
        continue;
      }

      const previousTotals = totalsForRange(
        entry.events,
        previousStart,
        currentStart,
        false,
      );
      const changePercent = calculateChangePercent(
        currentTotals.cases,
        previousTotals.cases,
      );

      const monthlyPoints: ProductMonthlyPoint[] = monthBuckets.map(
        (bucket) => {
          const totals = entry.monthMap.get(bucket.key) ?? {
            cases: 0,
            revenue: 0,
          };
          return {
            key: bucket.key,
            label: bucket.shortLabel,
            cases: totals.cases,
            revenue: roundRevenue(totals.revenue),
          };
        },
      );

      baseProducts.push({
        productName: entry.productName,
        totalCases: currentTotals.cases,
        totalRevenue: roundRevenue(currentTotals.revenue),
        sellOutCasesPerMonth: Math.max(
          1,
          Math.round(currentTotals.cases / periodMonths),
        ),
        lastOrderDate: formatIsoDate(entry.lastOrderDate),
        previousCases: previousTotals.cases,
        changePercent,
        trendDirection: classifyTrend(
          currentTotals.cases,
          previousTotals.cases,
          changePercent,
        ),
        movementType: 'steady',
        reorderUrgency: 'none',
        reorderSuggestedCases: 0,
        reorderReason: '',
        stockRiskLevel: 'none',
        stockRiskReason: '',
        daysSinceLastOrder: daysBetween(now, entry.lastOrderDate),
        lastOrderCases: entry.lastOrderCases,
        monthlyPoints,
      });
    }

    baseProducts.sort((left, right) => {
      if (right.totalCases !== left.totalCases) {
        return right.totalCases - left.totalCases;
      }
      if (right.totalRevenue !== left.totalRevenue) {
        return right.totalRevenue - left.totalRevenue;
      }
      return left.productName.localeCompare(right.productName);
    });

    if (baseProducts.length === 0) {
      return {
        ...this.emptyPeriod(period),
        summary: {
          headline: 'No sales recorded yet',
          body: `No orders were recorded for ${period.rangeLabel.toLowerCase()}, so there is no product trend to analyze yet.`,
          highlights: [],
        },
      };
    }

    const velocityRanked = [...baseProducts].sort((left, right) => {
      if (right.sellOutCasesPerMonth !== left.sellOutCasesPerMonth) {
        return right.sellOutCasesPerMonth - left.sellOutCasesPerMonth;
      }
      return right.totalCases - left.totalCases;
    });

    const fastCount =
      velocityRanked.length >= 3
        ? Math.max(1, Math.ceil(velocityRanked.length * 0.3))
        : 1;
    const slowCount =
      velocityRanked.length >= 4
        ? Math.max(1, Math.ceil(velocityRanked.length * 0.3))
        : velocityRanked.length > 1
          ? 1
          : 0;

    const fastNames = new Set(
      velocityRanked.slice(0, fastCount).map((product) => product.productName),
    );
    const slowNames = new Set(
      velocityRanked
        .slice(Math.max(0, velocityRanked.length - slowCount))
        .map((product) => product.productName)
        .filter((name) => !fastNames.has(name)),
    );

    const strongestCurrentCases = baseProducts[0]?.totalCases ?? 0;

    const products = baseProducts.map((product) => {
      const movementType: MovementType = fastNames.has(product.productName)
        ? 'fast'
        : slowNames.has(product.productName)
          ? 'slow'
          : 'steady';

      const averageDailyCases = product.totalCases / period.days;
      const estimatedCoverageDays =
        averageDailyCases > 0 ? product.lastOrderCases / averageDailyCases : 0;
      const isFrequentlySold =
        movementType === 'fast' ||
        product.totalCases >=
          Math.max(3, Math.round(strongestCurrentCases * 0.6));

      let stockRiskLevel: RiskLevel = 'none';
      let stockRiskReason = '';

      if (
        isFrequentlySold &&
        estimatedCoverageDays > 0 &&
        product.daysSinceLastOrder >=
          Math.max(7, Math.round(estimatedCoverageDays * 0.85))
      ) {
        stockRiskLevel = 'high';
        stockRiskReason =
          'Demand is moving faster than the last order likely covers, so this item could run short soon.';
      } else if (
        isFrequentlySold &&
        estimatedCoverageDays > 0 &&
        product.daysSinceLastOrder >=
          Math.max(5, Math.round(estimatedCoverageDays * 0.6))
      ) {
        stockRiskLevel = 'medium';
        stockRiskReason =
          'Sales are healthy and the last replenishment window is getting tight.';
      } else if (
        (product.trendDirection === 'up' || product.trendDirection === 'new') &&
        product.daysSinceLastOrder >= 14 &&
        product.totalCases >= 3
      ) {
        stockRiskLevel = 'medium';
        stockRiskReason =
          'Recent demand improved, but this product has not been reordered recently.';
      }

      const shouldSuggestReorder =
        stockRiskLevel !== 'none' ||
        movementType === 'fast' ||
        product.trendDirection === 'up' ||
        product.trendDirection === 'new';

      let reorderUrgency: UrgencyLevel = 'none';
      if (stockRiskLevel === 'high') {
        reorderUrgency = 'high';
      } else if (
        stockRiskLevel === 'medium' ||
        product.trendDirection === 'up' ||
        product.trendDirection === 'new'
      ) {
        reorderUrgency = 'medium';
      } else if (shouldSuggestReorder) {
        reorderUrgency = 'low';
      }

      const coverageDays =
        reorderUrgency === 'high' ? 28 : reorderUrgency === 'medium' ? 21 : 14;
      const reorderSuggestedCases = shouldSuggestReorder
        ? Math.max(1, Math.round(averageDailyCases * coverageDays))
        : 0;
      const reorderReason = shouldSuggestReorder
        ? `Based on the current run rate of about ${product.sellOutCasesPerMonth} cases per month, the next replenishment should cover the coming ${Math.round(coverageDays / 7)} weeks.`
        : '';

      return {
        ...product,
        movementType,
        reorderUrgency,
        reorderSuggestedCases,
        reorderReason,
        stockRiskLevel,
        stockRiskReason,
      };
    });

    const recommendations = [...products]
      .sort((left, right) => {
        const leftScore =
          left.totalCases * 4 +
          Math.max(left.changePercent, 0) +
          (left.movementType === 'fast' ? 15 : 0) +
          (left.trendDirection === 'new' ? 10 : 0);
        const rightScore =
          right.totalCases * 4 +
          Math.max(right.changePercent, 0) +
          (right.movementType === 'fast' ? 15 : 0) +
          (right.trendDirection === 'new' ? 10 : 0);
        return rightScore - leftScore;
      })
      .slice(0, 3)
      .map((product) => ({
        productName: product.productName,
        reason: recommendationReason(product),
        trendDirection: product.trendDirection,
        totalCases: product.totalCases,
        totalRevenue: product.totalRevenue,
      }));

    const fastMoving = products
      .filter((product) => product.movementType === 'fast')
      .slice(0, 3);
    const slowMoving = products
      .filter((product) => product.movementType === 'slow')
      .slice(0, 3);

    const reorderSuggestions = [...products]
      .filter((product) => product.reorderUrgency !== 'none')
      .sort((left, right) => {
        const urgencyComparison = compareUrgency(
          left.reorderUrgency,
          right.reorderUrgency,
        );
        if (urgencyComparison !== 0) {
          return urgencyComparison;
        }
        return right.totalCases - left.totalCases;
      })
      .slice(0, 3)
      .map((product) => ({
        productName: product.productName,
        urgency: product.reorderUrgency,
        suggestedCases: product.reorderSuggestedCases,
        reason: product.reorderReason,
        lastOrderDate: product.lastOrderDate,
      }));

    const stockRiskAlerts = [...products]
      .filter((product) => product.stockRiskLevel !== 'none')
      .sort((left, right) => {
        const riskComparison = compareRisk(
          left.stockRiskLevel,
          right.stockRiskLevel,
        );
        if (riskComparison !== 0) {
          return riskComparison;
        }
        return right.totalCases - left.totalCases;
      })
      .slice(0, 3)
      .map((product) => ({
        productName: product.productName,
        severity: product.stockRiskLevel,
        message: product.stockRiskReason,
        lastOrderDate: product.lastOrderDate,
        totalCases: product.totalCases,
      }));

    const seasonalInsights = this.buildSeasonalInsights(
      monthBuckets,
      products,
      growthRate,
    );

    const leadProduct = products[0];
    const leadAlert = stockRiskAlerts[0];

    return {
      key: period.key,
      label: period.label,
      rangeLabel: period.rangeLabel,
      metrics: {
        totalRevenue,
        totalCases,
        totalOrders: currentOrders.length,
        activeProducts: products.length,
        averageOrderValue,
        growthRate,
      },
      summary: {
        headline:
          growthRate >= 20
            ? 'Demand is building quickly'
            : growthRate <= -20
              ? 'Demand needs attention'
              : 'Sales are holding steady',
        body: `${period.rangeLabel} generated ${formatCurrency(totalRevenue)} from ${totalCases} cases across ${products.length} active products. ${leadProduct.productName} leads the mix with ${leadProduct.totalCases} cases. ${leadAlert ? `Watch ${leadAlert.productName}: ${leadAlert.message}` : 'No immediate stock pressure was detected among your fastest-moving items.'}`,
        highlights: [
          `${leadProduct.productName} is the top seller for this period.`,
          ...recommendations.slice(0, 1).map((item) => item.reason),
          ...(leadAlert
            ? [`${leadAlert.productName} needs a stock check soon.`]
            : []),
        ],
      },
      products,
      recommendations,
      fastMoving,
      slowMoving,
      reorderSuggestions,
      stockRiskAlerts,
      seasonalInsights,
    };
  }

  private buildSeasonalInsights(
    monthBuckets: MonthBucket[],
    products: PeriodProduct[],
    growthRate: number,
  ): SeasonalInsight[] {
    const insights: SeasonalInsight[] = [];
    const activeMonths = monthBuckets.filter((bucket) => bucket.cases > 0);

    if (activeMonths.length > 0) {
      const peakMonth = activeMonths.reduce((best, bucket) =>
        bucket.revenue > best.revenue ? bucket : best,
      );
      const quietMonth = activeMonths.reduce((best, bucket) =>
        bucket.cases < best.cases ? bucket : best,
      );

      insights.push({
        title: 'Peak demand month',
        message: `${peakMonth.label} was strongest with ${peakMonth.cases} cases and ${formatCurrency(peakMonth.revenue)} in sales.`,
        emphasis: 'high',
      });

      if (quietMonth.key !== peakMonth.key) {
        insights.push({
          title: 'Lighter stocking window',
          message: `${quietMonth.label} moved only ${quietMonth.cases} cases, so it is a softer period for heavier replenishment.`,
          emphasis: 'steady',
        });
      }
    }

    const spikyProduct = [...products].sort((left, right) => {
      const leftPeak = left.monthlyPoints.reduce(
        (best, point) => (point.cases > best ? point.cases : best),
        0,
      );
      const rightPeak = right.monthlyPoints.reduce(
        (best, point) => (point.cases > best ? point.cases : best),
        0,
      );
      return rightPeak - leftPeak;
    })[0];

    if (spikyProduct) {
      const peakPoint = spikyProduct.monthlyPoints.reduce((best, point) =>
        point.cases > best.cases ? point : best,
      );

      if (peakPoint.cases > Math.max(1, spikyProduct.sellOutCasesPerMonth)) {
        insights.push({
          title: `${spikyProduct.productName} seasonal spike`,
          message: `${spikyProduct.productName} peaked in ${peakPoint.label} with ${peakPoint.cases} cases, higher than its usual monthly run rate.`,
          emphasis: growthRate >= 15 ? 'high' : 'watch',
        });
      }
    }

    return insights.slice(0, 3);
  }
}
