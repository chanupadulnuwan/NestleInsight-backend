import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { Order } from '../orders/entities/order.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import {
  SalesRoute,
  SalesRouteStatus,
} from '../sales-routes/entities/sales-route.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { DailyReport, DailyReportStatus } from './entities/daily-report.entity';
import { GenerateReportDto } from './dto/generate-report.dto';
import { UpdateReportDraftDto } from './dto/update-report-draft.dto';

@Injectable()
export class DailyReportsService {
  constructor(
    @InjectRepository(DailyReport)
    private readonly reportsRepo: Repository<DailyReport>,
    @InjectRepository(SalesRoute)
    private readonly salesRoutesRepo: Repository<SalesRoute>,
    @InjectRepository(StoreVisit)
    private readonly storeVisitsRepo: Repository<StoreVisit>,
    @InjectRepository(SalesIncident)
    private readonly salesIncidentsRepo: Repository<SalesIncident>,
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    private readonly activityService: ActivityService,
  ) {}

  async generateReport(
    userId: string,
    dto: GenerateReportDto,
  ): Promise<DailyReport> {
    const route = await this.requireOwnedRoute(userId, dto.routeId);
    if (route.status !== SalesRouteStatus.CLOSED) {
      throw new BadRequestException(
        'Close the route before generating the daily report.',
      );
    }

    const existingReport = await this.reportsRepo.findOne({
      where: { salesRepId: userId, routeId: dto.routeId },
      order: { createdAt: 'DESC' },
    });

    if (existingReport?.status === DailyReportStatus.SUBMITTED) {
      return existingReport;
    }

    const summaries = await this.buildReportSummaries(userId, route);
    const reportDate =
      route.closedAt?.toISOString().split('T')[0] ??
      new Date().toISOString().split('T')[0];

    const report = existingReport
      ? this.reportsRepo.merge(existingReport, {
          reportDate,
          status: DailyReportStatus.DRAFT,
          submittedAt: null,
          ...summaries,
        })
      : this.reportsRepo.create({
          routeId: dto.routeId,
          salesRepId: userId,
          reportDate,
          status: DailyReportStatus.DRAFT,
          submittedAt: null,
          repComments: null,
          ...summaries,
        } as Partial<DailyReport>);

    const savedReport = await this.reportsRepo.save(report);

    await this.activityService.logForUser({
      userId,
      type: 'DAILY_REPORT_DRAFT_GENERATED',
      title: 'Daily report draft ready',
      message: `Daily report draft prepared for ${savedReport.reportDate}.`,
      metadata: {
        reportId: savedReport.id,
        reportDate: savedReport.reportDate,
        status: savedReport.status,
      },
    });

    return savedReport;
  }

  async getMyReports(salesRepId: string): Promise<DailyReport[]> {
    return this.reportsRepo.find({
      where: { salesRepId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }

  async getMyReport(
    salesRepId: string,
    reportId: string,
  ): Promise<DailyReport> {
    const report = await this.reportsRepo.findOne({
      where: { id: reportId, salesRepId },
    });

    if (!report) {
      throw new NotFoundException('Daily report not found.');
    }

    return report;
  }

  async updateDraft(
    salesRepId: string,
    reportId: string,
    dto: UpdateReportDraftDto,
  ): Promise<DailyReport> {
    const report = await this.getMyReport(salesRepId, reportId);

    if (report.status !== DailyReportStatus.DRAFT) {
      throw new BadRequestException('Only draft reports can be updated.');
    }

    report.repComments = dto.repComments?.trim() || null;
    const savedReport = await this.reportsRepo.save(report);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'DAILY_REPORT_DRAFT_UPDATED',
      title: 'Daily report draft updated',
      message: `Daily report draft for ${savedReport.reportDate} was updated.`,
      metadata: {
        reportId: savedReport.id,
        status: savedReport.status,
      },
    });

    return savedReport;
  }

  async submitReport(
    salesRepId: string,
    reportId: string,
  ): Promise<DailyReport> {
    const report = await this.getMyReport(salesRepId, reportId);

    if (report.status === DailyReportStatus.SUBMITTED) {
      return report;
    }

    report.status = DailyReportStatus.SUBMITTED;
    report.submittedAt = new Date();
    const savedReport = await this.reportsRepo.save(report);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'DAILY_REPORT_SUBMITTED',
      title: 'Daily Report Submitted',
      message: `Daily report submitted for ${savedReport.reportDate}`,
      metadata: {
        reportId: savedReport.id,
        reportDate: savedReport.reportDate,
        status: savedReport.status,
      },
    });

