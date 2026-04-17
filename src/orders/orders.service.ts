import { randomInt } from 'crypto';

import * as bcrypt from 'bcrypt';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ProductStatus } from '../common/enums/product-status.enum';
import { Role } from '../common/enums/role.enum';
import { Outlet, OutletStatus } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { SalesRoute, SalesRouteStatus } from '../sales-routes/entities/sales-route.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ConfirmAssistedOrderPinDto } from './dto/confirm-assisted-order-pin.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { RequestAssistedOrderPinDto } from './dto/request-assisted-order-pin.dto';
import {
  AssistedOrderRequest,
  AssistedOrderRequestItemSnapshot,
  AssistedOrderRequestStatus,
} from './entities/assisted-order-request.entity';
import { Order } from './entities/order.entity';
import {
  createAutomaticDelayPatch,
  getOrderDueAt,
  isOrderOverdue,
} from './order-status.util';

@Injectable()
export class OrdersService {
  private static readonly assistedOrderPinTtlMs = 10 * 60 * 1000;

  constructor(
    @InjectRepository(AssistedOrderRequest)
    private readonly assistedOrderRequestsRepository: Repository<AssistedOrderRequest>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(Outlet)
    private readonly outletsRepository: Repository<Outlet>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(SalesRoute)
    private readonly salesRoutesRepository: Repository<SalesRoute>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly usersService: UsersService,
    private readonly activityService: ActivityService,
  ) { }

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

  async requestSalesRepOrderPin(
    salesRepId: string,
    dto: RequestAssistedOrderPinDto,
  ) {
    const { salesRep, route, outlet } = await this.validateAssistedOrderContext(
      salesRepId,
      dto.routeId,
      dto.shopId,
    );

    const normalizedItems = await this.normalizeSalesOrderItems(dto.items);
    const orderTotal = Number(
      normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
    );
    const shopOwner = await this.resolveShopOwnerForOutlet(
      outlet,
      route.territoryId,
    );
    const isShopActive =
      outlet.status === OutletStatus.APPROVED &&
      shopOwner != null &&
      shopOwner.accountStatus === AccountStatus.ACTIVE;

    if (!isShopActive) {
      const draftRequest = this.assistedOrderRequestsRepository.create({
        routeId: route.id,
        shopId: outlet.id,
        salesRepId,
        shopOwnerUserId: shopOwner?.id ?? null,
        shopNameSnapshot: outlet.outletName,
        territoryId: route.territoryId,
        warehouseId: route.warehouseId,
        status: AssistedOrderRequestStatus.DRAFT,
        itemsJson: normalizedItems,
        orderTotal,
        currencyCode: 'LKR',
      });

      const savedDraft = await this.assistedOrderRequestsRepository.save(
        draftRequest,
      );

      await this.activityService.logForUser({
        userId: salesRepId,
        type: 'ASSISTED_ORDER_DRAFT_SAVED',
        title: 'Assisted order saved as draft',
        message:
          'This outlet is not linked to an active shop owner account yet, so the order was saved as a draft.',
        metadata: {
          assistedOrderRequestId: savedDraft.id,
          routeId: route.id,
          shopId: outlet.id,
          shopName: outlet.outletName,
          itemCount: normalizedItems.length,
          totalAmount: orderTotal,
        },
      });

      return {
        message:
          'Outlet is not linked to an active shop owner account. The order was saved as a draft.',
        assistedOrderRequestId: savedDraft.id,
        status: savedDraft.status,
        requiresPin: false,
      };
    }

    const pin = this.generateSixDigitPin();
    const pinHash = await bcrypt.hash(pin, 10);
    const pinExpiresAt = new Date(
      Date.now() + OrdersService.assistedOrderPinTtlMs,
    );

    const request = this.assistedOrderRequestsRepository.create({
      routeId: route.id,
      shopId: outlet.id,
      salesRepId,
      shopOwnerUserId: shopOwner.id,
      shopNameSnapshot: outlet.outletName,
      territoryId: route.territoryId,
      warehouseId: route.warehouseId,
      pinHash,
      pinExpiresAt,
      status: AssistedOrderRequestStatus.PENDING_SHOP_PIN,
      itemsJson: normalizedItems,
      orderTotal,
      currencyCode: 'LKR',
    });

    const savedRequest = await this.assistedOrderRequestsRepository.save(request);

    await this.activityService.logForUser({
      userId: shopOwner.id,
      type: 'ASSISTED_ORDER_PIN_REQUESTED',
      title: 'Sales rep order confirmation requested',
      message: `${salesRep.firstName} ${salesRep.lastName} requested a confirmation PIN for an assisted order at ${outlet.outletName}. Share the PIN with the sales rep before it expires.`,
      metadata: {
        assistedOrderRequestId: savedRequest.id,
        routeId: route.id,
        shopId: outlet.id,
        shopName: outlet.outletName,
        pin,
        expiresAt: pinExpiresAt.toISOString(),
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
        assistedOrderRequestId: savedRequest.id,
        routeId: route.id,
        shopId: outlet.id,
        shopName: outlet.outletName,
        expiresAt: pinExpiresAt.toISOString(),
        totalAmount: orderTotal,
        itemCount: normalizedItems.length,
      },
    });

    return {
      message: 'Confirmation PIN sent to the shop owner activity center.',
      assistedOrderRequestId: savedRequest.id,
      status: savedRequest.status,
      requiresPin: true,
      expiresAt: pinExpiresAt.toISOString(),
    };
  }

