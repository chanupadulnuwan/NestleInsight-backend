import { Matches } from 'class-validator';

export class EnterPinDto {
  @Matches(/^\d{6}$/, { message: 'pin must be a 6-digit number' })
  pin!: string;
}
