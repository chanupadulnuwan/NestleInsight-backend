import { Type } from 'class-transformer';
import { IsString, IsInt, Min, IsOptional } from 'class-validator';

export class LogReturnItemDto {
  @IsString() productId: string;
  @IsString() productName: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityCases?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityUnits?: number;

  @IsOptional()
  @IsString()
  unitType?: string;

  @IsString() reason: string;
  @IsOptional() @IsString() notes?: string;
}
