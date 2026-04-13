import { IsIn, IsString, IsOptional } from 'class-validator';

export class ReviewOutletDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
