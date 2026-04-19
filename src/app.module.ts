import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { DailyReportsModule } from './daily-reports/daily-reports.module';
import { DeliveryAssignmentsModule } from './delivery-assignments/delivery-assignments.module';
import { OrdersModule } from './orders/orders.module';
import { OutletsModule } from './outlets/outlets.module';
import { ProductsModule } from './products/products.module';
import { PromotionsModule } from './promotions/promotions.module';
import { SalesIncidentsModule } from './sales-incidents/sales-incidents.module';
import { SalesRoutesModule } from './sales-routes/sales-routes.module';
import { StoreVisitsModule } from './store-visits/store-visits.module';
import { TerritoriesModule } from './territories/territories.module';
import { UsersModule } from './users/users.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { SmartRouteModule } from './smart-route/smart-route.module';
import { FieldMonitoringModule } from './field-monitoring/field-monitoring.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST') || 'localhost',
        port: parseInt(configService.get<string>('DB_PORT') || '5432', 10),
        username: configService.get<string>('DB_USERNAME') || 'postgres',
        password: configService.get<string>('DB_PASSWORD') || '',
        database: configService.get<string>('DB_NAME') || 'nestle_insight',
        autoLoadEntities: true,
        // Keep schema changes explicit through SQL migrations instead of runtime sync.
        synchronize: configService.get<string>('DB_SYNCHRONIZE') === 'true',
      }),
    }),

    ActivityModule,
    AuthModule,
    CategoriesModule,
    DailyReportsModule,
    DeliveryAssignmentsModule,
    OrdersModule,
    OutletsModule,
    ProductsModule,
    PromotionsModule,
    SalesIncidentsModule,
    SalesRoutesModule,
    StoreVisitsModule,
    TerritoriesModule,
    UsersModule,
    WarehousesModule,
    SmartRouteModule,
    FieldMonitoringModule,
  ],
})
export class AppModule {}
