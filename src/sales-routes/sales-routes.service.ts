import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { Role } from '../common/enums/role.enum';
import { Order } from '../orders/entities/order.entity';
import { Outlet, OutletStatus } from '../outlets/entities/outlet.entity';
import { StoreVisit } from '../store-visits/entities/store-visit.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { ApproveLoadRequestDto, LoadRequestDecision } from './dto/approve-load-request.dto';
import { CloseRouteDto } from './dto/close-route.dto';
import { ConfirmRouteApprovalPinDto } from './dto/confirm-route-approval-pin.dto';
import { CreateRouteDto } from './dto/create-route.dto';
import { EnterPinDto } from './dto/enter-pin.dto';
import { LogReturnItemDto } from './dto/log-return-item.dto';
import { RequestDeliveryApprovalDto } from './dto/request-delivery-approval.dto';
import { ReviewRouteApprovalRequestDto } from './dto/review-route-approval-request.dto';
import { SubmitLoadRequestDto } from './dto/submit-load-request.dto';
import { UpdateRouteBeatPlanDto } from './dto/update-route-beat-plan.dto';
import {
  RouteApprovalRequest,
  RouteApprovalRequestStatus,
  RouteApprovalRequestType,
} from './entities/route-approval-request.entity';
import {
  RouteBeatPlanItem,
  RouteBeatPlanSource,
} from './entities/route-beat-plan-item.entity';
import { RouteBeatPlanTemplate } from './entities/route-beat-plan-template.entity';
import {
  SalesRoute,
  SalesRouteStatus,
  SalesRouteStockLine,
} from './entities/sales-route.entity';
import {
  VanLoadRequest,
  VanLoadRequestStatus,
  VanLoadRequestStockLine,
} from './entities/van-load-request.entity';

const ROUTE_PIN_TTL_MINUTES = 30;
const APPROVAL_PIN_TTL_MINUTES = 30;
const BCRYPT_ROUNDS = 10;
const DEFAULT_ITEMS_PER_CASE = 12;
const BEAT_PLAN_TEMPLATE_REAPPLY_DAYS = 28;
const DUE_OUTLET_WINDOW_DAYS = 28;
const OPEN_ROUTE_STATUSES = [
  SalesRouteStatus.DRAFT,
  SalesRouteStatus.AWAITING_LOAD_APPROVAL,
  SalesRouteStatus.APPROVED_TO_START,
  SalesRouteStatus.IN_PROGRESS,
] as const;

type DeliveryAlert = {
  outletId: string;
  outletName: string;
  ownerName: string | null;
  orderIds: string[];
  orderCount: number;
  products: VanLoadRequestStockLine[];
};

type VarianceLine = {
  productId: string;
  productName: string;
  openingUnits: number;
  expectedClosingUnits: number;
  actualClosingUnits: number;
  varianceUnits: number;
  varianceReason: string | null;
};

type BeatPlanSeed = {
  outletId: string;
  outletName: string;
  ownerName: string | null;
  source: RouteBeatPlanSource;
  hasPendingDelivery: boolean;
  pendingDeliveryOrderIds: string[];
};

