import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CompleteSalesRepDeliveryDto {
  @IsUUID()
  @IsOptional()
  orderId?: string;

  @IsUUID()
  routeId: string;

  @IsString()
  @MinLength(1)
  confirmationNote: string;

  @IsDateString()
  @IsOptional()
  nextDeliveryDate?: string;
}
