import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { TmUsersService } from './tm-users.service';

class TmRejectUserDto {
  reason: string;
}

@Controller('tm/users')
@UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
@Roles(Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR)
export class TmUsersController {
  constructor(private readonly tmUsersService: TmUsersService) {}

  @Get('pending')
  listPendingUsers(@Req() req: any) {
    return this.tmUsersService.listPendingUsers(req.user.userId);
  }

  @Patch(':id/approve')
  approveUser(@Req() req: any, @Param('id') targetUserId: string) {
    return this.tmUsersService.approveUser(req.user.userId, targetUserId);
  }

  @Patch(':id/reject')
  rejectUser(
    @Req() req: any,
    @Param('id') targetUserId: string,
    @Body() dto: TmRejectUserDto,
  ) {
    return this.tmUsersService.rejectUser(req.user.userId, targetUserId, dto.reason);
  }
}