@Injectable()
export class SalesRoutesService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    @InjectRepository(Outlet)
    private readonly outletsRepo: Repository<Outlet>,
    @InjectRepository(RouteApprovalRequest)
    private readonly approvalRequestsRepo: Repository<RouteApprovalRequest>,
    @InjectRepository(RouteBeatPlanItem)
    private readonly beatPlanItemsRepo: Repository<RouteBeatPlanItem>,
    @InjectRepository(RouteBeatPlanTemplate)
    private readonly beatPlanTemplatesRepo: Repository<RouteBeatPlanTemplate>,
    @InjectRepository(SalesRoute)
    private readonly salesRoutesRepo: Repository<SalesRoute>,
    @InjectRepository(StoreVisit)
    private readonly storeVisitsRepo: Repository<StoreVisit>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(VanLoadRequest)
    private readonly vanLoadRequestsRepo: Repository<VanLoadRequest>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepo: Repository<Vehicle>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepo: Repository<Warehouse>,
    @InjectRepository(WarehouseInventoryItem)
    private readonly inventoryRepo: Repository<WarehouseInventoryItem>,
    private readonly activityService: ActivityService,
  ) {}

  async getSetupOptions(salesRepId: string) {
    const salesRep = await this.requireSalesRep(salesRepId);

    if (!salesRep.territoryId) {
      return {
        message: 'Sales rep is not assigned to a territory yet.',
        territoryId: null,
        warehouses: [],
      };
    }

    const [warehouses, conflictingRoutes] = await Promise.all([
      this.warehousesRepo.find({
        where: { territoryId: salesRep.territoryId },
        order: { name: 'ASC' },
      }),
      this.salesRoutesRepo.find({
        where: {
          status: In([...OPEN_ROUTE_STATUSES]),
        },
      }),
    ]);

    const lockedVehicleIds = new Set(
      conflictingRoutes
        .filter((route) => route.vehicleId && route.salesRepId !== salesRepId)
        .map((route) => route.vehicleId as string),
    );

    const vehicleCandidates = await this.vehiclesRepo.find({
      where: {
        territoryId: salesRep.territoryId,
      },
      order: {
        label: 'ASC',
      },
    });

    return {
      message: 'Route setup options fetched successfully.',
      territoryId: salesRep.territoryId,
      warehouses: warehouses.map((warehouse) => ({
        id: warehouse.id,
        name: warehouse.name,
        address: warehouse.address,
        vehicles: vehicleCandidates
          .filter((vehicle) => vehicle.warehouseId === warehouse.id)
          .map((vehicle) => ({
            id: vehicle.id,
            label: vehicle.label,
            registrationNumber: vehicle.registrationNumber,
            status: vehicle.status,
            isAvailable:
              vehicle.status === 'ACTIVE' && !lockedVehicleIds.has(vehicle.id),
            unavailableReason:
              vehicle.status !== 'ACTIVE'
                ? 'Vehicle is inactive.'
                : lockedVehicleIds.has(vehicle.id)
                  ? 'Vehicle is unavailable because another active route already locked it.'
                  : null,
          })),
      })),
    };
  }

  async createRoute(salesRepId: string, dto: CreateRouteDto) {
    const salesRep = await this.requireSalesRep(salesRepId);
    const warehouseId = dto.warehouseId.trim();

    if (!salesRep.territoryId) {
      throw new BadRequestException(
        'You must be assigned to a territory before starting a route.',
      );
    }

    const createdRouteId = await this.salesRoutesRepo.manager.transaction(
      async (manager) => {
        const existingOpenRoute = await manager.getRepository(SalesRoute).findOne({
          where: {
            salesRepId,
            status: In([...OPEN_ROUTE_STATUSES]),
          },
          order: { createdAt: 'DESC' },
        });

        if (existingOpenRoute) {
          throw new BadRequestException(
            'You already have another route in progress or waiting to be completed.',
          );
        }

        const warehouse = await manager.getRepository(Warehouse).findOne({
          where: { id: warehouseId },
        });

        if (!warehouse) {
          throw new NotFoundException('Warehouse not found.');
        }
        if (warehouse.territoryId !== salesRep.territoryId) {
          throw new BadRequestException(
            'Selected warehouse does not belong to your territory.',
          );
        }

        let vehicle: Vehicle | null = null;
        if (dto.vehicleId) {
          vehicle = await manager
            .getRepository(Vehicle)
            .createQueryBuilder('vehicle')
            .setLock('pessimistic_write')
            .where('vehicle.id = :vehicleId', { vehicleId: dto.vehicleId })
            .getOne();

          if (!vehicle) {
            throw new NotFoundException('Vehicle not found.');
          }
          if (vehicle.territoryId !== salesRep.territoryId) {
            throw new BadRequestException(
              'Selected vehicle does not belong to your territory.',
            );
          }
          if (vehicle.warehouseId !== warehouseId) {
            throw new BadRequestException(
              'Selected vehicle does not belong to the chosen warehouse.',
            );
          }
          if (vehicle.status !== 'ACTIVE') {
            throw new BadRequestException(
              'Selected vehicle is not active.',
            );
          }

          const vehicleConflict = await manager.getRepository(SalesRoute).findOne({
            where: {
              vehicleId: vehicle.id,
              status: In([...OPEN_ROUTE_STATUSES]),
            },
          });

          if (vehicleConflict) {
            throw new BadRequestException(
              'Selected vehicle is unavailable because another active route already locked it.',
            );
          }
        }

        const route = manager.getRepository(SalesRoute).create({
          salesRepId,
          warehouseId,
          vehicleId: vehicle?.id ?? null,
          territoryId: salesRep.territoryId,
          status: SalesRouteStatus.DRAFT,
          deliveryOrderIdsJson: [],
          openingStockJson: null,
          closingStockJson: null,
          varianceJson: null,
          startedAt: null,
          closedAt: null,
          warehouseManagerPinHash: null,
          pinExpiresAt: null,
        });

        const savedRoute = await manager.getRepository(SalesRoute).save(route);
        return savedRoute.id;
      },
    );

    await this.seedBeatPlanForRoute(createdRouteId, salesRep);

    const route = await this.getOwnedRouteWithRelations(createdRouteId, salesRepId);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'SALES_ROUTE_CREATED',
      title: 'Sales route created',
      message: 'A new start-route draft was created successfully.',
      metadata: {
        routeId: route.id,
        warehouseId: route.warehouseId,
        vehicleId: route.vehicleId,
      },
    });

    return {
      message: 'Sales route created successfully.',
      route: await this.serializeRoute(route),
    };
  }

  async updateBeatPlan(
    routeId: string,
    salesRepId: string,
    dto: UpdateRouteBeatPlanDto,
  ) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);
    this.ensureEditableRoute(route);

    const eligibleOutlets = await this.getEligibleOutlets(
      route.territoryId,
      route.warehouseId,
    );
    const outletMap = new Map(eligibleOutlets.map((outlet) => [outlet.id, outlet]));
    const selectedOutletIds = [...new Set(dto.selectedOutletIds)];

    for (const outletId of selectedOutletIds) {
      if (!outletMap.has(outletId)) {
        throw new BadRequestException(
          'One or more selected outlets do not belong to the route territory and warehouse.',
        );
      }
    }

    const alerts = await this.computeDeliveryAlerts(route.territoryId, route.warehouseId);
    const alertByOutletId = new Map(alerts.map((alert) => [alert.outletId, alert]));
    const existingItems = await this.beatPlanItemsRepo.find({
      where: { routeId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const existingByOutletId = new Map(
      existingItems.map((item) => [item.outletId, item]),
    );

    const toSave: RouteBeatPlanItem[] = [];
    for (let index = 0; index < selectedOutletIds.length; index += 1) {
      const outletId = selectedOutletIds[index];
      const outlet = outletMap.get(outletId)!;
      const alert = alertByOutletId.get(outletId);
      const existing = existingByOutletId.get(outletId);

      const item = existing ?? this.beatPlanItemsRepo.create({
        routeId,
        outletId,
        outletNameSnapshot: outlet.outletName,
        ownerNameSnapshot: outlet.ownerName ?? null,
        source: alert ? RouteBeatPlanSource.DELIVERY : RouteBeatPlanSource.MANUAL,
      });

      item.outletNameSnapshot = outlet.outletName;
      item.ownerNameSnapshot = outlet.ownerName ?? null;
      item.isSelected = true;
      item.hasPendingDelivery = !!alert;
      item.pendingDeliveryCount = alert?.orderCount ?? 0;
      item.pendingDeliveryOrderIdsJson = alert?.orderIds ?? [];
      item.sortOrder = index + 1;

      toSave.push(item);
      existingByOutletId.delete(outletId);
    }

    for (const item of existingByOutletId.values()) {
      item.isSelected = false;
      item.sortOrder = selectedOutletIds.length + item.sortOrder + 1;
      toSave.push(item);
    }

    if (toSave.length > 0) {
      await this.beatPlanItemsRepo.save(toSave);
    }

    if (dto.saveTemplate !== false) {
      await this.upsertBeatPlanTemplate(route, selectedOutletIds);
    }

    return {
      message: 'Best plan updated successfully.',
      route: await this.serializeRoute(route),
    };
  }

  async requestDeliveryApproval(
    routeId: string,
    salesRepId: string,
    dto: RequestDeliveryApprovalDto,
  ) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);
    this.ensureEditableRoute(route);

    const alerts = await this.computeDeliveryAlerts(route.territoryId, route.warehouseId);
    const allowedOrderIds = new Set(alerts.flatMap((alert) => alert.orderIds));
    const requestedOrderIds = [...new Set(dto.orderIds)];

    if (requestedOrderIds.length === 0) {
      throw new BadRequestException(
        'Select at least one ready-for-delivery order before requesting approval.',
      );
    }

    for (const orderId of requestedOrderIds) {
      if (!allowedOrderIds.has(orderId)) {
        throw new BadRequestException(
          'One or more delivery orders are no longer available for this route.',
        );
      }
    }

    const targetedAlerts = alerts.filter((alert) =>
      alert.orderIds.some((orderId) => requestedOrderIds.includes(orderId)),
    );
    const outletNames = targetedAlerts.map((alert) => alert.outletName);
    const requestedMessage =
      requestedOrderIds.length === 1
        ? `Sales rep requested approval to deliver 1 ready-for-delivery order on this route for ${outletNames.join(', ')}.`
        : `Sales rep requested approval to deliver ${requestedOrderIds.length} ready-for-delivery orders on this route for ${outletNames.join(', ')}.`;

    const existingRequest = await this.approvalRequestsRepo.findOne({
      where: {
        routeId,
        type: RouteApprovalRequestType.DELIVERY_ORDERS,
      },
      order: { createdAt: 'DESC' },
    });

    const request = existingRequest
      ? this.approvalRequestsRepo.merge(existingRequest, {
          status: RouteApprovalRequestStatus.PENDING,
          requestedMessage,
          requestedPayloadJson: {
            orderIds: requestedOrderIds,
            outletNames,
          },
          approvedPayloadJson: null,
          decisionNote: null,
          reviewedBy: null,
          reviewedAt: null,
          pinHash: null,
          pinExpiresAt: null,
          pinVerifiedAt: null,
        })
      : this.approvalRequestsRepo.create({
          routeId,
          salesRepId,
          type: RouteApprovalRequestType.DELIVERY_ORDERS,
          status: RouteApprovalRequestStatus.PENDING,
          requestedMessage,
          requestedPayloadJson: {
            orderIds: requestedOrderIds,
            outletNames,
          },
          approvedPayloadJson: null,
        });

    await this.salesRoutesRepo.update(routeId, {
      deliveryOrderIdsJson: [],
    });
    await this.approvalRequestsRepo.save(request);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ROUTE_DELIVERY_APPROVAL_REQUESTED',
      title: 'Delivery approval requested',
      message:
        'Your request to include ready-for-delivery orders on this route was sent for TM approval.',
      metadata: {
        routeId,
        approvalRequestId: request.id,
        orderIds: requestedOrderIds,
      },
    });

    const managers = await this.findRelevantManagers(route);
    await Promise.all(
      managers.map((manager) =>
        this.activityService.logForUser({
          userId: manager.id,
          type: 'ROUTE_DELIVERY_APPROVAL_PENDING',
          title: 'Ready-for-delivery request pending',
          message: requestedMessage,
          metadata: {
            routeId,
            approvalRequestId: request.id,
            salesRepId,
            orderIds: requestedOrderIds,
          },
        }),
      ),
    );

    return {
      message: 'Delivery approval request submitted successfully.',
      approvalRequestId: request.id,
    };
  }

  async reviewDeliveryApprovalRequest(
    approvalRequestId: string,
    managerId: string,
    dto: ReviewRouteApprovalRequestDto,
  ) {
    const manager = await this.requireRouteManager(managerId);
    const approvalRequest = await this.approvalRequestsRepo.findOne({
      where: {
        id: approvalRequestId,
        type: RouteApprovalRequestType.DELIVERY_ORDERS,
      },
      relations: {
        route: true,
      },
    });

    if (!approvalRequest) {
      throw new NotFoundException('Delivery approval request not found.');
    }
    if (!approvalRequest.route) {
      throw new NotFoundException('Linked route not found.');
    }
    if (approvalRequest.status !== RouteApprovalRequestStatus.PENDING) {
      throw new BadRequestException(
        'This delivery approval request has already been reviewed.',
      );
    }
    this.ensureManagerOwnsRoute(manager, approvalRequest.route);

    let rawPin: string | null = null;
    let expiresAt: Date | null = null;
    const requestedOrderIds = this.toStringArray(
      approvalRequest.requestedPayloadJson['orderIds'],
    );

    approvalRequest.status = dto.decision;
    approvalRequest.decisionNote = dto.notes?.trim() ?? null;
    approvalRequest.reviewedBy = managerId;
    approvalRequest.reviewedAt = new Date();

    if (dto.decision === RouteApprovalRequestStatus.APPROVED) {
      rawPin = this.generatePin();
      expiresAt = new Date(Date.now() + APPROVAL_PIN_TTL_MINUTES * 60 * 1000);
      approvalRequest.approvedPayloadJson = {
        orderIds: requestedOrderIds,
      };
      approvalRequest.pinHash = await bcrypt.hash(rawPin, BCRYPT_ROUNDS);
      approvalRequest.pinExpiresAt = expiresAt;
      approvalRequest.pinVerifiedAt = null;
      await this.salesRoutesRepo.update(approvalRequest.routeId, {
        deliveryOrderIdsJson: requestedOrderIds,
      });
    } else {
      approvalRequest.approvedPayloadJson = null;
      approvalRequest.pinHash = null;
      approvalRequest.pinExpiresAt = null;
      approvalRequest.pinVerifiedAt = null;
      await this.salesRoutesRepo.update(approvalRequest.routeId, {
        deliveryOrderIdsJson: [],
      });
    }

    await this.approvalRequestsRepo.save(approvalRequest);

    await this.activityService.logForUser({
      userId: approvalRequest.salesRepId,
      type:
        dto.decision === RouteApprovalRequestStatus.APPROVED
          ? 'ROUTE_DELIVERY_APPROVAL_APPROVED'
          : 'ROUTE_DELIVERY_APPROVAL_REJECTED',
      title:
        dto.decision === RouteApprovalRequestStatus.APPROVED
          ? 'Delivery approval granted'
          : 'Delivery approval denied',
      message:
        dto.decision === RouteApprovalRequestStatus.APPROVED
          ? 'TM approved your ready-for-delivery request. Enter the PIN to continue.'
          : 'TM denied the ready-for-delivery request. Those deliveries cannot be included in this route.',
      metadata: {
        routeId: approvalRequest.routeId,
        approvalRequestId: approvalRequest.id,
        ...(rawPin
          ? {
              pin: rawPin,
              pinExpiresAt: expiresAt?.toISOString() ?? null,
            }
          : {}),
      },
    });

    await this.activityService.logForUser({
      userId: managerId,
      type: 'ROUTE_DELIVERY_APPROVAL_REVIEWED',
      title: 'Delivery request reviewed',
      message: `You ${dto.decision.toLowerCase()} a ready-for-delivery request for a sales route.`,
      metadata: {
        routeId: approvalRequest.routeId,
        approvalRequestId: approvalRequest.id,
      },
    });

    return {
      message:
        dto.decision === RouteApprovalRequestStatus.APPROVED
          ? 'Delivery approval granted successfully.'
          : 'Delivery approval rejected successfully.',
      ...(rawPin
        ? {
            pin: rawPin,
            pinExpiresAt: expiresAt?.toISOString() ?? null,
          }
        : {}),
    };
  }

  async confirmDeliveryApprovalPin(
    approvalRequestId: string,
    salesRepId: string,
    dto: ConfirmRouteApprovalPinDto,
  ) {
    const approvalRequest = await this.approvalRequestsRepo.findOne({
      where: {
        id: approvalRequestId,
        salesRepId,
        type: RouteApprovalRequestType.DELIVERY_ORDERS,
      },
    });

    if (!approvalRequest) {
      throw new NotFoundException('Delivery approval request not found.');
    }
    if (approvalRequest.status !== RouteApprovalRequestStatus.APPROVED) {
      throw new BadRequestException(
        'This delivery approval request is not awaiting PIN confirmation.',
      );
    }
    if (!approvalRequest.pinHash || !approvalRequest.pinExpiresAt) {
      throw new BadRequestException('No active PIN exists for this approval.');
    }
    if (new Date() > approvalRequest.pinExpiresAt) {
      throw new BadRequestException('The approval PIN has expired.');
    }

    const pinMatches = await bcrypt.compare(dto.pin, approvalRequest.pinHash);
    if (!pinMatches) {
      throw new BadRequestException('Incorrect PIN.');
    }

    approvalRequest.pinVerifiedAt = new Date();
    await this.approvalRequestsRepo.save(approvalRequest);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ROUTE_DELIVERY_APPROVAL_PIN_CONFIRMED',
      title: 'Delivery approval confirmed',
      message:
        'The ready-for-delivery approval PIN was confirmed. You can continue with the route load request.',
      metadata: {
        routeId: approvalRequest.routeId,
        approvalRequestId: approvalRequest.id,
      },
    });

    return {
      message: 'Delivery approval PIN confirmed successfully.',
    };
  }

  async submitLoadRequest(
    routeId: string,
    salesRepId: string,
    dto: SubmitLoadRequestDto,
  ) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);

    if (
      route.status !== SalesRouteStatus.DRAFT &&
      route.status !== SalesRouteStatus.AWAITING_LOAD_APPROVAL
    ) {
      throw new BadRequestException(
        'Load requests can only be submitted before the route starts.',
      );
    }

    await this.ensureDeliveryApprovalSatisfied(route);

    const deliveryStock = route.deliveryOrderIdsJson?.length
      ? await this.buildReservedDeliveryStock(route)
      : [];
    const freeSaleStock = dto.freeSaleStock.filter(
      (item) => Number(item.quantityCases) > 0,
    );

    if (deliveryStock.length === 0 && freeSaleStock.length === 0) {
      throw new BadRequestException(
        'Add at least one stock line before submitting the van load request.',
      );
    }

    const existingRequest = await this.vanLoadRequestsRepo.findOne({
      where: { routeId },
      order: { createdAt: 'DESC' },
    });

    const loadRequest = existingRequest
      ? this.vanLoadRequestsRepo.merge(existingRequest, {
          status: VanLoadRequestStatus.PENDING,
          deliveryStockJson: deliveryStock,
          freeSaleStockJson: freeSaleStock,
          managerNotes: null,
          reviewedBy: null,
          reviewedAt: null,
        })
      : this.vanLoadRequestsRepo.create({
          routeId,
          status: VanLoadRequestStatus.PENDING,
          deliveryStockJson: deliveryStock,
          freeSaleStockJson: freeSaleStock,
          managerNotes: null,
          reviewedBy: null,
          reviewedAt: null,
        });

    const savedLoadRequest = await this.vanLoadRequestsRepo.save(loadRequest);
    await this.salesRoutesRepo.update(routeId, {
      status: SalesRouteStatus.AWAITING_LOAD_APPROVAL,
      openingStockJson: null,
      warehouseManagerPinHash: null,
      pinExpiresAt: null,
    });

    const managerMessage = this.buildLoadRequestManagerMessage(
      route,
      deliveryStock,
      freeSaleStock,
    );

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ROUTE_LOAD_REQUEST_SUBMITTED',
      title: 'Van load request submitted',
      message: 'Your van load request was submitted for TM approval.',
      metadata: {
        routeId,
        loadRequestId: savedLoadRequest.id,
      },
    });

    const managers = await this.findRelevantManagers(route);
    await Promise.all(
      managers.map((manager) =>
        this.activityService.logForUser({
          userId: manager.id,
          type: 'ROUTE_LOAD_REQUEST_PENDING',
          title: 'Van load request pending',
          message: managerMessage,
          metadata: {
            routeId,
            salesRepId,
            loadRequestId: savedLoadRequest.id,
          },
        }),
      ),
    );

    return {
      message: 'Load request submitted successfully.',
      loadRequest: savedLoadRequest,
    };
  }

  async getMyRoute(salesRepId: string) {
    const route = await this.salesRoutesRepo
      .createQueryBuilder('route')
      .leftJoinAndSelect('route.warehouse', 'warehouse')
      .leftJoinAndSelect('route.vehicle', 'vehicle')
      .leftJoinAndSelect('route.territory', 'territory')
      .where('route.sales_rep_id = :salesRepId', { salesRepId })
      .andWhere('route.status != :closedStatus', {
        closedStatus: SalesRouteStatus.CLOSED,
      })
      .orderBy('route.created_at', 'DESC')
      .getOne();

    if (!route) {
      return {
        message: 'No active route found.',
        route: null,
      };
    }

    return {
      message: 'Active route fetched successfully.',
      route: await this.serializeRoute(route),
    };
  }

  async getLatestRoute(salesRepId: string) {
    const latestRoute = await this.salesRoutesRepo
      .createQueryBuilder('route')
      .leftJoinAndSelect('route.warehouse', 'warehouse')
      .leftJoinAndSelect('route.vehicle', 'vehicle')
      .leftJoinAndSelect('route.territory', 'territory')
      .where('route.sales_rep_id = :salesRepId', { salesRepId })
      .orderBy('route.created_at', 'DESC')
      .getOne();

    if (!latestRoute) {
      return {
        message: 'No route found.',
        route: null,
      };
    }

    return {
      message: 'Latest route fetched successfully.',
      route: await this.serializeRoute(latestRoute),
    };
  }

  async approveLoadRequest(
    loadRequestId: string,
    managerId: string,
    dto: ApproveLoadRequestDto,
  ) {
    const manager = await this.requireRouteManager(managerId);
    const loadRequest = await this.vanLoadRequestsRepo.findOne({
      where: { id: loadRequestId },
      relations: {
        route: true,
      },
    });

    if (!loadRequest) {
      throw new NotFoundException('Load request not found.');
    }
    if (!loadRequest.route) {
      throw new NotFoundException('Linked route not found.');
    }
    if (loadRequest.status !== VanLoadRequestStatus.PENDING) {
      throw new BadRequestException(
        'This load request has already been reviewed.',
      );
    }
    this.ensureManagerOwnsRoute(manager, loadRequest.route);

    const approvedDeliveryStock =
      dto.decision === LoadRequestDecision.ADJUSTED
        ? dto.adjustedDeliveryStock ?? loadRequest.deliveryStockJson
        : loadRequest.deliveryStockJson;
    const approvedFreeSaleStock =
      dto.decision === LoadRequestDecision.ADJUSTED
        ? dto.adjustedFreeSaleStock ?? loadRequest.freeSaleStockJson
        : loadRequest.freeSaleStockJson;

    let generatedPin: string | null = null;
    let pinExpiresAt: Date | null = null;
    let routeStartPinExpiresAtIso: string | null = null;

    await this.salesRoutesRepo.manager.transaction(async (managerEntity) => {
      const routeRepo = managerEntity.getRepository(SalesRoute);
      const loadRequestRepo = managerEntity.getRepository(VanLoadRequest);
      const inventoryRepo = managerEntity.getRepository(WarehouseInventoryItem);

      const route = await routeRepo.findOne({
        where: { id: loadRequest.routeId },
      });
      if (!route) {
        throw new NotFoundException('Linked route not found.');
      }

      loadRequest.status =
        dto.decision === LoadRequestDecision.REJECTED
          ? VanLoadRequestStatus.REJECTED
          : dto.decision === LoadRequestDecision.ADJUSTED
            ? VanLoadRequestStatus.ADJUSTED
            : VanLoadRequestStatus.APPROVED;
      loadRequest.deliveryStockJson = approvedDeliveryStock;
      loadRequest.freeSaleStockJson = approvedFreeSaleStock;
      loadRequest.managerNotes = dto.notes?.trim() ?? null;
      loadRequest.reviewedBy = managerId;
      loadRequest.reviewedAt = new Date();

      if (dto.decision === LoadRequestDecision.REJECTED) {
        route.status = SalesRouteStatus.DRAFT;
        route.openingStockJson = null;
        route.warehouseManagerPinHash = null;
        route.pinExpiresAt = null;
      } else {
        await this.reserveInventoryForApprovedLoad(
          inventoryRepo,
          route.warehouseId,
          [...approvedDeliveryStock, ...approvedFreeSaleStock],
        );
        generatedPin = this.generatePin();
        pinExpiresAt = new Date(
          Date.now() + ROUTE_PIN_TTL_MINUTES * 60 * 1000,
        );
        routeStartPinExpiresAtIso = pinExpiresAt.toISOString();
        route.status = SalesRouteStatus.APPROVED_TO_START;
        route.openingStockJson = this.combineOpeningStock(
          approvedDeliveryStock,
          approvedFreeSaleStock,
        );
        route.warehouseManagerPinHash = await bcrypt.hash(
          generatedPin,
          BCRYPT_ROUNDS,
        );
        route.pinExpiresAt = pinExpiresAt;
      }

      await loadRequestRepo.save(loadRequest);
      await routeRepo.save(route);
    });

    await this.activityService.logForUser({
      userId: loadRequest.route.salesRepId,
      type:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'ROUTE_LOAD_REQUEST_REJECTED'
          : 'ROUTE_LOAD_REQUEST_APPROVED',
      title:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'Van load request rejected'
          : 'Van load request approved',
      message:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'Your van load request was rejected. Review the notes and resubmit.'
          : 'Your van load request was approved and the route is now ready to start.',
      metadata: {
        routeId: loadRequest.routeId,
        loadRequestId: loadRequest.id,
        decision: dto.decision,
        ...(generatedPin
          ? {
              pin: generatedPin,
              pinExpiresAt: routeStartPinExpiresAtIso,
            }
          : {}),
      },
    });

    await this.activityService.logForUser({
      userId: managerId,
      type: 'ROUTE_LOAD_REQUEST_REVIEWED',
      title: 'Van load request reviewed',
      message:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'You rejected a sales route van load request.'
          : 'You approved a sales route van load request. Share the PIN below with the sales rep to start the route.',
      metadata: {
        routeId: loadRequest.routeId,
        loadRequestId: loadRequest.id,
        decision: dto.decision,
        ...(generatedPin
          ? {
              pin: generatedPin,
              pinExpiresAt: routeStartPinExpiresAtIso,
            }
          : {}),
      },
    });

    return {
      message:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'Load request rejected successfully.'
          : 'Load request reviewed successfully.',
      ...(generatedPin
        ? {
            startPin: generatedPin,
            pinExpiresAt,
          }
        : {}),
    };
  }

  async enterStartPin(routeId: string, salesRepId: string, dto: EnterPinDto) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);

    if (route.status !== SalesRouteStatus.APPROVED_TO_START) {
      throw new BadRequestException('This route is not ready to start.');
    }
    if (!route.warehouseManagerPinHash || !route.pinExpiresAt) {
      throw new BadRequestException('No active start PIN exists for this route.');
    }
    if (new Date() > route.pinExpiresAt) {
      throw new BadRequestException('The start PIN has expired.');
    }

    await this.ensureDeliveryApprovalSatisfied(route);

    const isValidPin = await bcrypt.compare(
      dto.pin,
      route.warehouseManagerPinHash,
    );
    if (!isValidPin) {
      throw new BadRequestException('Incorrect PIN.');
    }

    route.status = SalesRouteStatus.IN_PROGRESS;
    route.startedAt = new Date();

    const savedRoute = await this.salesRoutesRepo.save(route);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'SALES_ROUTE_STARTED',
      title: 'Sales route started',
      message: 'Your sales route is now in progress.',
      metadata: {
        routeId: savedRoute.id,
        startedAt: savedRoute.startedAt?.toISOString() ?? null,
      },
    });

    return {
      message: 'Route started successfully.',
      route: await this.serializeRoute(savedRoute),
    };
  }

  async logReturnItem(routeId: string, salesRepId: string, dto: LogReturnItemDto) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);

    if (route.status !== SalesRouteStatus.IN_PROGRESS) {
      throw new BadRequestException('Route must be IN_PROGRESS to log returns.');
    }

    const existing = route.returnItemsJson ?? [];
    existing.push({
      productId: dto.productId,
      productName: dto.productName,
      quantityCases: dto.quantityCases,
      reason: dto.reason,
      notes: dto.notes ?? null,
      loggedAt: new Date().toISOString(),
    });

    await this.salesRoutesRepo.update(routeId, { returnItemsJson: existing });

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'RETURN_ITEM_LOGGED',
      title: 'Return item logged',
      message: `${dto.quantityCases} case(s) of "${dto.productName}" were logged for return.`,
      metadata: { routeId, productId: dto.productId },
    });

    return { message: 'Return item logged successfully.', routeId };
  }

  async closeRoute(routeId: string, salesRepId: string, dto: CloseRouteDto) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);

    if (route.status !== SalesRouteStatus.IN_PROGRESS) {
      throw new BadRequestException('Only in-progress routes can be closed.');
    }
    if (!route.warehouseManagerPinHash) {
      throw new BadRequestException('No route PIN is stored for this route.');
    }

    const isValidPin = await bcrypt.compare(
      dto.pin,
      route.warehouseManagerPinHash,
    );
    if (!isValidPin) {
      throw new BadRequestException('Incorrect PIN.');
    }

    const variance = this.buildVariance(
      route.openingStockJson ?? [],
      dto.closingStock,
      dto.returnItems,
      dto.varianceReason?.trim() ?? null,
    );

    route.closingStockJson = dto.closingStock;
    route.varianceJson = variance;
    route.status = SalesRouteStatus.CLOSED;
    route.closedAt = new Date();
    route.warehouseManagerPinHash = null;
    route.pinExpiresAt = null;

    const savedRoute = await this.salesRoutesRepo.save(route);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'SALES_ROUTE_CLOSED',
      title: 'Sales route closed',
      message: 'Your sales route was closed successfully.',
      metadata: {
        routeId: savedRoute.id,
        closedAt: savedRoute.closedAt?.toISOString() ?? null,
        varianceCount: variance.length,
      },
    });

    return {
      message: 'Route closed successfully.',
      route: await this.serializeRoute(savedRoute),
      variance,
    };
  }

  private ensureEditableRoute(route: SalesRoute) {
    if (
      route.status !== SalesRouteStatus.DRAFT &&
      route.status !== SalesRouteStatus.AWAITING_LOAD_APPROVAL &&
      route.status !== SalesRouteStatus.APPROVED_TO_START
    ) {
      throw new BadRequestException(
        'This route can no longer be edited from the Start Route flow.',
      );
    }
  }

  private async ensureDeliveryApprovalSatisfied(route: SalesRoute) {
    if (!route.deliveryOrderIdsJson || route.deliveryOrderIdsJson.length === 0) {
      return;
    }

    const approval = await this.approvalRequestsRepo.findOne({
      where: {
        routeId: route.id,
        type: RouteApprovalRequestType.DELIVERY_ORDERS,
      },
      order: { createdAt: 'DESC' },
    });

    if (!approval || approval.status !== RouteApprovalRequestStatus.APPROVED) {
      throw new BadRequestException(
        'Ready-for-delivery orders require TM approval before continuing.',
      );
    }
    if (!approval.pinVerifiedAt) {
      throw new BadRequestException(
        'Confirm the delivery approval PIN before continuing.',
      );
    }
  }

  private async seedBeatPlanForRoute(routeId: string, salesRep: User) {
    const route = await this.salesRoutesRepo.findOne({
      where: { id: routeId },
    });
    if (!route) {
      return;
    }

    const eligibleOutlets = await this.getEligibleOutlets(
      route.territoryId,
      route.warehouseId,
    );
    const dueOutletIds = await this.computeDueOutletIds(
      salesRep.id,
      eligibleOutlets.map((outlet) => outlet.id),
    );
    const alerts = await this.computeDeliveryAlerts(route.territoryId, route.warehouseId);

    const template = await this.beatPlanTemplatesRepo.findOne({
      where: {
        salesRepId: salesRep.id,
        territoryId: route.territoryId!,
        warehouseId: route.warehouseId,
      },
    });
    const applyTemplate =
      !!template &&
      (!template.lastAppliedAt ||
        this.diffDays(template.lastAppliedAt, new Date()) >=
          BEAT_PLAN_TEMPLATE_REAPPLY_DAYS);

    const candidateByOutletId = new Map<string, BeatPlanSeed>();
    const outletById = new Map(eligibleOutlets.map((outlet) => [outlet.id, outlet]));

    for (const outletId of dueOutletIds) {
      const outlet = outletById.get(outletId);
      if (!outlet) {
        continue;
      }
      candidateByOutletId.set(outletId, {
        outletId,
        outletName: outlet.outletName,
        ownerName: outlet.ownerName ?? null,
        source: RouteBeatPlanSource.DUE,
        hasPendingDelivery: false,
        pendingDeliveryOrderIds: [],
      });
    }

    for (const alert of alerts) {
      candidateByOutletId.set(alert.outletId, {
        outletId: alert.outletId,
        outletName: alert.outletName,
        ownerName: alert.ownerName,
        source: RouteBeatPlanSource.DELIVERY,
        hasPendingDelivery: true,
        pendingDeliveryOrderIds: alert.orderIds,
      });
    }

    if (applyTemplate && template) {
      for (const outletId of template.outletIdsJson) {
        const outlet = outletById.get(outletId);
        if (!outlet) {
          continue;
        }
        const existing = candidateByOutletId.get(outletId);
        candidateByOutletId.set(outletId, {
          outletId,
          outletName: outlet.outletName,
          ownerName: outlet.ownerName ?? null,
          source: existing?.source ?? RouteBeatPlanSource.TEMPLATE,
          hasPendingDelivery: existing?.hasPendingDelivery ?? false,
          pendingDeliveryOrderIds: existing?.pendingDeliveryOrderIds ?? [],
        });
      }
      template.lastAppliedAt = new Date();
      await this.beatPlanTemplatesRepo.save(template);
    }

    const beatPlanItems = Array.from(candidateByOutletId.values())
      .sort((left, right) => {
        const sourceRank = this.sourceRank(left.source) - this.sourceRank(right.source);
        if (sourceRank !== 0) {
          return sourceRank;
        }
        return left.outletName.localeCompare(right.outletName);
      })
      .map((entry, index) =>
        this.beatPlanItemsRepo.create({
          routeId,
          outletId: entry.outletId,
          outletNameSnapshot: entry.outletName,
          ownerNameSnapshot: entry.ownerName,
          source: entry.source,
          isSelected: true,
          hasPendingDelivery: entry.hasPendingDelivery,
          pendingDeliveryCount: entry.pendingDeliveryOrderIds.length,
          pendingDeliveryOrderIdsJson: entry.pendingDeliveryOrderIds,
          sortOrder: index + 1,
        }),
      );

    if (beatPlanItems.length > 0) {
      await this.beatPlanItemsRepo.save(beatPlanItems);
    }
  }

  private async getEligibleOutlets(
    territoryId: string | null,
    warehouseId: string,
  ) {
    if (!territoryId) {
      return [];
    }

    return this.outletsRepo.find({
      where: {
        territoryId,
        warehouseId,
        status: OutletStatus.APPROVED,
      },
      order: {
        outletName: 'ASC',
      },
    });
  }

  private async computeDueOutletIds(salesRepId: string, outletIds: string[]) {
    if (outletIds.length === 0) {
      return [];
    }

    const visits = await this.storeVisitsRepo.find({
      where: {
        salesRepId,
        shopId: In(outletIds),
      },
      order: {
        visitEndedAt: 'DESC',
        visitStartedAt: 'DESC',
      },
    });

    const latestVisitByOutlet = new Map<string, Date>();
    for (const visit of visits) {
      const outletId = visit.shopId;
      if (!outletId || latestVisitByOutlet.has(outletId)) {
        continue;
      }
      latestVisitByOutlet.set(
        outletId,
        visit.visitEndedAt ?? visit.visitStartedAt ?? visit.createdAt,
      );
    }

    const now = new Date();
    return outletIds.filter((outletId) => {
      const latestVisit = latestVisitByOutlet.get(outletId);
      if (!latestVisit) {
        return true;
      }
      return this.diffDays(latestVisit, now) >= DUE_OUTLET_WINDOW_DAYS;
    });
  }

  private async computeDeliveryAlerts(
    territoryId: string | null,
    warehouseId: string,
  ): Promise<DeliveryAlert[]> {
    if (!territoryId) {
      return [];
    }

    const [orders, outlets] = await Promise.all([
      this.ordersRepo.find({
        where: {
          territoryId,
          warehouseId,
          status: 'PROCEED',
          assignmentId: IsNull(),
        },
        order: {
          placedAt: 'ASC',
        },
      }),
      this.outletsRepo.find({
        where: {
          territoryId,
          warehouseId,
          status: OutletStatus.APPROVED,
        },
      }),
    ]);

    const outletByName = new Map(
      outlets.map((outlet) => [outlet.outletName.trim().toLowerCase(), outlet]),
    );
    const alertByOutletId = new Map<string, DeliveryAlert>();

    for (const order of orders) {
      const outlet = outletByName.get(order.shopNameSnapshot.trim().toLowerCase());
      if (!outlet) {
        continue;
      }

      const current = alertByOutletId.get(outlet.id) ?? {
        outletId: outlet.id,
        outletName: outlet.outletName,
        ownerName: outlet.ownerName ?? null,
        orderIds: [],
        orderCount: 0,
        products: [],
      };

      current.orderIds.push(order.id);
      current.orderCount += 1;
      current.products = this.combineVanLoadLines([
        ...current.products,
        ...order.items.map((item) => ({
          productId: item.productId ?? item.id,
          productName: item.productNameSnapshot,
          quantityCases: item.quantity,
        })),
      ]);

      alertByOutletId.set(outlet.id, current);
    }

    return Array.from(alertByOutletId.values()).sort((left, right) =>
      left.outletName.localeCompare(right.outletName),
    );
  }

  private async buildReservedDeliveryStock(route: SalesRoute) {
    const orderIds = route.deliveryOrderIdsJson ?? [];
    if (orderIds.length === 0 || !route.territoryId) {
      return [];
    }

    const orders = await this.ordersRepo.find({
      where: {
        id: In(orderIds),
        warehouseId: route.warehouseId,
        territoryId: route.territoryId,
        status: 'PROCEED',
        assignmentId: IsNull(),
      },
    });

    if (orders.length !== orderIds.length) {
      throw new BadRequestException(
        'One or more selected ready-for-delivery orders are no longer available.',
      );
    }

    return this.combineVanLoadLines(
      orders.flatMap((order) =>
        order.items.map((item) => ({
          productId: item.productId ?? item.id,
          productName: item.productNameSnapshot,
          quantityCases: item.quantity,
        })),
      ),
    );
  }

  private async reserveInventoryForApprovedLoad(
    inventoryRepo: Repository<WarehouseInventoryItem>,
    warehouseId: string,
    requestedLines: VanLoadRequestStockLine[],
  ) {
    const groupedLines = this.combineVanLoadLines(
      requestedLines.filter((line) => Number(line.quantityCases) > 0),
    );

    if (groupedLines.length === 0) {
      throw new BadRequestException(
        'Approved load request must contain at least one stock line.',
      );
    }

    const inventoryItems = await inventoryRepo.find({
      where: {
        warehouseId,
        productId: In(groupedLines.map((line) => line.productId)),
      },
    });
    const inventoryByProductId = new Map(
      inventoryItems.map((item) => [item.productId, item]),
    );

    for (const line of groupedLines) {
      const inventoryItem = inventoryByProductId.get(line.productId);
      const availableCases = inventoryItem?.quantityOnHand ?? 0;
      if (!inventoryItem || availableCases < line.quantityCases) {
        throw new BadRequestException(
          `${line.productName} needs ${line.quantityCases} case(s), but only ${availableCases} case(s) are available in warehouse inventory.`,
        );
      }
      inventoryItem.quantityOnHand -= line.quantityCases;
    }

    await inventoryRepo.save(Array.from(inventoryByProductId.values()));
  }

  private async serializeRoute(route: SalesRoute) {
    const [beatPlanItems, deliveryAlerts, loadRequest, deliveryApproval] =
      await Promise.all([
        this.beatPlanItemsRepo.find({
          where: { routeId: route.id },
          order: { sortOrder: 'ASC', createdAt: 'ASC' },
        }),
        this.computeDeliveryAlerts(route.territoryId, route.warehouseId),
        this.vanLoadRequestsRepo.findOne({
          where: { routeId: route.id },
          order: { createdAt: 'DESC' },
        }),
        this.approvalRequestsRepo.findOne({
          where: {
            routeId: route.id,
            type: RouteApprovalRequestType.DELIVERY_ORDERS,
          },
          order: { createdAt: 'DESC' },
        }),
      ]);

    const availableOutlets = await this.getEligibleOutlets(
      route.territoryId,
      route.warehouseId,
    );

    return {
      id: route.id,
      status: route.status,
      territoryId: route.territoryId,
      warehouseId: route.warehouseId,
      warehouseName: route.warehouse?.name ?? null,
      vehicleId: route.vehicleId,
      vehicleLabel: route.vehicle?.label ?? null,
      startedAt: route.startedAt,
      closedAt: route.closedAt,
      routeStartPinExpiresAt: route.pinExpiresAt,
      deliveryOrderIds: route.deliveryOrderIdsJson ?? [],
      beatPlanItems: beatPlanItems.map((item) => ({
        id: item.id,
        outletId: item.outletId,
        outletName: item.outletNameSnapshot,
        ownerName: item.ownerNameSnapshot,
        source: item.source,
        isSelected: item.isSelected,
        hasPendingDelivery: item.hasPendingDelivery,
        pendingDeliveryCount: item.pendingDeliveryCount,
        orderIds: item.pendingDeliveryOrderIdsJson ?? [],
      })),
      availableOutlets: availableOutlets.map((outlet) => ({
        id: outlet.id,
        outletName: outlet.outletName,
        ownerName: outlet.ownerName,
      })),
      deliveryAlerts: deliveryAlerts.map((alert) => ({
        outletId: alert.outletId,
        outletName: alert.outletName,
        orderCount: alert.orderCount,
        orderIds: alert.orderIds,
        products: alert.products,
      })),
      deliveryApproval: deliveryApproval
        ? {
            id: deliveryApproval.id,
            status: deliveryApproval.status,
            pinVerifiedAt: deliveryApproval.pinVerifiedAt,
            pinExpiresAt: deliveryApproval.pinExpiresAt,
            notes: deliveryApproval.decisionNote,
          }
        : null,
      vanLoadRequest: loadRequest
        ? {
            id: loadRequest.id,
            status: loadRequest.status,
            deliveryStock: loadRequest.deliveryStockJson,
            freeSaleStock: loadRequest.freeSaleStockJson,
            managerNotes: loadRequest.managerNotes,
          }
        : null,
    };
  }

  private async upsertBeatPlanTemplate(
    route: SalesRoute,
    selectedOutletIds: string[],
  ) {
    if (!route.territoryId) {
      return;
    }

    const existingTemplate = await this.beatPlanTemplatesRepo.findOne({
      where: {
        salesRepId: route.salesRepId,
        territoryId: route.territoryId,
        warehouseId: route.warehouseId,
      },
    });

    const template = existingTemplate
      ? this.beatPlanTemplatesRepo.merge(existingTemplate, {
          outletIdsJson: selectedOutletIds,
          lastAppliedAt: new Date(),
        })
      : this.beatPlanTemplatesRepo.create({
          salesRepId: route.salesRepId,
          territoryId: route.territoryId,
          warehouseId: route.warehouseId,
          outletIdsJson: selectedOutletIds,
          lastAppliedAt: new Date(),
        });

    await this.beatPlanTemplatesRepo.save(template);
  }

  private async getOwnedRouteWithRelations(routeId: string, salesRepId: string) {
    const route = await this.salesRoutesRepo.findOne({
      where: {
        id: routeId,
        salesRepId,
      },
      relations: {
        warehouse: true,
        vehicle: true,
        territory: true,
      },
    });

    if (!route) {
      throw new NotFoundException('Sales route not found.');
    }

    return route;
  }

  private async requireOwnedRoute(routeId: string, salesRepId: string) {
    return this.getOwnedRouteWithRelations(routeId, salesRepId);
  }

  private async requireSalesRep(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });

    if (!user || user.role !== Role.SALES_REP) {
      throw new BadRequestException('Sales rep not found.');
    }

    return user;
  }

  private async requireRouteManager(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });

    if (
      !user ||
      (user.role !== Role.REGIONAL_MANAGER &&
        user.role !== Role.TERRITORY_DISTRIBUTOR)
    ) {
      throw new BadRequestException(
        'Only territory managers can review route approvals.',
      );
    }

    return user;
  }

  private ensureManagerOwnsRoute(manager: User, route: SalesRoute) {
    if (
      manager.warehouseId &&
      route.warehouseId !== manager.warehouseId &&
      (!manager.territoryId || manager.territoryId !== route.territoryId)
    ) {
      throw new BadRequestException(
        'This route does not belong to your warehouse or territory.',
      );
    }
  }

  private async findRelevantManagers(route: SalesRoute) {
    const managers = await this.usersRepo.find({
      where: {
        role: In([Role.REGIONAL_MANAGER, Role.TERRITORY_DISTRIBUTOR]),
      },
    });

    return managers.filter(
      (manager) =>
        manager.warehouseId === route.warehouseId ||
        (!!route.territoryId && manager.territoryId === route.territoryId),
    );
  }

  private buildLoadRequestManagerMessage(
    route: SalesRoute,
    deliveryStock: VanLoadRequestStockLine[],
    freeSaleStock: VanLoadRequestStockLine[],
  ) {
    if (deliveryStock.length > 0 && freeSaleStock.length > 0) {
      return 'A sales rep wants to carry additional products along with reserved delivery stock on this route.';
    }
    if (deliveryStock.length > 0) {
      return 'A sales rep wants approval to carry reserved delivery stock for ready-for-delivery orders on this route.';
    }
    return 'A sales rep wants approval to carry the requested products on this route.';
  }

  private generatePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private combineVanLoadLines(lines: VanLoadRequestStockLine[]) {
    const byProductId = new Map<string, VanLoadRequestStockLine>();

    for (const line of lines) {
      const productId = line.productId.toString();
      const current = byProductId.get(productId);
      if (current) {
        current.quantityCases += Number(line.quantityCases) || 0;
        continue;
      }

      byProductId.set(productId, {
        productId,
        productName: line.productName,
        quantityCases: Number(line.quantityCases) || 0,
      });
    }

    return Array.from(byProductId.values());
  }

  private combineOpeningStock(
    deliveryStock: VanLoadRequestStockLine[],
    freeSaleStock: VanLoadRequestStockLine[],
  ): SalesRouteStockLine[] {
    const byProduct = new Map<string, SalesRouteStockLine>();

    for (const item of [...deliveryStock, ...freeSaleStock]) {
      const current = byProduct.get(item.productId);
      if (current) {
        current.quantityCases += item.quantityCases;
        continue;
      }

      byProduct.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        quantityCases: item.quantityCases,
        quantityUnits: 0,
      });
    }

    return Array.from(byProduct.values());
  }

  private normalizeToUnits(quantityCases: number, itemsPerCase = DEFAULT_ITEMS_PER_CASE) {
    return quantityCases * itemsPerCase;
  }

  private buildVariance(
    openingStock: SalesRouteStockLine[],
    closingStock: CloseRouteDto['closingStock'],
    returnItems: CloseRouteDto['returnItems'],
    varianceReason: string | null,
  ): VarianceLine[] {
    const productIds = new Set<string>();
    const openingByProduct = new Map(openingStock.map((item) => [item.productId, item]));
    const closingByProduct = new Map(closingStock.map((item) => [item.productId, item]));
    const returnByProduct = new Map(returnItems.map((item) => [item.productId, item]));

    for (const item of openingStock) productIds.add(item.productId);
    for (const item of closingStock) productIds.add(item.productId);
    for (const item of returnItems) productIds.add(item.productId);

    return Array.from(productIds).map((productId) => {
      const opening = openingByProduct.get(productId);
      const closing = closingByProduct.get(productId);
      const returned = returnByProduct.get(productId);

      const openingUnits =
        this.normalizeToUnits(opening?.quantityCases ?? 0) +
        (opening?.quantityUnits ?? 0);
      const expectedClosingUnits = this.normalizeToUnits(returned?.quantityCases ?? 0);
      const actualClosingUnits =
        this.normalizeToUnits(closing?.quantityCases ?? 0) +
        (closing?.quantityUnits ?? 0);

      return {
        productId,
        productName:
          closing?.productName ??
          returned?.productName ??
          opening?.productName ??
          'Unknown product',
        openingUnits,
        expectedClosingUnits,
        actualClosingUnits,
        varianceUnits: actualClosingUnits - expectedClosingUnits,
        varianceReason,
      };
    });
  }

  private diffDays(from: Date, to: Date) {
    return Math.floor(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  private sourceRank(source: RouteBeatPlanSource) {
    switch (source) {
      case RouteBeatPlanSource.DELIVERY:
        return 0;
      case RouteBeatPlanSource.DUE:
        return 1;
      case RouteBeatPlanSource.TEMPLATE:
        return 2;
      case RouteBeatPlanSource.MANUAL:
        return 3;
      default:
        return 4;
    }
  }

  async cancelRoute(routeId: string, salesRepId: string) {
    const routeRepo = this.salesRouteRepo;
    const route = await this.requireOwnedRoute(routeId, salesRepId);

    const cancellableStatuses = [
      SalesRouteStatus.DRAFT,
      SalesRouteStatus.AWAITING_LOAD_APPROVAL,
      SalesRouteStatus.APPROVED_TO_START,
    ];

    if (!cancellableStatuses.includes(route.status as any)) {
      throw new BadRequestException(
        'This route cannot be cancelled once it is in progress or already closed.',
      );
    }

    route.status = SalesRouteStatus.CANCELLED as any;
    route.warehouseManagerPinHash = null;
    route.pinExpiresAt = null;
    await routeRepo.save(route);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'SALES_ROUTE_CANCELLED',
      title: 'Route cancelled',
      message: 'You cancelled the current route. You can create a new route at any time.',
      metadata: { routeId: route.id },
    });

    return { message: 'Route cancelled successfully.' };
  }

  async requestPinRefresh(routeId: string, salesRepId: string) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);

    if (route.status !== SalesRouteStatus.APPROVED_TO_START) {
      throw new BadRequestException(
        'PIN refresh is only available for routes that are approved to start.',
      );
    }

    // Reset status so TM can re-approve and issue a fresh PIN
    route.status = SalesRouteStatus.AWAITING_LOAD_APPROVAL;
    route.warehouseManagerPinHash = null;
    route.pinExpiresAt = null;
    await this.salesRouteRepo.save(route);

    const managers = await this.findRelevantManagers(route);
    await Promise.all(
      managers.map((manager) =>
        this.activityService.logForUser({
          userId: manager.id,
          type: 'ROUTE_PIN_REFRESH_REQUESTED',
          title: 'Route PIN refresh requested',
          message:
            'A sales rep has requested a new start PIN. Please review and re-approve the load request to issue a new PIN.',
          metadata: { routeId: route.id, salesRepId },
        }),
      ),
    );

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ROUTE_PIN_REFRESH_SENT',
      title: 'PIN refresh requested',
      message:
        'Your PIN refresh request has been sent to the warehouse manager. You will receive a new PIN once they approve.',
      metadata: { routeId: route.id },
    });

    return {
      message: 'PIN refresh request sent to your warehouse manager.',
    };
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => entry?.toString().trim())
      .filter((entry): entry is string => !!entry);
  }
}
