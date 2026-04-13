import { IsString, IsOptional, IsNumber } from 'class-validator';

export class StartVisitDto {
  @IsString()
  routeId: string;

  @IsString()
  @IsOptional()
  shopId?: string;

  @IsString()
  shopNameSnapshot: string;

  @IsString()
  territoryId: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;
}
