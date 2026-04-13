import { IsString, IsEmail, IsOptional, IsNumber } from 'class-validator';

export class CreateOutletDto {
  @IsString()
  outletName: string;

  @IsString()
  ownerName: string;

  @IsString()
  ownerPhone: string;

  @IsEmail()
  ownerEmail: string;

  @IsString()
  address: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;
}
