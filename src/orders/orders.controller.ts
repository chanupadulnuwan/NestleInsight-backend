import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ConfirmAssistedOrderPinDto } from './dto/confirm-assisted-order-pin.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { RequestAssistedOrderPinDto } from './dto/request-assisted-order-pin.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles(Role.SHOP_OWNER)
  listMyOrders(@Req() req: any) {
    return this.ordersService.listCurrentUserOrders(req.user?.userId);
  }

  @Get('latest')
  @Roles(Role.SHOP_OWNER)
  getLatestOrder(@Req() req: any) {
    return this.ordersService.getLatestCurrentUserOrder(req.user?.userId);
  }

  @Post()
  @Roles(Role.SHOP_OWNER)
  createOrder(@Req() req: any, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.createCurrentUserOrder(
      req.user?.userId,
      createOrderDto,
    );
  }

  @Post('sales-rep')
  @Roles(Role.SALES_REP)
  createSalesRepOrder(
    @Req() req: any,
    @Body() createSalesOrderDto: CreateSalesOrderDto,
  ) {
    return this.ordersService.createSalesRepOrder(
      req.user?.userId,
      createSalesOrderDto,
    );
  }

  @Post('rep-request')
  @Roles(Role.SALES_REP)
  requestSalesRepOrder(
    @Req() req: any,
    @Body() dto: RequestAssistedOrderPinDto,
  ) {
    return this.ordersService.requestSalesRepOrder(req.user?.userId, dto);
  }

  @Post('rep-confirm')
  @Roles(Role.SALES_REP)
  confirmSalesRepOrder(
    @Req() req: any,
    @Body() dto: ConfirmAssistedOrderPinDto,
  ) {
    return this.ordersService.confirmSalesRepOrder(req.user?.userId, dto);
  }
}
