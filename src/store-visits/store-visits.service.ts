import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, MoreThan, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { ActivityLog } from '../activity/entities/activity.entity';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { StoreVisit, StoreVisitStatus } from './entities/store-visit.entity';
import { Order } from '../orders/entities/order.entity';
import {
  SalesRoute,
  SalesRouteStatus,
} from '../sales-routes/entities/sales-route.entity';
import { RouteBeatPlanItem } from '../sales-routes/entities/route-beat-plan-item.entity';
import { StartVisitDto } from './dto/start-visit.dto';
import { CompleteVisitDto } from './dto/complete-visit.dto';
import { CheckInVisitDto } from './dto/check-in-visit.dto';

@Injectable()
export class StoreVisitsService {
  constructor(
    @InjectRepository(StoreVisit)
    private readonly storeVisitsRepo: Repository<StoreVisit>,
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    @InjectRepository(ActivityLog)
    private readonly activityLogsRepo: Repository<ActivityLog>,
    @InjectRepository(OrderReturn)
    private readonly orderReturnsRepo: Repository<OrderReturn>,
    @InjectRepository(SalesRoute)
    private readonly salesRoutesRepo: Repository<SalesRoute>,
    @InjectRepository(RouteBeatPlanItem)
    private readonly beatPlanItemsRepo: Repository<RouteBeatPlanItem>,
    private readonly activityService: ActivityService,
  ) {}

  async startVisit(userId: string, dto: StartVisitDto): Promise<StoreVisit> {
    const route = await this.salesRoutesRepo.findOne({
      where: { id: dto.routeId },
    });
    if (!route) {
      throw new NotFoundException(
        `Sales route with id ${dto.routeId} not found`,
      );
    }
    if (route.salesRepId !== userId) {
      throw new BadRequestException(
        'You can only start visits on your own route',
      );
    }
    if (route.status !== SalesRouteStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Route must be IN_PROGRESS before store visits can start',
      );
    }
    if (
      route.territoryId &&
      dto.territoryId &&
      route.territoryId !== dto.territoryId
    ) {
      throw new BadRequestException(
        'Outlet visit must use the current route territory',
      );
    }
    if (dto.shopId) {
      const beatPlanItem = await this.beatPlanItemsRepo.findOne({
        where: {
          routeId: dto.routeId,
          outletId: dto.shopId,
          isSelected: true,
        },
      });
      if (!beatPlanItem) {
        throw new BadRequestException(
          "Select an outlet from today's Beat Plan before starting the visit",
        );
      }
    }

    let lastOrderDate: Date | null = null;
    let suggestedOrder: any = null;
    let hasPendingDelivery = false;

    if (dto.shopId) {
      try {
        const outletOrders = await this.findOrdersForOutlet(dto.shopId);
        const latestOrder = outletOrders[0] ?? null;
        if (latestOrder) {
          lastOrderDate = latestOrder.placedAt;
          suggestedOrder = {
            totalAmount: Number(
              (Number(latestOrder.totalAmount ?? 0) * 1.1).toFixed(2),
            ),
            currencyCode: latestOrder.currencyCode,
            itemCount: latestOrder.items?.length || 0,
            note: 'Based on 110% of your previous order.',
          };
        }

        hasPendingDelivery = outletOrders.some((order) =>
          ['APPROVED', 'SHIPPED', 'READY_FOR_DELIVERY'].includes(order.status),
        );
      } catch (error) {
        console.error(
          'Failed to fetch order history for store visit start:',
          error,
        );
      }
    }

    const storeVisit: any = this.storeVisitsRepo.create({
      routeId: dto.routeId,
      shopId: dto.shopId || null,
      shopNameSnapshot: dto.shopNameSnapshot,
      territoryId: dto.territoryId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      salesRepId: userId,
      status: StoreVisitStatus.IN_PROGRESS,
      visitStartedAt: new Date(),
      visitStartTime: new Date(),
      lastOrderDateSnapshot: lastOrderDate,
      suggestedOrderJson: suggestedOrder,
      hasPendingDelivery,
    } as any);

    const savedVisit: any = await this.storeVisitsRepo.save(storeVisit);

    await this.activityService.logForUser({
      userId,
      type: 'STORE_VISIT_STARTED',
      title: 'Store Visit Started',
      message: `Store visit at "${dto.shopNameSnapshot}" has been started`,
      metadata: {
        visitId: savedVisit.id,
        shopName: savedVisit.shopNameSnapshot,
        status: savedVisit.status,
        lastOrderDate: savedVisit.lastOrderDateSnapshot,
        hasPendingDelivery: savedVisit.hasPendingDelivery,
      },
    });

