import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { AiWriterService } from '../ai-writer/ai-writer.service';
import { DailyReport, DailyReportStatus } from '../daily-reports/entities/daily-report.entity';
import { User } from '../users/entities/user.entity';
import { AdminReportReview } from './entities/admin-report-review.entity';
import { DemandPlannerReport } from './entities/demand-planner-report.entity';
import { CreatePlannerReportDto } from './dto/create-planner-report.dto';
import { SaveCriticalDto } from './dto/save-critical.dto';
import { WarnReportDto } from './dto/warn-report.dto';

@Injectable()
export class ReportDashboardService {
  constructor(
    @InjectRepository(AdminReportReview)
    private readonly reviewRepo: Repository<AdminReportReview>,
    @InjectRepository(DemandPlannerReport)
    private readonly plannerReportRepo: Repository<DemandPlannerReport>,
    @InjectRepository(DailyReport)
    private readonly dailyReportRepo: Repository<DailyReport>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly activityService: ActivityService,
    private readonly aiWriterService: AiWriterService,
  ) {}

  // --- Inbox ---

  async getInbox() {
    const actionedReportIds = await this.reviewRepo
      .createQueryBuilder('r')
      .select('r.daily_report_id')
      .where('r.status IN (:...statuses)', { statuses: ['SAVED', 'CRITICAL', 'WARNED'] })
      .getRawMany()
      .then((rows) => rows.map((row) => row.r_daily_report_id as string));

    const query = this.dailyReportRepo
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.salesRep', 'salesRep')
      .leftJoin('report.route', 'route')
      .leftJoin('route.territory', 'territory')
      .addSelect(['territory.id', 'territory.name'])
      .where('report.status = :status', { status: DailyReportStatus.SUBMITTED });

    if (actionedReportIds.length > 0) {
      query.andWhere('report.id NOT IN (:...ids)', { ids: actionedReportIds });
    }

    const reports = await query.orderBy('report.submittedAt', 'DESC').getMany();

    const reviewMap = await this.getReviewMapForReports(reports.map((r) => r.id));

    return reports.map((report) => this.formatInboxItem(report, reviewMap));
  }

  async markAsRead(dailyReportId: string, reviewerId: string) {
    await this.requireSubmittedReport(dailyReportId);
    const existing = await this.reviewRepo.findOne({ where: { dailyReportId } });

    if (existing && existing.status !== 'READ') {
      return existing;
    }

    const review = existing
      ? Object.assign(existing, { reviewedById: reviewerId, status: 'READ' as const })
      : this.reviewRepo.create({ dailyReportId, reviewedById: reviewerId, status: 'READ' });

    return this.reviewRepo.save(review);
  }

  async getDailyReportDetail(reportId: string) {
    const report = await this.dailyReportRepo
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.salesRep', 'salesRep')
      .leftJoin('report.route', 'route')
      .leftJoin('route.territory', 'territory')
      .addSelect(['territory.id', 'territory.name'])
      .where('report.id = :id', { id: reportId })
      .andWhere('report.status = :status', { status: DailyReportStatus.SUBMITTED })
      .getOne();

    if (!report) {
      throw new NotFoundException('Report not found or not yet submitted.');
    }

    const review = await this.reviewRepo.findOne({ where: { dailyReportId: reportId } });

    return { report, review };
  }

  async saveReport(dailyReportId: string, reviewerId: string) {
    await this.requireSubmittedReport(dailyReportId);
    return this.upsertReview(dailyReportId, reviewerId, 'SAVED', null, null);
  }

  async saveCritical(dailyReportId: string, reviewerId: string, dto: SaveCriticalDto) {
    await this.requireSubmittedReport(dailyReportId);
    return this.upsertReview(dailyReportId, reviewerId, 'CRITICAL', dto.reason, null);
  }

