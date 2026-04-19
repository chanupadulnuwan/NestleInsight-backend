import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { Role } from '../common/enums/role.enum';
import { RouteSession } from '../sales-routes/entities/route-session.entity';
import { RoutePlanStop } from '../sales-routes/entities/route-plan-stop.entity';
import { RouteStopEvent } from '../sales-routes/entities/route-stop-event.entity';
import { Outlet } from '../outlets/entities/outlet.entity';
import { User } from '../users/entities/user.entity';

type SerializedRouteOutlet = {
  id: string;
  outletName: string;
  ownerName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  suggestedSeq: number;
  stopStatus: string;
};

type SerializedRouteStop = {
  id: string;
  routeSessionId: string;
  outletId: string;
  outletName: string;
  ownerName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  suggestedSeq: number;
  actualSeq: number | null;
  purpose: string;
  status: string;
  priorityScore: number | null;
  priorityBand: string;
  etaMinutes: number | null;
  distanceKm: number | null;
  recommendation:
    | 'resume-current-visit'
    | 'next-best-stop'
    | 'follow-sequence';
};

type SerializedRouteProgress = {
  sessionId: string;
  totalStops: number;
  pendingStops: number;
  inProgressStops: number;
  completedStops: number;
  skippedStops: number;
  currentStopNumber: number;
};

@Injectable()
export class SmartRouteService {
  constructor(
    @InjectRepository(RouteSession)
    private readonly sessionRepo: Repository<RouteSession>,
    @InjectRepository(RoutePlanStop)
    private readonly stopRepo: Repository<RoutePlanStop>,
    @InjectRepository(RouteStopEvent)
    private readonly eventRepo: Repository<RouteStopEvent>,
    @InjectRepository(Outlet)
    private readonly outletRepo: Repository<Outlet>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly activityService: ActivityService,
  ) {}

  async getOrCreateSession(userId: string, role: string, date: Date, territoryId: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let session = await this.sessionRepo.createQueryBuilder('session')
      .where('session.userId = :userId', { userId })
      .andWhere('session.routeDate >= :startOfDay', { startOfDay })
      .andWhere('session.routeDate <= :endOfDay', { endOfDay })
      .getOne();

    if (!session) {
      session = this.sessionRepo.create({
        userId,
        role,
        territoryId,
        routeDate: date,
        status: 'pending',
      });
      session = await this.sessionRepo.save(session);

      // Load assigned outlet list
      const outlets = await this.outletRepo.find({
        where: { registeredBySalesRepId: userId },
      });

      // Create Route Plan Stops based on assignments
      const stopsToCreate = outlets.map((outlet, index) => {
        return this.stopRepo.create({
          routeSessionId: session!.id,
          outletId: outlet.id,
          suggestedSeq: index + 1,
          purpose: 'Visit',
          status: 'pending',
        });
      });

      if (stopsToCreate.length > 0) {
        await this.stopRepo.save(stopsToCreate);
      }
    }

    return this.buildSessionResponse(session);
  }