    return savedVisit;
  }

  async completeVisit(
    visitId: string,
    userId: string,
    dto: CompleteVisitDto,
  ): Promise<StoreVisit> {
    const visit = await this.storeVisitsRepo.findOne({
      where: { id: visitId },
    });
    if (!visit) {
      throw new NotFoundException(`Store visit with id ${visitId} not found`);
    }

    if (visit.status !== StoreVisitStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Store visit is not IN_PROGRESS (current: ${visit.status})`,
      );
    }

    if (visit.salesRepId !== userId) {
      throw new BadRequestException(
        'You can only complete your own store visits',
      );
    }

    if (!Array.isArray(dto.stockItems) || dto.stockItems.length === 0) {
      throw new BadRequestException(
        'Shelf availability and stock observations are required before ending the visit',
      );
    }
    if (
      (!Array.isArray(dto.outletFeedbackAnswers) ||
        dto.outletFeedbackAnswers.length === 0) &&
      !dto.outletFeedback?.trim()
    ) {
      throw new BadRequestException(
        'Outlet feedback is required before ending the visit',
      );
    }

    const now = new Date();
    const durationSeconds = Math.floor(
      (now.getTime() - visit.visitStartedAt.getTime()) / 1000,
    );

    visit.status = StoreVisitStatus.COMPLETED;
    visit.visitEndedAt = now;
    visit.visitEndTime = now;
    visit.durationSeconds = durationSeconds;
    visit.durationMinutes = Math.ceil(durationSeconds / 60);

    // Structured stock data (preferred) or legacy JSON
    visit.shelfStockJson =
      (dto.stockItems as any) || dto.shelfStockJson || null;
    visit.backroomStockJson =
      (dto.stockItems?.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        backroomCount: item.backroomCount,
      })) as any) ||
      dto.backroomStockJson ||
      null;
    visit.estimatedSellThroughJson =
      (dto.stockItems?.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        estimatedSales: item.estimatedSales,
        shelfCount: item.shelfCount,
        backroomCount: item.backroomCount,
      })) as any) || null;

    // OSA issues
    visit.osaIssuesJson = (dto.osaIssues as any) || dto.osaIssuesJson || null;

    // Competitor notes
    (visit as any).competitorNotes = dto.competitorNotes || null;

    // Expiry items
    (visit as any).expiryItemsJson = (dto.expiryItems as any) || null;

    // Promotions
    visit.promotionsJson =
      (dto.promotionChecks as any) || dto.promotionsJson || null;

    // Planogram + POSM structured answers
    const displayAnswers = [
      ...(dto.planogramAnswers || []),
      ...(dto.posmAnswers || []),
    ];
    visit.planogramAnswersJson =
      displayAnswers.length > 0 ? (displayAnswers as any) : null;
    visit.planogramOk = dto.planogramOk ?? null;
    visit.posmOk = dto.posmOk ?? null;

    // Outlet feedback
    (visit as any).outletFeedbackAnswersJson =
      (dto.outletFeedbackAnswers as any) || null;
    visit.outletFeedback = dto.outletFeedback || null;

    const updatedVisit = await this.storeVisitsRepo.save(visit);

    await this.activityService.logForUser({
      userId,
      type: 'STORE_VISIT_COMPLETED',
      title: 'Store Visit Completed',
      message: `Store visit at "${visit.shopNameSnapshot}" has been completed (${durationSeconds}s)`,
      metadata: {
        visitId: updatedVisit.id,
        shopName: updatedVisit.shopNameSnapshot,
        status: updatedVisit.status,
        durationSeconds: updatedVisit.durationSeconds,
      },
    });

    return updatedVisit;
  }

  async checkInVisit(
    salesRepId: string,
    dto: CheckInVisitDto,
  ): Promise<StoreVisit> {
    const storeVisit: any = this.storeVisitsRepo.create({
      routeId: dto.routeId,
      shopId: dto.shopId,
      salesRepId,
      status: StoreVisitStatus.IN_PROGRESS,
      visitStartedAt: new Date(),
      visitNotes: dto.visitNotes || null,
    } as any);

    const savedVisit: any = await this.storeVisitsRepo.save(storeVisit);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'STORE_VISIT_CHECKED_IN',
      title: 'Store Visit Checked In',
      message: `Store visit at shop ${dto.shopId} has been checked in`,
      metadata: {
        visitId: savedVisit.id,
        routeId: dto.routeId,
        shopId: dto.shopId,
      },
    });

    return savedVisit;
  }

  async addPhotoToVisit(
    visitId: string,
    userId: string,
    filename: string,
  ): Promise<StoreVisit> {
    const visit = await this.storeVisitsRepo.findOne({
      where: { id: visitId },
    });
    if (!visit) {
      throw new NotFoundException(`Store visit with id ${visitId} not found`);
    }

    if (visit.salesRepId !== userId) {
      throw new BadRequestException(
        'You can only add photos to your own visits',
      );
    }

    const photoUrl = `/uploads/visits/${filename}`;
    if (!visit.photoUrls) {
      visit.photoUrls = [];
    }
    visit.photoUrls.push(photoUrl);

    const updatedVisit = await this.storeVisitsRepo.save(visit);

    await this.activityService.logForUser({
      userId,
      type: 'STORE_VISIT_PHOTO_ADDED',
      title: 'Store Visit Photo Added',
      message: `A shelving photo has been added to the visit at "${visit.shopNameSnapshot}"`,
      metadata: { visitId, photoUrl },
    });

    return updatedVisit;
  }

  /**
   * Returns order history context for a specific outlet —
   * orders placed since the last completed visit by this rep.
   * Used by the mobile app to calculate estimated sell-through per product.
   */
  async getOutletContext(outletId: string) {
    // Demand context must follow the outlet, not the individual rep.
    const lastVisit = await this.storeVisitsRepo.findOne({
      where: {
        shopId: outletId,
        status: StoreVisitStatus.COMPLETED,
      },
      order: { visitEndedAt: 'DESC' },
    });

    const since =
      lastVisit?.visitEndedAt ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30-day fallback

    // All direct shop-owner orders and assisted sales-rep orders for this outlet.
    const allOrders = await this.findOrdersForOutlet(outletId);

    const ordersSinceLastVisit = allOrders.filter(
      (o) => o.placedAt && new Date(o.placedAt) > since,
    );

    const productQuantities = await this.buildExpectedStockUnitsByProduct(
      lastVisit,
      allOrders,
      since,
    );

    return {
      lastVisitDate: lastVisit?.visitEndedAt ?? null,
      lastVisitSalesRepId: lastVisit?.salesRepId ?? null,
      orderCountSinceLastVisit: ordersSinceLastVisit.length,
      recentOrders: allOrders.slice(0, 5).map((o) => ({
        id: o.id,
        placedAt: o.placedAt,
        totalAmount: o.totalAmount,
        currencyCode: o.currencyCode,
        status: o.status,
        itemCount: o.items?.length ?? 0,
        items: (o.items || []).map((item) => ({
          productId: item.productId,
          productName: item.productNameSnapshot,
          quantity: item.quantity,
        })),
      })),
      productQuantities,
    };
  }

  private async buildExpectedStockUnitsByProduct(
    lastVisit: StoreVisit | null,
    movementCandidateOrders: Order[],
    since: Date,
  ) {
    const expectedUnits = this.readVisitStockUnits(lastVisit);
    const deliveredUnits = await this.readDeliveredUnitsByProduct(
      movementCandidateOrders,
      since,
    );
    const returnedUnits = await this.readReturnedUnitsByProduct(
      movementCandidateOrders,
      since,
    );

    for (const [productId, quantity] of deliveredUnits.entries()) {
      expectedUnits.set(productId, (expectedUnits.get(productId) ?? 0) + quantity);
    }

    for (const [productId, quantity] of returnedUnits.entries()) {
      expectedUnits.set(
        productId,
        Math.max(0, (expectedUnits.get(productId) ?? 0) - quantity),
      );
    }

    return Object.fromEntries(expectedUnits.entries());
  }

  private readVisitStockUnits(visit: StoreVisit | null) {
    const stockUnits = new Map<string, number>();
    const stockItems = Array.isArray(visit?.shelfStockJson)
      ? visit.shelfStockJson
      : [];

    for (const item of stockItems) {
      const record = item as unknown as Record<string, unknown>;
      const productId = record.productId?.toString() ?? '';
      if (!productId) {
        continue;
      }

      const quantityUnits =
        this.readNumber(record.shelfCount) +
        this.readNumber(record.backroomCount) +
        this.readNumber(record.quantityUnits);

      stockUnits.set(productId, (stockUnits.get(productId) ?? 0) + quantityUnits);
    }

    return stockUnits;
  }

  private async readDeliveredUnitsByProduct(
    movementCandidateOrders: Order[],
    since: Date,
  ) {
    const deliveredUnits = new Map<string, number>();
    const orderIds = new Set(movementCandidateOrders.map((order) => order.id));

    if (orderIds.size === 0) {
      return deliveredUnits;
    }

    const activityLogs = await this.activityLogsRepo.find({
      where: {
        type: In([
          'SALES_REP_ORDER_DELIVERED',
          'SALES_REP_ORDER_PARTIAL_DELIVERY',
        ]),
        createdAt: MoreThan(since),
      },
      order: { createdAt: 'ASC' },
    });
    const deliveryActivityByOrderId = new Map<string, ActivityLog>();

    for (const activity of activityLogs) {
      const orderId = activity.metadata?.orderId?.toString?.() ?? '';
      const deliveredItems = activity.metadata?.deliveredItems;
      if (!orderIds.has(orderId) || !Array.isArray(deliveredItems)) {
        continue;
      }
      deliveryActivityByOrderId.set(orderId, activity);
    }

    for (const order of movementCandidateOrders) {
      const activity = deliveryActivityByOrderId.get(order.id);
      if (activity) {
        const deliveredItems = activity.metadata?.deliveredItems as unknown[];
        for (const deliveredItem of deliveredItems) {
          const record = deliveredItem as Record<string, unknown>;
          const productId = record.productId?.toString() ?? '';
          if (!productId) {
            continue;
          }
          const unitsPerCase = this.unitsPerCaseForOrderProduct(order, productId);
          this.incrementQuantity(
            deliveredUnits,
            productId,
            this.readNumber(record.quantityCases) * unitsPerCase,
          );
        }
        continue;
      }

      const fallbackDeliveredAt = order.updatedAt ?? order.placedAt;
      if (
        order.status !== 'COMPLETED' ||
        !fallbackDeliveredAt ||
        fallbackDeliveredAt.getTime() <= since.getTime()
      ) {
        continue;
      }

      for (const item of order.items ?? []) {
        if (!item.productId) {
          continue;
        }
        this.incrementQuantity(
          deliveredUnits,
          item.productId,
          this.readNumber(item.quantity) *
            this.unitsPerCaseForOrderProduct(order, item.productId),
        );
      }
    }

    return deliveredUnits;
  }

  private async readReturnedUnitsByProduct(
    movementCandidateOrders: Order[],
    since: Date,
  ) {
    const returnedUnits = new Map<string, number>();
    const orderIds = new Set(movementCandidateOrders.map((order) => order.id));

    if (orderIds.size === 0) {
      return returnedUnits;
    }

    const returns = await this.orderReturnsRepo.find({
      where: { createdAt: MoreThan(since) },
      relations: { items: { product: true } },
    });

    for (const orderReturn of returns) {
      if (!orderReturn.orderId || !orderIds.has(orderReturn.orderId)) {
        continue;
      }

      for (const item of orderReturn.items ?? []) {
        if (!item.productId) {
          continue;
        }
        const unitsPerCase = item.product?.productsPerCase ?? 1;
        this.incrementQuantity(
          returnedUnits,
          item.productId,
          this.readNumber(item.quantity) * unitsPerCase,
        );
      }
    }

    return returnedUnits;
  }

  private unitsPerCaseForOrderProduct(order: Order, productId: string) {
    const item = order.items?.find((orderItem) => orderItem.productId === productId);
    return item?.product?.productsPerCase ?? 1;
  }

  private incrementQuantity(
    quantities: Map<string, number>,
    productId: string,
    quantity: number,
  ) {
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }

  private readNumber(value: unknown) {
    const numericValue = Number(value ?? 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  private async findOrdersForOutlet(outletId: string): Promise<Order[]> {
    const [directOrders, assistedOrders] = await Promise.all([
      this.ordersRepo.find({
        where: { userId: outletId },
        relations: ['items', 'items.product'],
        order: { placedAt: 'DESC' },
      }),
      this.ordersRepo.find({
        where: { customerNote: Like(`%Shop: ${outletId}%`) },
        relations: ['items', 'items.product'],
        order: { placedAt: 'DESC' },
      }),
    ]);

    const byId = new Map<string, Order>();
    for (const order of [...directOrders, ...assistedOrders]) {
      byId.set(order.id, order);
    }

    return Array.from(byId.values()).sort((left, right) => {
      const leftTime = left.placedAt ? new Date(left.placedAt).getTime() : 0;
      const rightTime = right.placedAt ? new Date(right.placedAt).getTime() : 0;
      return rightTime - leftTime;
    });
  }
}
