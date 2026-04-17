import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { DailyReport } from '../daily-reports/entities/daily-report.entity';
import { SalesIncident } from '../sales-incidents/entities/sales-incident.entity';
import { RoutePlanStop } from '../sales-routes/entities/route-plan-stop.entity';
import { RouteSession } from '../sales-routes/entities/route-session.entity';
import { RouteStopEvent } from '../sales-routes/entities/route-stop-event.entity';
import { SalesRoute } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class FieldMonitoringService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(SalesRoute)
    private readonly routeRepo: Repository<SalesRoute>,

    @InjectRepository(RouteSession)
    private readonly sessionRepo: Repository<RouteSession>,

    @InjectRepository(RoutePlanStop)
    private readonly stopRepo: Repository<RoutePlanStop>,

    @InjectRepository(RouteStopEvent)
    private readonly stopEventRepo: Repository<RouteStopEvent>,

    @InjectRepository(DailyReport)
    private readonly reportRepo: Repository<DailyReport>,

    @InjectRepository(SalesIncident)
    private readonly incidentRepo: Repository<SalesIncident>,

    @InjectRepository(StoreVisit)
    private readonly visitRepo: Repository<StoreVisit>,
  ) {}

  // ─── Team Overview ───────────────────────────────────────────────────────────
  async getTeamOverview(date: string, territoryId?: string) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    // Field roles to monitor
    const FIELD_ROLES = ['SALES_REP', 'TERRITORY_DISTRIBUTOR'];

    const userQb = this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.territory', 'territory')
      .where('u.role IN (:...roles)', { roles: FIELD_ROLES });

    if (territoryId) {
      userQb.andWhere('u.territoryId = :territoryId', { territoryId });
    }

    const users = await userQb.getMany();
    if (users.length === 0) return [];

    const userIds = users.map((u) => u.id);

    // Fetch routes for the date window
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .where('r.salesRepId IN (:...userIds)', { userIds })
      .andWhere('r.createdAt BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
      .getMany();

    const routeIds = routes.map((r) => r.id);

    // Fetch plan stops for those routes (via route sessions)
    const sessions = routeIds.length
      ? await this.sessionRepo
          .createQueryBuilder('s')
          .where('s.userId IN (:...userIds)', { userIds })
          .andWhere('s.routeDate BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
          .getMany()
      : [];

    const sessionIds = sessions.map((s) => s.id);

    const planStops = sessionIds.length
      ? await this.stopRepo
          .createQueryBuilder('ps')
          .where('ps.routeSessionId IN (:...sessionIds)', { sessionIds })
          .getMany()
      : [];

    // Fetch stop events
    const stopIds = planStops.map((ps) => ps.id);
    const stopEvents = stopIds.length
      ? await this.stopEventRepo
          .createQueryBuilder('e')
          .where('e.stopId IN (:...stopIds)', { stopIds })
          .getMany()
      : [];

    // Fetch daily reports
    const reports = await this.reportRepo
      .createQueryBuilder('dr')
      .where('dr.salesRepId IN (:...userIds)', { userIds })
      .andWhere('dr.reportDate = :date', { date })
      .getMany();

    // Assemble per-user rows
    return users.map((user) => {
      const userRoutes = routes.filter((r) => r.salesRepId === user.id);
      const routeStarted = userRoutes.length > 0;
      const routeClosed = userRoutes.some((r) => r.status === 'CLOSED');

      // Find sessions for this user
      const userSessionIds = sessions
        .filter((s) => s.userId === user.id)
        .map((s) => s.id);

      const userStops = planStops.filter((ps) =>
        userSessionIds.includes(ps.routeSessionId),
      );

      const assignedOutlets = userStops.length;

      // Count skipped stops (stops with a 'skipped' or 'skip' event)
      const userStopIds = userStops.map((ps) => ps.id);
      const skippedStopIds = new Set(
        stopEvents
          .filter(
            (e) =>
              userStopIds.includes(e.stopId) &&
              (e.eventType === 'SKIPPED' || e.eventType === 'SKIP'),
          )
          .map((e) => e.stopId),
      );

      const completedStopIds = new Set(
        stopEvents
          .filter(
            (e) =>
              userStopIds.includes(e.stopId) &&
              (e.eventType === 'COMPLETED' || e.eventType === 'COMPLETE'),
          )
          .map((e) => e.stopId),
      );

      // Field time calculation
      let totalFieldMinutes = 0;
      const userRoute = userRoutes[0];
      if (userRoute?.startedAt && userRoute?.closedAt) {
        totalFieldMinutes = Math.round(
          (new Date(userRoute.closedAt).getTime() -
            new Date(userRoute.startedAt).getTime()) /
            60000,
        );
      } else if (userRoute?.startedAt) {
        totalFieldMinutes = Math.round(
          (Date.now() - new Date(userRoute.startedAt).getTime()) / 60000,
        );
      }

      const userReport = reports.find((dr) => dr.salesRepId === user.id);

      return {
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`.trim() || user.username,
        role: user.role,
        territory: user.territory?.name ?? null,
        territoryId: user.territoryId ?? null,
        assignedOutlets,
        completed: completedStopIds.size,
        skipped: skippedStopIds.size,
        totalFieldTimeMinutes: totalFieldMinutes,
        routeStarted,
        routeClosed,
        reportStatus: userReport?.status ?? null,
        routeId: userRoute?.id ?? null,
      };
    });
  }

  // ─── Employee Drill-Down ─────────────────────────────────────────────────────
  async getEmployeeDetail(userId: string, date: string) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: { territory: true },
    });

    // Route
    const route = await this.routeRepo
      .createQueryBuilder('r')
      .where('r.salesRepId = :userId', { userId })
      .andWhere('r.createdAt BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
      .orderBy('r.createdAt', 'DESC')
      .getOne();

    // Session
    const session = await this.sessionRepo
      .createQueryBuilder('s')
      .where('s.userId = :userId', { userId })
      .andWhere('s.routeDate BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
      .orderBy('s.routeDate', 'DESC')
      .getOne();

    // Route timeline stops
    let routeTimeline: Array<Record<string, unknown>> = [];
    let skipLog: Array<Record<string, unknown>> = [];

    if (session) {
      const stops = await this.stopRepo
        .createQueryBuilder('ps')
        .where('ps.routeSessionId = :sessionId', { sessionId: session.id })
        .orderBy('COALESCE(ps.actualSeq, ps.suggestedSeq)', 'ASC')
        .getMany();

      const stopIds = stops.map((s) => s.id);
      const events = stopIds.length
        ? await this.stopEventRepo
            .createQueryBuilder('e')
            .where('e.stopId IN (:...stopIds)', { stopIds })
            .orderBy('e.eventTime', 'ASC')
            .getMany()
        : [];

      routeTimeline = await Promise.all(stops.map(async (stop) => {
        const stopEvts = events.filter((e) => e.stopId === stop.id);
        const arrivedAt = stopEvts.find((e) => e.eventType === 'ARRIVED')?.eventTime ?? null;
        const completedAt =
          stopEvts.find((e) => e.eventType === 'COMPLETED' || e.eventType === 'COMPLETE')
            ?.eventTime ?? null;
        const skippedAt =
          stopEvts.find((e) => e.eventType === 'SKIPPED' || e.eventType === 'SKIP')
            ?.eventTime ?? null;

        let durationMinutes: number | null = null;
        if (arrivedAt && completedAt) {
          durationMinutes = Math.round(
            (new Date(completedAt).getTime() - new Date(arrivedAt).getTime()) / 60000,
          );
        }

        // Fetch visit data for photos
        const visit = await this.visitRepo.findOne({
          where: { stopId: stop.id },
          select: ['photoUrls'],
        });

        return {
          stopId: stop.id,
          sequence: stop.actualSeq ?? stop.suggestedSeq,
          outletId: stop.outletId,
          outletName: `Outlet #${stop.outletId.slice(0, 6)}`,
          purpose: stop.purpose,
          status: stop.status,
          durationMinutes,
          arrivedAt,
          completedAt,
          skippedAt,
          reasonCode:
            stopEvts.find((e) => e.reasonCode)?.reasonCode ?? null,
          photoUrls: visit?.photoUrls ?? [],
        };
      }));

      skipLog = routeTimeline
        .filter((s) => s.status === 'skipped' || s.skippedAt)
        .map((s) => ({
          outletId: s.outletId,
          outletName: s.outletName,
          reasonCode: s.reasonCode ?? '—',
          time: s.skippedAt,
        }));
    }

    // Daily report
    const report = await this.reportRepo
      .createQueryBuilder('dr')
      .where('dr.salesRepId = :userId', { userId })
      .andWhere('dr.reportDate = :date', { date })
      .getOne();

    // Incidents
    const incidents = route
      ? await this.incidentRepo
          .createQueryBuilder('i')
          .where('i.salesRepId = :userId', { userId })
          .andWhere('i.routeId = :routeId', { routeId: route.id })
          .orderBy('i.createdAt', 'DESC')
          .getMany()
      : [];

    return {
      userId: user?.id ?? userId,
      userName: user
        ? `${user.firstName} ${user.lastName}`.trim() || user.username
        : userId,
      role: user?.role ?? null,
      territory: user?.territory?.name ?? null,
      territoryId: user?.territoryId ?? null,
      route: route
        ? {
            id: route.id,
            status: route.status,
            startedAt: route.startedAt,
            closedAt: route.closedAt,
          }
        : null,
      routeTimeline,
      skipLog,
      incidents: incidents.map((inc) => ({
        id: inc.id,
        incidentType: inc.incidentType,
        severity: inc.severity,
        description: inc.description,
        outletId: inc.shopId,
        time: inc.createdAt,
      })),
      dailyReport: report
        ? {
            id: report.id,
            status: report.status,
            reportDate: report.reportDate,
            submittedAt: report.submittedAt,
            repComments: report.repComments,
            routeSummary: report.routeSummaryJson,
            visitSummary: report.visitSummaryJson,
            deliverySummary: report.deliverySummaryJson,
            incidentSummary: report.incidentSummaryJson,
          }
        : null,
    };
  }
}
