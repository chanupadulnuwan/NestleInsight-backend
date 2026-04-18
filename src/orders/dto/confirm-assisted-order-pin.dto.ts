import { IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class ConfirmAssistedOrderPinDto {
  @IsUUID()
  orderId: string;

  @Matches(/^\d{4}$/, { message: 'pin must be a 4-digit number' })
  pin: string;

  @MinLength(5, {
    message: 'assistedReason must be at least 5 characters long',
  })
  @MaxLength(250, {
    message: 'assistedReason must be 250 characters or less',
  })
  assistedReason: string;
}
