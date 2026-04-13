import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DailyReport } from './entities/daily-report.entity';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([DailyReport]), ActivityModule],
  controllers: [DailyReportsController],
  providers: [DailyReportsService, JwtAuthGuard, RolesGuard],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}
