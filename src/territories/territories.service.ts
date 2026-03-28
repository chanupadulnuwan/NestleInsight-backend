import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Role } from '../common/enums/role.enum';
import { findNearestLocation } from '../common/utils/location-assignment.util';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { CreateTerritoryDto } from './dto/create-territory.dto';
import { Territory } from './entities/territory.entity';

@Injectable()
export class TerritoriesService {
  constructor(
    @InjectRepository(Territory)
    private readonly territoriesRepository: Repository<Territory>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepository: Repository<Vehicle>,
  ) {}

  async listTerritories() {
    const territories = await this.territoriesRepository.find({
      relations: {
        warehouses: {
          inventoryItems: true,
          managerUser: true,
        },
      },
      order: {
        name: 'ASC',
      },
    });

    const territoryIds = territories.map((territory) => territory.id);
    const [users, vehicles] = territoryIds.length
      ? await Promise.all([
          this.usersRepository.find({
            where: {
              territoryId: In(territoryIds),
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
            where: {
              territoryId: In(territoryIds),
            },
            relations: {
              warehouse: true,
            },
            order: {
              label: 'ASC',
            },
          }),
        ])
      : [[], []];

    const usersByTerritoryId = new Map<string, User[]>();
    for (const user of users) {
      if (!user.territoryId) {
        continue;
      }

      const nextUsers = usersByTerritoryId.get(user.territoryId) ?? [];
      nextUsers.push(user);
      usersByTerritoryId.set(user.territoryId, nextUsers);
    }

    const vehiclesByTerritoryId = new Map<string, Vehicle[]>();
    for (const vehicle of vehicles) {
      const nextVehicles = vehiclesByTerritoryId.get(vehicle.territoryId) ?? [];
      nextVehicles.push(vehicle);
      vehiclesByTerritoryId.set(vehicle.territoryId, nextVehicles);
    }

    return {
      message: 'Territories fetched successfully.',
      territories: territories.map((territory) =>
        this.serializeTerritory(
          territory,
          usersByTerritoryId.get(territory.id) ?? [],
          vehiclesByTerritoryId.get(territory.id) ?? [],
        ),
      ),
    };
  }

  async createTerritory(createTerritoryDto: CreateTerritoryDto) {
    const normalizedName = createTerritoryDto.name.trim();
    if (!normalizedName) {
      throw new BadRequestException('Territory name is required.');
    }

    const slug = this.toSlug(normalizedName);
    const existingTerritory = await this.territoriesRepository.findOne({
      where: [{ slug }, { name: normalizedName }],
    });

    if (existingTerritory) {
      throw new BadRequestException({
        message: 'A territory already exists with this name.',
        code: 'TERRITORY_NAME_NOT_UNIQUE',
      });
    }

    const territory = this.territoriesRepository.create({
      name: normalizedName,
      slug,
      latitude: createTerritoryDto.latitude,
      longitude: createTerritoryDto.longitude,
    });

    const savedTerritory = await this.territoriesRepository.save(territory);
    const hydratedTerritory = await this.territoriesRepository.findOne({
      where: { id: savedTerritory.id },
      relations: {
        warehouses: {
          inventoryItems: true,
          managerUser: true,
        },
      },
    });

    if (!hydratedTerritory) {
      throw new NotFoundException(
        'Territory was created but could not be reloaded.',
      );
    }

    return {
      message: 'Territory created successfully.',
      territory: this.serializeTerritory(hydratedTerritory, [], []),
    };
  }

  async resolveAssignment(latitude: number, longitude: number) {
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      throw new BadRequestException('Valid coordinates are required.');
    }

    const territories = await this.territoriesRepository.find({
      order: {
        name: 'ASC',
      },
    });

    const warehouseCandidates = await this.warehousesRepository.find({
      relations: {
        territory: true,
        managerUser: true,
      },
      order: {
        name: 'ASC',
      },
    });

    const nearestWarehouse = findNearestLocation(
      latitude,
      longitude,
      warehouseCandidates.filter(
        (warehouse) =>
          warehouse.latitude !== null && warehouse.longitude !== null,
      ) as Array<
        Warehouse & {
          latitude: number;
          longitude: number;
        }
      >,
    );
    const nearestTerritory = findNearestLocation(latitude, longitude, territories);

    const resolvedTerritory =
      nearestWarehouse?.item.territory ??
      nearestTerritory?.item ??
      null;

    const resolvedWarehouse = nearestWarehouse?.item ?? null;

    return {
      message: resolvedTerritory
        ? 'Territory and warehouse resolved successfully.'
        : 'No matching territory assignment is available yet.',
      territory: resolvedTerritory
        ? {
            id: resolvedTerritory.id,
            name: resolvedTerritory.name,
            slug: resolvedTerritory.slug,
            distanceKm: Number(
              (
                nearestWarehouse?.item.territoryId === resolvedTerritory.id
                  ? nearestWarehouse.distanceKm
                  : (nearestTerritory?.distanceKm ?? 0)
              ).toFixed(2),
            ),
          }
        : null,
      warehouse: resolvedWarehouse
        ? {
            id: resolvedWarehouse.id,
            name: resolvedWarehouse.name,
            slug: resolvedWarehouse.slug,
            territoryId: resolvedWarehouse.territoryId,
            territoryName: resolvedWarehouse.territory?.name ?? '',
            distanceKm: Number((nearestWarehouse?.distanceKm ?? 0).toFixed(2)),
          }
        : null,
    };
  }

  private serializeTerritory(
    territory: Territory,
    users: User[],
    vehicles: Vehicle[],
  ) {
    return {
      id: territory.id,
      name: territory.name,
      slug: territory.slug,
      latitude: territory.latitude,
      longitude: territory.longitude,
      warehouseCount: territory.warehouses?.length ?? 0,
      createdAt: territory.createdAt,
      updatedAt: territory.updatedAt,
      warehouses: (territory.warehouses ?? [])
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((warehouse) => this.serializeWarehouseSummary(warehouse)),
      managers: users
        .filter((user) => user.role === Role.REGIONAL_MANAGER)
        .map((user) => this.serializeUserSummary(user)),
      distributors: users
        .filter((user) => user.role === Role.TERRITORY_DISTRIBUTOR)
        .map((user) => this.serializeUserSummary(user)),
      shopOwners: users
        .filter((user) => user.role === Role.SHOP_OWNER)
        .map((user) => this.serializeShopOwnerSummary(user)),
      vehicles: vehicles.map((vehicle) => this.serializeVehicleSummary(vehicle)),
    };
  }

  private serializeWarehouseSummary(warehouse: Warehouse) {
    return {
      id: warehouse.id,
      name: warehouse.name,
      slug: warehouse.slug,
      territoryId: warehouse.territoryId,
      address: warehouse.address,
      latitude: warehouse.latitude,
      longitude: warehouse.longitude,
      phoneNumber: warehouse.phoneNumber,
      managerUserId: warehouse.managerUserId,
      managerName: warehouse.managerUser
        ? `${warehouse.managerUser.firstName} ${warehouse.managerUser.lastName}`.trim()
        : 'Not assigned',
      inventoryItemCount: warehouse.inventoryItems?.length ?? 0,
      createdAt: warehouse.createdAt,
      updatedAt: warehouse.updatedAt,
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
      warehouseId: user.warehouseId,
      warehouseName: user.warehouse?.name ?? user.warehouseName,
      address: user.address,
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

  private toSlug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