  private getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async getNextStop(
    sessionId: string,
    userId: string,
    currentLat?: number,
    currentLng?: number,
  ) {
    await this.getOwnedSessionOrThrow(sessionId, userId);

    const inProgressStops = await this.stopRepo.find({
      where: { routeSessionId: sessionId, status: 'in_progress' },
      order: { actualSeq: 'ASC', suggestedSeq: 'ASC' },
    });

    if (inProgressStops.length > 0) {
      const currentStop = inProgressStops[0];
      const outlet = await this.outletRepo.findOne({
        where: { id: currentStop.outletId },
      });
      return this.serializeStop(
        currentStop,
        outlet,
        'resume-current-visit',
      );
    }

    const pendingStops = await this.stopRepo.find({
      where: { routeSessionId: sessionId, status: 'pending' },
      order: { suggestedSeq: 'ASC' },
    });

    if (pendingStops.length === 0) {
      await this.refreshSessionStatus(sessionId);
      return null;
    }

    const outletIds = pendingStops.map((stop) => stop.outletId);
    if (outletIds.length === 0) {
      await this.refreshSessionStatus(sessionId);
      return null;
    }

    const outlets = await this.outletRepo.find({
      where: { id: In(outletIds) },
    });
    const outletMap = new Map(outlets.map((outlet) => [outlet.id, outlet]));

    if (currentLat == null || currentLng == null) {
      const nextStop = pendingStops[0];
      return this.serializeStop(
        nextStop,
        outletMap.get(nextStop.outletId),
        'follow-sequence',
      );
    }

    const scoredStops = pendingStops.map((stop) => {
      const outlet = outletMap.get(stop.outletId);

      let distanceKm = 10;
      if (
        outlet?.latitude != null &&
        outlet.longitude != null
      ) {
        distanceKm = this.getDistance(currentLat, currentLng, outlet.latitude, outlet.longitude);
      }

      const deliveryUrgency = 0.5;
      const visitFrequencyDue = 0.5;
      const outletPriority = 0.5;
      const distanceScore = Math.max(0, 1 - distanceKm / 50);

      const priorityScore = (deliveryUrgency * 0.35) + (distanceScore * 0.25) + (visitFrequencyDue * 0.20) + (outletPriority * 0.20);

      stop.priorityScore = Number(priorityScore.toFixed(2));
      stop.distanceKm = Number(distanceKm.toFixed(2));
      stop.etaMinutes = Math.round(distanceKm * 2);

      return stop;
    });

    scoredStops.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

    await this.stopRepo.save(scoredStops);

    const nextStop = scoredStops[0];
    return this.serializeStop(
      nextStop,
      outletMap.get(nextStop.outletId),
      'next-best-stop',
    );
  }

  async skipStop(stopId: string, reasonCode: string, freeText: string, userId: string, lat?: number, lng?: number) {
    if (reasonCode === 'OTHER' && freeText.trim().length < 5) {
      throw new BadRequestException('Enter a short reason when selecting Other.');
    }

    const stop = await this.getOwnedStopOrThrow(stopId, userId);

    stop.status = 'skipped';
    await this.stopRepo.save(stop);

    const event = this.eventRepo.create({
      stopId,
      eventType: 'skip',
      reasonCode,
      freeTextReason: freeText,
      triggeredByUserId: userId,
    });
    await this.eventRepo.save(event);

    await this.notifyRouteSkip(stop, reasonCode, freeText, userId);
    await this.refreshSessionStatus(stop.routeSessionId);

    return this.getNextStop(stop.routeSessionId, userId, lat, lng);
  }

  async startStop(stopId: string, userId: string) {
    const stop = await this.getOwnedStopOrThrow(stopId, userId);

    if (stop.actualSeq == null) {
      stop.actualSeq = await this.nextActualSequence(stop.routeSessionId);
    }
    stop.status = 'in_progress';
    await this.stopRepo.save(stop);

    const event = this.eventRepo.create({
      stopId,
      eventType: 'started',
      triggeredByUserId: userId,
    });
    await this.eventRepo.save(event);

    await this.refreshSessionStatus(stop.routeSessionId);

    const outlet = await this.outletRepo.findOne({ where: { id: stop.outletId } });
    return this.serializeStop(stop, outlet, 'resume-current-visit');
  }

  async completeStop(stopId: string, userId: string) {
    const stop = await this.getOwnedStopOrThrow(stopId, userId);

    if (stop.actualSeq == null) {
      stop.actualSeq = await this.nextActualSequence(stop.routeSessionId);
    }
    stop.status = 'completed';
    await this.stopRepo.save(stop);

    const event = this.eventRepo.create({
      stopId,
      eventType: 'completed',
      triggeredByUserId: userId,
    });
    await this.eventRepo.save(event);

    await this.refreshSessionStatus(stop.routeSessionId);

    const outlet = await this.outletRepo.findOne({ where: { id: stop.outletId } });
    return this.serializeStop(stop, outlet, 'resume-current-visit');
  }

