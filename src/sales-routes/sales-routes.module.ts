import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from '../activity/activity.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { SalesRoute } from './entities/sales-route.entity';
import { VanLoadRequest } from './entities/van-load-request.entity';
import { SalesRoutesController } from './sales-routes.controller';
import { SalesRoutesService } from './sales-routes.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SalesRoute, VanLoadRequest, User]),
    ActivityModule,
    UsersModule,
  ],
  controllers: [SalesRoutesController],
  providers: [SalesRoutesService, JwtAuthGuard, RolesGuard],
  exports: [SalesRoutesService],
})
export class SalesRoutesModule {}
