import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsUUID,
  IsNumber,
  Matches,
  MinLength,
  MaxLength,
  IsLatitude,
  IsLongitude,
  IsOptional, // 👈 ADDED THIS RIGHT HERE
} from 'class-validator';



export class CreateOutletDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(100)
  outletName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(100)
  ownerName: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/, {
    message: 'contactNumber must be a valid phone number',
  })
  contactNumber: string;

  @IsEmail()
  @IsOptional()
  ownerEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  address?: string;

  @IsUUID()
  @IsNotEmpty()
  territoryId: string;

  @IsLatitude()
  @IsNotEmpty()
  latitude: number;

  @IsLongitude()
  @IsNotEmpty()
  longitude: number;
}

