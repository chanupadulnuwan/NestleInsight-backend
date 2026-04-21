import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class CloseRouteStockLineDto {
  @IsUUID()
  productId: string;

  @IsString()
  productName: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityCases: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityUnits: number;
}

export class CloseRouteReturnItemDto {
  @IsUUID()
  productId: string;

  @IsString()
  productName: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityCases: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  quantityUnits?: number;

  @IsString()
  @IsOptional()
  unitType?: string;

  @IsString()
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CloseRouteDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CloseRouteStockLineDto)
  closingStock: CloseRouteStockLineDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CloseRouteReturnItemDto)
  returnItems: CloseRouteReturnItemDto[];

  @IsString()
  @IsOptional()
  varianceReason?: string;

  @Matches(/^\d{6}$/, { message: 'pin must be a 6-digit number' })
  pin: string;
}
