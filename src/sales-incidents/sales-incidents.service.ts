import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import {
  SalesIncident,
  SalesIncidentType,
  SalesIncidentSeverity,
} from './entities/sales-incident.entity';
import { ReportIncidentDto } from './dto/report-incident.dto';

@Injectable()
export class SalesIncidentsService {
  constructor(
    @InjectRepository(SalesIncident)
    private readonly incidentsRepo: Repository<SalesIncident>,
    private readonly activityService: ActivityService,
  ) {}

  async reportIncident(
    userId: string,
    dto: ReportIncidentDto,
  ): Promise<SalesIncident> {
    const incident: any = this.incidentsRepo.create({
      routeId: dto.routeId,
      incidentType: dto.incidentType,
      description: dto.description,
      severity: dto.severity,
      salesRepId: userId,
    } as any);

    const savedIncident: any = await this.incidentsRepo.save(incident);

    await this.activityService.logForUser({
      userId,
      type: 'INCIDENT_REPORTED',
      title: 'Incident Reported',
      message: `${dto.incidentType} incident reported with ${dto.severity} severity`,
      metadata: {
        incidentId: savedIncident.id,
        incidentType: savedIncident.incidentType,
        severity: savedIncident.severity,
        description: dto.description,
      },
    });

    return savedIncident;
  }

  async getIncidents(
    territorryId?: string,
    status?: string,
  ): Promise<SalesIncident[]> {
    const query = this.incidentsRepo.createQueryBuilder('incident');

    if (territorryId) {
      query.andWhere('incident.territoryId = :territorryId', { territorryId });
    }

    return query.orderBy('incident.createdAt', 'DESC').getMany();
  }
}
