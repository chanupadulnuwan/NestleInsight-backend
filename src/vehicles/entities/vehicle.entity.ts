import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Territory } from '../../territories/entities/territory.entity';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'territory_id', type: 'uuid' })
  territoryId: string;

  @ManyToOne(() => Territory, (territory) => territory.vehicles, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'territory_id' })
  territory: Territory;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @ManyToOne(() => Warehouse, (warehouse) => warehouse.vehicles, {
    eager: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse | null;

  @Column({ name: 'vehicle_code', type: 'varchar', length: 40, unique: true })
  vehicleCode: string;

  @Column({
    name: 'registration_number',
    type: 'varchar',
    length: 40,
    unique: true,
  })
  registrationNumber: string;

  @Column({ type: 'varchar', length: 80 })
  label: string;

  @Column({ type: 'varchar', length: 40, default: 'VAN' })
  type: string;

  @Column({ name: 'capacity_cases', type: 'int', default: 0 })
  capacityCases: number;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
