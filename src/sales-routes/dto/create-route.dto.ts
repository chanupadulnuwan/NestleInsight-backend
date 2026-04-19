import { IsString, IsUUID } from 'class-validator';

export class CreateRouteDto {
  @IsString()
  warehouseId!: string;

  @IsUUID()
  vehicleId!: string;
}
