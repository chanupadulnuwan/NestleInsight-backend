import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { Platform } from '../../common/enums/platform.enum';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  // Website auth update: allow the web client to declare WEB access so mobile-only accounts are blocked from the portal.
  @IsOptional()
  @IsEnum(Platform)
  platformAccess?: Platform;
}
