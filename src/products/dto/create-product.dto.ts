import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { ProductStatus } from '../../common/enums/product-status.enum';

function trimRequiredString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function toOptionalNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  return Number(value);
}

export class CreateProductDto {
  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  productName: string;

  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  sku: string;

  @Transform(({ value }) => trimRequiredString(value))
  @IsUUID()
  categoryId: string;

  @Transform(({ value }) => trimOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @Transform(({ value }) => trimRequiredString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  packSize: string;

  @Transform(({ value }) => toOptionalNumber(value))
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  unitPrice: number;

  @Transform(({ value }) => toOptionalNumber(value))
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  productsPerCase: number;

  @Transform(({ value }) => toOptionalNumber(value))
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  casePrice?: number;

  @Transform(({ value }) => trimOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  barcode?: string;

  @Transform(({ value }) => trimOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Transform(({ value }) => trimRequiredString(value))
  @IsEnum(ProductStatus)
  status: ProductStatus;
}
