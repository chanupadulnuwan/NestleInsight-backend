import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SHOP_OWNER)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  listMyOrders(@Req() req: any) {
    return this.ordersService.listCurrentUserOrders(req.user?.userId);
  }

  @Get('latest')
  getLatestOrder(@Req() req: any) {
    return this.ordersService.getLatestCurrentUserOrder(req.user?.userId);
  }

  @Post()
  createOrder(@Req() req: any, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.createCurrentUserOrder(
      req.user?.userId,
      createOrderDto,
    );
  }
}
