import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import {
  LoadRequestStockLineDto,
} from './submit-load-request.dto';

export enum LoadRequestDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ADJUSTED = 'ADJUSTED',
}

export class ApproveLoadRequestDto {
  @IsEnum(LoadRequestDecision)
  decision: LoadRequestDecision;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoadRequestStockLineDto)
  @IsOptional()
  adjustedDeliveryStock?: LoadRequestStockLineDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoadRequestStockLineDto)
  @IsOptional()
  adjustedFreeSaleStock?: LoadRequestStockLineDto[];
}
