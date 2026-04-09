import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Role } from '../common/enums/role.enum';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { SubmitOrderFeedbackDto } from './dto/submit-order-feedback.dto';
import { ActivityLog } from './entities/activity.entity';
import { FeedbackSubmission } from './entities/feedback-submission.entity';
import { OrderFeedback } from './entities/order-feedback.entity';

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
    @InjectRepository(OrderFeedback)
    private readonly orderFeedbackRepository: Repository<OrderFeedback>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
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
        where: { role: Role.TERRITORY_DISTRIBUTOR, territoryId: shopOwner.territoryId },
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

  // ─── Order-Specific Star Rating Feedback ────────────────────────────────────

  async submitOrderFeedback(
    shopOwnerId: string,
    territoryId: string,
    dto: SubmitOrderFeedbackDto,
  ): Promise<{ message: string; feedback: OrderFeedback }> {
    // 1. Verify the order exists and belongs to this shop owner.
    const order = await this.orderRepository.findOne({
      where: { id: dto.orderId, userId: shopOwnerId },
      select: ['id', 'orderCode', 'status', 'userId', 'territoryId'],
    });

    if (!order) {
      throw new NotFoundException('Order not found or does not belong to you.');
    }

    // 2. Only completed orders may be reviewed.
    if (order.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Feedback can only be submitted for completed orders.',
      );
    }

    // 3. Check duplicate feedback.
    const existing = await this.orderFeedbackRepository.findOne({
      where: { orderId: dto.orderId, shopOwnerId },
    });

    if (existing) {
      throw new BadRequestException(
        'You have already submitted feedback for this order.',
      );
    }

    // 4. Persist the feedback.
    const feedback = this.orderFeedbackRepository.create({
      shopOwnerId,
      orderId: dto.orderId,
      rating: dto.rating,
      comment: dto.comment?.trim() ?? null,
      territoryId,
    });

    const saved = await this.orderFeedbackRepository.save(feedback);

    // 5. Fetch the shop owner's display name for the activity log.
    const shopOwner = await this.userRepository.findOne({
      where: { id: shopOwnerId },
      select: ['id', 'firstName', 'lastName', 'shopName'],
    });

    const displayName =
      shopOwner?.shopName ??
      `${shopOwner?.firstName ?? ''} ${shopOwner?.lastName ?? ''}`.trim();

    const stars = '★'.repeat(dto.rating) + '☆'.repeat(5 - dto.rating);
    const commentSnippet = dto.comment
      ? ` — "${dto.comment.substring(0, 100)}${dto.comment.length > 100 ? '…' : ''}"`
      : '';

    // 6. Notify the Territory Distributor who owns this territory.
    const tm = await this.userRepository.findOne({
      where: { role: Role.TERRITORY_DISTRIBUTOR, territoryId },
      select: ['id'],
    });

    if (tm) {
      await this.logForUser({
        userId: tm.id,
        type: 'ORDER_FEEDBACK',
        title: `${displayName} rated order ${order.orderCode}`,
        message: `Shop owner gave ${stars} (${dto.rating}/5)${commentSnippet}`,
        metadata: {
          feedbackId: saved.id,
          orderId: order.id,
          orderCode: order.orderCode,
          rating: dto.rating,
          comment: dto.comment ?? null,
          fromUserId: shopOwnerId,
          fromUserName: displayName,
        },
      });
    }

    return { message: 'Feedback submitted successfully.', feedback: saved };
  }

  async getFeedbackByTerritory(territoryId: string): Promise<OrderFeedback[]> {
    return this.orderFeedbackRepository.find({
      where: { territoryId },
      relations: ['shopOwner', 'order'],
      order: { createdAt: 'DESC' },
    });
  }
}
