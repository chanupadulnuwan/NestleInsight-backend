import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CheckInVisitDto {
  @IsUUID()
  @IsNotEmpty()
  routeId: string;

  @IsUUID()
  @IsNotEmpty()
  shopId: string;

  @IsString()
  @IsOptional()
  visitNotes?: string;
}
