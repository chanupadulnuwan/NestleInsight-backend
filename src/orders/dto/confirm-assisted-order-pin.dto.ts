import { Matches, MinLength } from 'class-validator';

export class ConfirmAssistedOrderPinDto {
  @Matches(/^\d{6}$/)
  pin: string;

  @MinLength(5)
  assistedReason: string;
}
