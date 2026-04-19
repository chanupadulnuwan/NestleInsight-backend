import { IsOptional, IsString } from 'class-validator';

export class UpdateReportDraftDto {
  @IsOptional()
  @IsString()
  repComments?: string;
}
