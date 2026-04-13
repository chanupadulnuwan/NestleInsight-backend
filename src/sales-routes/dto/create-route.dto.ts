import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRouteDto {
  @IsString() // Changed this from @IsUUID() to @IsString()
  warehouseId!: string;

  @IsUUID()
  @IsOptional()
  vehicleId?: string;
}