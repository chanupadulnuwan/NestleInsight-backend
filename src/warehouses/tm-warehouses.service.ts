import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProductStatus } from '../common/enums/product-status.enum';
import { Role } from '../common/enums/role.enum';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { WarehouseInventoryItem } from './entities/warehouse-inventory-item.entity';
import { Warehouse } from './entities/warehouse.entity';

export class AddInventoryItemDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityOnHand: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevel: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCapacityCases: number;
}

export class CreateTmVehicleDto {
  @IsString()
  @MaxLength(80)
  label: string;

  @IsString()
  @MaxLength(40)
  registrationNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  vehicleCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacityCases: number;
}

@Injectable()
export class TmWarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehousesRepo: Repository<Warehouse>,
    @InjectRepository(WarehouseInventoryItem)
    private readonly inventoryRepo: Repository<WarehouseInventoryItem>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepo: Repository<Vehicle>,
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,
  ) {}

  async getMyWarehouse(tmUserId: string) {
    const tm = await this.requireTm(tmUserId);

    const warehouse = await this.warehousesRepo.findOne({
      where: { id: tm.warehouseId! },
      relations: { inventoryItems: { product: true }, managerUser: true },
    });

    if (!warehouse) throw new NotFoundException('Your warehouse was not found.');

    const territoryVehicles = tm.territoryId
      ? await this.vehiclesRepo.find({ where: { territoryId: tm.territoryId } })
      : [];
    const vehicles = territoryVehicles.filter((vehicle) => vehicle.warehouseId === tm.warehouseId!);
    const availableVehicles = territoryVehicles.filter((vehicle) => !vehicle.warehouseId);
    const users = await this.usersRepo.find({
      where: [
        { warehouseId: tm.warehouseId!, role: Role.TERRITORY_DISTRIBUTOR },
        { warehouseId: tm.warehouseId!, role: Role.SHOP_OWNER },
      ],
    });
    const catalog = await this.productsRepo.find({
      where: { status: ProductStatus.ACTIVE },
      order: { productName: 'ASC', packSize: 'ASC' },
    });

    return {
      message: 'Warehouse details fetched.',
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        address: warehouse.address,
        phoneNumber: warehouse.phoneNumber,
        latitude: warehouse.latitude,
        longitude: warehouse.longitude,
        territoryId: warehouse.territoryId,
        territory: (warehouse as any).territory?.name ?? null,
        inventory: warehouse.inventoryItems.map((item) => ({
          id: item.id,
          productId: item.productId,
          productName: item.product?.productName ?? null,
          sku: item.product?.sku ?? null,
          packSize: item.product?.packSize ?? null,
          imageUrl: item.product?.imageUrl ?? null,
          quantityOnHand: item.quantityOnHand,
          reorderLevel: item.reorderLevel,
          maxCapacityCases: item.maxCapacityCases,
          status:
            item.product?.status !== 'ACTIVE'
              ? 'INACTIVE_PRODUCT'
              : item.quantityOnHand <= item.reorderLevel
                ? 'LOW_STOCK'
                : 'HEALTHY',
        })),
        vehicles: vehicles.map((v) => ({
          id: v.id,
          vehicleCode: v.vehicleCode,
          registrationNumber: v.registrationNumber,
          label: v.label,
          type: v.type,
          capacityCases: v.capacityCases,
          status: v.status,
        })),
        availableVehicles: availableVehicles.map((v) => ({
          id: v.id,
          vehicleCode: v.vehicleCode,
          registrationNumber: v.registrationNumber,
          label: v.label,
          type: v.type,
          capacityCases: v.capacityCases,
          status: v.status,
        })),
        catalog: catalog.map((product) => ({
          id: product.id,
          productName: product.productName,
          sku: product.sku,
          packSize: product.packSize,
          imageUrl: product.imageUrl,
          casePrice: product.casePrice,
        })),
        users: users.map((u) => ({
          id: u.id,
          publicUserCode: u.publicUserCode,
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          email: u.email,
          phoneNumber: u.phoneNumber,
          role: u.role,
          accountStatus: u.accountStatus,
          approvalStatus: u.approvalStatus,
          shopName: u.shopName ?? null,
          address: u.address ?? null,
        })),
      },
    };
  }

  async getUserDetail(tmUserId: string, targetUserId: string) {
    const tm = await this.requireTm(tmUserId);

    const user = await this.usersRepo.findOne({ where: { id: targetUserId } });
    if (!user) throw new NotFoundException('User not found.');

    const allowedRoles = [Role.TERRITORY_DISTRIBUTOR, Role.SHOP_OWNER];
    if (!allowedRoles.includes(user.role)) {
      throw new BadRequestException('You can only view distributor and shop owner profiles.');
    }
    if (user.warehouseId !== tm.warehouseId) {
      throw new BadRequestException('This user is not assigned to your warehouse.');
    }

    return {
      message: 'User details fetched.',
      user: {
        id: user.id,
        publicUserCode: user.publicUserCode,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        phoneNumber: user.phoneNumber,
        nic: user.nic,
        employeeId: user.employeeId,
        role: user.role,
        accountStatus: user.accountStatus,
        approvalStatus: user.approvalStatus,
        shopName: user.shopName,
        address: user.address,
        latitude: user.latitude,
        longitude: user.longitude,
        createdAt: user.createdAt,
      },
    };
  }

  async addInventoryItem(tmUserId: string, dto: AddInventoryItemDto) {
    const tm = await this.requireTm(tmUserId);

    const product = await this.productsRepo.findOne({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found.');

    if (dto.quantityOnHand > dto.maxCapacityCases) {
      throw new BadRequestException('Cases on hand cannot exceed the maximum capacity.');
    }

    if (dto.reorderLevel > dto.maxCapacityCases) {
      throw new BadRequestException('Refill level cannot exceed the maximum capacity.');
    }

    const existing = await this.inventoryRepo.findOne({
      where: { warehouseId: tm.warehouseId!, productId: dto.productId },
    });

    if (existing) {
      existing.quantityOnHand = dto.quantityOnHand;
      existing.reorderLevel = dto.reorderLevel;
      existing.maxCapacityCases = dto.maxCapacityCases;
      await this.inventoryRepo.save(existing);
      return { message: 'Inventory item updated.' };
    }

    const item = this.inventoryRepo.create({
      warehouseId: tm.warehouseId!,
      productId: dto.productId,
      quantityOnHand: dto.quantityOnHand,
      reorderLevel: dto.reorderLevel,
      maxCapacityCases: dto.maxCapacityCases,
    });

    await this.inventoryRepo.save(item);
    return { message: 'Inventory item added.' };
  }

  async createVehicle(tmUserId: string, dto: CreateTmVehicleDto) {
    const tm = await this.requireTm(tmUserId);

    if (!tm.territoryId) {
      throw new BadRequestException('You are not assigned to a territory.');
    }

    const normalizedRegistration = dto.registrationNumber.trim().toUpperCase();
    const normalizedLabel = dto.label.trim();
    const normalizedType = dto.type?.trim().toUpperCase() || 'VAN';

    if (!normalizedLabel) {
      throw new BadRequestException('Vehicle label is required.');
    }

    const existingRegistration = await this.vehiclesRepo.findOne({
      where: { registrationNumber: normalizedRegistration },
    });
    if (existingRegistration) {
      throw new BadRequestException('A vehicle with this registration number already exists.');
    }

    const vehicleCode = await this.buildUniqueVehicleCode(
      dto.vehicleCode?.trim() || normalizedRegistration,
    );

    const vehicle = this.vehiclesRepo.create({
      territoryId: tm.territoryId,
      warehouseId: tm.warehouseId!,
      vehicleCode,
      registrationNumber: normalizedRegistration,
      label: normalizedLabel,
      type: normalizedType,
      capacityCases: dto.capacityCases,
      status: 'ACTIVE',
    });

    await this.vehiclesRepo.save(vehicle);

    return {
      message: 'Vehicle created and assigned to your warehouse.',
      vehicle: {
        id: vehicle.id,
        vehicleCode: vehicle.vehicleCode,
        registrationNumber: vehicle.registrationNumber,
        label: vehicle.label,
        type: vehicle.type,
        capacityCases: vehicle.capacityCases,
        status: vehicle.status,
      },
    };
  }

  async assignVehicle(tmUserId: string, vehicleId: string) {
    const tm = await this.requireTm(tmUserId);

    const vehicle = await this.vehiclesRepo.findOne({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found.');

    if (vehicle.territoryId !== tm.territoryId) {
      throw new BadRequestException('Vehicle does not belong to your territory.');
    }
    if (vehicle.warehouseId && vehicle.warehouseId !== tm.warehouseId) {
      throw new BadRequestException('Vehicle is already assigned to another warehouse.');
    }
    if (vehicle.warehouseId === tm.warehouseId) {
      return { message: 'Vehicle is already assigned to your warehouse.' };
    }

    await this.vehiclesRepo.update(vehicleId, { warehouseId: tm.warehouseId! });
    return { message: 'Vehicle assigned to your warehouse.' };
  }

  private async requireTm(tmUserId: string) {
    const tm = await this.usersRepo.findOne({ where: { id: tmUserId } });
    if (!tm?.warehouseId) {
      throw new BadRequestException('You are not assigned to a warehouse.');
    }
    return tm;
  }

  private async buildUniqueVehicleCode(seed: string) {
    const normalizedSeed = seed
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    const baseCode = normalizedSeed || `TM-${Date.now().toString().slice(-6)}`;
    let candidate = baseCode;
    let suffix = 1;

    while (await this.vehiclesRepo.findOne({ where: { vehicleCode: candidate } })) {
      const suffixLabel = `-${suffix}`;
      candidate = `${baseCode.slice(0, 40 - suffixLabel.length)}${suffixLabel}`;
      suffix += 1;
    }

    return candidate;
  }
}
