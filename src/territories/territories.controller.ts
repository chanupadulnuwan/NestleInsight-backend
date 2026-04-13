import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { CreateTerritoryDto } from './dto/create-territory.dto';
import { TerritoriesService } from './territories.service';

@Controller('territories')
export class TerritoriesController {
  constructor(private readonly territoriesService: TerritoriesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.REGIONAL_MANAGER, Role.SALES_REP)
  listTerritories() {
    return this.territoriesService.listTerritories();
  }

  @Get('resolve')
  resolveAssignment(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
  ) {
    return this.territoriesService.resolveAssignment(
      Number(latitude),
      Number(longitude),
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  createTerritory(@Body() createTerritoryDto: CreateTerritoryDto) {
    return this.territoriesService.createTerritory(createTerritoryDto);
  }
}
