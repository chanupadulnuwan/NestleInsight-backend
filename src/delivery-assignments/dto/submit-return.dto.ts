import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReturnItemDto {
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsString()
  productNameSnapshot: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsIn(['ITEM', 'CASE'])
  unitType?: 'ITEM' | 'CASE';

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  reasonNote?: string;
}

export class SubmitReturnDto {
  @IsString()
  @Length(6, 6)
  tmPin: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashReturnedAmount: number;

  @IsOptional()
  @IsString()
  cashVarianceType?: string;

  @IsOptional()
  @IsString()
  cashVarianceReason?: string;

  @IsOptional()
  @IsString()
  earlyClosureReason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}
