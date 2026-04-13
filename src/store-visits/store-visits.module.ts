import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StoreVisit } from './entities/store-visit.entity';
import { StoreVisitsController } from './store-visits.controller';
import { StoreVisitsService } from './store-visits.service';

@Module({
  imports: [TypeOrmModule.forFeature([StoreVisit]), ActivityModule],
  controllers: [StoreVisitsController],
  providers: [StoreVisitsService, JwtAuthGuard, RolesGuard],
  exports: [StoreVisitsService],
})
export class StoreVisitsModule {}
