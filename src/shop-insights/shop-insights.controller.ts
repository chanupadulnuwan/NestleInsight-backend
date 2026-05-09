import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { ShopInsightsService } from './shop-insights.service';

@Controller('shop-insights')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SHOP_OWNER)
export class ShopInsightsController {
  constructor(private readonly service: ShopInsightsService) {}

  @Get('my')
  getMyInsights(@Req() req: any) {
    return this.service.getMyInsights(req.user?.userId);
  }
}
