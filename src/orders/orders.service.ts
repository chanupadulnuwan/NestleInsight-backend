import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { Role } from '../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './entities/order.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly usersService: UsersService,
    private readonly activityService: ActivityService,
  ) {}

  async createCurrentUserOrder(userId: string, createOrderDto: CreateOrderDto) {
    const user = await this.requireShopOwner(userId);
    const normalizedItems = createOrderDto.items.map((item) => ({
      productCode: item.productCode.trim(),
      productName: item.productName.trim(),
      imageAssetPath: item.imageAssetPath?.trim() || null,
      unitPrice: Number(item.unitPrice),
      quantity: Number(item.quantity),
      lineTotal: Number((item.unitPrice * item.quantity).toFixed(2)),
    }));

    const totalAmount = Number(
      normalizedItems
        .reduce((sum, item) => sum + item.lineTotal, 0)
        .toFixed(2),
    );

    const order = this.ordersRepository.create({
      orderCode: this.generateOrderCode(),
      userId: user.id,
      shopNameSnapshot: user.shopName ?? `${user.firstName} ${user.lastName}`,
      status: 'PLACED',
      currencyCode: 'LKR',
      totalAmount,
      items: normalizedItems,
    });

    const savedOrder = await this.ordersRepository.save(order);

    await this.activityService.logForUser({
      userId: user.id,
      type: 'ORDER_PLACED',
      title: 'Order placed',
      message: `Order ${savedOrder.orderCode} was placed successfully.`,
      metadata: {
        orderId: savedOrder.id,
        orderCode: savedOrder.orderCode,
        totalAmount: savedOrder.totalAmount,
        placedAt: savedOrder.placedAt.toISOString(),
      },
    });

    return {
      message: 'Order placed successfully.',
      order: this.serializeOrder(savedOrder),
    };
  }

  async listCurrentUserOrders(userId: string) {
    await this.requireShopOwner(userId);

    const orders = await this.ordersRepository.find({
      where: { userId },
      order: { placedAt: 'DESC' },
    });

    return {
      message: 'orders fetched successfully',
      orders: orders.map((order) => this.serializeOrder(order)),
    };
  }

  async getLatestCurrentUserOrder(userId: string) {
    await this.requireShopOwner(userId);

    const latestOrder = await this.ordersRepository.findOne({
      where: { userId },
      order: { placedAt: 'DESC' },
    });

    return {
      message: latestOrder
        ? 'latest order fetched successfully'
        : 'no previous order found',
      order: latestOrder ? this.serializeOrder(latestOrder) : null,
    };
  }

  private async requireShopOwner(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new BadRequestException('shop owner account was not found');
    }

    if (user.role !== Role.SHOP_OWNER) {
      throw new BadRequestException(
        'only shop owner accounts can place mobile orders',
      );
    }

    return user;
  }

  private serializeOrder(order: Order) {
    return {
      id: order.id,
      orderCode: order.orderCode,
      userId: order.userId,
      shopName: order.shopNameSnapshot,
      status: order.status,
      currencyCode: order.currencyCode,
      totalAmount: order.totalAmount,
      placedAt: order.placedAt,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productCode: item.productCode,
        productName: item.productName,
        imageAssetPath: item.imageAssetPath,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
    };
  }

  private generateOrderCode() {
    const date = new Date();
    const yyyy = date.getFullYear().toString();
    const mm = `${date.getMonth() + 1}`.padStart(2, '0');
    const dd = `${date.getDate()}`.padStart(2, '0');
    const suffix = `${Date.now()}`.slice(-6);

    return `ORD-${yyyy}${mm}${dd}-${suffix}`;
  }
}
