import { IsOptional, IsJSON, IsBoolean, IsString } from 'class-validator';

export class CompleteVisitDto {
  @IsOptional()
  shelfStockJson?: any;

  @IsOptional()
  backroomStockJson?: any;

  @IsOptional()
  osaIssuesJson?: any;

  @IsOptional()
  promotionsJson?: any;

  @IsOptional()
  @IsBoolean()
  planogramOk?: boolean;

  @IsOptional()
  @IsBoolean()
  posmOk?: boolean;

  @IsOptional()
  @IsString()
  outletFeedback?: string;
}
