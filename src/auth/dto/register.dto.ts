import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

import { Platform } from '../../common/enums/platform.enum';
import { Role } from '../../common/enums/role.enum';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username can only contain letters, numbers, and underscores',
  })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[0-9]{10,15}$/, {
    message: 'phoneNumber must be a valid phone number',
  })
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number',
  })
  password: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword: string;

  @IsEnum(Role)
  role: Role;

  @IsEnum(Platform)
  platformAccess: Platform;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  shopName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  warehouseName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;
}
