import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { RejectUserDto } from './dto/reject-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('pending')
  async getPendingUsers() {
    return this.usersService.findPendingUsersSafe();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/approve')
  async approveUser(@Param('id') id: string, @Req() req: any) {
    return this.usersService.approveUser(id, req.user?.username ?? 'admin');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/reject')
  async rejectUser(
    @Param('id') id: string,
    @Body() rejectUserDto: RejectUserDto,
  ) {
    return this.usersService.rejectUser(id, rejectUserDto.rejectionReason);
  }
}