import { IsIn, IsString, IsOptional, IsNumber } from 'class-validator';
import { SalesIncidentType, SalesIncidentSeverity } from '../entities/sales-incident.entity';

export class ReportIncidentDto {
  @IsString()
  routeId: string;

  @IsIn(Object.values(SalesIncidentType))
  incidentType: SalesIncidentType;

  @IsString()
  description: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsIn(Object.values(SalesIncidentSeverity))
  severity: SalesIncidentSeverity;
}
