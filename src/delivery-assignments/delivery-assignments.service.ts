import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { In, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { Role } from '../common/enums/role.enum';
import { Order } from '../orders/entities/order.entity';
import {
  createAutomaticDelayPatch,
  isOrderOverdue,
  isProceedOrderStatus,
} from '../orders/order-status.util';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { AddNoteDto } from './dto/add-note.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { ReportIncidentDto } from './dto/report-incident.dto';
import { SubmitShopReturnDto } from './dto/submit-shop-return.dto';
import { ReturnItemDto, SubmitReturnDto } from './dto/submit-return.dto';
import { DeliveryAssignmentOrder } from './entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from './entities/delivery-assignment.entity';
import { IncidentReport } from './entities/incident-report.entity';
import { OrderReturn } from './entities/order-return.entity';
import { ReturnItem } from './entities/return-item.entity';

const PIN_TTL_HOURS = 24;

function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

type StockReservation = {
  productId: string;
  productName: string;
  quantity: number;
};

type RefillAlert = {
  productId: string;
  productName: string;
  beforeQuantity: number;
  afterQuantity: number;
  refillLevel: number;
};

@Injectable()
export class DeliveryAssignmentsService {
  constructor(
    @InjectRepository(DeliveryAssignment)
    private readonly assignmentsRepo: Repository<DeliveryAssignment>,
    @InjectRepository(DeliveryAssignmentOrder)
    private readonly daoRepo: Repository<DeliveryAssignmentOrder>,
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    @InjectRepository(OrderReturn)
    private readonly returnsRepo: Repository<OrderReturn>,
    @InjectRepository(ReturnItem)
    private readonly returnItemsRepo: Repository<ReturnItem>,
    @InjectRepository(IncidentReport)
    private readonly incidentsRepo: Repository<IncidentReport>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepo: Repository<Vehicle>,
    @InjectRepository(WarehouseInventoryItem)
    private readonly inventoryRepo: Repository<WarehouseInventoryItem>,
    private readonly activityService: ActivityService,
  ) {}

  async createAssignment(tmUserId: string, dto: CreateAssignmentDto) {
    const tm = await this.usersRepo.findOne({ where: { id: tmUserId } });
    if (!tm || !tm.warehouseId) {
      throw new BadRequestException('Territory manager is not assigned to a warehouse.');
    }

    const distributor = await this.usersRepo.findOne({ where: { id: dto.distributorId } });
    if (!distributor || distributor.role !== Role.TERRITORY_DISTRIBUTOR) {
      throw new BadRequestException('Invalid distributor.');
    }
    if (distributor.warehouseId !== tm.warehouseId) {
      throw new BadRequestException('Distributor does not belong to your warehouse.');
    }

    let vehicle: Vehicle | null = null;
    if (dto.vehicleId) {
      vehicle = await this.vehiclesRepo.findOne({ where: { id: dto.vehicleId } });
      if (!vehicle || vehicle.warehouseId !== tm.warehouseId) {
        throw new BadRequestException('Vehicle does not belong to your warehouse.');
      }
    }

    const uniqueOrderIds = [...new Set(dto.orderIds)];
    const orders = await this.ordersRepo.find({ where: { id: In(uniqueOrderIds) } });
    if (orders.length !== uniqueOrderIds.length) {
      throw new BadRequestException('One or more orders were not found.');
    }

    const overdueOrders = orders.filter((order) => isOrderOverdue(order));
    if (overdueOrders.length > 0) {
      await Promise.all(
        overdueOrders.map((order) =>
          this.ordersRepo.update(order.id, createAutomaticDelayPatch(order.placedAt)),
        ),
      );

      throw new BadRequestException(
        `Order ${overdueOrders[0].orderCode} exceeded the 2-business-day delivery window and was automatically marked delayed.`,
      );
    }

    for (const order of orders) {
      if (order.warehouseId !== tm.warehouseId) {
        throw new BadRequestException(`Order ${order.orderCode} does not belong to your warehouse.`);
      }
      if (!isProceedOrderStatus(order.status)) {
        throw new BadRequestException(
          `Order ${order.orderCode} must be in Proceed status before delivery can start.`,
        );
      }
    }

    const stockCheck = await this.buildStockReservationCheck(tm.warehouseId, orders);
    if (stockCheck.shortages.length > 0) {
      throw new BadRequestException(stockCheck.shortages[0]);
    }

    if (vehicle && vehicle.capacityCases < stockCheck.totalCases) {
      throw new BadRequestException(
        `The selected vehicle can carry ${vehicle.capacityCases} case(s), but the chosen orders need ${stockCheck.totalCases} case(s).`,
      );
    }

    const deliveryDate = dto.deliveryDate ?? new Date().toISOString().split('T')[0];
    const plainPins: Array<{ orderId: string; pin: string }> = [];

    const assignmentResult = await this.ordersRepo.manager.transaction(async (manager) => {
      const assignmentRepo = manager.getRepository(DeliveryAssignment);
      const assignmentOrderRepo = manager.getRepository(DeliveryAssignmentOrder);
      const inventoryRepo = manager.getRepository(WarehouseInventoryItem);
      const orderRepo = manager.getRepository(Order);

      const refillAlerts = await this.reserveWarehouseStock(
        inventoryRepo,
        tm.warehouseId!,
        stockCheck.reservations,
      );

      const assignment = assignmentRepo.create({
        territoryManagerId: tmUserId,
        distributorId: dto.distributorId,
        vehicleId: dto.vehicleId ?? null,
        deliveryDate,
        status: 'ACTIVE',
        notes: dto.notes ?? null,
      });
      const savedAssignment = await assignmentRepo.save(assignment);

      const pinExpiry = new Date(Date.now() + PIN_TTL_HOURS * 3600 * 1000);
      const assignmentOrders: DeliveryAssignmentOrder[] = [];

      for (let index = 0; index < uniqueOrderIds.length; index += 1) {
        const order = orders.find((entry) => entry.id === uniqueOrderIds[index])!;
        const rawPin = generatePin();
        const pinHash = await bcrypt.hash(rawPin, 10);

        plainPins.push({ orderId: order.id, pin: rawPin });
        assignmentOrders.push(
          assignmentOrderRepo.create({
            assignmentId: savedAssignment.id,
            orderId: order.id,
            sortOrder: index,
            shopPinHash: pinHash,
            shopPinExpiresAt: pinExpiry,
          }),
        );

        await orderRepo.update(order.id, {
          status: 'ASSIGNED',
          assignmentId: savedAssignment.id,
          customerNote: this.buildDeliveryStartedNote(
            order.orderCode,
            distributor,
            vehicle,
            deliveryDate,
          ),
          delayReason: null,
          delayedAt: null,
          delayedBy: null,
        });
      }

      await assignmentOrderRepo.save(assignmentOrders);
      return {
        assignmentId: savedAssignment.id,
        refillAlerts,
      };
    });

    const savedAssignmentId = assignmentResult.assignmentId;

    await Promise.all(
      orders.map((order) =>
        this.activityService.logForUser({
          userId: order.userId,
          type: 'ORDER_DELIVERY_STARTED',
          title: 'Delivery started',
          message: this.buildDeliveryStartedNote(
            order.orderCode,
            distributor,
            vehicle,
            deliveryDate,
          ),
          metadata: {
            orderId: order.id,
            orderCode: order.orderCode,
            assignmentId: savedAssignmentId,
            distributorId: distributor.id,
            distributorName: `${distributor.firstName} ${distributor.lastName}`.trim(),
            vehicleId: vehicle?.id ?? null,
            vehicleLabel: vehicle?.label ?? null,
            deliveryDate,
          },
        }),
      ),
    );

    await Promise.all(
      assignmentResult.refillAlerts.map((alert) =>
        this.activityService.logForUser({
          userId: tmUserId,
          type: 'REFILL_ALERT',
          title: 'Product fell below refill level',
          message: `${alert.productName} dropped from ${alert.beforeQuantity} to ${alert.afterQuantity} case(s) after delivery dispatch and is now below the refill level of ${alert.refillLevel}.`,
          metadata: {
            productId: alert.productId,
            productName: alert.productName,
            beforeQuantity: alert.beforeQuantity,
            afterQuantity: alert.afterQuantity,
            refillLevel: alert.refillLevel,
            assignmentId: savedAssignmentId,
          },
        }),
      ),
    );

    const result = await this.assignmentsRepo.findOne({
      where: { id: savedAssignmentId },
      relations: { assignmentOrders: { order: true }, distributor: true, vehicle: true },
    });

    return {
      message: 'Delivery assignment created and warehouse stock reserved.',
      assignment: this.serializeAssignment(result!),
      shopPins: plainPins,
    };
  }

  async generateReturnPin(tmUserId: string, assignmentId: string) {
    const assignment = await this.requireAssignment(assignmentId);

    if (assignment.territoryManagerId !== tmUserId) {
      throw new BadRequestException('You are not the manager of this assignment.');
    }
    if (assignment.status !== 'ACTIVE') {
      throw new BadRequestException('Assignment is not active.');
    }

    const rawPin = generatePin();
    const pinHash = await bcrypt.hash(rawPin, 10);
    const pinExpiry = new Date(Date.now() + 2 * 3600 * 1000);

    await this.assignmentsRepo.update(assignmentId, {
      tmReturnPinHash: pinHash,
      tmReturnPinExpiresAt: pinExpiry,
    });

    await this.activityService.logForUser({
      userId: tmUserId,
      type: 'WAREHOUSE_RETURN_PIN_GENERATED',
      title: 'Warehouse return PIN generated',
      message: `Return PIN for this assignment is: ${rawPin}. Share this with your distributor to close the trip. Expires in 2 hours.`,
      metadata: { assignmentId, pin: rawPin, expiresAt: pinExpiry.toISOString() },
    });

    return {
      message: 'Return PIN generated. Share this PIN with your distributor.',
      pin: rawPin,
      expiresAt: pinExpiry.toISOString(),
    };
  }

  async requestDeliveryPin(distributorId: string, orderId: string) {
    const dao = await this.daoRepo.findOne({
      where: { orderId },
      relations: { assignment: true, order: { user: true } },
    });
    if (!dao || dao.assignment.distributorId !== distributorId) {
      throw new NotFoundException('Order not found in your active assignments.');
    }
    if (dao.assignment.status !== 'ACTIVE') throw new BadRequestException('Assignment is not active.');
    if (dao.order?.status === 'COMPLETED') throw new BadRequestException('Order is already completed.');

    const rawPin = generatePin();
    const pinHash = await bcrypt.hash(rawPin, 10);
    const pinExpiry = new Date(Date.now() + PIN_TTL_HOURS * 3600 * 1000);

    await this.daoRepo.update(dao.id, { shopPinHash: pinHash, shopPinExpiresAt: pinExpiry });

    if (dao.order?.userId) {
      await this.activityService.logForUser({
        userId: dao.order.userId,
        type: 'DELIVERY_CONFIRMATION_PIN',
        title: 'Delivery confirmation PIN',
        message: `Your delivery confirmation PIN for order ${dao.order.orderCode} is: ${rawPin}. Share this with the distributor when they hand over your order.`,
        metadata: { orderId, orderCode: dao.order.orderCode, pin: rawPin },
      });
    }
    return { message: 'Delivery PIN sent to shop owner.' };
  }

  async requestShopReturnPin(distributorId: string, orderId: string) {
    const dao = await this.daoRepo.findOne({
      where: { orderId },
      relations: { assignment: true, order: { user: true } },
    });
    if (!dao || dao.assignment.distributorId !== distributorId) {
      throw new NotFoundException('Order not found in your active assignments.');
    }
    if (dao.assignment.status !== 'ACTIVE') throw new BadRequestException('Assignment is not active.');

    const rawPin = generatePin();
    const pinHash = await bcrypt.hash(rawPin, 10);
    const pinExpiry = new Date(Date.now() + 2 * 3600 * 1000);

    await this.daoRepo.update(dao.id, { shopReturnPinHash: pinHash, shopReturnPinExpiresAt: pinExpiry });

    if (dao.order?.userId) {
      await this.activityService.logForUser({
        userId: dao.order.userId,
        type: 'SHOP_RETURN_CONFIRMATION_PIN',
        title: 'Product return confirmation PIN',
        message: `Your product return confirmation PIN for order ${dao.order.orderCode} is: ${rawPin}. Share this with the distributor to confirm product pickup. Expires in 2 hours.`,
        metadata: { orderId, orderCode: dao.order.orderCode, pin: rawPin },
      });
    }
    return { message: 'Return confirmation PIN sent to shop owner.' };
  }

  async submitShopReturn(distributorId: string, orderId: string, dto: SubmitShopReturnDto) {
    const dao = await this.daoRepo.findOne({
      where: { orderId },
      relations: { assignment: true, order: { user: true } },
    });
    if (!dao || dao.assignment.distributorId !== distributorId) {
      throw new NotFoundException('Order not found in your active assignments.');
    }
    if (!dao.shopReturnPinHash || !dao.shopReturnPinExpiresAt) {
      throw new BadRequestException('No return PIN requested yet. Tap "Request PIN" first.');
    }
    if (new Date() > dao.shopReturnPinExpiresAt) {
      throw new BadRequestException('Return PIN has expired. Request a new one.');
    }
    const pinMatch = await bcrypt.compare(dto.pin, dao.shopReturnPinHash);
    if (!pinMatch) throw new BadRequestException('Incorrect PIN.');

    const distributor = await this.usersRepo.findOne({ where: { id: distributorId } });
    const totalValue = dto.items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.quantity, 0);

    await this.returnsRepo.manager.transaction(async (manager) => {
      const oRRepo = manager.getRepository(OrderReturn);
      const riRepo = manager.getRepository(ReturnItem);
      const daoRepo = manager.getRepository(DeliveryAssignmentOrder);

      const ret = new OrderReturn();
      ret.assignmentId = dao.assignmentId;
      ret.distributorId = distributorId;
      (ret as any).returnType = 'SHOP';
      (ret as any).orderId = orderId;
      ret.tmVerified = false;
      ret.verificationNote = `Shop return, shop owner PIN verified. Order: ${dao.order?.orderCode ?? orderId}.`;
      const saved = await oRRepo.save(ret);

      await riRepo.save(
        dto.items.map((item) =>
          riRepo.create({
            returnId: saved.id,
            productId: item.productId ?? null,
            productNameSnapshot: item.productNameSnapshot,
            quantity: item.quantity,
            reason: `${item.reason}${item.reasonNote ? ': ' + item.reasonNote : ''}`,
          }),
        ),
      );
      await daoRepo.update(dao.id, { shopReturnPinHash: null, shopReturnPinExpiresAt: null });
    });

    const distName = distributor ? `${distributor.firstName} ${distributor.lastName}`.trim() : 'Distributor';
    await this.activityService.logForUser({
      userId: dao.assignment.territoryManagerId,
      type: 'SHOP_RETURN_RECEIVED',
      title: 'Shop return recorded',
      message: `${distName} collected returned products from ${dao.order?.shopNameSnapshot ?? 'shop'} (order ${dao.order?.orderCode ?? orderId}). ${dto.items.length} product type(s)${totalValue > 0 ? `, est. value: LKR ${totalValue.toFixed(2)}` : ''}.`,
      metadata: { orderId, orderCode: dao.order?.orderCode, distributorId, itemCount: dto.items.length, totalValue },
    });

    if (dao.order?.userId) {
      await this.activityService.logForUser({
        userId: dao.order.userId,
        type: 'PRODUCT_RETURN_CONFIRMED',
        title: 'Product return confirmed',
        message: `Your returned products for order ${dao.order.orderCode} have been collected by the distributor and will be processed.`,
        metadata: { orderId, orderCode: dao.order.orderCode },
      });
    }
    return { message: 'Shop return recorded successfully.' };
  }

  async requestWarehouseReturnPin(distributorId: string, assignmentId: string) {
    const assignment = await this.requireAssignment(assignmentId);
    if (assignment.distributorId !== distributorId) {
      throw new BadRequestException('This assignment does not belong to you.');
    }
    if (assignment.status !== 'ACTIVE') throw new BadRequestException('Assignment is not active.');

    const rawPin = generatePin();
    const pinHash = await bcrypt.hash(rawPin, 10);
    const pinExpiry = new Date(Date.now() + 2 * 3600 * 1000);

    await this.assignmentsRepo.update(assignmentId, { tmReturnPinHash: pinHash, tmReturnPinExpiresAt: pinExpiry });

    await this.activityService.logForUser({
      userId: assignment.territoryManagerId,
      type: 'WAREHOUSE_RETURN_PIN_REQUESTED',
      title: 'Distributor ready to return to warehouse',
      message: `Your distributor is ready to return products to the warehouse. Return confirmation PIN: ${rawPin}. Share this with your distributor to close the trip. Expires in 2 hours.`,
      metadata: { assignmentId, pin: rawPin, expiresAt: pinExpiry.toISOString() },
    });

    return { message: 'PIN sent to Territory Manager. Ask them for the PIN to proceed.' };
  }

  async addDistributorNote(distributorId: string, dto: AddNoteDto) {
    const distributor = await this.usersRepo.findOne({ where: { id: distributorId } });
    let tmUserId: string | null = null;

    if (dto.assignmentId) {
      const assignment = await this.assignmentsRepo.findOne({ where: { id: dto.assignmentId, distributorId } });
      if (assignment) tmUserId = assignment.territoryManagerId;
    }
    if (!tmUserId && distributor?.warehouseId) {
      const tm = await this.usersRepo.findOne({ where: { warehouseId: distributor.warehouseId, role: Role.REGIONAL_MANAGER } });
      tmUserId = tm?.id ?? null;
    }
    if (!tmUserId) throw new BadRequestException('Could not find your territory manager.');

    const name = distributor ? `${distributor.firstName} ${distributor.lastName}`.trim() : 'Distributor';
    await this.activityService.logForUser({
      userId: tmUserId,
      type: 'DISTRIBUTOR_NOTE',
      title: `Note from ${name}`,
      message: `[${dto.category.toUpperCase()}] ${dto.message}`,
      metadata: { distributorId, distributorName: name, assignmentId: dto.assignmentId ?? null, category: dto.category },
    });

    return { message: 'Note sent to Territory Manager.' };
  }

  async listAssignments(tmUserId: string, dateFilter?: string) {
    const query = this.assignmentsRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.distributor', 'distributor')
      .leftJoinAndSelect('a.vehicle', 'vehicle')
      .leftJoinAndSelect('a.assignmentOrders', 'dao')
      .leftJoinAndSelect('dao.order', 'order')
      .where('a.territory_manager_id = :tmUserId', { tmUserId })
      .orderBy('a.delivery_date', 'DESC')
      .addOrderBy('a.created_at', 'DESC');

    if (dateFilter) {
      query.andWhere('a.delivery_date = :date', { date: dateFilter });
    }

    const assignments = await query.getMany();
    return { message: 'Assignments fetched.', assignments: assignments.map(this.serializeAssignment) };
  }

  async listReturns(tmUserId: string) {
    const tm = await this.usersRepo.findOne({ where: { id: tmUserId } });
    if (!tm?.warehouseId) throw new BadRequestException('Not assigned to a warehouse.');

    const returns = await this.returnsRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.distributor', 'distributor')
      .innerJoinAndSelect('r.items', 'items')
      .leftJoin('r.assignment', 'assignment')
      .where('distributor.warehouse_id = :warehouseId', { warehouseId: tm.warehouseId })
      .orderBy('r.created_at', 'DESC')
      .getMany();

    return { message: 'Returns fetched.', returns: returns.map(this.serializeReturn) };
  }

  async listIncidents(tmUserId: string) {
    const tm = await this.usersRepo.findOne({ where: { id: tmUserId } });
    if (!tm?.warehouseId) throw new BadRequestException('Not assigned to a warehouse.');

    const incidents = await this.incidentsRepo
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.reporter', 'reporter')
      .where('reporter.warehouse_id = :warehouseId', { warehouseId: tm.warehouseId })
      .orderBy('i.created_at', 'DESC')
      .getMany();

    return { message: 'Incidents fetched.', incidents: incidents.map(this.serializeIncident) };
  }

  async getMyAssignment(distributorId: string) {
    const today = new Date().toISOString().split('T')[0];

    const assignment = await this.assignmentsRepo.findOne({
      where: { distributorId, deliveryDate: today, status: 'ACTIVE' },
      relations: ['assignmentOrders', 'assignmentOrders.order', 'assignmentOrders.order.user', 'assignmentOrders.order.items', 'vehicle'],
    });

    if (!assignment) {
      return { message: 'No active assignment for today.', assignment: null };
    }

    return { message: 'Assignment fetched.', assignment: this.serializeAssignment(assignment) };
  }

  async completeOrder(distributorId: string, orderId: string, pin: string) {
    const dao = await this.daoRepo.findOne({
      where: { orderId },
      relations: { assignment: true, order: true },
    });

    if (!dao || dao.assignment.distributorId !== distributorId) {
      throw new NotFoundException('Order not found in your active assignments.');
    }
    if (dao.assignment.status !== 'ACTIVE') {
      throw new BadRequestException('Assignment is not active.');
    }
    if (!dao.shopPinHash || !dao.shopPinExpiresAt) {
      throw new BadRequestException('No PIN has been set for this order.');
    }
    if (new Date() > dao.shopPinExpiresAt) {
      throw new BadRequestException('The shop PIN has expired. Contact your territory manager.');
    }

    const pinMatch = await bcrypt.compare(pin, dao.shopPinHash);
    if (!pinMatch) {
      throw new BadRequestException('Incorrect PIN.');
    }

    const customerNote = `Order ${dao.order?.orderCode ?? ''} was delivered successfully.`;

    await this.ordersRepo.update(orderId, {
      status: 'COMPLETED',
      customerNote,
    });

    await this.daoRepo.update(dao.id, { shopPinHash: null, shopPinExpiresAt: null });

    if (dao.order) {
      await Promise.all([
        this.activityService.logForUser({
          userId: dao.order.userId,
          type: 'ORDER_COMPLETED',
          title: 'Order completed',
          message: customerNote,
          metadata: {
            orderId: dao.order.id,
            orderCode: dao.order.orderCode,
            assignmentId: dao.assignmentId,
          },
        }),
        this.activityService.logForUser({
          userId: dao.assignment.territoryManagerId,
          type: 'ORDER_COMPLETED',
          title: 'Order completed',
          message: `Order ${dao.order.orderCode} for ${dao.order.shopNameSnapshot} was completed successfully by the distributor.`,
          metadata: {
            orderId: dao.order.id,
            orderCode: dao.order.orderCode,
            assignmentId: dao.assignmentId,
            shopName: dao.order.shopNameSnapshot,
          },
        }),
      ]);
    }

    return { message: 'Order marked as completed.' };
  }

  async submitReturn(distributorId: string, assignmentId: string, dto: SubmitReturnDto) {
    const assignment = await this.requireAssignment(assignmentId);

    if (assignment.distributorId !== distributorId) {
      throw new BadRequestException('This assignment does not belong to you.');
    }
    if (assignment.status !== 'ACTIVE') {
      throw new BadRequestException('Assignment is not active.');
    }
    if (!assignment.tmReturnPinHash || !assignment.tmReturnPinExpiresAt) {
      throw new BadRequestException(
        'No return PIN has been generated yet. Ask your territory manager.',
      );
    }
    if (new Date() > assignment.tmReturnPinExpiresAt) {
      throw new BadRequestException('Return PIN has expired. Ask your territory manager to regenerate it.');
    }

    const pinMatch = await bcrypt.compare(dto.tmPin, assignment.tmReturnPinHash);
    if (!pinMatch) {
      throw new BadRequestException('Incorrect territory manager PIN.');
    }

    const distributor = await this.usersRepo.findOne({ where: { id: distributorId } });
    if (!distributor?.warehouseId) {
      throw new BadRequestException('Distributor is not assigned to a warehouse.');
    }

    await this.returnsRepo.manager.transaction(async (manager) => {
      const orderReturnRepo = manager.getRepository(OrderReturn);
      const returnItemRepo = manager.getRepository(ReturnItem);
      const assignmentRepo = manager.getRepository(DeliveryAssignment);
      const inventoryRepo = manager.getRepository(WarehouseInventoryItem);

      const orderReturn = orderReturnRepo.create({
        assignmentId,
        distributorId,
        tmVerified: true,
        verificationNote: 'Verified via PIN at end of trip.',
      });
      const savedReturn = await orderReturnRepo.save(orderReturn);

      const items = dto.items.map((item: ReturnItemDto) =>
        returnItemRepo.create({
          returnId: savedReturn.id,
          productId: item.productId ?? null,
          productNameSnapshot: item.productNameSnapshot,
          quantity: item.quantity,
          reason: item.reason,
        }),
      );
      await returnItemRepo.save(items);

      await this.restockReturnedProducts(
        inventoryRepo,
        distributor.warehouseId!,
        dto.items,
      );

      await assignmentRepo.update(assignmentId, {
        status: 'COMPLETED',
        tmReturnPinHash: null,
        tmReturnPinExpiresAt: null,
      });
    });

    return { message: 'Return submitted, stock restored, and trip closed.' };
  }

  async reportIncident(distributorId: string, dto: ReportIncidentDto) {
    const incident = this.incidentsRepo.create({
      assignmentId: dto.assignmentId ?? null,
      reportedBy: distributorId,
      incidentType: dto.incidentType,
      description: dto.description,
    });

    const saved = await this.incidentsRepo.save(incident);

    return { message: 'Incident reported.', incidentId: saved.id };
  }

  private async requireAssignment(id: string): Promise<DeliveryAssignment> {
    const assignment = await this.assignmentsRepo.findOne({ where: { id } });
    if (!assignment) throw new NotFoundException('Assignment not found.');
    return assignment;
  }

  private async buildStockReservationCheck(warehouseId: string, orders: Order[]) {
    const reservationsByProduct = new Map<string, StockReservation>();
    const shortages: string[] = [];
    let totalCases = 0;

    for (const order of orders) {
      for (const item of order.items ?? []) {
        totalCases += item.quantity;

        if (!item.productId) {
          shortages.push(
            `Order ${order.orderCode} contains ${item.productNameSnapshot}, which is no longer linked to an inventory product.`,
          );
          continue;
        }

        const current = reservationsByProduct.get(item.productId);
        if (current) {
          current.quantity += item.quantity;
        } else {
          reservationsByProduct.set(item.productId, {
            productId: item.productId,
            productName: item.productNameSnapshot,
            quantity: item.quantity,
          });
        }
      }
    }

    const reservations = Array.from(reservationsByProduct.values());
    if (shortages.length > 0 || reservations.length === 0) {
      return { reservations, shortages, totalCases };
    }

    const inventoryItems = await this.inventoryRepo.find({
      where: {
        warehouseId,
        productId: In(reservations.map((reservation) => reservation.productId)),
      },
    });
    const inventoryByProductId = new Map(
      inventoryItems.map((item) => [item.productId, item]),
    );

    for (const reservation of reservations) {
      const inventoryItem = inventoryByProductId.get(reservation.productId);
      const availableCases = inventoryItem?.quantityOnHand ?? 0;

      if (availableCases < reservation.quantity) {
        shortages.push(
          `${reservation.productName} needs ${reservation.quantity} case(s), but only ${availableCases} case(s) are available in warehouse inventory.`,
        );
      }
    }

    return { reservations, shortages, totalCases };
  }

  private async reserveWarehouseStock(
    inventoryRepo: Repository<WarehouseInventoryItem>,
    warehouseId: string,
    reservations: StockReservation[],
  ) {
    if (reservations.length === 0) {
      return [] as RefillAlert[];
    }

    const inventoryItems = await inventoryRepo.find({
      where: {
        warehouseId,
        productId: In(reservations.map((reservation) => reservation.productId)),
      },
    });
    const inventoryByProductId = new Map(
      inventoryItems.map((item) => [item.productId, item]),
    );

    const refillAlerts: RefillAlert[] = [];

    for (const reservation of reservations) {
      const inventoryItem = inventoryByProductId.get(reservation.productId);
      if (!inventoryItem || inventoryItem.quantityOnHand < reservation.quantity) {
        throw new BadRequestException(
          `${reservation.productName} no longer has enough stock to start delivery. Please refresh and process the order again.`,
        );
      }

      const beforeQuantity = inventoryItem.quantityOnHand;
      inventoryItem.quantityOnHand -= reservation.quantity;

      if (
        beforeQuantity > inventoryItem.reorderLevel &&
        inventoryItem.quantityOnHand <= inventoryItem.reorderLevel
      ) {
        refillAlerts.push({
          productId: reservation.productId,
          productName: reservation.productName,
          beforeQuantity,
          afterQuantity: inventoryItem.quantityOnHand,
          refillLevel: inventoryItem.reorderLevel,
        });
      }
    }

    await inventoryRepo.save(Array.from(inventoryByProductId.values()));
    return refillAlerts;
  }

  private async restockReturnedProducts(
    inventoryRepo: Repository<WarehouseInventoryItem>,
    warehouseId: string,
    returnItems: ReturnItemDto[],
  ) {
    const aggregatedReturns = new Map<
      string,
      { productName: string; quantity: number }
    >();

    for (const item of returnItems) {
      if (!item.productId) {
        continue;
      }

      const current = aggregatedReturns.get(item.productId);
      if (current) {
        current.quantity += item.quantity;
      } else {
        aggregatedReturns.set(item.productId, {
          productName: item.productNameSnapshot,
          quantity: item.quantity,
        });
      }
    }

    const productIds = Array.from(aggregatedReturns.keys());
    if (productIds.length === 0) {
      return;
    }

    const existingInventoryItems = await inventoryRepo.find({
      where: { warehouseId, productId: In(productIds) },
    });
    const inventoryByProductId = new Map(
      existingInventoryItems.map((item) => [item.productId, item]),
    );
    const updates: WarehouseInventoryItem[] = [];

    for (const productId of productIds) {
      const returned = aggregatedReturns.get(productId)!;
      const existing = inventoryByProductId.get(productId);

      if (existing) {
        existing.quantityOnHand += returned.quantity;
        if (existing.maxCapacityCases < existing.quantityOnHand) {
          existing.maxCapacityCases = existing.quantityOnHand;
        }
        updates.push(existing);
        continue;
      }

      updates.push(
        inventoryRepo.create({
          warehouseId,
          productId,
          quantityOnHand: returned.quantity,
          reorderLevel: 0,
          maxCapacityCases: returned.quantity,
        }),
      );
    }

    await inventoryRepo.save(updates);
  }

  private buildDeliveryStartedNote(
    orderCode: string,
    distributor: User,
    vehicle: Vehicle | null,
    deliveryDate: string,
  ) {
    const distributorName = `${distributor.firstName} ${distributor.lastName}`.trim();
    const vehiclePart = vehicle ? ` using ${vehicle.label}` : '';
    return `Your order ${orderCode} has started delivery with ${distributorName}${vehiclePart}. Delivery is scheduled for ${this.formatDeliveryDate(deliveryDate)}.`;
  }

  private formatDeliveryDate(deliveryDate: string) {
    const normalized = new Date(`${deliveryDate}T00:00:00`);
    return normalized.toLocaleDateString('en-LK', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  private serializeAssignment(a: DeliveryAssignment) {
    return {
      id: a.id,
      distributorId: a.distributorId,
      distributorName: a.distributor
        ? `${a.distributor.firstName} ${a.distributor.lastName}`
        : null,
      vehicleId: a.vehicleId,
      vehicleLabel: a.vehicle?.label ?? null,
      vehicleCapacityCases: a.vehicle?.capacityCases ?? null,
      vehicleRegistrationNumber: a.vehicle?.registrationNumber ?? null,
      vehicleType: a.vehicle?.type ?? null,
      deliveryDate: a.deliveryDate,
      status: a.status,
      notes: a.notes,
      orders: (a.assignmentOrders ?? [])
        .sort((x, y) => x.sortOrder - y.sortOrder)
        .map((dao) => ({
          daoId: dao.id,
          orderId: dao.orderId,
          sortOrder: dao.sortOrder,
          orderCode: dao.order?.orderCode ?? null,
          shopName: dao.order?.shopNameSnapshot ?? null,
          shopPhone: dao.order?.user?.phoneNumber ?? null,
          shopAddress: dao.order?.user?.address ?? null,
          totalAmount: dao.order?.totalAmount ?? null,
          currencyCode: dao.order?.currencyCode ?? 'LKR',
          status: dao.order?.status ?? null,
          items: (dao.order?.items ?? []).map((item) => ({
            id: item.id,
            productId: item.productId,
            productName: item.productNameSnapshot,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
            unitPrice: item.quantity > 0 ? item.lineTotal / item.quantity : 0,
          })),
        })),
      createdAt: a.createdAt,
    };
  }

  private serializeReturn(r: OrderReturn) {
    return {
      id: r.id,
      assignmentId: r.assignmentId,
      distributorId: r.distributorId,
      distributorName: r.distributor
        ? `${r.distributor.firstName} ${r.distributor.lastName}`
        : null,
      tmVerified: r.tmVerified,
      verificationNote: r.verificationNote,
      items: (r.items ?? []).map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productNameSnapshot,
        quantity: item.quantity,
        reason: item.reason,
      })),
      createdAt: r.createdAt,
    };
  }

  private serializeIncident(i: IncidentReport) {
    return {
      id: i.id,
      assignmentId: i.assignmentId,
      reportedBy: i.reportedBy,
      reporterName: i.reporter
        ? `${i.reporter.firstName} ${i.reporter.lastName}`
        : null,
      incidentType: i.incidentType,
      description: i.description,
      createdAt: i.createdAt,
    };
  }
}
