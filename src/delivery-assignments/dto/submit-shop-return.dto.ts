import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ShopReturnItemDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  productNameSnapshot: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsIn(['ITEM', 'CASE'])
  unitType: 'ITEM' | 'CASE';

  @IsIn(['EXPIRED', 'DAMAGED', 'OTHER'])
  reason: 'EXPIRED' | 'DAMAGED' | 'OTHER';

  @IsOptional()
  @IsString()
  reasonNote?: string;

  @IsOptional()
  @IsNumber()
  unitPrice?: number;
}

export class SubmitShopReturnDto {
  @IsString()
  pin: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShopReturnItemDto)
  items: ShopReturnItemDto[];
}
