import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { AccountStatus } from '../../common/enums/account-status.enum';

export class UpdateUserStatusDto {
  @IsEnum(AccountStatus)
  status: AccountStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
