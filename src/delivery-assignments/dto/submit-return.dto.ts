import {
  IsArray,
  IsInt,
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

  @IsString()
  reason: string;
}

export class SubmitReturnDto {
  @IsString()
  @Length(6, 6)
  tmPin: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}
