import { IsOptional, IsString, IsUUID } from 'class-validator';

export class GenerateReturnPinDto {
  @IsUUID()
  assignmentId: string;

  @IsOptional()
  @IsString()
  reviewNote?: string;
}
