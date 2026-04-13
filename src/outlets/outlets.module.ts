import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Outlet } from './entities/outlet.entity';
import { OutletsController } from './outlets.controller';
import { OutletsService } from './outlets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Outlet]), ActivityModule],
  controllers: [OutletsController],
  providers: [OutletsService, JwtAuthGuard, RolesGuard],
  exports: [OutletsService],
})
export class OutletsModule {}
