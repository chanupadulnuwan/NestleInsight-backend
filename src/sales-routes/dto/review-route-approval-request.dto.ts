import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

import { RouteApprovalRequestStatus } from '../entities/route-approval-request.entity';

export class ReviewRouteApprovalRequestDto {
  @IsEnum(RouteApprovalRequestStatus)
  decision: RouteApprovalRequestStatus.APPROVED | RouteApprovalRequestStatus.REJECTED;

  @IsOptional()
  @IsString()
  @MinLength(2)
  notes?: string;
}
