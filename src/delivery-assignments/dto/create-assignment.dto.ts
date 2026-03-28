import { IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAssignmentDto {
  @IsUUID()
  distributorId: string;

  @IsUUID()
  @IsOptional()
  vehicleId?: string;

  @IsArray()
  @IsUUID(undefined, { each: true })
  orderIds: string[];

  @IsDateString()
  @IsOptional()
  deliveryDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
