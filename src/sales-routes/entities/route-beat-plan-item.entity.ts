import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SalesRoute } from './sales-route.entity';

export enum RouteBeatPlanSource {
  DUE = 'DUE',
  DELIVERY = 'DELIVERY',
  TEMPLATE = 'TEMPLATE',
  MANUAL = 'MANUAL',
}

@Entity('route_beat_plan_items')
export class RouteBeatPlanItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'route_id', type: 'uuid' })
  routeId: string;

  @ManyToOne(() => SalesRoute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_id' })
  route: SalesRoute;

  @Column({ name: 'outlet_id', type: 'uuid' })
  outletId: string;

  @Column({ name: 'outlet_name_snapshot', type: 'varchar', length: 150 })
  outletNameSnapshot: string;

  @Column({ name: 'owner_name_snapshot', type: 'varchar', length: 150, nullable: true })
  ownerNameSnapshot: string | null;

  @Column({ type: 'varchar', length: 30 })
  source: RouteBeatPlanSource;

  @Column({ name: 'is_selected', type: 'boolean', default: true })
  isSelected: boolean;

  @Column({ name: 'has_pending_delivery', type: 'boolean', default: false })
  hasPendingDelivery: boolean;

  @Column({ name: 'pending_delivery_count', type: 'int', default: 0 })
  pendingDeliveryCount: number;

  @Column({ name: 'pending_delivery_order_ids_json', type: 'jsonb', nullable: true })
  pendingDeliveryOrderIdsJson: string[] | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
