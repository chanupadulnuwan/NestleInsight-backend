import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityLog } from './entities/activity.entity';
import { FeedbackSubmission } from './entities/feedback-submission.entity';
import { OrderFeedback } from './entities/order-feedback.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityLog, FeedbackSubmission, OrderFeedback, Order, User])],
  controllers: [ActivityController],
  providers: [ActivityService, JwtAuthGuard],
  exports: [ActivityService, TypeOrmModule],
})
export class ActivityModule {}
