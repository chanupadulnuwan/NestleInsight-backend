import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), ActivityModule],
  controllers: [UsersController],
  providers: [UsersService, JwtAuthGuard, RolesGuard],
  exports: [TypeOrmModule, UsersService],
})
export class UsersModule {}
