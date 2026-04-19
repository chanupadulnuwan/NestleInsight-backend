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
import { SalesRoute, SalesRouteStatus } from '../sales-routes/entities/sales-route.entity';
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

  async getMyReport(salesRepId: string, reportId: string): Promise<DailyReport> {
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
      throw new BadRequestException(
        'Only draft reports can be updated.',
      );
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
      this.ordersRepo.find({
        where: { userId: salesRepId },
        order: { placedAt: 'ASC' },
      }),
    ]);

    const routeOrders = salesRepOrders.filter((order) =>
      (order.customerNote ?? '').includes(`Route: ${route.id}`),
    );
    const completedVisits = visits.filter((visit) => visit.status === 'COMPLETED');
    const routeReturnItems = Array.isArray(route.returnItemsJson)
      ? route.returnItemsJson
      : [];
    const totalReturnedCases = routeReturnItems.reduce<number>(
      (sum, item) => sum + Number((item as Record<string, unknown>).quantityCases ?? 0),
      0,
    );
    const totalVisitDurationSeconds = completedVisits.reduce<number>(
      (sum, visit) => sum + (visit.durationSeconds ?? 0),
      0,
    );
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

    return {
      routeSummaryJson: {
        routeId: route.id,
        status: route.status,
        territoryId: route.territoryId,
        warehouseId: route.warehouseId,
        vehicleId: route.vehicleId,
        startedAt: route.startedAt?.toISOString() ?? null,
        closedAt: route.closedAt?.toISOString() ?? null,
        openingStockLineCount: Array.isArray(route.openingStockJson)
          ? route.openingStockJson.length
          : 0,
        closingStockLineCount: Array.isArray(route.closingStockJson)
          ? route.closingStockJson.length
          : 0,
        varianceLineCount: Array.isArray(route.varianceJson)
          ? route.varianceJson.length
          : 0,
        returnLineCount: routeReturnItems.length,
      },
      visitSummaryJson: {
        totalVisits: visits.length,
        completedVisits: completedVisits.length,
        totalVisitDurationSeconds,
        totalVisitDurationMinutes: Math.round(totalVisitDurationSeconds / 60),
        visitedShops: visits.map((visit) => ({
          visitId: visit.id,
          shopId: visit.shopId,
          shopName: visit.shopNameSnapshot,
          status: visit.status,
          durationSeconds: visit.durationSeconds ?? 0,
        })),
      },
      osaSummaryJson: {
        visitsWithPlanogramOk: completedVisits.filter((visit) => visit.planogramOk === true)
          .length,
        visitsWithPosmOk: completedVisits.filter((visit) => visit.posmOk === true)
          .length,
        visitsWithOsaNotes: visitsWithOsaNotes.length,
        totalOsaIssueEntries: osaIssueCount,
        visitsWithFeedback: visitsWithFeedback.length,
        feedbackSamples: visitsWithFeedback.slice(0, 5).map((visit) => ({
          shopName: visit.shopNameSnapshot,
          feedback: visit.outletFeedback,
        })),
      },
      deliverySummaryJson: {
        assistedOrderCount: routeOrders.length,
        totalOrderValue: Number(
          routeOrders.reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0).toFixed(2),
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
        items: routeReturnItems,
      },
      incidentSummaryJson: {
        incidentCount: incidents.length,
        incidentsBySeverity: {
          LOW: incidents.filter((incident) => incident.severity === 'LOW').length,
          MEDIUM: incidents.filter((incident) => incident.severity === 'MEDIUM').length,
          HIGH: incidents.filter((incident) => incident.severity === 'HIGH').length,
          CRITICAL: incidents.filter((incident) => incident.severity === 'CRITICAL').length,
        },
        incidents: incidents.map((incident) => ({
          incidentId: incident.id,
          type: incident.incidentType,
          severity: incident.severity,
          description: incident.description,
          createdAt: incident.createdAt.toISOString(),
        })),
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
}
