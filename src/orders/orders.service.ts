import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { ActivityService } from '../activity/activity.service';
import { ActivityLog } from '../activity/entities/activity.entity';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { ProductStatus } from '../common/enums/product-status.enum';
import { Role } from '../common/enums/role.enum';
import { Outlet } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import {
  SalesRoute,
  SalesRouteStatus,
} from '../sales-routes/entities/sales-route.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ConfirmAssistedOrderPinDto } from './dto/confirm-assisted-order-pin.dto';
import { CompleteSalesRepDeliveryDto } from './dto/complete-sales-rep-delivery.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { RequestAssistedOrderPinDto } from './dto/request-assisted-order-pin.dto';
import { Order } from './entities/order.entity';
import {
  VanLoadRequest,
  VanLoadRequestStockLine,
} from '../sales-routes/entities/van-load-request.entity';
import {
  createAutomaticDelayPatch,
  getOrderDueAt,
  isOrderOverdue,
} from './order-status.util';

const ASSISTED_ORDER_PIN_TTL_MINUTES = 10;
const ASSISTED_ORDER_BCRYPT_ROUNDS = 10;

type AssistedOrderItemSnapshot = {
  productId: string;
  quantity: number;
};

type AssistedOrderRequestMetadata = {
  status: 'DRAFT' | 'PENDING_SHOP_PIN' | 'CONFIRMED';
  routeId: string;
  shopId: string;
  shopName: string;
  items: AssistedOrderItemSnapshot[];
  pinHash?: string;
  pinExpiresAt?: string;
  shopOwnerUserId?: string;
  shopOwnerName?: string;
  shopOwnerMatchSource?: string;
  draftReason?: string;
  confirmedAt?: string;
  confirmedOrderId?: string;
  assistedReason?: string;
};

type SalesRepOrderOptions = {
  assistedReason?: string | null;
  shopNameSnapshot?: string;
  targetCustomerUserId?: string | null;
};