  async getProgress(
    sessionId: string,
    userId: string,
  ): Promise<SerializedRouteProgress> {
    await this.getOwnedSessionOrThrow(sessionId, userId);
    await this.refreshSessionStatus(sessionId);

    const stops = await this.stopRepo.find({
      where: { routeSessionId: sessionId },
    });
    const counts = this.countStops(stops);

    return {
      sessionId,
      totalStops: stops.length,
      pendingStops: counts.pending,
      inProgressStops: counts.inProgress,
      completedStops: counts.completed,
      skippedStops: counts.skipped,
      currentStopNumber: Math.max(
        0,
        counts.completed + counts.skipped + counts.inProgress,
      ),
    };
  }

  private async nextActualSequence(routeSessionId: string) {
    const stops = await this.stopRepo.find({
      where: { routeSessionId },
    });

    return stops.filter((stop) => stop.actualSeq != null).length + 1;
  }

  private async getOwnedSessionOrThrow(sessionId: string, userId: string) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Smart route session not found');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(
        'This smart route session does not belong to the current user.',
      );
    }

    return session;
  }

  private async getOwnedStopOrThrow(stopId: string, userId: string) {
    const stop = await this.stopRepo.findOne({
      where: { id: stopId },
    });
    if (!stop) {
      throw new NotFoundException('Stop not found');
    }

    await this.getOwnedSessionOrThrow(stop.routeSessionId, userId);
    return stop;
  }

  private async buildSessionResponse(session: RouteSession) {
    await this.refreshSessionStatus(session.id);

    const freshSession = await this.sessionRepo.findOne({
      where: { id: session.id },
    });
    const stops = await this.stopRepo.find({
      where: { routeSessionId: session.id },
      order: { suggestedSeq: 'ASC' },
    });
    const outlets =
      stops.length == 0
        ? []
        : await this.outletRepo.find({
            where: { id: In(stops.map((stop) => stop.outletId)) },
          });
    const outletMap = new Map(outlets.map((outlet) => [outlet.id, outlet]));
    const counts = this.countStops(stops);
    const assignedOutlets: SerializedRouteOutlet[] = stops.map((stop) => {
      const outlet = outletMap.get(stop.outletId);
      return {
        id: stop.outletId,
        outletName: outlet?.outletName ?? 'Unknown outlet',
        ownerName: outlet?.ownerName ?? 'Owner not set',
        address: outlet?.address ?? null,
        latitude: outlet?.latitude ?? null,
        longitude: outlet?.longitude ?? null,
        suggestedSeq: stop.suggestedSeq,
        stopStatus: stop.status,
      };
    });

    const activeSession = freshSession ?? session;

    return {
      id: activeSession.id,
      userId: activeSession.userId,
      status: activeSession.status,
      routeDate: activeSession.routeDate,
      startTime: activeSession.startTime,
      endTime: activeSession.endTime,
      totalStops: stops.length,
      pendingStops: counts.pending,
      inProgressStops: counts.inProgress,
      completedStops: counts.completed,
      skippedStops: counts.skipped,
      assignedOutlets,
    };
  }

  private countStops(stops: RoutePlanStop[]) {
    return stops.reduce(
      (summary, stop) => {
        if (stop.status === 'completed') {
          summary.completed += 1;
        } else if (stop.status === 'in_progress') {
          summary.inProgress += 1;
        } else if (stop.status === 'skipped') {
          summary.skipped += 1;
        } else {
          summary.pending += 1;
        }

        return summary;
      },
      { pending: 0, inProgress: 0, completed: 0, skipped: 0 },
    );
  }

  private serializeStop(
    stop: RoutePlanStop,
    outlet: Outlet | null | undefined,
    recommendation: SerializedRouteStop['recommendation'],
  ): SerializedRouteStop {
    const priorityScore =
      stop.priorityScore == null ? null : Number(stop.priorityScore);

    return {
      id: stop.id,
      routeSessionId: stop.routeSessionId,
      outletId: stop.outletId,
      outletName: outlet?.outletName ?? 'Unknown outlet',
      ownerName: outlet?.ownerName ?? 'Owner not set',
      address: outlet?.address ?? null,
      latitude: outlet?.latitude ?? null,
      longitude: outlet?.longitude ?? null,
      suggestedSeq: stop.suggestedSeq,
      actualSeq: stop.actualSeq ?? null,
      purpose: stop.purpose,
      status: stop.status,
      priorityScore,
      priorityBand: this.getPriorityBand(priorityScore),
      etaMinutes: stop.etaMinutes ?? null,
      distanceKm: stop.distanceKm == null ? null : Number(stop.distanceKm),
      recommendation,
    };
  }

  private getPriorityBand(priorityScore: number | null) {
    if (priorityScore == null) {
      return 'Standard';
    }

    if (priorityScore >= 0.8) {
      return 'Highest priority';
    }

    if (priorityScore >= 0.65) {
      return 'Recommended';
    }

    return 'Standard';
  }

  private async refreshSessionStatus(routeSessionId: string) {
    const session = await this.sessionRepo.findOne({
      where: { id: routeSessionId },
    });
    if (!session) {
      return null;
    }

    const stops = await this.stopRepo.find({
      where: { routeSessionId },
    });
    const counts = this.countStops(stops);
    const touchedStops = counts.completed + counts.inProgress + counts.skipped;

    if (stops.length > 0 && counts.pending === 0 && counts.inProgress === 0) {
      session.status = 'completed';
      session.startTime = session.startTime ?? new Date();
      session.endTime = session.endTime ?? new Date();
    } else if (touchedStops > 0) {
      session.status = 'in_progress';
      session.startTime = session.startTime ?? new Date();
      session.endTime = null;
    } else {
      session.status = 'pending';
      session.endTime = null;
    }

    return this.sessionRepo.save(session);
  }

  private async notifyRouteSkip(
    stop: RoutePlanStop,
    reasonCode: string,
    freeText: string,
    skippedByUserId: string,
  ) {
    const [session, outlet, skippedBy, recipients] = await Promise.all([
      this.sessionRepo.findOne({ where: { id: stop.routeSessionId } }),
      this.outletRepo.findOne({ where: { id: stop.outletId } }),
      this.userRepo.findOne({ where: { id: skippedByUserId } }),
      this.userRepo.find({
        where: {
          role: In([
            Role.ADMIN,
            Role.TERRITORY_DISTRIBUTOR,
            Role.REGIONAL_MANAGER,
          ]),
        },
      }),
    ]);

    if (!session || !outlet || !skippedBy) {
      return;
    }

    const skippedByName =
      `${skippedBy.firstName} ${skippedBy.lastName}`.trim() || skippedBy.username;
    const reasonLabel = this.formatSkipReason(reasonCode);
    const note = freeText.trim();
    const message = note.length > 0
      ? `${skippedByName} skipped ${outlet.outletName}. Reason: ${reasonLabel}. Note: ${note}`
      : `${skippedByName} skipped ${outlet.outletName}. Reason: ${reasonLabel}.`;

    const targetUsers = recipients.filter((user) => {
      if (user.role === Role.ADMIN) {
        return true;
      }

      if (
        user.role === Role.TERRITORY_DISTRIBUTOR &&
        user.territoryId === session.territoryId
      ) {
        return true;
      }

      if (
        user.role === Role.REGIONAL_MANAGER &&
        (
          (outlet.warehouseId != null && user.warehouseId === outlet.warehouseId) ||
          (session.territoryId != null && user.territoryId === session.territoryId)
        )
      ) {
        return true;
      }

      return false;
    });

    await Promise.all(
      targetUsers.map((user) =>
        this.activityService.logForUser({
          userId: user.id,
          type: 'SMART_ROUTE_STOP_SKIPPED',
          title: 'Suggested outlet skipped',
          message,
          metadata: {
            routeSessionId: stop.routeSessionId,
            stopId: stop.id,
            outletId: outlet.id,
            outletName: outlet.outletName,
            reasonCode,
            freeText: note,
            skippedByUserId,
            skippedByName,
          },
        }),
      ),
    );
  }

  private formatSkipReason(reasonCode: string) {
    switch (reasonCode) {
      case 'CUSTOMER_CLOSED':
        return 'Customer branch closed early';
      case 'NO_STOCK_NEEDED':
        return 'Outlet does not need stock today';
      case 'ALREADY_VISITED':
        return 'Outlet already visited';
      case 'OTHER':
        return 'Other reason';
      default:
        return reasonCode;
    }
  }
}
