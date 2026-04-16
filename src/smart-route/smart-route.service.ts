import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RouteSession } from '../sales-routes/entities/route-session.entity';
import { RoutePlanStop } from '../sales-routes/entities/route-plan-stop.entity';
import { RouteStopEvent } from '../sales-routes/entities/route-stop-event.entity';
import { Outlet } from '../outlets/entities/outlet.entity';

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
  ) {}

  async getOrCreateSession(userId: string, role: string, date: Date, territoryId: string): Promise<RouteSession> {
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
        territoryId: territoryId,
        routeDate: new Date(),
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

    return session;
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

  async getNextStop(sessionId: string, currentLat?: number, currentLng?: number) {
    const pendingStops = await this.stopRepo.find({
      where: { routeSessionId: sessionId, status: 'pending' },
    });

    if (pendingStops.length === 0) {
      return null;
    }

    if (!currentLat || !currentLng) {
      // Missing lat/lng fallback -> return stops ordered by suggestedSeq
      pendingStops.sort((a, b) => a.suggestedSeq - b.suggestedSeq);
      return pendingStops[0];
    }

    // Load outlet coordinates to calculate distance priorities
    const outletIds = pendingStops.map(s => s.outletId);
    if (outletIds.length === 0) return null;
    
    // Convert to IN clauses with proper typeorm abstractions ideally, fallback string array OK
    const qb = this.outletRepo.createQueryBuilder('outlet')
      .where('outlet.id IN (:...ids)', { ids: outletIds });
    const outlets = await qb.getMany();
    const outletMap = new Map(outlets.map(o => [o.id, o]));

    const scoredStops = pendingStops.map(stop => {
      const outlet = outletMap.get(stop.outletId);
      
      let distanceKm = 10; // Default buffer distance
      if (outlet && outlet.latitude && outlet.longitude) {
        distanceKm = this.getDistance(currentLat, currentLng, outlet.latitude, outlet.longitude);
      }
      
      const deliveryUrgency = 0.5; // Scale 0-1
      const visitFrequencyDue = 0.5; // Scale 0-1
      const outletPriority = 0.5; // Scale 0-1
      const distanceScore = Math.max(0, 1 - (distanceKm / 50)); 

      const priorityScore = (deliveryUrgency * 0.35) + (distanceScore * 0.25) + (visitFrequencyDue * 0.20) + (outletPriority * 0.20);
      
      stop.priorityScore = Number(priorityScore.toFixed(2));
      stop.distanceKm = Number(distanceKm.toFixed(2));
      stop.etaMinutes = Math.round(distanceKm * 2);

      return stop;
    });

    scoredStops.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
    
    await this.stopRepo.save(scoredStops);

    return scoredStops[0];
  }

  async skipStop(stopId: string, reasonCode: string, freeText: string, userId: string, lat?: number, lng?: number) {
    const stop = await this.stopRepo.findOne({ where: { id: stopId }});
    if (!stop) throw new NotFoundException('Stop not found');

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

    return this.getNextStop(stop.routeSessionId, lat, lng);
  }

  async startStop(stopId: string, userId: string) {
    const stop = await this.stopRepo.findOne({ where: { id: stopId }});
    if (!stop) throw new NotFoundException('Stop not found');

    stop.status = 'in_progress';
    await this.stopRepo.save(stop);

    const event = this.eventRepo.create({
      stopId,
      eventType: 'started',
      triggeredByUserId: userId,
    });
    await this.eventRepo.save(event);

    return stop;
  }

  async completeStop(stopId: string, userId: string) {
    const stop = await this.stopRepo.findOne({ where: { id: stopId }});
    if (!stop) throw new NotFoundException('Stop not found');

    stop.status = 'completed';
    await this.stopRepo.save(stop);

    const event = this.eventRepo.create({
      stopId,
      eventType: 'completed',
      triggeredByUserId: userId,
    });
    await this.eventRepo.save(event);

    return stop;
  }
}
