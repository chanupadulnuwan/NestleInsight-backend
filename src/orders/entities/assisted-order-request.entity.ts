import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Order } from './order.entity';

export enum AssistedOrderRequestStatus {
  DRAFT = 'DRAFT',
  PENDING_SHOP_PIN = 'PENDING_SHOP_PIN',
  CONFIRMED = 'CONFIRMED',
  EXPIRED = 'EXPIRED',
}

export interface AssistedOrderRequestItemSnapshot {
  productId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  packSizeSnapshot: string | null;
  imageUrlSnapshot: string | null;
  casePriceSnapshot: number;
  quantity: number;
  lineTotal: number;
}

@Entity('assisted_order_requests')
export class AssistedOrderRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'route_id', type: 'uuid' })
  routeId: string;

  @Column({ name: 'shop_id', type: 'uuid' })
  shopId: string;

  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @Column({ name: 'shop_owner_user_id', type: 'uuid', nullable: true })
  shopOwnerUserId: string | null;

  @Column({ name: 'shop_name_snapshot', type: 'varchar', length: 150 })
  shopNameSnapshot: string;

  @Column({ name: 'territory_id', type: 'uuid', nullable: true })
  territoryId: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({
    name: 'assisted_reason',
    type: 'varchar',
    length: 250,
    nullable: true,
  })
  assistedReason: string | null;

  @Column({ name: 'pin_hash', type: 'varchar', length: 255, nullable: true })
  pinHash: string | null;

  @Column({ name: 'pin_expires_at', type: 'timestamp', nullable: true })
  pinExpiresAt: Date | null;

  @Column({
    type: 'varchar',
    length: 40,
    default: AssistedOrderRequestStatus.PENDING_SHOP_PIN,
  })
  status: AssistedOrderRequestStatus;

  @Column({ name: 'items_json', type: 'jsonb' })
  itemsJson: AssistedOrderRequestItemSnapshot[];

  @Column({ name: 'order_total', type: 'double precision' })
  orderTotal: number;

  @Column({ name: 'currency_code', type: 'varchar', length: 10, default: 'LKR' })
  currencyCode: string;

  @Column({ name: 'confirmed_order_id', type: 'uuid', nullable: true })
  confirmedOrderId: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'confirmed_order_id' })
  confirmedOrder: Order | null;

  @Column({ name: 'requested_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  requestedAt: Date;

  @Column({ name: 'confirmed_at', type: 'timestamp', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
