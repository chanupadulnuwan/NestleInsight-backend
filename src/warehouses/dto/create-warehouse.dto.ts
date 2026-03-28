import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateWarehouseDto {
  @IsUUID()
  territoryId: string;

  @IsNotEmpty()
  name: string;

  @IsNotEmpty()
  address: string;

  @IsNotEmpty()
  phoneNumber: string;

  @IsOptional()
  @IsUUID()
  managerUserId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
