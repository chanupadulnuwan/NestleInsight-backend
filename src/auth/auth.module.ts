import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignOptions } from 'jsonwebtoken';

import { ActivityModule } from '../activity/activity.module';
import { Territory } from '../territories/entities/territory.entity';
import { UsersModule } from '../users/users.module';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpEmailService } from './otp-email.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    ActivityModule,
    UsersModule,
    TypeOrmModule.forFeature([Territory, Warehouse]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'fallback_secret',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ||
            '1d') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpEmailService, JwtStrategy],
})
export class AuthModule {}
