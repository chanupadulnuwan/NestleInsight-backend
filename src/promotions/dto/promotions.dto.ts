import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, Min, IsArray } from 'class-validator';

export class CreatePromotionDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDate()
  @Type(() => Date)
  startDate!: Date;

  @IsDate()
  @Type(() => Date)
  endDate!: Date;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  promotionType!: string;

  @IsString()
  discountType!: string;

  @IsNumber()
  discountValue!: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  minQuantity?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minOrderValue?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  usageLimit?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  perShopLimit?: number;

  // Added: Allow an array of Product IDs
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eligibleProductIds?: string[];

  // Added: Allow an array of Territory IDs
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eligibleTerritoryIds?: string[];
}

export class UpdatePromotionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  startDate?: Date;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  endDate?: Date;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  promotionType?: string;

  @IsString()
  @IsOptional()
  discountType?: string;

  @IsNumber()
  @IsOptional()
  discountValue?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  minQuantity?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minOrderValue?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  usageLimit?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  perShopLimit?: number;

  // Added for updates as well
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eligibleProductIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eligibleTerritoryIds?: string[];
}