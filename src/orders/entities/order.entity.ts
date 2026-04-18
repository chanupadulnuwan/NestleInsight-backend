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
import { Warehouse } from '../../warehouses/entities/warehouse.entity';
import { OrderItem } from './order-item.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_code', type: 'varchar', length: 50, unique: true })
  orderCode: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'shop_name_snapshot', type: 'varchar', length: 150 })
  shopNameSnapshot: string;

  @Column({ name: 'territory_id', type: 'uuid', nullable: true })
  territoryId: string | null;

  @ManyToOne(() => Territory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'territory_id' })
  territory: Territory | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse | null;

  @Column({ type: 'varchar', length: 30, default: 'PLACED' })
  status: string;

  @Column({ type: 'varchar', length: 30, default: 'SHOP_OWNER' })
  source: string;

  @Column({
    name: 'assisted_reason',
    type: 'varchar',
    length: 250,
    nullable: true,
  })
  assistedReason: string | null;

  @Column({
    name: 'confirmation_pin',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  confirmationPin: string | null;

  @Column({ name: 'currency_code', type: 'varchar', length: 10, default: 'LKR' })
  currencyCode: string;

  @Column({ name: 'total_amount', type: 'double precision' })
  totalAmount: number;

  @Column({
    name: 'placed_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  placedAt: Date;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'delay_reason', type: 'text', nullable: true })
  delayReason: string | null;

  @Column({ name: 'customer_note', type: 'text', nullable: true })
  customerNote: string | null;

  @Column({ name: 'delayed_at', type: 'timestamp', nullable: true })
  delayedAt: Date | null;

  @Column({ name: 'delayed_by', type: 'uuid', nullable: true })
  delayedBy: string | null;

  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId: string | null;

  @Column({ name: 'applied_promotion_id', type: 'uuid', nullable: true })
  appliedPromotionId: string | null;

  @Column({ name: 'applied_promotion_code', type: 'varchar', length: 50, nullable: true })
  appliedPromotionCode: string | null;

  @Column({ name: 'subtotal_before_discount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  subtotalBeforeDiscount: number | null;

  @Column({ name: 'promotion_discount_total', type: 'decimal', precision: 12, scale: 2, nullable: true })
  promotionDiscountTotal: number | null;

  @Column({ name: 'total_after_discount', type: 'decimal', precision: 12, scale: 2, nullable: true })
  totalAfterDiscount: number | null;

  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
