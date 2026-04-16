import { IsString, IsInt, Min, IsOptional } from 'class-validator';

export class LogReturnItemDto {
  @IsString() productId: string;
  @IsString() productName: string;
  @IsInt() @Min(0) quantityCases: number;
  @IsString() reason: string;
  @IsOptional() @IsString() notes?: string;
}
