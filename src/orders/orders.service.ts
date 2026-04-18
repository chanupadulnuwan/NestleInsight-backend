import { randomInt } from 'crypto';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ProductStatus } from '../common/enums/product-status.enum';
import { Role } from '../common/enums/role.enum';
import { Outlet, OutletStatus } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ConfirmAssistedOrderPinDto } from './dto/confirm-assisted-order-pin.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { RequestAssistedOrderPinDto } from './dto/request-assisted-order-pin.dto';
import { Order } from './entities/order.entity';
import {
  createAutomaticDelayPatch,
  getOrderDueAt,
  isOrderOverdue,
} from './order-status.util';

type AssistedOrderItemSnapshot = {
  productId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  packSizeSnapshot: string | null;
  imageUrlSnapshot: string | null;
  casePriceSnapshot: number;
  quantity: number;
  lineTotal: number;
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(Outlet)
    private readonly outletsRepository: Repository<Outlet>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
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

    const subtotal = Number(
      normalizedItems
        .reduce((sum, item) => sum + item.lineTotal, 0)
        .toFixed(2),
    );

    const discountAmount = Number(createOrderDto.discountAmount || 0);
    const finalTotal = Number((subtotal - discountAmount).toFixed(2));

    const order = this.ordersRepository.create({
      orderCode: this.generateOrderCode(),
      userId: user.id,
      shopNameSnapshot: user.shopName ?? `${user.firstName} ${user.lastName}`,
      territoryId: user.territoryId,
      warehouseId: user.warehouseId,
      status: 'PLACED',
      currencyCode: 'LKR',
      totalAmount: finalTotal,
      subtotalBeforeDiscount: subtotal,
      promotionDiscountTotal: discountAmount,
      totalAfterDiscount: finalTotal,
      appliedPromotionId: createOrderDto.appliedPromotionId,
      appliedPromotionCode: createOrderDto.appliedPromotionCode,
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
        discountAmount: savedOrder.promotionDiscountTotal,
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

    await this.syncAutomaticDelays(orders);

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

    await this.syncAutomaticDelayForOrder(latestOrder);

    return {
      message: latestOrder
        ? 'latest order fetched successfully'
        : 'no previous order found',
      order: latestOrder ? this.serializeOrder(latestOrder) : null,
    };
  }

  async createSalesRepOrder(
    salesRepId: string,
    dto: CreateSalesOrderDto,
  ) {
    const user = await this.usersService.findById(salesRepId);

    if (!user) {
      throw new BadRequestException('sales rep account was not found');
    }

    if (user.role !== Role.SALES_REP) {
      throw new BadRequestException(
        'only sales rep accounts can place sales orders',
      );
    }

    // Validate items array
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    const productIds = [
      ...new Set(dto.items.map((item) => item.productId)),
    ];
    const products = await this.productsRepository.find({
      where: {
        id: In(productIds),
      },
    });
    const productsById = new Map(
      products.map((product) => [product.id, product]),
    );

    const normalizedItems = dto.items.map((item) => {
      const product = productsById.get(item.productId);

      if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException({
          message: 'One or more selected products are currently unavailable.',
          code: 'PRODUCT_CURRENTLY_UNAVAILABLE',
        });
      }

      return {
        productId: item.productId,
        skuSnapshot: product.sku,
        productNameSnapshot: product.productName,
        packSizeSnapshot: product.packSize,
        imageUrlSnapshot: product.imageUrl,
        casePriceSnapshot: product.casePrice,
        quantity: item.quantity,
        lineTotal: Number((product.casePrice * item.quantity).toFixed(2)),
        product,
      };
    });

    // Create order with sales rep specific data
    const orderCode = `SR-${Date.now()}`;
    const order = this.ordersRepository.create({
      orderCode,
      userId: salesRepId,
      shopNameSnapshot: `Shop at ${dto.shopId}`,
      territoryId: user.territoryId ?? null,
      warehouseId: user.warehouseId ?? null,
      status: 'PLACED',
      currencyCode: 'LKR',
      totalAmount: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
      placedAt: new Date(),
      customerNote: `Sales route order - Route: ${dto.routeId}, Shop: ${dto.shopId}`,
      items: normalizedItems.map((item) => ({
        productId: item.productId,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        packSizeSnapshot: item.packSizeSnapshot,
        imageUrlSnapshot: item.imageUrlSnapshot,
        casePriceSnapshot: item.casePriceSnapshot,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        product: item.product,
      } as any)),
    });

    const savedOrder = await this.ordersRepository.save(order);

    // Log activity
    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ORDER_PLACED',
      title: 'Order placed',
      message: `Order with ${dto.items.length} item(s) placed at shop ${dto.shopId}.`,
      metadata: {
        orderId: savedOrder.id,
        routeId: dto.routeId,
        shopId: dto.shopId,
        itemCount: dto.items.length,
      },
    });

    return {
      message: 'Sales order placed successfully.',
      order: this.serializeOrder(savedOrder),
    };
  }

  async requestSalesRepOrder(
    salesRepId: string,
    dto: RequestAssistedOrderPinDto,
  ) {
    const { salesRep, outlet } = await this.validateAssistedOrderContext(
      salesRepId,
      dto.shopId,
    );

    const normalizedItems = await this.normalizeSalesOrderItems(dto.items);
    const orderTotal = Number(
      normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
    );
    const shopOwner = await this.resolveShopOwnerForOutlet(
      outlet,
      outlet.territoryId ?? salesRep.territoryId ?? null,
    );
    const isShopActive =
      outlet.status === OutletStatus.APPROVED &&
      shopOwner != null &&
      shopOwner.accountStatus === AccountStatus.ACTIVE;
    const confirmationPin = isShopActive ? this.generateFourDigitPin() : null;

    const order = this.ordersRepository.create({
      orderCode: this.generateOrderCode(),
      userId: shopOwner?.id ?? salesRep.id,
      shopNameSnapshot: outlet.outletName,
      territoryId: outlet.territoryId ?? salesRep.territoryId ?? null,
      warehouseId: outlet.warehouseId ?? salesRep.warehouseId ?? null,
      status: isShopActive ? 'PENDING_PIN' : 'DRAFT',
      currencyCode: 'LKR',
      totalAmount: orderTotal,
      subtotalBeforeDiscount: orderTotal,
      promotionDiscountTotal: 0,
      totalAfterDiscount: orderTotal,
      confirmationPin,
      customerNote: `Assisted order requested by sales rep ${salesRep.firstName} ${salesRep.lastName} for ${outlet.outletName}.`,
      items: normalizedItems.map((item) => ({
        productId: item.productId,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        packSizeSnapshot: item.packSizeSnapshot,
        imageUrlSnapshot: item.imageUrlSnapshot,
        casePriceSnapshot: item.casePriceSnapshot,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })) as any,
    });

    const savedOrder = await this.ordersRepository.save(order);

    if (!isShopActive) {
      await this.activityService.logForUser({
        userId: salesRepId,
        type: 'ASSISTED_ORDER_DRAFT_SAVED',
        title: 'Assisted order saved as draft',
        message:
          'This outlet is not linked to an active shop owner account yet, so the order was saved as a draft.',
        metadata: {
          orderId: savedOrder.id,
          shopId: outlet.id,
          shopName: outlet.outletName,
          itemCount: normalizedItems.length,
          totalAmount: orderTotal,
        },
      });

      return {
        message:
          'Outlet is not linked to an active shop owner account. The order was saved as a draft.',
        orderId: savedOrder.id,
        status: savedOrder.status,
        requiresPin: false,
      };
    }

    const activeShopOwner = shopOwner!;

    await this.activityService.logForUser({
      userId: activeShopOwner.id,
      type: 'ASSISTED_ORDER_PIN_REQUESTED',
      title: 'Sales rep order confirmation requested',
      message: `${salesRep.firstName} ${salesRep.lastName} requested a confirmation PIN for an assisted order at ${outlet.outletName}. Share the PIN with the sales rep to finalize the order.`,
      metadata: {
        orderId: savedOrder.id,
        shopId: outlet.id,
        shopName: outlet.outletName,
        pin: confirmationPin,
        totalAmount: orderTotal,
        itemCount: normalizedItems.length,
      },
    });

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ASSISTED_ORDER_PIN_REQUESTED',
      title: 'Confirmation PIN requested',
      message: `A confirmation PIN was sent to ${outlet.ownerName} for the assisted order at ${outlet.outletName}.`,
      metadata: {
        orderId: savedOrder.id,
        shopId: outlet.id,
        shopName: outlet.outletName,
        totalAmount: orderTotal,
        itemCount: normalizedItems.length,
      },
    });

    return {
      message: 'Confirmation PIN sent to the shop owner activity center.',
      orderId: savedOrder.id,
      status: savedOrder.status,
      requiresPin: true,
    };
  }

  async confirmSalesRepOrder(
    salesRepId: string,
    dto: ConfirmAssistedOrderPinDto,
  ) {
    const salesRep = await this.requireSalesRep(salesRepId);
    const order = await this.ordersRepository.findOne({
      where: { id: dto.orderId },
      relations: {
        territory: true,
        warehouse: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order was not found.');
    }

    if (order.status === 'DRAFT') {
      throw new BadRequestException(
        'This assisted order was saved as a draft and cannot be confirmed with a PIN.',
      );
    }

    if (order.status !== 'PENDING_PIN') {
      throw new BadRequestException(
        'This assisted order is no longer waiting for a shop PIN.',
      );
    }

    if (!order.confirmationPin || order.confirmationPin !== dto.pin) {
      throw new UnauthorizedException('Invalid PIN');
    }

    const assistedReason = dto.assistedReason.trim();
    order.status = 'CONFIRMED';
    order.source = 'SALES_REP';
    order.assistedReason = assistedReason;
    order.confirmationPin = null;
    order.customerNote =
      `Assisted order placed by sales rep ${salesRep.firstName} ${salesRep.lastName}. ` +
      `Reason: ${assistedReason}`;

    const savedOrder = await this.ordersRepository.save(order);

    await this.activityService.logForUser({
      userId: savedOrder.userId,
      type: 'ORDER_PLACED',
      title: 'Order placed',
      message: `Order ${savedOrder.orderCode} was placed successfully with sales rep assistance.`,
      metadata: {
        orderId: savedOrder.id,
        orderCode: savedOrder.orderCode,
        totalAmount: savedOrder.totalAmount,
        placedAt: savedOrder.placedAt.toISOString(),
        assistedReason,
      },
    });

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ASSISTED_ORDER_CONFIRMED',
      title: 'Assisted order confirmed',
      message: `Order ${savedOrder.orderCode} was confirmed for ${savedOrder.shopNameSnapshot}.`,
      metadata: {
        orderId: savedOrder.id,
        orderCode: savedOrder.orderCode,
        shopName: savedOrder.shopNameSnapshot,
      },
    });

    return {
      message: 'Assisted order confirmed successfully.',
      order: this.serializeOrder(savedOrder),
      orderId: savedOrder.id,
    };
  }

  async syncAutomaticDelays(orders: Order[]) {
    const overdueOrders = orders.filter((order) => isOrderOverdue(order));

    await Promise.all(
      overdueOrders.map((order) => this.syncAutomaticDelayForOrder(order)),
    );

    return orders;
  }

  async syncAutomaticDelayForOrder(order: Order | null) {
    if (!order || !isOrderOverdue(order)) {
      return order;
    }

    const patch = createAutomaticDelayPatch(order.placedAt);

    await this.ordersRepository.update(order.id, patch);
    Object.assign(order, patch);

    return order;
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

  private async validateAssistedOrderContext(salesRepId: string, shopId: string) {
    const salesRep = await this.requireSalesRep(salesRepId);
    const outlet = await this.outletsRepository.findOne({
      where: { id: shopId },
    });

    if (!outlet) {
      throw new NotFoundException('Outlet was not found.');
    }

    if (
      salesRep.territoryId &&
      outlet.territoryId &&
      salesRep.territoryId !== outlet.territoryId
    ) {
      throw new BadRequestException(
        'This outlet does not belong to the sales rep territory.',
      );
    }

    if (
      salesRep.warehouseId &&
      outlet.warehouseId &&
      salesRep.warehouseId !== outlet.warehouseId
    ) {
      throw new BadRequestException(
        'This outlet does not belong to the sales rep warehouse.',
      );
    }

    return { salesRep, outlet };
  }

  private async normalizeSalesOrderItems(
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<AssistedOrderItemSnapshot[]> {
    if (!items || items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await this.productsRepository.find({
      where: { id: In(productIds) },
    });
    const productsById = new Map(products.map((product) => [product.id, product]));

    return items.map((item) => {
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
        skuSnapshot: product.sku,
        productNameSnapshot: product.productName,
        packSizeSnapshot: product.packSize,
        imageUrlSnapshot: product.imageUrl,
        casePriceSnapshot: casePrice,
        quantity,
        lineTotal: Number((casePrice * quantity).toFixed(2)),
      };
    });
  }

  private async resolveShopOwnerForOutlet(
    outlet: Outlet,
    territoryId: string | null,
  ): Promise<User | null> {
    const queries: Array<Promise<User | null>> = [];

    if ((outlet.ownerEmail?.trim().length ?? 0) > 0) {
      queries.push(
        this.usersRepository
          .createQueryBuilder('user')
          .where('LOWER(user.email) = LOWER(:email)', {
            email: outlet.ownerEmail!.trim(),
          })
          .andWhere('user.role = :role', { role: Role.SHOP_OWNER })
          .andWhere(territoryId ? 'user.territoryId = :territoryId' : '1=1', {
            territoryId: territoryId ?? undefined,
          })
          .getOne(),
      );
    }

    if ((outlet.ownerPhone?.trim().length ?? 0) > 0) {
      queries.push(
        this.usersRepository.findOne({
          where: {
            phoneNumber: outlet.ownerPhone!.trim(),
            role: Role.SHOP_OWNER,
            ...(territoryId ? { territoryId } : {}),
          },
        }),
      );
    }

    queries.push(
      this.usersRepository.findOne({
        where: {
          shopName: outlet.outletName,
          role: Role.SHOP_OWNER,
          ...(territoryId ? { territoryId } : {}),
        },
      }),
    );

    for (const finalUser of queries) {
      const resolved = await finalUser;
      if (resolved != null) {
        return resolved;
      }
    }

    return null;
  }

  private serializeOrder(order: Order) {
    const deliveryDueAt = getOrderDueAt(order.placedAt);

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
      source: order.source,
      currencyCode: order.currencyCode,
      totalAmount: order.totalAmount,
      placedAt: order.placedAt,
      approvedAt: order.approvedAt,
      assistedReason: order.assistedReason,
      customerNote: order.customerNote,
      delayReason: order.delayReason,
      delayedAt: order.delayedAt,
      deliveryDueAt: deliveryDueAt.toISOString(),
      isOverdue: isOrderOverdue(order),
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

  private async requireSalesRep(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user || user.role !== Role.SALES_REP) {
      throw new BadRequestException(
        'only sales rep accounts can request assisted orders',
      );
    }

    return user;
  }

  private generateFourDigitPin() {
    return randomInt(1000, 10000).toString();
  }
}