  async warnSalesRep(dailyReportId: string, reviewerId: string, dto: WarnReportDto) {
    const report = await this.requireSubmittedReport(dailyReportId);

    const salesRepId = report.salesRepId;
    const reportDate = report.reportDate;

    const alertMessage = await this.buildWarnMessage(dto.reason, reportDate);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'REPORT_REVISION_REQUESTED',
      title: 'Report Revision Requested',
      message: alertMessage,
      metadata: {
        reportId: dailyReportId,
        reportDate,
        warnedReason: dto.reason,
      },
    });

    await this.upsertReview(dailyReportId, reviewerId, 'WARNED', null, dto.reason);

    return { message: 'Sales rep has been notified. Report removed from inbox.' };
  }

  // --- Saved Reports ---

  async getSavedReports(filters: {
    territoryId?: string;
    salesRepId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const query = this.reviewRepo
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.dailyReport', 'report')
      .leftJoinAndSelect('report.salesRep', 'salesRep')
      .leftJoin('report.route', 'route')
      .leftJoin('route.territory', 'territory')
      .addSelect(['territory.id', 'territory.name'])
      .where('review.status = :status', { status: 'SAVED' });

    if (filters.territoryId) {
      query.andWhere('territory.id = :tid', { tid: filters.territoryId });
    }

    if (filters.salesRepId) {
      query.andWhere('report.salesRepId = :sid', { sid: filters.salesRepId });
    }

    if (filters.startDate) {
      query.andWhere('report.reportDate >= :start', { start: filters.startDate });
    }

    if (filters.endDate) {
      query.andWhere('report.reportDate <= :end', { end: filters.endDate });
    }

    return query.orderBy('review.updatedAt', 'DESC').getMany();
  }

  async deleteSavedReport(dailyReportId: string, deletedById: string) {
    const review = await this.reviewRepo.findOne({
      where: { dailyReportId, status: 'SAVED' },
      relations: ['dailyReport', 'dailyReport.salesRep'],
    });

    if (!review) {
      throw new NotFoundException('Saved report not found.');
    }

    const deleter = await this.userRepo.findOne({ where: { id: deletedById } });
    const deleterName = deleter
      ? `${deleter.firstName} ${deleter.lastName}`
      : 'An administrator';

    // Notify field ops monitoring via activity log for the report's sales rep
    await this.activityService.logForUser({
      userId: review.dailyReport.salesRepId,
      type: 'SAVED_REPORT_DELETED',
      title: 'Saved Report Deleted',
      message: `${deleterName} deleted the saved daily report for ${review.dailyReport.reportDate} from the report dashboard.`,
      metadata: {
        reportId: dailyReportId,
        reportDate: review.dailyReport.reportDate,
        deletedById,
      },
    });

    await this.reviewRepo.remove(review);
    return { message: 'Report deleted.' };
  }

  // --- Critical Reports ---

  async getCriticalReports() {
    return this.reviewRepo
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.dailyReport', 'report')
      .leftJoinAndSelect('report.salesRep', 'salesRep')
      .leftJoin('report.route', 'route')
      .leftJoin('route.territory', 'territory')
      .addSelect(['territory.id', 'territory.name'])
      .where('review.status = :status', { status: 'CRITICAL' })
      .orderBy('review.updatedAt', 'DESC')
      .getMany();
  }

  async resolveCriticalReport(dailyReportId: string) {
    const review = await this.reviewRepo.findOne({
      where: { dailyReportId, status: 'CRITICAL' },
    });

    if (!review) {
      throw new NotFoundException('Critical report not found.');
    }

    review.status = 'SAVED';
    return this.reviewRepo.save(review);
  }

  // --- Demand Planner Reports ---

  async createPlannerReport(authorId: string, dto: CreatePlannerReportDto, attachmentUrl?: string) {
    if (dto.isCritical && !dto.criticalReason?.trim()) {
      throw new BadRequestException('Critical reason is required when saving as critical.');
    }

    const report = this.plannerReportRepo.create({
      authorId,
      title: dto.title.trim(),
      content: dto.content.trim(),
      isCritical: dto.isCritical ?? false,
      criticalReason: dto.isCritical ? dto.criticalReason!.trim() : null,
      attachmentUrl: attachmentUrl ?? null,
    });

    return this.plannerReportRepo.save(report);
  }

  async getPlannerReports(filters: {
    authorId?: string;
    startDate?: string;
    endDate?: string;
    isCritical?: boolean;
  }) {
    const query = this.plannerReportRepo
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.author', 'author');

    if (filters.authorId) {
      query.where('report.authorId = :authorId', { authorId: filters.authorId });
    }

    if (filters.startDate) {
      query.andWhere('report.createdAt >= :start', { start: filters.startDate });
    }

    if (filters.endDate) {
      query.andWhere('report.createdAt <= :end', { end: filters.endDate + 'T23:59:59' });
    }

    if (filters.isCritical !== undefined) {
      query.andWhere('report.isCritical = :isCritical', { isCritical: filters.isCritical });
    }

    return query.orderBy('report.createdAt', 'DESC').getMany();
  }

  async deletePlannerReport(reportId: string, requesterId: string) {
    const report = await this.plannerReportRepo.findOne({ where: { id: reportId } });

    if (!report) {
      throw new NotFoundException('Report not found.');
    }

    await this.plannerReportRepo.remove(report);
    return { message: 'Report deleted.' };
  }

  // --- Helpers ---

  private async requireSubmittedReport(dailyReportId: string) {
    const report = await this.dailyReportRepo.findOne({
      where: { id: dailyReportId, status: DailyReportStatus.SUBMITTED },
    });

    if (!report) {
      throw new NotFoundException('Submitted daily report not found.');
    }

    return report;
  }

  private async upsertReview(
    dailyReportId: string,
    reviewerId: string,
    status: AdminReportReview['status'],
    criticalReason: string | null,
    warnedReason: string | null,
  ) {
    const existing = await this.reviewRepo.findOne({ where: { dailyReportId } });

    const review = existing
      ? Object.assign(existing, {
          reviewedById: reviewerId,
          status,
          criticalReason,
          warnedReason,
        })
      : this.reviewRepo.create({
          dailyReportId,
          reviewedById: reviewerId,
          status,
          criticalReason,
          warnedReason,
        });

    return this.reviewRepo.save(review);
  }

  private async getReviewMapForReports(reportIds: string[]) {
    if (reportIds.length === 0) return new Map<string, AdminReportReview>();

    const reviews = await this.reviewRepo.find({
      where: { dailyReportId: In(reportIds) },
    });

    return new Map(reviews.map((r) => [r.dailyReportId, r]));
  }

  private formatInboxItem(report: DailyReport, reviewMap: Map<string, AdminReportReview>) {
    const review = reviewMap.get(report.id);
    const route = (report as any).route;
    const territory = route?.territory;

    return {
      id: report.id,
      reportDate: report.reportDate,
      submittedAt: report.submittedAt,
      repComments: report.repComments,
      isRead: review?.status === 'READ',
      salesRep: {
        id: report.salesRep?.id ?? report.salesRepId,
        firstName: report.salesRep?.firstName ?? '',
        lastName: report.salesRep?.lastName ?? '',
        employeeId: report.salesRep?.employeeId ?? null,
      },
      territory: territory
        ? { id: territory.id, name: territory.name }
        : null,
      routeSummary: report.routeSummaryJson,
      visitSummary: report.visitSummaryJson,
    };
  }

  private async buildWarnMessage(reason: string, reportDate: string): Promise<string> {
    if (this.aiWriterService.isConfigured()) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const result = await this.aiWriterService.writeNarrative({
          reportType: 'sales_rep_alert',
          audience: 'sales_rep',
          window: { fromDate: reportDate, toDate: reportDate },
          filters: { reportDate },
          metrics: {},
          charts: [],
          anomalies: [reason],
          recommendedActions: [
            'Review the concerns raised and submit a revised, complete daily report.',
          ],
        });

        if (result?.managementRecommendation) {
          return result.managementRecommendation;
        }
      } catch {
        // fall through to template
      }
    }

    return (
      `Your daily report for ${reportDate} has been reviewed and returned for revision. ` +
      `Reason: ${reason}. Please review the feedback and submit a revised report as soon as possible.`
    );
  }
}
