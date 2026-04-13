import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { DailyReport, DailyReportStatus } from './entities/daily-report.entity';
import { GenerateReportDto } from './dto/generate-report.dto';

@Injectable()
export class DailyReportsService {
  constructor(
    @InjectRepository(DailyReport)
    private readonly reportsRepo: Repository<DailyReport>,
    private readonly activityService: ActivityService,
  ) {}

  async generateReport(
    userId: string,
    dto: GenerateReportDto,
  ): Promise<DailyReport> {
    const today = new Date().toISOString().split('T')[0];

    const report: any = this.reportsRepo.create({
      routeId: dto.routeId,
      salesRepId: userId,
      reportDate: today,
      status: DailyReportStatus.SUBMITTED,
      submittedAt: new Date(),
      routeSummaryJson: null,
      visitSummaryJson: null,
      osaSummaryJson: null,
      deliverySummaryJson: null,
      returnSummaryJson: null,
      incidentSummaryJson: null,
    } as any);

    const savedReport: any = await this.reportsRepo.save(report);

    await this.activityService.logForUser({
      userId,
      type: 'DAILY_REPORT_SUBMITTED',
      title: 'Daily Report Submitted',
      message: `Daily report submitted for ${today}`,
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
    const query = this.reportsRepo.createQueryBuilder('report');

    if (startDate) {
      query.andWhere('report.reportDate >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('report.reportDate <= :endDate', { endDate });
    }

    return query.orderBy('report.reportDate', 'DESC').getMany();
  }
}
