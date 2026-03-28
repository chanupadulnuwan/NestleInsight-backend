import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateWarehouseInventoryItemDto {
  @IsUUID()
  id: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityOnHand: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevel: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCapacityCases: number;
}

export class UpdateWarehouseInventoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateWarehouseInventoryItemDto)
  items: UpdateWarehouseInventoryItemDto[];
}
