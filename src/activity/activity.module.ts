import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityLog } from './entities/activity.entity';
import { FeedbackSubmission } from './entities/feedback-submission.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog, FeedbackSubmission])],
  controllers: [ActivityController],
  providers: [ActivityService, JwtAuthGuard],
  exports: [ActivityService, TypeOrmModule],
})
export class ActivityModule {}
