import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePlannerReportDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  content: string;

  @IsBoolean()
  @IsOptional()
  isCritical?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  criticalReason?: string;
}
