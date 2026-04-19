import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

export class UpdateRouteBeatPlanDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  selectedOutletIds: string[];

  @IsOptional()
  saveTemplate?: boolean;
}
