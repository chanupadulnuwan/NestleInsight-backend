import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { ProductStatus } from '../common/enums/product-status.enum';
import { Role } from '../common/enums/role.enum';
import { Product } from '../products/entities/product.entity';
import { UsersService } from '../users/users.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './entities/order.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    private readonly usersService: UsersService,
    private readonly activityService: ActivityService,
  ) {}

  async createCurrentUserOrder(userId: string, createOrderDto: CreateOrderDto) {
    const user = await this.requireShopOwner(userId);
    const productIds = [
      ...new Set(createOrderDto.items.map((item) => item.productId)),
    ];
    const products = await this.productsRepository.find({
      where: {
        id: In(productIds),
      },
    });
    const productsById = new Map(
      products.map((product) => [product.id, product]),
    );

    const normalizedItems = createOrderDto.items.map((item) => {
      const product = productsById.get(item.productId);

      if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException({
          message: 'One or more selected products are currently unavailable.',
          code: 'PRODUCT_CURRENTLY_UNAVAILABLE',
        });
      }

      const casePrice = Number(product.casePrice);
      const quantity = Number(item.quantity);

      return {
        productId: product.id,
        product,
        skuSnapshot: product.sku,
        productNameSnapshot: product.productName,
        packSizeSnapshot: product.packSize,
        imageUrlSnapshot: product.imageUrl,
        casePriceSnapshot: casePrice,
        quantity,
        lineTotal: Number((casePrice * quantity).toFixed(2)),
      };
    });

    const totalAmount = Number(
      normalizedItems
        .reduce((sum, item) => sum + item.lineTotal, 0)
        .toFixed(2),
    );

    const order = this.ordersRepository.create({
      orderCode: this.generateOrderCode(),
      userId: user.id,
      shopNameSnapshot: user.shopName ?? `${user.firstName} ${user.lastName}`,
      territoryId: user.territoryId,
      warehouseId: user.warehouseId,
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
      relations: {
        territory: true,
        warehouse: true,
      },
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
      relations: {
        territory: true,
        warehouse: true,
      },
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

    if (!user.territoryId || !user.warehouseId) {
      throw new BadRequestException({
        message:
          'Your shop is not assigned to a territory warehouse yet. Please contact support.',
        code: 'SHOP_ASSIGNMENT_NOT_AVAILABLE',
      });
    }

    return user;
  }

  private serializeOrder(order: Order) {
    return {
      id: order.id,
      orderCode: order.orderCode,
      userId: order.userId,
      shopName: order.shopNameSnapshot,
      territoryId: order.territoryId,
      territoryName: order.territory?.name ?? null,
      warehouseId: order.warehouseId,
      warehouseName: order.warehouse?.name ?? null,
      status: order.status,
      currencyCode: order.currencyCode,
      totalAmount: order.totalAmount,
      placedAt: order.placedAt,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        packSize: item.packSizeSnapshot,
        imageUrl: item.imageUrlSnapshot,
        // Keep older migrated orders readable even when their stored line total
        // came from legacy per-unit pricing instead of the newer case pricing.
        casePrice: this.resolveItemDisplayPrice(
          item.casePriceSnapshot,
          item.lineTotal,
          item.quantity,
        ),
        isCurrentlyAvailable: item.product?.status === ProductStatus.ACTIVE,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
    };
  }

  private resolveItemDisplayPrice(
    snapshotPrice: number,
    lineTotal: number,
    quantity: number,
  ) {
    if (quantity <= 0) {
      return snapshotPrice;
    }

    const expectedLineTotal = Number((snapshotPrice * quantity).toFixed(2));
    const normalizedLineTotal = Number(lineTotal.toFixed(2));

    if (Math.abs(expectedLineTotal - normalizedLineTotal) <= 0.01) {
      return snapshotPrice;
    }

    return Number((lineTotal / quantity).toFixed(2));
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
