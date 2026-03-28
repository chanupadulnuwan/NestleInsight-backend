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

import { User } from '../../users/entities/user.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { DeliveryAssignmentOrder } from './delivery-assignment-order.entity';

@Entity('delivery_assignments')
export class DeliveryAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'territory_manager_id', type: 'uuid' })
  territoryManagerId: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'territory_manager_id' })
  territoryManager: User;

  @Column({ name: 'distributor_id', type: 'uuid' })
  distributorId: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'distributor_id' })
  distributor: User;

  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId: string | null;

  @ManyToOne(() => Vehicle, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle | null;

  @Column({ name: 'delivery_date', type: 'date' })
  deliveryDate: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: string; // ACTIVE | COMPLETED | CANCELLED

  @Column({ name: 'tm_return_pin_hash', type: 'varchar', length: 255, nullable: true })
  tmReturnPinHash: string | null;

  @Column({ name: 'tm_return_pin_expires_at', type: 'timestamp', nullable: true })
  tmReturnPinExpiresAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => DeliveryAssignmentOrder, (dao) => dao.assignment, { cascade: true, eager: true })
  assignmentOrders: DeliveryAssignmentOrder[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
