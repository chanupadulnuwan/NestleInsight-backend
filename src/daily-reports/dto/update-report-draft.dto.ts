import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateReportDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  repComments?: string;
}
