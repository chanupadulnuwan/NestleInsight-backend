import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PortalApprovalGuard } from '../auth/guards/portal-approval.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { DelayOrderDto } from './dto/delay-order.dto';
import { ProcessTmOrderDto } from './dto/process-tm-order.dto';
import { TmOrdersService } from './tm-orders.service';

@Controller('tm/orders')
@UseGuards(JwtAuthGuard, RolesGuard, PortalApprovalGuard)
@Roles(Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR)
export class TmOrdersController {
  constructor(private readonly tmOrdersService: TmOrdersService) {}

  @Get()
  listWarehouseOrders(@Req() req: any) {
    return this.tmOrdersService.listWarehouseOrders(req.user.userId);
  }

  @Patch(':id/approve')
  approveOrder(@Req() req: any, @Param('id') orderId: string) {
    return this.tmOrdersService.approveOrder(req.user.userId, orderId);
  }

  @Get(':id/process-preview')
  previewOrderProcessing(@Req() req: any, @Param('id') orderId: string) {
    return this.tmOrdersService.previewOrderProcessing(req.user.userId, orderId);
  }

  @Patch(':id/process')
  processOrder(
    @Req() req: any,
    @Param('id') orderId: string,
    @Body() dto: ProcessTmOrderDto,
  ) {
    return this.tmOrdersService.processOrder(
      req.user.userId,
      orderId,
      dto.decision,
      dto.explanation,
    );
  }

  @Patch(':id/delay')
  delayOrder(@Req() req: any, @Param('id') orderId: string, @Body() dto: DelayOrderDto) {
    return this.tmOrdersService.delayOrder(req.user.userId, orderId, dto.reason);
  }
}
