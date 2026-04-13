import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SalesIncident } from './entities/sales-incident.entity';
import { SalesIncidentsController } from './sales-incidents.controller';
import { SalesIncidentsService } from './sales-incidents.service';

@Module({
  imports: [TypeOrmModule.forFeature([SalesIncident]), ActivityModule],
  controllers: [SalesIncidentsController],
  providers: [SalesIncidentsService, JwtAuthGuard, RolesGuard],
  exports: [SalesIncidentsService],
})
export class SalesIncidentsModule {}
