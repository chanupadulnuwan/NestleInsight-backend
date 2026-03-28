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

import { AccountStatus } from '../../common/enums/account-status.enum';
import { ApprovalStatus } from '../../common/enums/approval-status.enum';
import { Platform } from '../../common/enums/platform.enum';
import { Role } from '../../common/enums/role.enum';
import { Territory } from '../../territories/entities/territory.entity';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'public_user_code',
    type: 'varchar',
    length: 50,
    unique: true,
    nullable: true,
  })
  publicUserCode: string | null;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 20, unique: true })
  phoneNumber: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({
    name: 'employee_id',
    type: 'varchar',
    length: 50,
    unique: true,
    nullable: true,
  })
  employeeId: string | null;

  @Column({
    name: 'nic',
    type: 'varchar',
    length: 50,
    unique: true,
    nullable: true,
  })
  nic: string | null;

  @Column({
    name: 'shop_name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  shopName: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  address: string | null;

  @Column({
    name: 'warehouse_name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  warehouseName: string | null;

  @Column({
    name: 'territory_id',
    type: 'uuid',
    nullable: true,
  })
  territoryId: string | null;

  @ManyToOne(() => Territory, (territory) => territory.users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'territory_id' })
  territory: Territory | null;

  @Column({
    name: 'warehouse_id',
    type: 'uuid',
    nullable: true,
  })
  warehouseId: string | null;

  @ManyToOne(() => Warehouse, (warehouse) => warehouse.users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse | null;

  @Column({
    type: 'double precision',
    nullable: true,
  })
  latitude: number | null;

  @Column({
    type: 'double precision',
    nullable: true,
  })
  longitude: number | null;

  @Column({
    type: 'enum',
    enum: Role,
  })
  role: Role;

  @Column({
    name: 'platform_access',
    type: 'enum',
    enum: Platform,
  })
  platformAccess: Platform;

  @Column({
    name: 'account_status',
    type: 'enum',
    enum: AccountStatus,
    default: AccountStatus.PENDING,
  })
  accountStatus: AccountStatus;

  @Column({
    name: 'approval_status',
    type: 'enum',
    enum: ApprovalStatus,
    default: ApprovalStatus.PENDING,
  })
  approvalStatus: ApprovalStatus;

  @Column({
    name: 'approved_by',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified: boolean;

  @Column({
    name: 'otp_code_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  otpCodeHash: string | null;

  @Column({ name: 'otp_expires_at', type: 'timestamp', nullable: true })
  otpExpiresAt: Date | null;

  @Column({ name: 'otp_last_sent_at', type: 'timestamp', nullable: true })
  otpLastSentAt: Date | null;

  @Column({ name: 'otp_verified_at', type: 'timestamp', nullable: true })
  otpVerifiedAt: Date | null;

  @OneToMany(() => Warehouse, (warehouse) => warehouse.managerUser)
  managedWarehouses: Warehouse[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
