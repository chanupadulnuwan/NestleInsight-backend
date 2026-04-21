import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { ReviewOutletDto } from './dto/review-outlet.dto';
import { OutletsService } from './outlets.service';

@Controller('outlets')
@UseGuards(JwtAuthGuard)
export class OutletsController {
  constructor(private readonly outletsService: OutletsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  createOutlet(@Req() req: any, @Body() dto: CreateOutletDto) {
    return this.outletsService.createOutlet({
      userId: req.user?.userId,
      territoryId: req.user?.territoryId,
      warehouseId: req.user?.warehouseId,
      dto,
    });
  }

  @Get('my-territory')
  @UseGuards(RolesGuard)
  @Roles(Role.SALES_REP)
  getMyTerritoryOutlets(@Req() req: any) {
    return this.outletsService.getMyTerritoryOutlets(
      req.user?.userId,
      req.user?.territoryId,
    );
  }

  @Get('pending')
  @UseGuards(RolesGuard)
  @Roles(Role.REGIONAL_MANAGER)
  getPendingOutlets(@Req() req: any) {
    return this.outletsService.getPendingOutlets(req.user?.warehouseId);
  }

  @Patch(':id/review')
  @UseGuards(RolesGuard)
  @Roles(Role.REGIONAL_MANAGER)
  reviewOutlet(
    @Param('id') outletId: string,
    @Req() req: any,
    @Body() dto: ReviewOutletDto,
  ) {
    return this.outletsService.reviewOutlet(outletId, req.user?.userId, dto);
  }
}
