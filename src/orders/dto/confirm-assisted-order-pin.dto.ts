import { Matches, MaxLength, MinLength } from 'class-validator';

export class ConfirmAssistedOrderPinDto {
  @Matches(/^\d{6}$/, { message: 'pin must be a 6-digit number' })
  pin: string;

  @MinLength(5, {
    message: 'assistedReason must be at least 5 characters long',
  })
  @MaxLength(250, {
    message: 'assistedReason must be 250 characters or less',
  })
  assistedReason: string;
}
