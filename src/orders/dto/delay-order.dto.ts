import { IsString, MinLength } from 'class-validator';

export class DelayOrderDto {
  @IsString()
  @MinLength(5, { message: 'Please provide a meaningful delay reason (at least 5 characters).' })
  reason: string;
}
