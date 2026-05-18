import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RequestEndRouteReviewDto {
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
}
