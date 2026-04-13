import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

export enum OutletStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('outlets')
export class Outlet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'outlet_name', type: 'varchar', length: 150 })
  outletName: string;

  @Column({ name: 'owner_name', type: 'varchar', length: 150 })
  ownerName: string;

  @Column({ name: 'owner_phone', type: 'varchar', length: 20, nullable: true })
  ownerPhone: string | null;

  @Column({ name: 'owner_email', type: 'varchar', length: 150, nullable: true })
  ownerEmail: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'territory_id', type: 'uuid', nullable: true })
  territoryId: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({
    name: 'registered_by_sales_rep_id',
    type: 'uuid',
    nullable: true,
  })
  registeredBySalesRepId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'registered_by_sales_rep_id' })
  registeredBySalesRep: User | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: OutletStatus.PENDING_APPROVAL,
  })
  status: OutletStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
