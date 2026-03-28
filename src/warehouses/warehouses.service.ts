import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';

import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { ProductStatus } from '../common/enums/product-status.enum';
import {
  buildDefaultInventoryCapacity,
  buildDefaultReorderLevel,
} from '../common/utils/location-assignment.util';
import { Order } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { Role } from '../common/enums/role.enum';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseInventoryDto } from './dto/update-warehouse-inventory.dto';
import { WarehouseInventoryItem } from './entities/warehouse-inventory-item.entity';
import { Warehouse } from './entities/warehouse.entity';

type WarehouseOrderWindow = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ANNUALLY';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
    @InjectRepository(WarehouseInventoryItem)
    private readonly inventoryRepository: Repository<WarehouseInventoryItem>,
    @InjectRepository(Territory)
    private readonly territoriesRepository: Repository<Territory>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepository: Repository<Vehicle>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
  ) {}

  async listWarehouses(territoryId?: string, search?: string) {
    const warehouses = await this.warehousesRepository.find({
      where: territoryId ? { territoryId } : {},
      relations: {
        inventoryItems: {
          product: true,
        },
        managerUser: true,
      },
      order: {
        name: 'ASC',
      },
    });

    const normalizedSearch = search?.trim().toLowerCase() ?? '';
    const filteredWarehouses = normalizedSearch
      ? warehouses.filter((warehouse) =>
          [
            warehouse.name,
            warehouse.address,
            warehouse.territory?.name ?? '',
            warehouse.managerUser
              ? `${warehouse.managerUser.firstName} ${warehouse.managerUser.lastName}`.trim()
              : '',
          ].some((value) => value.toLowerCase().includes(normalizedSearch)),
        )
      : warehouses;

    return {
      message: 'Warehouses fetched successfully.',
      warehouses: filteredWarehouses.map((warehouse) =>
        this.serializeWarehouseSummary(warehouse),
      ),
    };
  }

  async getWarehouseDetails(
    warehouseId: string,
    orderWindow: string | undefined,
  ) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id: warehouseId },
      relations: {
        inventoryItems: {
          product: true,
        },
        managerUser: true,
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found.');
    }

    const normalizedOrderWindow = this.normalizeOrderWindow(orderWindow);
    const [users, vehicles, orders] = await Promise.all([
      this.usersRepository.find({
        where: {
          territoryId: warehouse.territoryId,
          role: In([
            Role.REGIONAL_MANAGER,
            Role.TERRITORY_DISTRIBUTOR,
            Role.SHOP_OWNER,
          ]),
        },
        relations: {
          territory: true,
          warehouse: true,
        },
        order: {
          firstName: 'ASC',
          lastName: 'ASC',
          shopName: 'ASC',
        },
      }),
      this.vehiclesRepository.find({
        where: [
          { warehouseId: warehouse.id },
          { territoryId: warehouse.territoryId, warehouseId: IsNull() },
        ],
        order: {
          label: 'ASC',
        },
      }),
      this.ordersRepository.find({
        where: {
          warehouseId: warehouse.id,
          placedAt: MoreThanOrEqual(
            this.getOrderWindowStartDate(normalizedOrderWindow),
          ),
        },
        order: {
          placedAt: 'DESC',
        },
        take: 25,
      }),
    ]);

    return {
      message: 'Warehouse details fetched successfully.',
      warehouse: this.serializeWarehouseDetails(
        warehouse,
        users,
        vehicles,
        orders,
        normalizedOrderWindow,
      ),
    };
  }

  async createWarehouse(createWarehouseDto: CreateWarehouseDto) {
    const normalizedName = createWarehouseDto.name.trim();
    const normalizedAddress = createWarehouseDto.address.trim();
    const normalizedPhoneNumber = createWarehouseDto.phoneNumber.trim();

    if (!normalizedName || !normalizedAddress || !normalizedPhoneNumber) {
      throw new BadRequestException(
        'Complete all warehouse details before saving.',
      );
    }

    const territory = await this.territoriesRepository.findOne({
      where: { id: createWarehouseDto.territoryId },
    });

    if (!territory) {
      throw new BadRequestException({
        message: 'Select a valid territory.',
        code: 'WAREHOUSE_TERRITORY_NOT_FOUND',
      });
    }

    const normalizedManagerUserId = createWarehouseDto.managerUserId?.trim();
    let manager: User | null = null;

    if (normalizedManagerUserId) {
      manager = await this.usersRepository.findOne({
        where: {
          id: normalizedManagerUserId,
        },
        relations: {
          territory: true,
          warehouse: true,
        },
      });

      if (
        !manager ||
        manager.role !== Role.REGIONAL_MANAGER ||
        manager.accountStatus !== AccountStatus.ACTIVE ||
        manager.approvalStatus !== ApprovalStatus.APPROVED
      ) {
        throw new BadRequestException({
          message: 'Select a registered territory manager.',
          code: 'WAREHOUSE_MANAGER_NOT_FOUND',
        });
      }

      if (manager.territoryId && manager.territoryId !== territory.id) {
        throw new BadRequestException({
          message: 'This manager belongs to a different territory.',
          code: 'WAREHOUSE_MANAGER_TERRITORY_MISMATCH',
        });
      }

      const existingManagedWarehouse =
        (await this.warehousesRepository.findOne({
          where: {
            managerUserId: manager.id,
          },
        })) ?? null;

      if (existingManagedWarehouse || manager.warehouseId) {
        throw new BadRequestException({
          message: 'This territory manager is already assigned to a warehouse.',
          code: 'WAREHOUSE_MANAGER_ALREADY_ASSIGNED',
        });
      }
    }

    const slug = this.toSlug(`${territory.name}-${normalizedName}`);
    const existingWarehouse = await this.warehousesRepository.findOne({
      where: [{ slug }, { territoryId: territory.id, name: normalizedName }],
    });

    if (existingWarehouse) {
      throw new BadRequestException({
        message:
          'A warehouse already exists with this name in the selected territory.',
        code: 'WAREHOUSE_NAME_NOT_UNIQUE',
      });
    }

    const warehouse = this.warehousesRepository.create({
      territoryId: territory.id,
      territory,
      name: normalizedName,
      slug,
      address: normalizedAddress,
      latitude:
        createWarehouseDto.latitude === undefined
          ? null
          : createWarehouseDto.latitude,
      longitude:
        createWarehouseDto.longitude === undefined
          ? null
          : createWarehouseDto.longitude,
      phoneNumber: normalizedPhoneNumber,
      managerUserId: manager?.id ?? null,
      managerUser: manager ?? null,
    });

    const savedWarehouse = await this.warehousesRepository.save(warehouse);

    if (manager) {
      manager.territoryId = territory.id;
      manager.territory = territory;
      manager.warehouseId = savedWarehouse.id;
      manager.warehouseName = savedWarehouse.name;
      await this.usersRepository.save(manager);
    }

    await this.seedWarehouseInventory(savedWarehouse.id);

    const hydratedWarehouse = await this.warehousesRepository.findOne({
      where: { id: savedWarehouse.id },
      relations: {
        inventoryItems: {
          product: true,
        },
        managerUser: true,
      },
    });

    if (!hydratedWarehouse) {
      throw new NotFoundException(
        'Warehouse was created but could not be reloaded.',
      );
    }

    return {
      message: 'Warehouse created successfully.',
      warehouse: this.serializeWarehouseDetails(
        hydratedWarehouse,
        manager ? [manager] : [],
        [],
        [],
        'MONTHLY',
      ),
    };
  }

  async updateWarehouseInventory(
    warehouseId: string,
    updateWarehouseInventoryDto: UpdateWarehouseInventoryDto,
  ) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id: warehouseId },
      relations: {
        inventoryItems: {
          product: true,
        },
        managerUser: true,
      },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found.');
    }

    const itemsById = new Map(
      (warehouse.inventoryItems ?? []).map((item) => [item.id, item]),
    );

    const updatedItems = updateWarehouseInventoryDto.items.map((item) => {
      const inventoryItem = itemsById.get(item.id);
      if (!inventoryItem) {
        throw new BadRequestException(
          'One or more inventory items do not belong to this warehouse.',
        );
      }

      if (item.quantityOnHand > item.maxCapacityCases) {
        throw new BadRequestException(
          'Cases on hand cannot exceed the maximum capacity.',
        );
      }

      if (item.reorderLevel > item.maxCapacityCases) {
        throw new BadRequestException(
          'Reorder level cannot exceed the maximum capacity.',
        );
      }

      inventoryItem.quantityOnHand = item.quantityOnHand;
      inventoryItem.reorderLevel = item.reorderLevel;
      inventoryItem.maxCapacityCases = item.maxCapacityCases;
      return inventoryItem;
    });

    await this.inventoryRepository.save(updatedItems);

    return this.getWarehouseDetails(warehouseId, 'MONTHLY');
  }

  async lookupWarehouseByName(name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new BadRequestException('Warehouse name is required.');
    }

    const slug = this.toSlug(normalizedName);
    const warehouse =
      (await this.warehousesRepository.findOne({
        where: [{ slug }, { name: ILike(normalizedName) }],
        relations: {
          territory: true,
          managerUser: true,
        },
      })) ?? null;

    if (!warehouse) {
      throw new NotFoundException({
        message: 'Warehouse name was not found.',
        code: 'WAREHOUSE_ASSIGNMENT_NOT_FOUND',
      });
    }

    return {
      message: 'Warehouse assignment resolved successfully.',
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        territoryId: warehouse.territoryId,
        territoryName: warehouse.territory?.name ?? '',
        latitude: warehouse.latitude,
        longitude: warehouse.longitude,
        managerUserId: warehouse.managerUserId,
        managerName: warehouse.managerUser
          ? `${warehouse.managerUser.firstName} ${warehouse.managerUser.lastName}`.trim()
          : null,
      },
    };
  }

  private async seedWarehouseInventory(warehouseId: string) {
    const activeProducts = await this.productsRepository.find({
      where: {
        status: ProductStatus.ACTIVE,
      },
      order: {
        productName: 'ASC',
      },
    });

    if (activeProducts.length === 0) {
      return;
    }

    const existingItems = await this.inventoryRepository.find({
      where: {
        warehouseId,
      },
    });
    const existingProductIds = new Set(existingItems.map((item) => item.productId));

    const missingItems = activeProducts
      .filter((product) => !existingProductIds.has(product.id))
      .map((product) => {
        const maxCapacityCases = buildDefaultInventoryCapacity(
          product.productsPerCase,
        );

        return this.inventoryRepository.create({
          warehouseId,
          productId: product.id,
          quantityOnHand: 0,
          reorderLevel: buildDefaultReorderLevel(maxCapacityCases),
          maxCapacityCases,
        });
      });

    if (missingItems.length > 0) {
      await this.inventoryRepository.save(missingItems);
    }
  }

  private serializeWarehouseSummary(warehouse: Warehouse) {
    const inventoryItems = warehouse.inventoryItems ?? [];
    const totalCasesOnHand = inventoryItems.reduce(
      (sum, item) => sum + item.quantityOnHand,
      0,
    );
    const totalUnitsOnHand = inventoryItems.reduce((sum, item) => {
      const unitsPerCase = item.product?.productsPerCase ?? 0;
      return sum + item.quantityOnHand * unitsPerCase;
    }, 0);

    return {
      id: warehouse.id,
      name: warehouse.name,
      slug: warehouse.slug,
      territoryId: warehouse.territoryId,
      territoryName: warehouse.territory?.name ?? '',
      address: warehouse.address,
      latitude: warehouse.latitude,
      longitude: warehouse.longitude,
      phoneNumber: warehouse.phoneNumber,
      managerUserId: warehouse.managerUserId,
      managerName: warehouse.managerUser
        ? `${warehouse.managerUser.firstName} ${warehouse.managerUser.lastName}`.trim()
        : 'Not assigned',
      inventoryItemCount: inventoryItems.length,
      inventoryCases: totalCasesOnHand,
      inventoryUnits: totalUnitsOnHand,
      createdAt: warehouse.createdAt,
      updatedAt: warehouse.updatedAt,
    };
  }

  private serializeWarehouseDetails(
    warehouse: Warehouse,
    users: User[],
    vehicles: Vehicle[],
    orders: Order[],
    orderWindow: WarehouseOrderWindow,
  ) {
    const inventory = (warehouse.inventoryItems ?? [])
      .slice()
      .sort((left, right) =>
        left.product.productName.localeCompare(right.product.productName),
      )
      .map((item) => this.serializeInventoryItem(item));

    const orderTotals = orders.reduce(
      (summary, order) => {
        summary.totalOrders += 1;
        summary.totalAmount = Number(
          (summary.totalAmount + order.totalAmount).toFixed(2),
        );
        summary.totalCases += order.items.reduce(
          (caseSum, item) => caseSum + item.quantity,
          0,
        );
        return summary;
      },
      { totalOrders: 0, totalAmount: 0, totalCases: 0 },
    );

    return {
      ...this.serializeWarehouseSummary(warehouse),
      inventory,
      inventorySummary: {
        trackedProducts: inventory.length,
        totalCasesOnHand: inventory.reduce(
          (sum, item) => sum + item.casesOnHand,
          0,
        ),
        totalUnitsOnHand: inventory.reduce(
          (sum, item) => sum + item.unitsOnHand,
          0,
        ),
        totalStockValue: Number(
          inventory.reduce((sum, item) => sum + item.stockValue, 0).toFixed(2),
        ),
        lowStockProducts: inventory.filter(
          (item) => item.casesOnHand <= item.reorderLevel,
        ).length,
      },
      managers: users
        .filter((user) => user.role === Role.REGIONAL_MANAGER)
        .map((user) => this.serializeUserSummary(user)),
      distributors: users
        .filter((user) => user.role === Role.TERRITORY_DISTRIBUTOR)
        .filter((user) => user.warehouseId === warehouse.id)
        .map((user) => this.serializeUserSummary(user)),
      shopOwners: users
        .filter((user) => user.role === Role.SHOP_OWNER)
        .filter((user) => user.warehouseId === warehouse.id)
        .map((user) => this.serializeShopOwnerSummary(user)),
      vehicles: vehicles.map((vehicle) => this.serializeVehicleSummary(vehicle)),
      orders: {
        period: orderWindow,
        summary: orderTotals,
        records: orders.map((order) => ({
          id: order.id,
          orderCode: order.orderCode,
          shopName: order.shopNameSnapshot,
          status: order.status,
          totalAmount: order.totalAmount,
          itemCount: order.items.length,
          totalCases: order.items.reduce(
            (sum, item) => sum + item.quantity,
            0,
          ),
          placedAt: order.placedAt,
        })),
      },
    };
  }

  private serializeInventoryItem(item: WarehouseInventoryItem) {
    const casesOnHand = item.quantityOnHand;
    const unitsOnHand = item.quantityOnHand * item.product.productsPerCase;
    const stockValue = Number((item.quantityOnHand * item.product.casePrice).toFixed(2));

    return {
      id: item.id,
      productId: item.productId,
      productName: item.product.productName,
      sku: item.product.sku,
      packSize: item.product.packSize,
      casesOnHand,
      unitsOnHand,
      reorderLevel: item.reorderLevel,
      maxCapacityCases: item.maxCapacityCases,
      stockValue,
      casePrice: item.product.casePrice,
      status:
        item.product.status === ProductStatus.INACTIVE
          ? 'INACTIVE_PRODUCT'
          : item.quantityOnHand <= item.reorderLevel
            ? 'LOW_STOCK'
            : 'HEALTHY',
      updatedAt: item.updatedAt,
    };
  }

  private serializeUserSummary(user: User) {
    return {
      id: user.id,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      username: user.username,
      phoneNumber: user.phoneNumber,
      warehouseId: user.warehouseId,
      warehouseName: user.warehouse?.name ?? user.warehouseName,
      accountStatus: user.accountStatus,
    };
  }

  private serializeShopOwnerSummary(user: User) {
    return {
      id: user.id,
      shopName:
        user.shopName?.trim() || `${user.firstName} ${user.lastName}`.trim(),
      ownerName: `${user.firstName} ${user.lastName}`.trim(),
      phoneNumber: user.phoneNumber,
      address: user.address,
      warehouseId: user.warehouseId,
      warehouseName: user.warehouse?.name ?? user.warehouseName,
      accountStatus: user.accountStatus,
    };
  }

  private serializeVehicleSummary(vehicle: Vehicle) {
    return {
      id: vehicle.id,
      vehicleCode: vehicle.vehicleCode,
      registrationNumber: vehicle.registrationNumber,
      label: vehicle.label,
      type: vehicle.type,
      capacityCases: vehicle.capacityCases,
      status: vehicle.status,
      warehouseId: vehicle.warehouseId,
      warehouseName: vehicle.warehouse?.name ?? null,
    };
  }

  private normalizeOrderWindow(value?: string): WarehouseOrderWindow {
    const normalizedValue = value?.trim().toUpperCase();

    if (
      normalizedValue === 'DAILY' ||
      normalizedValue === 'WEEKLY' ||
      normalizedValue === 'MONTHLY' ||
      normalizedValue === 'ANNUALLY'
    ) {
      return normalizedValue;
    }

    return 'MONTHLY';
  }

  private getOrderWindowStartDate(orderWindow: WarehouseOrderWindow) {
    const currentDate = new Date();

    if (orderWindow === 'DAILY') {
      return new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
    }

    if (orderWindow === 'WEEKLY') {
      return new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    if (orderWindow === 'ANNUALLY') {
      return new Date(currentDate.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    return new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  private toSlug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
