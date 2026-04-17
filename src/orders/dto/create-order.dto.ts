import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @IsUUID()
  productId: string;

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

  @IsString()
  @IsUUID()
  @IsOptional()
  appliedPromotionId?: string;

  @IsString()
  @IsOptional()
  appliedPromotionCode?: string;

  @IsNumber()
  @IsOptional()
  discountAmount?: number;
}
