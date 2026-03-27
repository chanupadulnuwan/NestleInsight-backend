import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { RejectUserDto } from './dto/reject-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

type AdminRequest = {
  user?: {
    userId?: string;
    username?: string;
  };
};

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
  @Get('manageable')
  async getManageableUsers() {
    return this.usersService.findManageableUsersSafe();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/approve')
  async approveUser(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.usersService.approveUser(id, {
      userId: req.user?.userId,
      username: req.user?.username ?? 'admin',
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/reject')
  async rejectUser(
    @Param('id') id: string,
    @Body() rejectUserDto: RejectUserDto,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.rejectUser(id, rejectUserDto.rejectionReason, {
      userId: req.user?.userId,
      username: req.user?.username ?? 'admin',
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/status')
  async updateUserStatus(
    @Param('id') id: string,
    @Body() updateUserStatusDto: UpdateUserStatusDto,
    @Req() req: AdminRequest,
  ) {
    return this.usersService.updateUserStatus(id, updateUserStatusDto, {
      userId: req.user?.userId,
      username: req.user?.username ?? 'admin',
    });
  }
}
