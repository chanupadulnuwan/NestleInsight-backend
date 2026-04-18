import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import {
  AssistedOrderRequest,
  AssistedOrderRequestStatus,
} from '../orders/entities/assisted-order-request.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { SalesRoute, SalesRouteStatus } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit, StoreVisitStatus } from '../store-visits/entities/store-visit.entity';
import { DailyReport, DailyReportStatus } from './entities/daily-report.entity';
import { GenerateReportDto } from './dto/generate-report.dto';
import { UpdateReportDraftDto } from './dto/update-report-draft.dto';

@Injectable()
export class DailyReportsService {
  constructor(
    @InjectRepository(DailyReport)
    private readonly reportsRepo: Repository<DailyReport>,
    @InjectRepository(SalesRoute)
    private readonly routesRepo: Repository<SalesRoute>,
    @InjectRepository(StoreVisit)
    private readonly visitsRepo: Repository<StoreVisit>,
    @InjectRepository(SalesIncident)
    private readonly incidentsRepo: Repository<SalesIncident>,
    @InjectRepository(AssistedOrderRequest)
    private readonly assistedOrdersRepo: Repository<AssistedOrderRequest>,
    private readonly activityService: ActivityService,
  ) {}

  async generateReport(
    userId: string,
    dto: GenerateReportDto,
  ): Promise<DailyReport> {
    const route = await this.routesRepo.findOne({
      where: { id: dto.routeId, salesRepId: userId },
    });

    if (!route) {
      throw new NotFoundException('Sales route not found.');
    }

    if (route.status !== SalesRouteStatus.CLOSED) {
      throw new BadRequestException(
        'Daily reports can only be generated after the route is closed.',
      );
    }

    const reportDate = this.resolveReportDate(route);
    const [visits, incidents, assistedOrders] = await Promise.all([
      this.visitsRepo.find({
        where: { routeId: route.id, salesRepId: userId },
        order: { visitStartedAt: 'ASC' },
      }),
      this.incidentsRepo.find({
        where: { routeId: route.id, salesRepId: userId },
        order: { createdAt: 'ASC' },
      }),
      this.assistedOrdersRepo.find({
        where: { routeId: route.id, salesRepId: userId },
        order: { requestedAt: 'ASC' },
      }),
    ]);

    const existingReport = await this.reportsRepo.findOne({
      where: {
        salesRepId: userId,
        routeId: route.id,
        reportDate,
      },
    });

    if (existingReport?.status === DailyReportStatus.SUBMITTED) {
      return existingReport;
    }

    const routeSummary = this.buildRouteSummary(route);
    const visitSummary = this.buildVisitSummary(visits);
    const osaSummary = this.buildOsaSummary(visits);
    const deliverySummary = this.buildDeliverySummary(assistedOrders);
    const returnSummary = this.buildReturnSummary(route);
    const incidentSummary = this.buildIncidentSummary(incidents);

    const report = existingReport
      ? this.reportsRepo.merge(existingReport, {
          routeSummaryJson: routeSummary,
          visitSummaryJson: visitSummary,
          osaSummaryJson: osaSummary,
          deliverySummaryJson: deliverySummary,
          returnSummaryJson: returnSummary,
          incidentSummaryJson: incidentSummary,
          status: DailyReportStatus.DRAFT,
          submittedAt: null,
        })
      : this.reportsRepo.create({
          routeId: route.id,
          salesRepId: userId,
          reportDate,
          status: DailyReportStatus.DRAFT,
          submittedAt: null,
          routeSummaryJson: routeSummary,
          visitSummaryJson: visitSummary,
          osaSummaryJson: osaSummary,
          deliverySummaryJson: deliverySummary,
          returnSummaryJson: returnSummary,
          incidentSummaryJson: incidentSummary,
          repComments: null,
        } as any);

    const savedReport = await this.reportsRepo.save(report as any);

    await this.activityService.logForUser({
      userId,
      type: 'DAILY_REPORT_DRAFT_GENERATED',
      title: 'Daily report draft generated',
      message: `Daily report draft prepared for ${reportDate}.`,
      metadata: {
        reportId: savedReport.id,
        reportDate: savedReport.reportDate,
        status: savedReport.status,
        routeId: route.id,
      },
    });

    return savedReport;
  }

  async getMyReport(salesRepId: string, reportId: string): Promise<DailyReport> {
    const report = await this.reportsRepo.findOne({
      where: { id: reportId, salesRepId },
    });

    if (!report) {
      throw new NotFoundException('Daily report not found.');
    }

    return report;
  }

