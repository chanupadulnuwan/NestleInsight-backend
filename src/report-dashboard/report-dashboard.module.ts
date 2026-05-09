import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { AiWriterService } from '../ai-writer/ai-writer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { User } from '../users/entities/user.entity';
import { AdminReportReview } from './entities/admin-report-review.entity';
import { DemandPlannerReport } from './entities/demand-planner-report.entity';
import { ReportDashboardController } from './report-dashboard.controller';
import { ReportDashboardService } from './report-dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminReportReview,
      DemandPlannerReport,
      DailyReport,
      User,
    ]),
    ActivityModule,
  ],
  controllers: [ReportDashboardController],
  providers: [ReportDashboardService, AiWriterService, JwtAuthGuard, RolesGuard],
})
export class ReportDashboardModule {}
