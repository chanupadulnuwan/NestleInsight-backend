import { IsString } from 'class-validator';

export class GenerateReportDto {
  @IsString()
  routeId: string;
}
