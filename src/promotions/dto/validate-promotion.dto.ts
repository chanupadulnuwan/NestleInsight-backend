import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CartItemDto {
  @IsString()
  productId: string;

  @IsNumber()
  price: number;

  @IsNumber()
  quantity: number;
}

export class ValidatePromotionDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsUUID()
  @IsOptional()
  promotionId?: string;

  @IsString()
  territoryId: string;

  @IsNumber()
  cartTotal: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  cartItems: CartItemDto[];

  @IsString()
  @IsOptional()
  shopId?: string;
}
