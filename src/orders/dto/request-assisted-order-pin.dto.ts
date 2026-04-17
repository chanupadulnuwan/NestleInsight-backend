import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RequestAssistedOrderPinItemDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;
}

export class RequestAssistedOrderPinDto {
  @IsUUID()
  routeId: string;

  @IsUUID()
  shopId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestAssistedOrderPinItemDto)
  items: RequestAssistedOrderPinItemDto[];
}
