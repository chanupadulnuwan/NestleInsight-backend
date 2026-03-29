import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { ActivityLog } from './entities/activity.entity';
import { FeedbackSubmission } from './entities/feedback-submission.entity';

type LogActivityInput = {
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityRepository: Repository<ActivityLog>,
    @InjectRepository(FeedbackSubmission)
    private readonly feedbackRepository: Repository<FeedbackSubmission>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async logForUser(input: LogActivityInput): Promise<ActivityLog> {
    const activity = this.activityRepository.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? null,
    });

    return this.activityRepository.save(activity);
  }

  async listForUser(userId: string) {
    const activities = await this.activityRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return {
      message: 'activity fetched successfully',
      activities,
    };
  }

  async submitFeedbackForUser(userId: string, message: string) {
    const feedback = this.feedbackRepository.create({
      userId,
      message: message.trim(),
      status: 'SUBMITTED',
    });

    const savedFeedback = await this.feedbackRepository.save(feedback);

    // Log confirmation for the shop owner
    await this.logForUser({
      userId,
      type: 'FEEDBACK_RECEIVED',
      title: 'Feedback received',
      message:
        'Thank you for your feedback. We appreciate you taking the time to share it with us.',
      metadata: {
        feedbackId: savedFeedback.id,
        feedbackStatus: savedFeedback.status,
      },
    });

    // Notify the Territory Manager assigned to the same territory
    const shopOwner = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'firstName', 'lastName', 'territoryId'],
    });

    if (shopOwner?.territoryId) {
      const territoryManager = await this.userRepository.findOne({
        where: { role: Role.REGIONAL_MANAGER, territoryId: shopOwner.territoryId },
        select: ['id'],
      });

      if (territoryManager) {
        await this.logForUser({
          userId: territoryManager.id,
          type: 'FEEDBACK_RECEIVED',
          title: 'New feedback from shop owner',
          message: `${shopOwner.firstName} ${shopOwner.lastName} submitted feedback: "${message.trim().substring(0, 120)}${message.trim().length > 120 ? '...' : ''}"`,
          metadata: {
            feedbackId: savedFeedback.id,
            fromUserId: userId,
            fromUserName: `${shopOwner.firstName} ${shopOwner.lastName}`,
          },
        });
      }
    }

    return {
      message: 'Feedback submitted successfully.',
      feedback: savedFeedback,
    };
  }
}
