import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Territory } from '../../territories/entities/territory.entity';
import { User } from '../../users/entities/user.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { WarehouseInventoryItem } from './warehouse-inventory-item.entity';

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'territory_id', type: 'uuid' })
  territoryId: string;

  @ManyToOne(() => Territory, (territory) => territory.warehouses, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'territory_id' })
  territory: Territory;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 180, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 255 })
  address: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 30 })
  phoneNumber: string;

  @Column({ name: 'manager_user_id', type: 'uuid', nullable: true })
  managerUserId: string | null;

  @ManyToOne(() => User, (user) => user.managedWarehouses, {
    eager: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'manager_user_id' })
  managerUser: User | null;

  @OneToMany(
    () => WarehouseInventoryItem,
    (inventoryItem) => inventoryItem.warehouse,
  )
  inventoryItems: WarehouseInventoryItem[];

  @OneToMany(() => User, (user) => user.warehouse)
  users: User[];

  @OneToMany(() => Vehicle, (vehicle) => vehicle.warehouse)
  vehicles: Vehicle[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
