import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto';
import { ValidatePromotionDto } from './dto/validate-promotion.dto';
import { PromotionsService } from './promotions.service';

@Controller('promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post('validate')
  @Roles(
    Role.ADMIN,
    Role.REGIONAL_MANAGER,
    Role.TERRITORY_DISTRIBUTOR,
    Role.SALES_REP,
    Role.SHOP_OWNER,
  )
  validatePromotion(@Body() dto: ValidatePromotionDto) {
    return this.promotionsService.validatePromotion(dto);
  }

  @Post()
  create(@Request() req: any, @Body() createPromotionDto: CreatePromotionDto) {
    return this.promotionsService.create(createPromotionDto, req.user?.userId);
  }

  @Get()
  @Roles(Role.ADMIN)
  findAll() {
    return this.promotionsService.findAll();
  }

  @Get('active')
  @Roles(
    Role.ADMIN,
    Role.REGIONAL_MANAGER,
    Role.TERRITORY_DISTRIBUTOR,
    Role.SALES_REP,
    Role.SHOP_OWNER,
  )
  findActive(@Query('territoryId') territoryId?: string) {
    return this.promotionsService.findActive(territoryId);
  }

  @Get('territory')
  @Roles(
    Role.ADMIN,
    Role.REGIONAL_MANAGER,
    Role.TERRITORY_DISTRIBUTOR,
    Role.SALES_REP,
    Role.SHOP_OWNER,
  )
  findForTerritory(@Query('territoryId') territoryId: string) {
    return this.promotionsService.findForTerritory(territoryId);
  }

  @Get('validate')
  @Roles(
    Role.ADMIN,
    Role.REGIONAL_MANAGER,
    Role.TERRITORY_DISTRIBUTOR,
    Role.SALES_REP,
  )
  validateCode(
    @Query('code') code: string,
    @Query('shopId') shopId: string,
    @Query('territoryId') territoryId: string,
    @Query('orderTotal') orderTotal: number,
    @Query('productIds') productIds: string,
  ) {
    const productIdsArray = productIds ? productIds.split(',') : [];
    return this.promotionsService.validatePromoCode(
      code,
      shopId,
      territoryId,
      Number(orderTotal) || 0,
      productIdsArray,
    );
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  findOne(@Param('id') id: string) {
    return this.promotionsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() updatePromotionDto: UpdatePromotionDto) {
    return this.promotionsService.update(id, updatePromotionDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.promotionsService.remove(id);
  }
}
