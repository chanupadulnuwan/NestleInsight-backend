import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, {
    message: 'otp must be a 6 digit code',
  })
  otp: string;
}
