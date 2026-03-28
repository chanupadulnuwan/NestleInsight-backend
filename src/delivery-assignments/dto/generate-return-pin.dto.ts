import { IsUUID } from 'class-validator';

export class GenerateReturnPinDto {
  @IsUUID()
  assignmentId: string;
}
