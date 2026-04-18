import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { User } from '../users/entities/user.entity';
import { ProcessTmOrderDecision } from './dto/process-tm-order.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';
import {
  getOrderDueAt,
  isOrderOverdue,
} from './order-status.util';

type ProcessingPreviewItem = {
  itemId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  lineTotal: number;
  availableCases: number;
  isAvailable: boolean;
  reason: string | null;
};

type ProcessingPreview = {
  allItemsAvailable: boolean;
  availableItems: ProcessingPreviewItem[];
  unavailableItems: ProcessingPreviewItem[];
  availableTotal: number;
  currentTotal: number;
};

@Injectable()
export class TmOrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepo: Repository<OrderItem>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(WarehouseInventoryItem)
    private readonly inventoryRepo: Repository<WarehouseInventoryItem>,
    private readonly activityService: ActivityService,
    private readonly ordersService: OrdersService,
  ) {}

  async listWarehouseOrders(tmUserId: string) {
    const tm = await this.requireTm(tmUserId);

    const orders = await this.ordersRepo.find({
      where: { warehouseId: tm.warehouseId! },
      relations: { user: true },
      order: { placedAt: 'DESC' },
    });

    await this.ordersService.syncAutomaticDelays(orders);

    return {
      message: 'Warehouse orders fetched.',
      orders: orders.map((order) => ({
        id: order.id,
        orderCode: order.orderCode,
        shopName: order.shopNameSnapshot,
        userId: order.userId,
        status: order.status,
        totalAmount: order.totalAmount,
        currencyCode: order.currencyCode,
        placedAt: order.placedAt,
        approvedAt: order.approvedAt,
        customerNote: order.customerNote,
        delayReason: order.delayReason,
        delayedAt: order.delayedAt,
        deliveryDueAt: getOrderDueAt(order.placedAt).toISOString(),
        assignmentId: order.assignmentId,
        isOverdue: isOrderOverdue(order),
        items: order.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.productNameSnapshot,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
        })),
      })),
    };
  }

  async previewOrderProcessing(tmUserId: string, orderId: string) {
    const tm = await this.requireTm(tmUserId);
    const order = await this.requireOrder(orderId, tm.warehouseId!);
    this.ensureProcessableOrder(order);

    const preview = await this.buildProcessingPreview(order, tm.warehouseId!);

    return {
      message: preview.allItemsAvailable
        ? 'All requested products are available. The order can be moved to ready for delivery.'
        : 'Some requested products are not available in warehouse inventory.',
      preview: this.serializePreview(order, preview),
    };
  }

  async processOrder(
    tmUserId: string,
    orderId: string,
    decision: ProcessTmOrderDecision,
    explanation?: string,
  ) {
    const tm = await this.requireTm(tmUserId);
    const order = await this.requireOrder(orderId, tm.warehouseId!);
    this.ensureProcessableOrder(order);

    const preview = await this.buildProcessingPreview(order, tm.warehouseId!);

    switch (decision) {
      case 'READY_TO_DELIVER':
        return this.markReadyToDeliver(tm, order, preview);
      case 'PROCEED_AVAILABLE':
        return this.proceedWithAvailableProducts(tm, order, preview);
      case 'CANCEL_ORDER':
        return this.cancelOrder(tm, order, preview);
      default:
        throw new BadRequestException('Unsupported order decision.');
    }
  }

  async approveOrder(tmUserId: string, orderId: string) {
    return this.processOrder(tmUserId, orderId, 'READY_TO_DELIVER');
  }

  async delayOrder(tmUserId: string, orderId: string, reason: string) {
    const tm = await this.requireTm(tmUserId);
    const order = await this.requireOrder(orderId, tm.warehouseId!);

    const nonDelayableStatuses = ['COMPLETED', 'CANCELLED', 'DELAYED'];
    if (nonDelayableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Order is already in "${order.status}" status and cannot be marked delayed.`,
      );
    }

    const trimmedReason = this.normalizeExplanation(
      reason,
      'Please provide a meaningful delay reason.',
    );
    const customerNote = `Your order ${order.orderCode} has been delayed. Reason: ${trimmedReason}`;

    await this.ordersRepo.update(orderId, {
      status: 'DELAYED',
      customerNote,
      delayReason: trimmedReason,
      delayedAt: new Date(),
      delayedBy: tmUserId,
    });

    await this.activityService.logForUser({
      userId: order.userId,
      type: 'ORDER_DELAYED',
      title: 'Order delayed',
      message: customerNote,
      metadata: { orderId: order.id, orderCode: order.orderCode, reason: trimmedReason },
    });

    return { message: 'Order marked as delayed.' };
  }

  private async markReadyToDeliver(
    tm: User,
    order: Order,
    preview: ProcessingPreview,
  ) {
    if (!preview.allItemsAvailable) {
      throw new BadRequestException(
        'Some requested products are not available. Use the stock decision options instead.',
      );
    }

    const dueAt = getOrderDueAt(order.placedAt);
    const customerNote = `Your order ${order.orderCode} is proceeding for delivery and should arrive within 2 business days, before ${this.formatDateTime(dueAt)}.`;

    await this.ordersRepo.update(order.id, {
      status: 'PROCEED',
      approvedBy: tm.id,
      approvedAt: new Date(),
      customerNote,
      delayReason: null,
      delayedAt: null,
      delayedBy: null,
    });

    await this.activityService.logForUser({
      userId: order.userId,
      type: 'ORDER_APPROVED',
      title: 'Order proceeding for delivery',
      message: customerNote,
      metadata: {
        orderId: order.id,
        orderCode: order.orderCode,
        deliveryDueAt: dueAt.toISOString(),
      },
    });

    return {
      message: 'Order is now ready for delivery and has been moved to Proceed status.',
    };
  }

  private async proceedWithAvailableProducts(
    tm: User,
    order: Order,
    preview: ProcessingPreview,
  ) {
    if (preview.unavailableItems.length === 0) {
      throw new BadRequestException(
        'All requested products are available. Use Ready to deliver instead.',
      );
    }

    if (preview.availableItems.length === 0) {
      throw new BadRequestException(
        'None of the requested products are available. Cancel the order or restock before processing it.',
      );
    }

    const removedProducts = preview.unavailableItems.map((item) => item.productName);
    const remainingProducts = preview.availableItems.map((item) => item.productName);
    const customerNote = this.buildPartialProceedCustomerNote(
      order.orderCode,
      removedProducts,
      remainingProducts,
      preview.availableTotal,
    );
    const removedItemIds = preview.unavailableItems.map((item) => item.itemId);

    await this.ordersRepo.manager.transaction(async (manager) => {
      if (removedItemIds.length > 0) {
        await manager.getRepository(OrderItem).delete({
          id: In(removedItemIds),
          orderId: order.id,
        });
      }

      await manager.getRepository(Order).update(order.id, {
        status: 'PROCEED',
        approvedBy: tm.id,
        approvedAt: new Date(),
        totalAmount: preview.availableTotal,
        customerNote,
        delayReason: null,
        delayedAt: null,
        delayedBy: null,
      });
    });

    await this.activityService.logForUser({
      userId: order.userId,
      type: 'ORDER_UPDATED',
      title: 'Order updated before delivery',
      message: customerNote,
      metadata: {
        orderId: order.id,
        orderCode: order.orderCode,
        removedProducts,
        updatedTotalAmount: preview.availableTotal,
      },
    });

    return {
      message:
        'Unavailable products were removed from the order. The remaining items are now ready for delivery.',
    };
  }

  private async cancelOrder(
    tm: User,
    order: Order,
    preview: ProcessingPreview,
  ) {
    const customerNote = this.buildCancelledOrderCustomerNote(
      order.orderCode,
      preview.unavailableItems.map((item) => item.productName),
    );

    await this.ordersRepo.update(order.id, {
      status: 'CANCELLED',
      approvedBy: null,
      approvedAt: null,
      assignmentId: null,
      customerNote,
      delayReason: null,
      delayedAt: null,
      delayedBy: null,
    });

    await this.activityService.logForUser({
      userId: order.userId,
      type: 'ORDER_CANCELLED',
      title: 'Order cancelled',
      message: customerNote,
      metadata: {
        orderId: order.id,
        orderCode: order.orderCode,
        cancelledBy: tm.id,
      },
    });

    return { message: 'Order cancelled and the shop owner has been informed.' };
  }

  private async requireTm(tmUserId: string) {
    const tm = await this.usersRepo.findOne({ where: { id: tmUserId } });
    if (!tm?.warehouseId) {
      throw new BadRequestException('You are not assigned to a warehouse.');
    }
    return tm;
  }

  private async requireOrder(orderId: string, warehouseId: string): Promise<Order> {
    const order = await this.ordersRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.warehouseId !== warehouseId) {
      throw new BadRequestException('This order does not belong to your warehouse.');
    }
    return order;
  }

  private ensureProcessableOrder(order: Order) {
    if (!['PLACED', 'CONFIRMED'].includes(order.status)) {
      throw new BadRequestException(
        `Order is in "${order.status}" status and cannot be processed from approvals.`,
      );
    }
  }

  private async buildProcessingPreview(
    order: Order,
    warehouseId: string,
  ): Promise<ProcessingPreview> {
    const productIds = [
      ...new Set(
        order.items
          .map((item) => item.productId)
          .filter((productId): productId is string => !!productId),
      ),
    ];

    const inventoryItems = productIds.length
      ? await this.inventoryRepo.find({
          where: { warehouseId, productId: In(productIds) },
        })
      : [];
    const inventoryByProductId = new Map(
      inventoryItems.map((item) => [item.productId, item]),
    );

    const lineChecks = order.items.map<ProcessingPreviewItem>((item) => {
      const inventoryItem = item.productId
        ? inventoryByProductId.get(item.productId)
        : null;
      const availableCases = inventoryItem?.quantityOnHand ?? 0;
      const isAvailable = !!item.productId && availableCases >= item.quantity;

      return {
        itemId: item.id,
        productId: item.productId,
        productName: item.productNameSnapshot,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        availableCases,
        isAvailable,
        reason: isAvailable
          ? null
          : item.productId
            ? `Only ${availableCases} case(s) are currently available in warehouse inventory.`
            : 'This product is no longer linked to an active catalog item.',
      };
    });

    const availableItems = lineChecks.filter((item) => item.isAvailable);
    const unavailableItems = lineChecks.filter((item) => !item.isAvailable);

    return {
      allItemsAvailable: unavailableItems.length === 0,
      availableItems,
      unavailableItems,
      currentTotal: order.totalAmount,
      availableTotal: Number(
        availableItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2),
      ),
    };
  }

  private serializePreview(order: Order, preview: ProcessingPreview) {
    return {
      orderId: order.id,
      orderCode: order.orderCode,
      shopName: order.shopNameSnapshot,
      currentTotal: preview.currentTotal,
      availableTotal: preview.availableTotal,
      allItemsAvailable: preview.allItemsAvailable,
      availableItems: preview.availableItems,
      unavailableItems: preview.unavailableItems,
      deliveryDueAt: getOrderDueAt(order.placedAt).toISOString(),
    };
  }

  private normalizeExplanation(value: string | undefined, fallbackMessage: string) {
    const normalized = value?.trim() ?? '';
    if (normalized.length < 5) {
      throw new BadRequestException(fallbackMessage);
    }
    return normalized;
  }

  private formatCurrency(value: number) {
    return `LKR ${value.toFixed(2)}`;
  }

  private formatDateTime(date: Date) {
    return date.toLocaleString('en-LK', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private buildCancelledOrderCustomerNote(
    orderCode: string,
    unavailableProducts: string[],
  ) {
    const unavailablePart =
      unavailableProducts.length > 0
        ? ` The warehouse does not currently have enough stock for: ${unavailableProducts.join(', ')}.`
        : '';

    return `We're sorry, your order ${orderCode} could not be processed because there is not enough stock available in the warehouse right now.${unavailablePart} Please try again later or contact your territory manager for support.`;
  }

  private buildPartialProceedCustomerNote(
    orderCode: string,
    removedProducts: string[],
    remainingProducts: string[],
    updatedTotal: number,
  ) {
    const removedPart =
      removedProducts.length > 0
        ? `Removed products: ${removedProducts.join(', ')}.`
        : 'Some unavailable products were removed from your order.';
    const remainingPart =
      remainingProducts.length > 0
        ? ` Remaining products: ${remainingProducts.join(', ')}.`
        : '';

    return `We're sorry, some products in your order ${orderCode} were unavailable in the warehouse and had to be removed. ${removedPart}${remainingPart} Updated total: ${this.formatCurrency(updatedTotal)}. The remaining products will be delivered within 2 business days.`;
  }
}
