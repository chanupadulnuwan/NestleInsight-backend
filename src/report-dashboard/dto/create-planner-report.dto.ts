import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

function trimRequiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalBoolean(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}

export class CreatePlannerReportDto {
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(10)
  content: string;

  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  @IsOptional()
  isCritical?: boolean;

  @Transform(({ value }) => trimOptionalString(value))
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  criticalReason?: string;
}
