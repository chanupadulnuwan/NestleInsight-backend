import { IsString, Length } from 'class-validator';

export class ConfirmRouteApprovalPinDto {
  @IsString()
  @Length(6, 6)
  pin: string;
}
