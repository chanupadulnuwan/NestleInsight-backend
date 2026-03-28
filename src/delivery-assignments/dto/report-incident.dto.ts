import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const INCIDENT_TYPES = [
  'VEHICLE_ACCIDENT',
  'VEHICLE_BREAKDOWN',
  'FUEL_PROBLEM',
  'ROUTE_ISSUE',
  'DELIVERY_DELAY',
  'CUSTOMER_DISPUTE',
  'OTHER',
] as const;

export class ReportIncidentDto {
  @IsUUID()
  @IsOptional()
  assignmentId?: string;

  @IsIn(INCIDENT_TYPES)
  incidentType: string;

  @IsString()
  description: string;
}
