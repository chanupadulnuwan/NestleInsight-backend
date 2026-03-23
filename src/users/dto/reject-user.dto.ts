import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rejectionReason: string;
}