type OutletShopOwnerMatch = {
  user: User;
  matchSource: string;
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ActivityLog)
    private readonly activityLogsRepository: Repository<ActivityLog>,
    @InjectRepository(Outlet)
    private readonly outletsRepository: Repository<Outlet>,
    @InjectRepository(SalesRoute)
    private readonly salesRoutesRepository: Repository<SalesRoute>,
    @InjectRepository(VanLoadRequest)
    private readonly vanLoadRequestsRepository: Repository<VanLoadRequest>,
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
      normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
    );

    const order = this.ordersRepository.create({
      orderCode: this.generateOrderCode(),
      userId: user.id,
      shopNameSnapshot: user.shopName ?? `${user.firstName} ${user.lastName}`,
      territoryId: user.territoryId,
      warehouseId: user.warehouseId,
      status: 'PLACED',
      source: 'SALES_REP',
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

  async getLatestOrderForShop(shopId: string) {
    const latestOrder = await this.ordersRepository.findOne({
      where: { userId: shopId },
      relations: {
        territory: true,
        warehouse: true,
      },
      order: { placedAt: 'DESC' },
    });

    if (latestOrder) {
      await this.syncAutomaticDelayForOrder(latestOrder);
      return {
        message: 'latest order fetched successfully',
        order: this.serializeOrder(latestOrder),
      };
    }

    return {
      message: 'no orders found for this shop',
      order: null,
    };
  }

  async createSalesRepOrder(
    salesRepId: string,
    dto: CreateSalesOrderDto,
    options?: SalesRepOrderOptions,
  ) {
    const salesRep = await this.requireSalesRep(salesRepId);
    const route = await this.requireOwnedInProgressRoute(
      dto.routeId,
      salesRepId,
    );
    const outlet = await this.requireOutlet(dto.shopId);
    const normalizedItems = await this.buildNormalizedSalesRepOrderItems(
      dto.items,
    );
    const targetShopOwner = options?.targetCustomerUserId
      ? await this.requireActiveShopOwner(options.targetCustomerUserId)
      : null;
    const orderOwner = targetShopOwner ?? salesRep;
    const totalAmount = Number(
      normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
    );
    const assistedReason = options?.assistedReason?.trim();
    const salesRepDisplayName =
      `${salesRep.firstName ?? ''} ${salesRep.lastName ?? ''}`.trim() ||
      salesRep.username;
    const customerNoteSegments = [
      `Sales route order - Route: ${dto.routeId}, Shop: ${dto.shopId}`,
      `Captured by sales rep ${salesRepDisplayName}`,
      assistedReason ? `Assisted reason: ${assistedReason}` : null,
    ].filter((value): value is string => !!value);

    const order = this.ordersRepository.create({
      orderCode: `SR-${Date.now()}`,
      userId: orderOwner.id,
      shopNameSnapshot:
        options?.shopNameSnapshot ??
        targetShopOwner?.shopName ??
        outlet.outletName,
      territoryId:
        route.territoryId ??
        targetShopOwner?.territoryId ??
        salesRep.territoryId ??
        null,
      warehouseId:
        route.warehouseId ??
        targetShopOwner?.warehouseId ??
        salesRep.warehouseId ??
        null,
      status: 'PLACED',
      source: 'SALES_REP',
      currencyCode: 'LKR',
      totalAmount,
      placedAt: new Date(),
      customerNote: customerNoteSegments.join(' | '),
      items: normalizedItems.map(
        (item) =>
          ({
            productId: item.productId,
            skuSnapshot: item.skuSnapshot,
            productNameSnapshot: item.productNameSnapshot,
            packSizeSnapshot: item.packSizeSnapshot,
            imageUrlSnapshot: item.imageUrlSnapshot,
            casePriceSnapshot: item.casePriceSnapshot,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
            product: item.product,
          }) as any,
      ),
    });

    const savedOrder = await this.ordersRepository.save(order);

    // Log activity
    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ORDER_PLACED',
      title: 'Order placed',
      message: `Order with ${dto.items.length} item(s) placed at ${outlet.outletName}.`,
      metadata: {
        orderId: savedOrder.id,
        routeId: dto.routeId,
        shopId: dto.shopId,
        itemCount: dto.items.length,
        assistedReason: assistedReason ?? null,
      },
    });

    if (targetShopOwner) {
      await this.activityService.logForUser({
        userId: targetShopOwner.id,
        type: 'ASSISTED_ORDER_CONFIRMED',
        title: 'Order placed on your behalf',
        message: `${salesRepDisplayName} placed order ${savedOrder.orderCode} for ${outlet.outletName}.`,
        metadata: {
          orderId: savedOrder.id,
          orderCode: savedOrder.orderCode,
          routeId: dto.routeId,
          shopId: dto.shopId,
          shopName: outlet.outletName,
          itemCount: dto.items.length,
          totalAmount: savedOrder.totalAmount,
          salesRepId: salesRep.id,
          salesRepName: salesRepDisplayName,
          assistedReason: assistedReason ?? null,
        },
      });
    }

    return {
      message: 'Sales order placed successfully.',
      order: this.serializeOrder(savedOrder),
    };
  }

  async requestSalesRepOrderPin(
    salesRepId: string,
    dto: RequestAssistedOrderPinDto,
  ) {
    const salesRep = await this.requireSalesRep(salesRepId);
    await this.requireOwnedInProgressRoute(dto.routeId, salesRepId);
    const outlet = await this.requireOutlet(dto.shopId);
    const normalizedItems = await this.buildNormalizedSalesRepOrderItems(
      dto.items,
    );
    const wasCreatedByThisSalesRep =
      outlet.registeredBySalesRepId === salesRepId;
    const shopOwnerMatch = wasCreatedByThisSalesRep
      ? null
      : await this.resolveActiveShopOwnerForOutlet(outlet);
    const salesRepDisplayName =
      `${salesRep.firstName ?? ''} ${salesRep.lastName ?? ''}`.trim() ||
      salesRep.username;
    const totalAmount = Number(
      normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
    );

    if (wasCreatedByThisSalesRep || !shopOwnerMatch) {
      const bypassReason = wasCreatedByThisSalesRep
        ? 'SALES_REP_CREATED_OUTLET'
        : 'ACTIVE_SHOP_OWNER_NOT_FOUND';
      const result = await this.createSalesRepOrder(salesRepId, dto, {
        assistedReason: wasCreatedByThisSalesRep
          ? 'Captured during store visit for a sales-rep-created outlet.'
          : 'Captured during store visit; no active shop owner app account is linked to this outlet.',
        shopNameSnapshot: outlet.outletName,
      });

      await this.activityService.logForUser({
        userId: salesRepId,
        type: 'ASSISTED_ORDER_CONFIRMED_WITHOUT_PIN',
        title: 'Assisted order placed without PIN',
        message: wasCreatedByThisSalesRep
          ? `${result.order.orderCode} was placed for sales-rep-created outlet ${outlet.outletName} without PIN confirmation.`
          : `No active shop owner app account was found for ${outlet.outletName}, so ${result.order.orderCode} was placed without PIN confirmation.`,
        metadata: {
          status: 'CONFIRMED',
          routeId: dto.routeId,
          shopId: dto.shopId,
          shopName: outlet.outletName,
          orderId: result.order.id,
          orderCode: result.order.orderCode,
          itemCount: dto.items.length,
          totalAmount,
          confirmationBypassedReason: bypassReason,
        },
      });

      return {
        message: wasCreatedByThisSalesRep
          ? 'This outlet was registered by you, so the assisted order was placed without shop-owner PIN confirmation.'
          : 'No active shop owner account was linked to this outlet. The assisted order was placed without PIN confirmation.',
        order: result.order,
        orderId: result.order.id,
        orderCode: result.order.orderCode,
        status: 'CONFIRMED',
        requiresPin: false,
        expiresAt: null,
      };
    }

    const pin = this.generateAssistedOrderPin();
    const pinExpiresAt = new Date(
      Date.now() + ASSISTED_ORDER_PIN_TTL_MINUTES * 60 * 1000,
    );
    const pinHash = await bcrypt.hash(pin, ASSISTED_ORDER_BCRYPT_ROUNDS);

    const requestActivity = await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ASSISTED_ORDER_PIN_REQUESTED',
      title: 'Assisted order PIN sent',
      message: `A confirmation PIN was sent to ${shopOwnerMatch.user.shopName ?? shopOwnerMatch.user.firstName} for ${outlet.outletName}.`,
      metadata: {
        status: 'PENDING_SHOP_PIN',
        routeId: dto.routeId,
        shopId: dto.shopId,
        shopName: outlet.outletName,
        shopOwnerUserId: shopOwnerMatch.user.id,
        shopOwnerName:
          shopOwnerMatch.user.shopName ??
          `${shopOwnerMatch.user.firstName} ${shopOwnerMatch.user.lastName}`.trim(),
        shopOwnerMatchSource: shopOwnerMatch.matchSource,
        items: dto.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        pinHash,
        pinExpiresAt: pinExpiresAt.toISOString(),
        itemCount: dto.items.length,
        totalAmount,
      } satisfies AssistedOrderRequestMetadata & Record<string, unknown>,
    });

    await this.activityService.logForUser({
      userId: shopOwnerMatch.user.id,
      type: 'ASSISTED_ORDER_PIN',
      title: 'Order approval PIN',
      message: `${salesRepDisplayName} requested approval for an assisted order at ${outlet.outletName}. Share PIN ${pin} before it expires.`,
      metadata: {
        routeId: dto.routeId,
        shopId: dto.shopId,
        shopName: outlet.outletName,
        pin,
        expiresAt: pinExpiresAt.toISOString(),
        salesRepId: salesRep.id,
        salesRepName: salesRepDisplayName,
        itemCount: dto.items.length,
        totalAmount,
      },
    });

    return {
      message: `Confirmation PIN sent to ${shopOwnerMatch.user.shopName ?? outlet.outletName} in the activity center.`,
      assistedOrderRequestId: requestActivity.id,
      status: 'PENDING_SHOP_PIN',
      requiresPin: true,
      expiresAt: pinExpiresAt.toISOString(),
    };
  }

  async confirmSalesRepOrderPin(
    salesRepId: string,
    assistedOrderRequestId: string,
    dto: ConfirmAssistedOrderPinDto,
  ) {
    await this.requireSalesRep(salesRepId);

    const requestActivity = await this.activityLogsRepository.findOne({
      where: {
        id: assistedOrderRequestId,
        userId: salesRepId,
        type: 'ASSISTED_ORDER_PIN_REQUESTED',
      },
    });

    if (!requestActivity) {
      throw new NotFoundException('Assisted order request not found.');
    }

    const metadata = this.readAssistedOrderRequestMetadata(
      requestActivity.metadata,
    );

    if (metadata.status === 'CONFIRMED' && metadata.confirmedOrderId) {
      const existingOrder = await this.findSerializedOrderById(
        metadata.confirmedOrderId,
      );
      if (!existingOrder) {
        throw new NotFoundException(
          'The confirmed assisted order could not be found.',
        );
      }

      return {
        message: 'Assisted order already confirmed.',
        order: existingOrder,
      };
    }

    if (metadata.status !== 'PENDING_SHOP_PIN') {
      throw new BadRequestException(
        'This assisted order request is no longer awaiting a PIN.',
      );
    }

    if (new Date(metadata.pinExpiresAt).getTime() < Date.now()) {
      throw new BadRequestException(
        'The assisted order confirmation PIN has expired.',
      );
    }

    const isValidPin = await bcrypt.compare(dto.pin, metadata.pinHash);
    if (!isValidPin) {
      throw new BadRequestException(
        'Incorrect assisted order confirmation PIN.',
      );
    }

    const result = await this.createSalesRepOrder(
      salesRepId,
      {
        routeId: metadata.routeId,
        shopId: metadata.shopId,
        items: metadata.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      },
      {
        assistedReason: dto.assistedReason,
        shopNameSnapshot: metadata.shopName,
        targetCustomerUserId: metadata.shopOwnerUserId ?? null,
      },
    );

    requestActivity.title = 'Assisted order confirmed';
    requestActivity.message = `Assisted order ${result.order.orderCode} confirmed successfully.`;
    requestActivity.metadata = {
      ...metadata,
      status: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
      confirmedOrderId: result.order.id,
      assistedReason: dto.assistedReason.trim(),
    };
    await this.activityLogsRepository.save(requestActivity);

    return {
      message: 'Assisted order placed successfully.',
      order: result.order,
    };
  }

  async completeSalesRepImmediateDelivery(
    salesRepId: string,
    orderId: string,
    dto: CompleteSalesRepDeliveryDto,
  ) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Missing order reference for delivery.');
    }

    const salesRep = await this.requireSalesRep(salesRepId);
    const route = await this.requireOwnedInProgressRoute(
      dto.routeId,
      salesRepId,
    );
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: {
        territory: true,
        warehouse: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }
    if (order.source !== 'SALES_REP') {
      throw new BadRequestException(
        'Only sales-rep-assisted orders can be delivered from lorry stock.',
      );
    }
    if (!order.customerNote?.includes(`Route: ${route.id}`)) {
      throw new BadRequestException(
        'This order is not linked to the active sales route.',
      );
    }
    if (['COMPLETED', 'CANCELLED'].includes(order.status?.toUpperCase())) {
      throw new BadRequestException('This order is already closed.');
    }

    const loadRequest = await this.vanLoadRequestsRepository.findOne({
      where: { routeId: route.id },
      order: { createdAt: 'DESC' },
    });
    if (!loadRequest) {
      throw new BadRequestException(
        'No approved lorry load is available for this route.',
      );
    }

    const plan = this.buildImmediateDeliveryPlan(order, loadRequest);
    const deliveredItemCount = plan.reduce(
      (sum, item) => sum + item.deliveredCases,
      0,
    );
    if (deliveredItemCount <= 0) {
      throw new BadRequestException(
        'The current lorry load does not contain stock for this order.',
      );
    }

    const pendingItems = plan.filter((item) => item.pendingCases > 0);
    const isPartial = pendingItems.length > 0;
    if (isPartial && !dto.nextDeliveryDate) {
      throw new BadRequestException(
        'Select the next delivery date for a partial delivery.',
      );
    }

    this.applyImmediateDeliveryDeduction(loadRequest, plan);
    await this.vanLoadRequestsRepository.save(loadRequest);

    const confirmationNote = dto.confirmationNote.trim();
    const deliveryNoteSegments = [
      order.customerNote,
      `Immediate sales-rep delivery by ${salesRep.username}`,
      `Confirmation: ${confirmationNote}`,
      isPartial
        ? `Partial balance backordered for ${dto.nextDeliveryDate}`
        : null,
    ].filter((value): value is string => !!value);

    order.status = isPartial ? 'PARTIAL' : 'COMPLETED';
    order.customerNote = deliveryNoteSegments.join(' | ');
    await this.ordersRepository.save(order);

    let backorder: Order | null = null;
    if (isPartial) {
      backorder = await this.createImmediateDeliveryBackorder(
        order,
        route,
        pendingItems,
        dto.nextDeliveryDate,
      );
    }

    const managers = await this.findRelevantManagersForRoute(route);
    const salesRepDisplayName =
      `${salesRep.firstName ?? ''} ${salesRep.lastName ?? ''}`.trim() ||
      salesRep.username;

    await Promise.all([
      this.activityService.logForUser({
        userId: salesRepId,
        type: isPartial
          ? 'SALES_REP_ORDER_PARTIAL_DELIVERY'
          : 'SALES_REP_ORDER_DELIVERED',
        title: isPartial ? 'Partial delivery completed' : 'Order delivered',
        message: isPartial
          ? `${order.orderCode} was partially delivered. ${backorder?.orderCode ?? 'A backorder'} was created for the balance.`
          : `${order.orderCode} was delivered from your lorry stock.`,
        metadata: {
          orderId: order.id,
          orderCode: order.orderCode,
          routeId: route.id,
          backorderId: backorder?.id ?? null,
          backorderCode: backorder?.orderCode ?? null,
          deliveredItems: plan.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantityCases: item.deliveredCases,
          })),
          pendingItems: pendingItems.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantityCases: item.pendingCases,
          })),
        },
      }),
      ...managers.map((manager) =>
        this.activityService.logForUser({
          userId: manager.id,
          type: isPartial
            ? 'SALES_REP_ORDER_PARTIAL_DELIVERY'
            : 'SALES_REP_ORDER_DELIVERED',
          title: isPartial
            ? 'Sales rep partial delivery'
            : 'Sales rep completed delivery',
          message: isPartial
            ? `${salesRepDisplayName} partially delivered ${order.orderCode} for ${order.shopNameSnapshot}. ${backorder?.orderCode ?? 'A backorder'} is waiting for approval.`
            : `${salesRepDisplayName} placed and delivered ${order.orderCode} for ${order.shopNameSnapshot}.`,
          metadata: {
            orderId: order.id,
            orderCode: order.orderCode,
            routeId: route.id,
            salesRepId,
            salesRepName: salesRepDisplayName,
            backorderId: backorder?.id ?? null,
            backorderCode: backorder?.orderCode ?? null,
          },
        }),
      ),
    ]);

    if (order.userId !== salesRepId) {
      await this.activityService.logForUser({
        userId: order.userId,
        type: isPartial ? 'ORDER_PARTIAL_DELIVERY' : 'ORDER_COMPLETED',
        title: isPartial ? 'Order partially delivered' : 'Order completed',
        message: isPartial
          ? `${order.orderCode} was partially delivered. The remaining items are pending follow-up delivery.`
          : `${order.orderCode} was delivered successfully.`,
        metadata: {
          orderId: order.id,
          orderCode: order.orderCode,
          routeId: route.id,
          backorderId: backorder?.id ?? null,
          backorderCode: backorder?.orderCode ?? null,
        },
      });
    }

    return {
      message: isPartial
        ? 'Partial delivery completed and a backorder was sent for approval.'
        : 'Order delivered successfully.',
      status: order.status,
      order: this.serializeOrder(order),
      delivery: {
        outcome: isPartial ? 'PARTIAL' : 'COMPLETED',
        deliveredItems: plan
          .filter((item) => item.deliveredCases > 0)
          .map((item) => ({
            productId: item.productId,
            productName: item.productName,
            requestedCases: item.requestedCases,
            deliveredCases: item.deliveredCases,
            pendingCases: item.pendingCases,
          })),
        pendingItems: pendingItems.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          requestedCases: item.requestedCases,
          deliveredCases: item.deliveredCases,
          pendingCases: item.pendingCases,
        })),
        backorder: backorder ? this.serializeOrder(backorder) : null,
      },
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

  private async requireSalesRep(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new BadRequestException('sales rep account was not found');
    }

    if (user.role !== Role.SALES_REP) {
      throw new BadRequestException(
        'only sales rep accounts can place sales orders',
      );
    }

    return user;
  }

  private async requireOwnedInProgressRoute(
    routeId: string,
    salesRepId: string,
  ) {
    const route = await this.salesRoutesRepository.findOne({
      where: { id: routeId, salesRepId },
    });

    if (!route) {
      throw new NotFoundException('Sales route not found.');
    }

    if (route.status !== SalesRouteStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Sales route must be in progress before placing assisted orders.',
      );
    }

    return route;
  }

  private async requireOutlet(shopId: string) {
    const outlet = await this.outletsRepository.findOne({
      where: { id: shopId },
    });

    if (!outlet) {
      throw new NotFoundException('Outlet not found.');
    }

    return outlet;
  }

  private async buildNormalizedSalesRepOrderItems(
    items: CreateSalesOrderDto['items'],
  ) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Order must contain at least one item.');
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await this.productsRepository.find({
      where: { id: In(productIds) },
    });
    const productsById = new Map(
      products.map((product) => [product.id, product]),
    );

    return items.map((item) => {
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

  private async requireActiveShopOwner(userId: string) {
    const user = await this.requireShopOwner(userId);

    if (
      user.accountStatus !== AccountStatus.ACTIVE ||
      user.approvalStatus !== ApprovalStatus.APPROVED
    ) {
      throw new BadRequestException(
        'The linked shop owner account is not active.',
      );
    }

    return user;
  }

  private readAssistedOrderRequestMetadata(
    metadata: Record<string, unknown> | null,
  ) {
    if (!metadata) {
      throw new BadRequestException(
        'Assisted order request metadata is missing.',
      );
    }

    const routeId = metadata.routeId?.toString();
    const shopId = metadata.shopId?.toString();
    const shopName = metadata.shopName?.toString();
    const pinHash = metadata.pinHash?.toString();
    const pinExpiresAt = metadata.pinExpiresAt?.toString();
    const status = metadata.status?.toString();
    const rawItems = Array.isArray(metadata.items) ? metadata.items : [];

    const items = rawItems.map((item) => {
      const value = item as Record<string, unknown>;
      const productId = value.productId?.toString() ?? '';
      const quantity = Number(value.quantity ?? 0);

      if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException(
          'Assisted order request contains invalid item data.',
        );
      }

      return { productId, quantity };
    });

    if (
      !routeId ||
      !shopId ||
      !shopName ||
      (status !== 'PENDING_SHOP_PIN' && status !== 'CONFIRMED') ||
      !pinHash ||
      !pinExpiresAt ||
      items.length === 0
    ) {
      throw new BadRequestException(
        'Assisted order request metadata is incomplete.',
      );
    }

    return {
      status,
      routeId,
      shopId,
      shopName,
      items,
      pinHash,
      pinExpiresAt,
      shopOwnerUserId: metadata.shopOwnerUserId?.toString(),
      shopOwnerName: metadata.shopOwnerName?.toString(),
      shopOwnerMatchSource: metadata.shopOwnerMatchSource?.toString(),
      confirmedAt: metadata.confirmedAt?.toString(),
      confirmedOrderId: metadata.confirmedOrderId?.toString(),
      assistedReason: metadata.assistedReason?.toString(),
    } satisfies AssistedOrderRequestMetadata;
  }

  private buildImmediateDeliveryPlan(
    order: Order,
    loadRequest: VanLoadRequest,
  ) {
    const availableByProduct = new Map<string, number>();
    for (const line of [
      ...(loadRequest.freeSaleStockJson ?? []),
      ...(loadRequest.deliveryStockJson ?? []),
    ]) {
      const productId = line.productId?.toString() ?? '';
      if (!productId) {
        continue;
      }
      availableByProduct.set(
        productId,
        (availableByProduct.get(productId) ?? 0) +
          Math.max(0, Number(line.quantityCases) || 0),
      );
    }

    return order.items
      .filter((item) => !!item.productId && item.quantity > 0)
      .map((item) => {
        const productId = item.productId!;
        const requestedCases = Number(item.quantity) || 0;
        const availableCases = availableByProduct.get(productId) ?? 0;
        const deliveredCases = Math.min(requestedCases, availableCases);
        availableByProduct.set(productId, availableCases - deliveredCases);

        return {
          productId,
          productName: item.productNameSnapshot,
          requestedCases,
          deliveredCases,
          pendingCases: Math.max(0, requestedCases - deliveredCases),
          casePrice: Number(item.casePriceSnapshot) || 0,
          orderItem: item,
        };
      });
  }

  private applyImmediateDeliveryDeduction(
    loadRequest: VanLoadRequest,
    plan: ReturnType<OrdersService['buildImmediateDeliveryPlan']>,
  ) {
    for (const item of plan) {
      let remaining = item.deliveredCases;
      if (remaining <= 0) {
        continue;
      }

      remaining = this.deductFromLoadLines(
        loadRequest.freeSaleStockJson,
        item.productId,
        remaining,
      );
      remaining = this.deductFromLoadLines(
        loadRequest.deliveryStockJson,
        item.productId,
        remaining,
      );
    }

    loadRequest.freeSaleStockJson = (
      loadRequest.freeSaleStockJson ?? []
    ).filter((line) => Number(line.quantityCases) > 0);
    loadRequest.deliveryStockJson = (
      loadRequest.deliveryStockJson ?? []
    ).filter((line) => Number(line.quantityCases) > 0);
  }

  private deductFromLoadLines(
    lines: VanLoadRequestStockLine[],
    productId: string,
    quantityCases: number,
  ) {
    let remaining = quantityCases;
    for (const line of lines ?? []) {
      if (remaining <= 0 || line.productId !== productId) {
        continue;
      }
      const lineCases = Math.max(0, Number(line.quantityCases) || 0);
      const deducted = Math.min(lineCases, remaining);
      line.quantityCases = lineCases - deducted;
      remaining -= deducted;
    }

    return remaining;
  }

  private async createImmediateDeliveryBackorder(
    sourceOrder: Order,
    route: SalesRoute,
    pendingItems: ReturnType<OrdersService['buildImmediateDeliveryPlan']>,
    nextDeliveryDate?: string,
  ) {
    const items = pendingItems
      .filter((item) => item.pendingCases > 0)
      .map((item) => ({
        productId: item.productId,
        skuSnapshot: item.orderItem.skuSnapshot,
        productNameSnapshot: item.orderItem.productNameSnapshot,
        packSizeSnapshot: item.orderItem.packSizeSnapshot,
        imageUrlSnapshot: item.orderItem.imageUrlSnapshot,
        casePriceSnapshot: item.casePrice,
        quantity: item.pendingCases,
        lineTotal: Number((item.casePrice * item.pendingCases).toFixed(2)),
        product: item.orderItem.product,
      }));
    const totalAmount = Number(
      items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
    );
    const backorder = this.ordersRepository.create({
      orderCode: `SR-BO-${Date.now()}`,
      userId: sourceOrder.userId,
      shopNameSnapshot: sourceOrder.shopNameSnapshot,
      territoryId: sourceOrder.territoryId ?? route.territoryId ?? null,
      warehouseId: sourceOrder.warehouseId ?? route.warehouseId ?? null,
      status: 'PLACED',
      source: 'SALES_REP',
      currencyCode: sourceOrder.currencyCode,
      totalAmount,
      placedAt: new Date(),
      customerNote: [
        `Backorder from partial sales-rep delivery - Route: ${route.id}`,
        `Original order: ${sourceOrder.orderCode}`,
        nextDeliveryDate ? `Next delivery date: ${nextDeliveryDate}` : null,
      ]
        .filter((value): value is string => !!value)
        .join(' | '),
      items,
    });

    return this.ordersRepository.save(backorder);
  }

  private async findRelevantManagersForRoute(route: SalesRoute) {
    const managers = [
      ...(await this.usersService.findByRole(Role.REGIONAL_MANAGER)),
      ...(await this.usersService.findByRole(Role.TERRITORY_DISTRIBUTOR)),
    ];
    const matchedManagers = managers.filter(
      (manager) =>
        manager.warehouseId === route.warehouseId ||
        (!!route.territoryId && manager.territoryId === route.territoryId),
    );

    return matchedManagers.length > 0 ? matchedManagers : managers;
  }

  private async resolveActiveShopOwnerForOutlet(
    outlet: Outlet,
  ): Promise<OutletShopOwnerMatch | null> {
    const candidates = new Map<string, OutletShopOwnerMatch>();
    const addCandidate = (user: User | null, matchSource: string) => {
      if (!user) {
        return;
      }

      candidates.set(user.id, { user, matchSource });
    };

    if (outlet.ownerEmail && (outlet.ownerEmail.trim().length ?? 0) > 0) {
      addCandidate(
        await this.usersService.findByEmail(outlet.ownerEmail.trim()),
        'OWNER_EMAIL',
      );
    }

    if (outlet.ownerPhone && (outlet.ownerPhone.trim().length ?? 0) > 0) {
      addCandidate(
        await this.usersService.findByPhoneNumber(outlet.ownerPhone.trim()),
        'OWNER_PHONE',
      );
    }

    const normalizedOutletName = this.normalizeText(outlet.outletName);
    const normalizedOwnerName = this.normalizeText(outlet.ownerName);
    const normalizedEmail = this.normalizeText(outlet.ownerEmail);
    const normalizedPhone = this.normalizePhone(outlet.ownerPhone);
    const allShopOwners = await this.usersService.findByRole(Role.SHOP_OWNER);

    for (const shopOwner of allShopOwners) {
      const matchesTerritory =
        !outlet.territoryId || shopOwner.territoryId === outlet.territoryId;
      const matchesWarehouse =
        !outlet.warehouseId || shopOwner.warehouseId === outlet.warehouseId;
      const normalizedShopName = this.normalizeText(shopOwner.shopName);
      const normalizedUserName = this.normalizeText(
        `${shopOwner.firstName} ${shopOwner.lastName}`,
      );
      const normalizedUserEmail = this.normalizeText(shopOwner.email);
      const normalizedUserPhone = this.normalizePhone(shopOwner.phoneNumber);

      if (
        normalizedEmail.length > 0 &&
        normalizedEmail == normalizedUserEmail &&
        matchesTerritory
      ) {
        addCandidate(shopOwner, 'SHOP_OWNER_EMAIL');
        continue;
      }

      if (
        normalizedPhone.length > 0 &&
        normalizedPhone == normalizedUserPhone &&
        (matchesTerritory || matchesWarehouse)
      ) {
        addCandidate(shopOwner, 'SHOP_OWNER_PHONE');
        continue;
      }

      if (
        normalizedOutletName.length > 0 &&
        normalizedOutletName == normalizedShopName &&
        (matchesTerritory || matchesWarehouse)
      ) {
        addCandidate(shopOwner, 'SHOP_NAME');
        continue;
      }

      if (
        normalizedOwnerName.length > 0 &&
        normalizedOwnerName == normalizedUserName &&
        matchesTerritory
      ) {
        addCandidate(shopOwner, 'OWNER_NAME');
      }
    }

    const rankedMatches = [...candidates.values()]
      .filter(
        ({ user }) =>
          user.role === Role.SHOP_OWNER &&
          user.accountStatus === AccountStatus.ACTIVE &&
          user.approvalStatus === ApprovalStatus.APPROVED,
      )
      .sort(
        (left, right) =>
          this.getShopOwnerMatchScore(right.matchSource) -
          this.getShopOwnerMatchScore(left.matchSource),
      );

    return rankedMatches[0] ?? null;
  }

  private getShopOwnerMatchScore(matchSource: string) {
    switch (matchSource) {
      case 'OWNER_EMAIL':
      case 'SHOP_OWNER_EMAIL':
        return 400;
      case 'OWNER_PHONE':
      case 'SHOP_OWNER_PHONE':
        return 300;
      case 'SHOP_NAME':
        return 200;
      case 'OWNER_NAME':
        return 100;
      default:
        return 0;
    }
  }

  private normalizeText(value?: string | null) {
    return value?.trim().toLowerCase() ?? '';
  }

  private normalizePhone(value?: string | null) {
    return value?.replace(/\D/g, '') ?? '';
  }

  private async findSerializedOrderById(orderId: string) {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
      relations: {
        territory: true,
        warehouse: true,
      },
    });

    if (!order) {
      return null;
    }

    return this.serializeOrder(order);
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

  private generateAssistedOrderPin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
