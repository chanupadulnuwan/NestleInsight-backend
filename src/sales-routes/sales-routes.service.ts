import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { ActivityService } from '../activity/activity.service';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ApproveLoadRequestDto, LoadRequestDecision } from './dto/approve-load-request.dto';
import { CloseRouteDto } from './dto/close-route.dto';
import { CreateRouteDto } from './dto/create-route.dto';
import { EnterPinDto } from './dto/enter-pin.dto';
import { SubmitLoadRequestDto } from './dto/submit-load-request.dto';
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
const BCRYPT_ROUNDS = 10;
const DEFAULT_ITEMS_PER_CASE = 12;

type VarianceLine = {
  productId: string;
  productName: string;
  openingUnits: number;
  expectedClosingUnits: number;
  actualClosingUnits: number;
  varianceUnits: number;
  varianceReason: string | null;
};

@Injectable()
export class SalesRoutesService {
  constructor(
    @InjectRepository(SalesRoute)
    private readonly salesRoutesRepo: Repository<SalesRoute>,
    @InjectRepository(VanLoadRequest)
    private readonly vanLoadRequestsRepo: Repository<VanLoadRequest>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly usersService: UsersService,
    private readonly activityService: ActivityService,
  ) {}

  async createRoute(salesRepId: string, dto: CreateRouteDto) {
    const salesRep = await this.requireSalesRep(salesRepId);

    const inProgressRoute = await this.salesRoutesRepo.findOne({
      where: {
        salesRepId,
        status: SalesRouteStatus.IN_PROGRESS,
      },
    });

    if (inProgressRoute) {
      throw new BadRequestException('You already have an in-progress route.');
    }

    const route = this.salesRoutesRepo.create({
      salesRepId,
      warehouseId: dto.warehouseId,
      vehicleId: dto.vehicleId ?? null,
      territoryId: salesRep.territoryId ?? null,
      status: SalesRouteStatus.DRAFT,
      openingStockJson: null,
      closingStockJson: null,
      varianceJson: null,
      startedAt: null,
      closedAt: null,
      warehouseManagerPinHash: null,
      pinExpiresAt: null,
    });

    const savedRoute = await this.salesRoutesRepo.save(route);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'SALES_ROUTE_CREATED',
      title: 'Sales route created',
      message: 'A new route draft was created successfully.',
      metadata: {
        routeId: savedRoute.id,
        warehouseId: savedRoute.warehouseId,
        vehicleId: savedRoute.vehicleId,
      },
    });

    return {
      message: 'Sales route created successfully.',
      route: savedRoute,
    };
  }

  async submitLoadRequest(
    routeId: string,
    salesRepId: string,
    dto: SubmitLoadRequestDto,
  ) {
    const route = await this.requireOwnedRoute(routeId, salesRepId);

    if (route.status !== SalesRouteStatus.DRAFT) {
      throw new BadRequestException(
        'Load requests can only be submitted for draft routes.',
      );
    }

    const existingRequest = await this.vanLoadRequestsRepo.findOne({
      where: { routeId },
      order: { createdAt: 'DESC' },
    });

    const loadRequest = existingRequest
      ? this.vanLoadRequestsRepo.merge(existingRequest, {
          status: VanLoadRequestStatus.PENDING,
          deliveryStockJson: dto.deliveryStock,
          freeSaleStockJson: dto.freeSaleStock,
          managerNotes: null,
          reviewedBy: null,
          reviewedAt: null,
        })
      : this.vanLoadRequestsRepo.create({
          routeId,
          status: VanLoadRequestStatus.PENDING,
          deliveryStockJson: dto.deliveryStock,
          freeSaleStockJson: dto.freeSaleStock,
          managerNotes: null,
          reviewedBy: null,
          reviewedAt: null,
        });

    const [savedLoadRequest] = await Promise.all([
      this.vanLoadRequestsRepo.save(loadRequest),
      this.salesRoutesRepo.update(routeId, {
        status: SalesRouteStatus.AWAITING_LOAD_APPROVAL,
      }),
    ]);

    await this.activityService.logForUser({
      userId: salesRepId,
      type: 'ROUTE_LOAD_REQUEST_SUBMITTED',
      title: 'Load request submitted',
      message: 'Your van load request was submitted for approval.',
      metadata: {
        routeId,
        loadRequestId: savedLoadRequest.id,
      },
    });

    const managers = await this.usersService.findByRole(Role.REGIONAL_MANAGER);
    const relevantManagers = managers.filter(
      (manager) =>
        manager.warehouseId === route.warehouseId ||
        (!!route.territoryId && manager.territoryId === route.territoryId),
    );

    await Promise.all(
      relevantManagers.map((manager) =>
        this.activityService.logForUser({
          userId: manager.id,
          type: 'ROUTE_LOAD_REQUEST_PENDING',
          title: 'Van load request pending',
          message: 'A sales rep submitted a van load request for your review.',
          metadata: {
            routeId,
            loadRequestId: savedLoadRequest.id,
            salesRepId,
            warehouseId: route.warehouseId,
            territoryId: route.territoryId,
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
    const activeRoute = await this.salesRoutesRepo
      .createQueryBuilder('route')
      .leftJoinAndSelect('route.salesRep', 'salesRep')
      .leftJoinAndSelect('route.warehouse', 'warehouse')
      .leftJoinAndSelect('route.vehicle', 'vehicle')
      .leftJoinAndSelect('route.territory', 'territory')
      .where('route.sales_rep_id = :salesRepId', { salesRepId })
      .andWhere('route.status != :closedStatus', {
        closedStatus: SalesRouteStatus.CLOSED,
      })
      .orderBy('route.created_at', 'DESC')
      .getOne();

    if (!activeRoute) {
      return {
        message: 'No active route found.',
        route: null,
        loadRequest: null,
      };
    }

    const loadRequest = await this.vanLoadRequestsRepo.findOne({
      where: { routeId: activeRoute.id },
      order: { createdAt: 'DESC' },
    });

    return {
      message: 'Active route fetched successfully.',
      route: activeRoute,
      loadRequest,
    };
  }

  async approveLoadRequest(
    loadRequestId: string,
    managerId: string,
    dto: ApproveLoadRequestDto,
  ) {
    const manager = await this.usersRepo.findOne({ where: { id: managerId } });
    if (!manager || manager.role !== Role.REGIONAL_MANAGER) {
      throw new BadRequestException('Only regional managers can review load requests.');
    }

    const loadRequest = await this.vanLoadRequestsRepo.findOne({
      where: { id: loadRequestId },
      relations: {
        route: true,
      },
    });

    if (!loadRequest) {
      throw new NotFoundException('Load request not found.');
    }

    const route = loadRequest.route;
    if (!route) {
      throw new NotFoundException('Linked route not found.');
    }

    if (
      manager.warehouseId &&
      route.warehouseId !== manager.warehouseId &&
      (!manager.territoryId || manager.territoryId !== route.territoryId)
    ) {
      throw new BadRequestException('This route does not belong to your warehouse or territory.');
    }

    const approvedDeliveryStock =
      dto.decision === LoadRequestDecision.ADJUSTED
        ? dto.adjustedDeliveryStock ?? loadRequest.deliveryStockJson
        : loadRequest.deliveryStockJson;
    const approvedFreeSaleStock =
      dto.decision === LoadRequestDecision.ADJUSTED
        ? dto.adjustedFreeSaleStock ?? loadRequest.freeSaleStockJson
        : loadRequest.freeSaleStockJson;

    const nextLoadRequestStatus =
      dto.decision === LoadRequestDecision.REJECTED
        ? VanLoadRequestStatus.REJECTED
        : dto.decision === LoadRequestDecision.ADJUSTED
          ? VanLoadRequestStatus.ADJUSTED
          : VanLoadRequestStatus.APPROVED;

    loadRequest.status = nextLoadRequestStatus;
    loadRequest.deliveryStockJson = approvedDeliveryStock;
    loadRequest.freeSaleStockJson = approvedFreeSaleStock;
    loadRequest.managerNotes = dto.notes?.trim() ?? null;
    loadRequest.reviewedBy = managerId;
    loadRequest.reviewedAt = new Date();

    const routePatch: Partial<SalesRoute> = {};
    let generatedPin: string | null = null;

    if (dto.decision === LoadRequestDecision.REJECTED) {
      routePatch.status = SalesRouteStatus.DRAFT;
      routePatch.openingStockJson = null;
      routePatch.warehouseManagerPinHash = null;
      routePatch.pinExpiresAt = null;
    } else {
      generatedPin = this.generatePin();
      routePatch.status = SalesRouteStatus.APPROVED_TO_START;
      routePatch.openingStockJson = this.combineOpeningStock(
        approvedDeliveryStock,
        approvedFreeSaleStock,
      );
      routePatch.warehouseManagerPinHash = await bcrypt.hash(
        generatedPin,
        BCRYPT_ROUNDS,
      );
      routePatch.pinExpiresAt = new Date(
        Date.now() + ROUTE_PIN_TTL_MINUTES * 60 * 1000,
      );
    }

    await Promise.all([
      this.vanLoadRequestsRepo.save(loadRequest),
      this.salesRoutesRepo.update(route.id, routePatch as any),
    ]);

    await this.activityService.logForUser({
      userId: route.salesRepId,
      type:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'ROUTE_LOAD_REQUEST_REJECTED'
          : 'ROUTE_LOAD_REQUEST_APPROVED',
      title:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'Load request rejected'
          : 'Load request approved',
      message:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'Your van load request was rejected. Review the notes and resubmit.'
          : `Your van load request was ${dto.decision.toLowerCase()} and the route is ready to start.`,
      metadata: {
        routeId: route.id,
        loadRequestId: loadRequest.id,
        decision: dto.decision,
        notes: loadRequest.managerNotes,
        ...(generatedPin
          ? {
              routeStartPin: generatedPin,
              pinExpiresAt: routePatch.pinExpiresAt?.toISOString() ?? null,
            }
          : {}),
      },
    });

    await this.activityService.logForUser({
      userId: managerId,
      type: 'ROUTE_LOAD_REQUEST_REVIEWED',
      title: 'Load request reviewed',
      message: `You ${dto.decision.toLowerCase()} a sales route load request.`,
      metadata: {
        routeId: route.id,
        loadRequestId: loadRequest.id,
        decision: dto.decision,
      },
    });

    return {
      message:
        dto.decision === LoadRequestDecision.REJECTED
          ? 'Load request rejected successfully.'
          : 'Load request reviewed successfully.',
      loadRequest,
      ...(generatedPin
        ? {
            startPin: generatedPin,
            pinExpiresAt: routePatch.pinExpiresAt,
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
      route: savedRoute,
    };
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
      route: savedRoute,
      variance,
    };
  }

  private normalizeToUnits(quantityCases: number, itemsPerCase = DEFAULT_ITEMS_PER_CASE) {
    return quantityCases * itemsPerCase;
  }

  private async requireOwnedRoute(routeId: string, salesRepId: string) {
    const route = await this.salesRoutesRepo.findOne({
      where: {
        id: routeId,
        salesRepId,
      },
      relations: {
        salesRep: true,
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

  private async requireSalesRep(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });

    if (!user || user.role !== Role.SALES_REP) {
      throw new BadRequestException('Sales rep not found.');
    }

    return user;
  }

  private generatePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
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

      // Return items are treated as the declared expected remainder from the route.
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
}
