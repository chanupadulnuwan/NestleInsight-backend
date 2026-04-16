import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { StoreVisit, StoreVisitStatus } from './entities/store-visit.entity';
import { StartVisitDto } from './dto/start-visit.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { CheckInVisitDto } from './dto/check-in-visit.dto';

@Injectable()
export class StoreVisitsService {
  constructor(
    @InjectRepository(StoreVisit)
    private readonly storeVisitsRepo: Repository<StoreVisit>,
    private readonly activityService: ActivityService,
  ) {}

  async startVisit(userId: string, dto: StartVisitDto): Promise<StoreVisit> {
    const storeVisit: any = this.storeVisitsRepo.create({
      routeId: dto.routeId,
      shopId: dto.shopId || null,
      shopNameSnapshot: dto.shopNameSnapshot,
      territoryId: dto.territoryId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      salesRepId: userId,
      status: StoreVisitStatus.IN_PROGRESS,
      visitStartedAt: new Date(),
    } as any);

    const savedVisit: any = await this.storeVisitsRepo.save(storeVisit);

    await this.activityService.logForUser({
      userId,
      type: 'STORE_VISIT_STARTED',
      title: 'Store Visit Started',
      message: `Store visit at "${dto.shopNameSnapshot}" has been started`,
      metadata: {
        visitId: savedVisit.id,
        shopName: savedVisit.shopNameSnapshot,
        status: savedVisit.status,
      },
    });

    return savedVisit;
  }

  async completeVisit(
    visitId: string,
    userId: string,
    dto: CompleteVisitDto,
  ): Promise<StoreVisit> {
    const visit = await this.storeVisitsRepo.findOne({ where: { id: visitId } });
    if (!visit) {
      throw new NotFoundException(`Store visit with id ${visitId} not found`);
    }

    if (visit.status !== StoreVisitStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Store visit is not IN_PROGRESS (current: ${visit.status})`,
      );
    }

    if (visit.salesRepId !== userId) {
      throw new BadRequestException(
        'You can only complete your own store visits',
      );
    }

    const now = new Date();
    const durationSeconds = Math.floor(
      (now.getTime() - visit.visitStartedAt.getTime()) / 1000,
    );

    visit.status = StoreVisitStatus.COMPLETED;
    visit.visitEndedAt = now;
    visit.durationSeconds = durationSeconds;
    visit.shelfStockJson = dto.shelfStockJson || null;
    visit.backroomStockJson = dto.backroomStockJson || null;
    visit.osaIssuesJson = dto.osaIssuesJson || null;
    visit.promotionsJson = dto.promotionsJson || null;
    visit.planogramOk = dto.planogramOk ?? null;
    visit.posmOk = dto.posmOk ?? null;
    visit.outletFeedback = dto.outletFeedback || null;

    const updatedVisit = await this.storeVisitsRepo.save(visit);

    await this.activityService.logForUser({
      userId,
      type: 'STORE_VISIT_COMPLETED',
      title: 'Store Visit Completed',
      message: `Store visit at "${visit.shopNameSnapshot}" has been completed (${durationSeconds} seconds)`,
      metadata: {
        visitId: updatedVisit.id,
        shopName: updatedVisit.shopNameSnapshot,
        status: updatedVisit.status,
        durationSeconds: updatedVisit.durationSeconds,
      },
    });

    return updatedVisit;
  }

  async checkInVisit(
    salesRepId: string,
    dto: CheckInVisitDto,
  ): Promise<StoreVisit> {
    const storeVisit: any = this.storeVisitsRepo.create({
      routeId: dto.routeId,
      shopId: dto.shopId,
      salesRepId,
      status: StoreVisitStatus.IN_PROGRESS,
      visitStartedAt: new Date(),
      visitNotes: dto.visitNotes || null,
    } as any);

    const savedVisit: any = await this.storeVisitsRepo.save(storeVisit);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'STORE_VISIT_CHECKED_IN',
      title: 'Store Visit Checked In',
      message: `Store visit at shop ${dto.shopId} has been checked in`,
      metadata: {
        visitId: savedVisit.id,
        routeId: dto.routeId,
        shopId: dto.shopId,
      },
    });

    return savedVisit;
  }
}
