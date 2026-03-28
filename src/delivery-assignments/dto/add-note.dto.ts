import { IsOptional, IsString } from 'class-validator';

export class AddNoteDto {
  @IsOptional()
  @IsString()
  assignmentId?: string;

  @IsString()
  category: string;

  @IsString()
  message: string;
}