    return savedReport;
  }

  async getReports(
    territoryId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DailyReport[]> {
    const query = this.reportsRepo
      .createQueryBuilder('report')
      .leftJoin('report.route', 'route');

    if (territoryId) {
      query.andWhere('route.territory_id = :territoryId', { territoryId });
    }

    if (startDate) {
      query.andWhere('report.reportDate >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('report.reportDate <= :endDate', { endDate });
    }

    return query.orderBy('report.reportDate', 'DESC').getMany();
  }

  private async requireOwnedRoute(salesRepId: string, routeId: string) {
    const route = await this.salesRoutesRepo.findOne({
      where: { id: routeId, salesRepId },
    });

    if (!route) {
      throw new NotFoundException('Sales route not found.');
    }

    return route;
  }

  private async buildReportSummaries(salesRepId: string, route: SalesRoute) {
    const [visits, incidents, salesRepOrders] = await Promise.all([
      this.storeVisitsRepo.find({
        where: { salesRepId, routeId: route.id },
        order: { createdAt: 'ASC' },
      }),
      this.salesIncidentsRepo.find({
        where: { salesRepId, routeId: route.id },
        order: { createdAt: 'ASC' },
      }),
      this.ordersRepo
        .createQueryBuilder('salesOrder')
        .where('salesOrder.customerNote LIKE :routeMarker', {
          routeMarker: `%Route: ${route.id}%`,
        })
        .orderBy('salesOrder.placedAt', 'ASC')
        .getMany(),
    ]);

    const routeOrders = salesRepOrders;
    const completedVisits = visits.filter(
      (visit) => visit.status === 'COMPLETED',
    );
    const routeReturnItems = Array.isArray(route.returnItemsJson)
      ? route.returnItemsJson
      : [];
    const normalizedReturnItems = routeReturnItems.map((item) =>
      this.normalizeReturnItem(item),
    );
    const totalReturnedCases = routeReturnItems.reduce<number>(
      (sum, item) =>
        sum + Number((item as Record<string, unknown>).quantityCases ?? 0),
      0,
    );
    const totalReturnedUnits = normalizedReturnItems.reduce<number>(
      (sum, item) => sum + item.quantityUnits,
      0,
    );
    const totalVisitDurationSeconds = completedVisits.reduce<number>(
      (sum, visit) => sum + (visit.durationSeconds ?? 0),
      0,
    );
    const routeDurationSeconds = route.startedAt
      ? Math.max(
          0,
          Math.floor(
            ((route.closedAt ?? new Date()).getTime() -
              route.startedAt.getTime()) /
              1000,
          ),
        )
      : 0;
    const visitsWithOsaNotes = completedVisits.filter((visit) =>
      this.hasVisitOsaData(visit.osaIssuesJson),
    );
    const osaIssueCount = completedVisits.reduce<number>(
      (sum, visit) => sum + this.countVisitOsaEntries(visit.osaIssuesJson),
      0,
    );
    const visitsWithFeedback = completedVisits.filter(
      (visit) => !!visit.outletFeedback?.trim(),
    );
    const visitRows = visits.map((visit) =>
      this.serializeVisitForReport(visit),
    );
    const osaIssueRows = completedVisits.flatMap((visit) =>
      this.serializeVisitIssues(visit),
    );
    const incidentRows = incidents.map((incident) => ({
      incidentId: incident.id,
      type: incident.incidentType,
      incidentType: incident.incidentType,
      severity: incident.severity,
      description: incident.description,
      shopId: incident.shopId,
      orderId: incident.orderId,
      createdAt: incident.createdAt.toISOString(),
      time: incident.createdAt.toISOString(),
    }));
    const incidentsBySeverity = this.countBy(
      incidents,
      (incident) => incident.severity,
    );
    const incidentsByType = this.countBy(
      incidents,
      (incident) => incident.incidentType,
    );

    return {
      routeSummaryJson: {
        routeId: route.id,
        status: route.status,
        territoryId: route.territoryId,
        warehouseId: route.warehouseId,
        vehicleId: route.vehicleId,
        startedAt: route.startedAt?.toISOString() ?? null,
        closedAt: route.closedAt?.toISOString() ?? null,
        totalRouteDurationSeconds: routeDurationSeconds,
        totalRouteDurationMinutes: Math.round(routeDurationSeconds / 60),
        fieldDurationMinutes: Math.round(routeDurationSeconds / 60),
        openingStockLines: Array.isArray(route.openingStockJson)
          ? route.openingStockJson.length
          : 0,
        openingStockLineCount: Array.isArray(route.openingStockJson)
          ? route.openingStockJson.length
          : 0,
        openingStockCases: this.sumCases(route.openingStockJson),
        closingStockLines: Array.isArray(route.closingStockJson)
          ? route.closingStockJson.length
          : 0,
        closingStockLineCount: Array.isArray(route.closingStockJson)
          ? route.closingStockJson.length
          : 0,
        closingStockCases: this.sumCases(route.closingStockJson),
        varianceLineCount: Array.isArray(route.varianceJson)
          ? route.varianceJson.length
          : 0,
        hasVariance: Array.isArray(route.varianceJson)
          ? route.varianceJson.length > 0
          : false,
        returnLineCount: routeReturnItems.length,
        totalReturnedCases,
        totalReturnedUnits,
      },
      visitSummaryJson: {
        totalVisits: visits.length,
        completedVisits: completedVisits.length,
        inProgressVisits: visits.length - completedVisits.length,
        totalVisitDurationSeconds,
        totalVisitDurationMinutes: Math.round(totalVisitDurationSeconds / 60),
        totalDurationMinutes: Math.round(totalVisitDurationSeconds / 60),
        photoCount: visits.reduce(
          (sum, visit) => sum + (visit.photoUrls?.length ?? 0),
          0,
        ),
        feedbackCount: visitsWithFeedback.length,
        outlets: visitRows,
        visitedShops: visitRows,
      },
      osaSummaryJson: {
        visitsWithPlanogramOk: completedVisits.filter(
          (visit) => visit.planogramOk === true,
        ).length,
        visitsWithPosmOk: completedVisits.filter(
          (visit) => visit.posmOk === true,
        ).length,
        visitsWithOsaNotes: visitsWithOsaNotes.length,
        totalOsaIssueEntries: osaIssueCount,
        issueCount: osaIssueRows.length,
        outletCountWithIssues: visitsWithOsaNotes.length,
        issues: osaIssueRows,
        visitsWithFeedback: visitsWithFeedback.length,
        feedbackCount: visitsWithFeedback.length,
        feedbackSamples: visitsWithFeedback.slice(0, 5).map((visit) => ({
          outletName: visit.shopNameSnapshot,
          shopName: visit.shopNameSnapshot,
          feedback: visit.outletFeedback,
        })),
      },
      deliverySummaryJson: {
        assistedOrderCount: routeOrders.length,
        totalOrderValue: Number(
          routeOrders
            .reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0)
            .toFixed(2),
        ),
        orderCodes: routeOrders.map((order) => order.orderCode),
        orders: routeOrders.map((order) => ({
          orderId: order.id,
          orderCode: order.orderCode,
          status: order.status,
          totalAmount: Number(order.totalAmount ?? 0),
          placedAt: order.placedAt?.toISOString?.() ?? order.placedAt,
        })),
      },
      returnSummaryJson: {
        returnLineCount: routeReturnItems.length,
        totalReturnedCases,
        totalReturnedUnits,
        totalReturnedProducts: totalReturnedUnits,
        items: normalizedReturnItems,
      },
      incidentSummaryJson: {
        incidentCount: incidents.length,
        incidentsBySeverity,
        incidentsByType,
        bySeverity: incidentsBySeverity,
        byType: incidentsByType,
        incidents: incidentRows,
      },
    };
  }

  private hasVisitOsaData(value: unknown) {
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }

    return false;
  }

  private countVisitOsaEntries(value: unknown) {
    if (Array.isArray(value)) {
      return value.length;
    }

    if (value && typeof value === 'object') {
      return 1;
    }

    return 0;
  }

  private serializeVisitForReport(visit: StoreVisit) {
    const startedAt = visit.visitStartTime ?? visit.visitStartedAt;
    const endedAt = visit.visitEndTime ?? visit.visitEndedAt;

    return {
      visitId: visit.id,
      shopId: visit.shopId,
      outletId: visit.shopId,
      shopName: visit.shopNameSnapshot,
      outletName: visit.shopNameSnapshot,
      territoryId: visit.territoryId,
      status: visit.status,
      startedAt: startedAt?.toISOString?.() ?? null,
      endedAt: endedAt?.toISOString?.() ?? null,
      visitStartedAt: visit.visitStartedAt?.toISOString?.() ?? null,
      visitEndedAt: visit.visitEndedAt?.toISOString?.() ?? null,
      durationSeconds: visit.durationSeconds ?? 0,
      durationMinutes: visit.durationMinutes ?? 0,
      hasPendingDelivery: visit.hasPendingDelivery,
      planogramOk: visit.planogramOk,
      posmOk: visit.posmOk,
      outletFeedback: visit.outletFeedback,
      competitorNotes: visit.competitorNotes,
      lastOrderDate: visit.lastOrderDateSnapshot?.toISOString?.() ?? null,
      shelfStock: visit.shelfStockJson ?? [],
      backroomStock: visit.backroomStockJson ?? [],
      osaIssues: visit.osaIssuesJson ?? [],
      promotions: visit.promotionsJson ?? [],
      expiryItems: visit.expiryItemsJson ?? [],
      planogramAnswers: visit.planogramAnswersJson ?? [],
      outletFeedbackAnswers: visit.outletFeedbackAnswersJson ?? [],
      estimatedSellThrough: visit.estimatedSellThroughJson ?? [],
      suggestedOrder: visit.suggestedOrderJson ?? null,
      photoUrls: visit.photoUrls ?? [],
      photoCount: visit.photoUrls?.length ?? 0,
    };
  }

  private serializeVisitIssues(visit: StoreVisit) {
    const rawIssues = Array.isArray(visit.osaIssuesJson)
      ? visit.osaIssuesJson
      : [];

    return rawIssues.map((issue) => {
      const record = issue as unknown as Record<string, unknown>;
      return {
        visitId: visit.id,
        shopId: visit.shopId,
        shopName: visit.shopNameSnapshot,
        outletName: visit.shopNameSnapshot,
        productId: record.productId ?? null,
        productName: record.productName ?? record.name ?? null,
        issueType: record.issueType ?? record.type ?? 'OSA_ISSUE',
        note: record.notes ?? record.note ?? '',
        feedback: record.notes ?? record.note ?? '',
      };
    });
  }

  private normalizeReturnItem(item: unknown) {
    const record = item as Record<string, unknown>;
    const notes = record.notes?.toString() ?? null;
    const legacyUnits = this.readLegacyUnitQuantity(notes);
    const rawCases = Number(record.quantityCases ?? 0);
    const rawUnits = Number(record.quantityUnits ?? 0);
    const quantityCases = legacyUnits !== null ? 0 : rawCases;
    const quantityUnits = rawUnits > 0 ? rawUnits : (legacyUnits ?? 0);

    return {
      productId: record.productId ?? null,
      productName: record.productName ?? 'Returned item',
      quantityCases,
      quantityUnits,
      unitType:
        record.unitType ??
        (quantityUnits > 0 && quantityCases === 0 ? 'UNIT' : 'CASE'),
      reason: record.reason ?? 'RETURNED',
      notes,
      loggedAt: record.loggedAt ?? null,
    };
  }

  private readLegacyUnitQuantity(notes: string | null) {
    if (!notes) {
      return null;
    }

    const match = notes.match(/Entered as product units:\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  private sumCases(lines: unknown) {
    if (!Array.isArray(lines)) {
      return 0;
    }

    return lines.reduce<number>((sum, line) => {
      const record = line as Record<string, unknown>;
      return sum + Number(record.quantityCases ?? 0);
    }, 0);
  }

  private countBy<T>(items: T[], selector: (item: T) => string) {
    return items.reduce<Record<string, number>>((acc, item) => {
      const key = selector(item);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }
}
