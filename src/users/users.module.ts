import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from './entities/user.entity';
import { TmUsersController } from './tm-users.controller';
import { TmUsersService } from './tm-users.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), ActivityModule],
  controllers: [UsersController, TmUsersController],
  providers: [UsersService, TmUsersService, JwtAuthGuard, RolesGuard, PortalApprovalGuard],
  exports: [TypeOrmModule, UsersService],
})
export class UsersModule {}
