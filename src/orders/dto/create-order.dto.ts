import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @IsString()
  @MaxLength(60)
  productCode: string;

  @IsString()
  @MaxLength(160)
  productName: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageAssetPath?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  unitPrice: number;

  // TODO: Replace these fallback quantity limits with product-level min/max values from admin master data.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
