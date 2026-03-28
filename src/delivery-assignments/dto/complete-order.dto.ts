import { IsString, Length } from 'class-validator';

export class CompleteOrderDto {
  @IsString()
  @Length(6, 6)
  pin: string;
}
