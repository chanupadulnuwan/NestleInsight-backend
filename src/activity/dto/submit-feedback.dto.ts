import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitFeedbackDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  message: string;
}