  async getMyReports(salesRepId: string): Promise<DailyReport[]> {
    return this.reportsRepo.find({
      where: { salesRepId },
      order: { reportDate: 'DESC' },
      take: 30,
    });
  }

  async updateDraft(
    salesRepId: string,
    reportId: string,
    dto: UpdateReportDraftDto,
  ): Promise<DailyReport> {
    const report = await this.getMyReport(salesRepId, reportId);

    if (report.status !== DailyReportStatus.DRAFT) {
      throw new BadRequestException('Only draft reports can be edited.');
    }

    report.repComments = dto.repComments?.trim() || null;
    return this.reportsRepo.save(report);
  }

  async submitReport(
    salesRepId: string,
    reportId: string,
  ): Promise<DailyReport> {
    const report = await this.getMyReport(salesRepId, reportId);

    if (report.status === DailyReportStatus.SUBMITTED) {
      return report;
    }

    if (report.status !== DailyReportStatus.DRAFT) {
      throw new BadRequestException('Only draft reports can be submitted.');
    }

    report.status = DailyReportStatus.SUBMITTED;
    report.submittedAt = new Date();

    const savedReport = await this.reportsRepo.save(report);

    if (savedReport.routeId) {
      await this.incidentsRepo.update(
        { routeId: savedReport.routeId, salesRepId },
        { includedInReport: true },
      );
    }

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'DAILY_REPORT_SUBMITTED',
      title: 'Daily report submitted',
      message: `Daily report submitted for ${savedReport.reportDate}.`,
      metadata: {
        reportId: savedReport.id,
        reportDate: savedReport.reportDate,
        status: savedReport.status,
        submittedAt: savedReport.submittedAt?.toISOString() ?? null,
      },
    });

    return savedReport;
  }

  async getReports(
    territoryId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DailyReport[]> {
    const query = this.reportsRepo.createQueryBuilder('report');

    if (startDate) {
      query.andWhere('report.reportDate >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('report.reportDate <= :endDate', { endDate });
    }

    return query.orderBy('report.reportDate', 'DESC').getMany();
  }

  private resolveReportDate(route: SalesRoute) {
    const sourceDate = route.closedAt ?? route.startedAt ?? route.createdAt;
    return sourceDate.toISOString().split('T')[0];
  }

  private buildRouteSummary(route: SalesRoute) {
    const openingStock = route.openingStockJson ?? [];
    const closingStock = route.closingStockJson ?? [];
    const returns = route.returnItemsJson ?? [];
    const variance = route.varianceJson ?? [];
    const openingCases = openingStock.reduce(
      (sum, item: any) => sum + Number(item?.quantityCases ?? 0),
      0,
    );
    const closingCases = closingStock.reduce(
      (sum, item: any) => sum + Number(item?.quantityCases ?? 0),
      0,
    );
    const totalReturnedCases = returns.reduce(
      (sum, item: any) => sum + Number(item?.quantityCases ?? 0),
      0,
    );

    return {
      routeId: route.id,
      status: route.status,
      startedAt: route.startedAt,
      closedAt: route.closedAt,
      fieldDurationMinutes:
        route.startedAt && route.closedAt
          ? Math.max(
              0,
              Math.round(
                (route.closedAt.getTime() - route.startedAt.getTime()) / 60000,
              ),
            )
          : null,
      openingStockLines: openingStock.length,
      closingStockLines: closingStock.length,
      openingStockCases: openingCases,
      closingStockCases: closingCases,
      returnLineCount: returns.length,
      totalReturnedCases,
      varianceLineCount: variance.length,
      hasVariance: variance.some(
        (item: any) => Number(item?.varianceUnits ?? 0) !== 0,
      ),
    };
  }

  private buildVisitSummary(visits: StoreVisit[]) {
    const completedVisits = visits.filter(
      (visit) => visit.status === StoreVisitStatus.COMPLETED,
    );
    const totalDurationMinutes = completedVisits.reduce((sum, visit) => {
      if (visit.durationMinutes != null) {
        return sum + visit.durationMinutes;
      }
      if (visit.durationSeconds != null) {
        return sum + Math.round(visit.durationSeconds / 60);
      }
      return sum;
    }, 0);

    return {
      totalVisits: visits.length,
      completedVisits: completedVisits.length,
      inProgressVisits: visits.length - completedVisits.length,
      totalDurationMinutes,
      photoCount: visits.reduce(
        (sum, visit) => sum + (visit.photoUrls?.length ?? 0),
        0,
      ),
      feedbackCount: visits
        .filter((visit) => this.hasText(visit.outletFeedback))
        .length,
      outlets: visits.map((visit) => ({
        visitId: visit.id,
        outletId: visit.shopId,
        outletName: visit.shopNameSnapshot,
        status: visit.status,
        startedAt: visit.visitStartedAt,
        endedAt: visit.visitEndedAt,
        durationSeconds: visit.durationSeconds,
      })),
    };
  }

  private buildOsaSummary(visits: StoreVisit[]) {
    const issues: Record<string, unknown>[] = [];
    let planogramOkCount = 0;
    let posmOkCount = 0;

    for (const visit of visits) {
      if (visit.planogramOk == true) {
        planogramOkCount += 1;
      }
      if (visit.posmOk == true) {
        posmOkCount += 1;
      }

      const rawIssues = visit.osaIssuesJson;
      if (Array.isArray(rawIssues)) {
        for (const issue of rawIssues) {
          if (issue && typeof issue === 'object' && !Array.isArray(issue)) {
            issues.push({
              outletId: visit.shopId,
              outletName: visit.shopNameSnapshot,
              ...this.toRecord(issue),
            });
          }
        }
      } else if (this.isRecord(rawIssues)) {
        issues.push({
          outletId: visit.shopId,
          outletName: visit.shopNameSnapshot,
          ...this.toRecord(rawIssues),
        });
      }
    }

    const outletIdsWithIssues = new Set(
      issues
        .map((item) =>
          typeof item.outletId === 'string' ? item.outletId.trim() : null,
        )
        .filter((id): id is string => Boolean(id)),
    );

    return {
      planogramOkCount,
      posmOkCount,
      outletCountWithIssues: outletIdsWithIssues.size,
      issueCount: issues.length,
      issues,
    };
  }

  private buildDeliverySummary(assistedOrders: AssistedOrderRequest[]) {
    const totalOrderValue = assistedOrders.reduce<number>(
      (sum, order) => sum + order.orderTotal,
      0,
    );

    return {
      totalRequests: assistedOrders.length,
      confirmedOrders: assistedOrders.filter(
        (order) => order.status === AssistedOrderRequestStatus.CONFIRMED,
      ).length,
      draftOrders: assistedOrders.filter(
        (order) => order.status === AssistedOrderRequestStatus.DRAFT,
      ).length,
      pendingPinOrders: assistedOrders.filter(
        (order) => order.status === AssistedOrderRequestStatus.PENDING_SHOP_PIN,
      ).length,
      expiredOrders: assistedOrders.filter(
        (order) => order.status === AssistedOrderRequestStatus.EXPIRED,
      ).length,
      totalValue: Number(totalOrderValue.toFixed(2)),
      orders: assistedOrders.map((order) => ({
        requestId: order.id,
        outletId: order.shopId,
        outletName: order.shopNameSnapshot,
        status: order.status,
        totalAmount: order.orderTotal,
        itemCount: order.itemsJson.length,
        confirmedOrderId: order.confirmedOrderId,
        assistedReason: order.assistedReason,
        requestedAt: order.requestedAt,
        confirmedAt: order.confirmedAt,
      })),
    };
  }

  private buildReturnSummary(route: SalesRoute) {
    const returns = route.returnItemsJson ?? [];

    return {
      totalReturnLines: returns.length,
      totalReturnedCases: returns.reduce(
        (sum, item: any) => sum + Number(item?.quantityCases ?? 0),
        0,
      ),
      items: returns,
    };
  }

  private buildIncidentSummary(incidents: SalesIncident[]) {
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const incident of incidents) {
      bySeverity[incident.severity] = (bySeverity[incident.severity] ?? 0) + 1;
      byType[incident.incidentType] = (byType[incident.incidentType] ?? 0) + 1;
    }

    return {
      totalIncidents: incidents.length,
      bySeverity,
      byType,
      incidents: incidents.map((incident) => ({
        id: incident.id,
        outletId: incident.shopId,
        orderId: incident.orderId,
        incidentType: incident.incidentType,
        severity: incident.severity,
        description: incident.description,
        includedInReport: incident.includedInReport,
        createdAt: incident.createdAt,
      })),
    };
  }

  private hasText(value: string | null) {
    return value != null && value.trim().length > 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }
}