  async confirmSalesRepOrderPin(
    salesRepId: string,
    requestId: string,
    dto: ConfirmAssistedOrderPinDto,
  ) {
    const request = await this.assistedOrderRequestsRepository.findOne({
      where: { id: requestId, salesRepId },
    });

    if (!request) {
      throw new NotFoundException('Assisted order request was not found.');
    }

    if (request.status === AssistedOrderRequestStatus.DRAFT) {
      throw new BadRequestException(
        'This assisted order was saved as a draft and cannot be confirmed with a PIN.',
      );
    }

    if (request.status !== AssistedOrderRequestStatus.PENDING_SHOP_PIN) {
      throw new BadRequestException(
        'This assisted order is no longer waiting for a shop PIN.',
      );
    }

    if (!request.pinHash || !request.pinExpiresAt) {
      throw new BadRequestException(
        'This assisted order does not have a valid PIN to confirm.',
      );
    }

    if (request.pinExpiresAt.getTime() < Date.now()) {
      request.status = AssistedOrderRequestStatus.EXPIRED;
      request.pinHash = null;
      request.pinExpiresAt = null;
      await this.assistedOrderRequestsRepository.save(request);
      throw new BadRequestException('The confirmation PIN has expired.');
    }

    const isPinValid = await bcrypt.compare(dto.pin, request.pinHash);

    if (!isPinValid) {
      throw new BadRequestException('Incorrect PIN.');
    }

    if (!request.shopOwnerUserId) {
      throw new BadRequestException(
        'This assisted order is not linked to a shop owner account.',
      );
    }

    const shopOwner = await this.requireShopOwner(request.shopOwnerUserId);
    const salesRep = await this.usersService.findById(salesRepId);

    if (!salesRep || salesRep.role !== Role.SALES_REP) {
      throw new BadRequestException('sales rep account was not found');
    }

    const assistedReason = dto.assistedReason.trim();
    const order = this.ordersRepository.create({
      orderCode: this.generateOrderCode(),
      userId: shopOwner.id,
      shopNameSnapshot: shopOwner.shopName ?? request.shopNameSnapshot,
      territoryId: request.territoryId ?? shopOwner.territoryId,
      warehouseId: request.warehouseId ?? shopOwner.warehouseId,
      status: 'PLACED',
      currencyCode: request.currencyCode,
      totalAmount: request.orderTotal,
      subtotalBeforeDiscount: request.orderTotal,
      promotionDiscountTotal: 0,
      totalAfterDiscount: request.orderTotal,
      customerNote: `Assisted order placed by sales rep ${salesRep.firstName} ${salesRep.lastName}. Reason: ${assistedReason}`,
      items: request.itemsJson.map(
        (item) => ({
          productId: item.productId,
          skuSnapshot: item.skuSnapshot,
          productNameSnapshot: item.productNameSnapshot,
          packSizeSnapshot: item.packSizeSnapshot,
          imageUrlSnapshot: item.imageUrlSnapshot,
          casePriceSnapshot: item.casePriceSnapshot,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
        }),
      ) as any,
    });

    const savedOrder = await this.ordersRepository.save(order);

    request.status = AssistedOrderRequestStatus.CONFIRMED;
    request.assistedReason = assistedReason;
    request.confirmedAt = new Date();
    request.confirmedOrderId = savedOrder.id;
    request.pinHash = null;
    request.pinExpiresAt = null;
    await this.assistedOrderRequestsRepository.save(request);

    await this.activityService.logForUser({
      userId: shopOwner.id,
      type: 'ORDER_PLACED',
      title: 'Order placed',
      message: `Order ${savedOrder.orderCode} was placed successfully with sales rep assistance.`,
      metadata: {
        orderId: savedOrder.id,
        orderCode: savedOrder.orderCode,
        totalAmount: savedOrder.totalAmount,
        placedAt: savedOrder.placedAt.toISOString(),
        assistedOrderRequestId: request.id,
        assistedReason,
      },
    });

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ASSISTED_ORDER_CONFIRMED',
      title: 'Assisted order confirmed',
      message: `Order ${savedOrder.orderCode} was confirmed for ${request.shopNameSnapshot}.`,
      metadata: {
        orderId: savedOrder.id,
        orderCode: savedOrder.orderCode,
        shopId: request.shopId,
        routeId: request.routeId,
        assistedOrderRequestId: request.id,
      },
    });

    return {
      message: 'Assisted order created successfully.',
      order: this.serializeOrder(savedOrder),
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

  private async validateAssistedOrderContext(
    salesRepId: string,
    routeId: string,
    shopId: string,
  ) {
    const salesRep = await this.usersService.findById(salesRepId);

    if (!salesRep || salesRep.role !== Role.SALES_REP) {
      throw new BadRequestException(
        'only sales rep accounts can request assisted orders',
      );
    }

    const route = await this.salesRoutesRepository.findOne({
      where: { id: routeId, salesRepId },
    });

    if (!route) {
      throw new NotFoundException('Active route was not found.');
    }

    if (route.status !== SalesRouteStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Assisted orders can only be requested during an active route.',
      );
    }

    const outlet = await this.outletsRepository.findOne({
      where: { id: shopId },
    });

    if (!outlet) {
      throw new NotFoundException('Outlet was not found.');
    }

    if (route.territoryId && outlet.territoryId && route.territoryId !== outlet.territoryId) {
      throw new BadRequestException(
        'This outlet does not belong to the active route territory.',
      );
    }

    if (route.warehouseId && outlet.warehouseId && route.warehouseId !== outlet.warehouseId) {
      throw new BadRequestException(
        'This outlet does not belong to the active route warehouse.',
      );
    }

    return { salesRep, route, outlet };
  }

  private async normalizeSalesOrderItems(
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<AssistedOrderRequestItemSnapshot[]> {
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
      currencyCode: order.currencyCode,
      totalAmount: order.totalAmount,
      placedAt: order.placedAt,
      approvedAt: order.approvedAt,
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

  private generateSixDigitPin() {
    return randomInt(100000, 1000000).toString();
  }
}
