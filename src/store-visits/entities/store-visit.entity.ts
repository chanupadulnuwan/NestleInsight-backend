import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SalesRoute } from '../../sales-routes/entities/sales-route.entity';
import { User } from '../../users/entities/user.entity';

export enum StoreVisitStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export interface StoreVisitStockLine {
  productId: string;
  productName: string;
  quantityCases: number;
  quantityUnits: number;
}

export interface StoreVisitIssueLine {
  productId: string;
  issueType: string;
  notes: string;
}

@Entity('store_visits')
export class StoreVisit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'route_id', type: 'uuid', nullable: true })
  routeId: string | null;

  @ManyToOne(() => SalesRoute, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'route_id' })
  route: SalesRoute | null;

  @Column({ name: 'route_session_id', type: 'uuid', nullable: true })
  routeSessionId: string | null;

  @Column({ name: 'stop_id', type: 'uuid', nullable: true })
  stopId: string | null;


  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sales_rep_id' })
  salesRep: User;

  @Column({ name: 'shop_id', type: 'uuid', nullable: true })
  shopId: string | null;

  @Column({ name: 'shop_name_snapshot', type: 'varchar', length: 150 })
  shopNameSnapshot: string;

  @Column({ name: 'territory_id', type: 'uuid', nullable: true })
  territoryId: string | null;

  @Column({ name: 'visit_started_at', type: 'timestamp' })
  visitStartedAt: Date;

  @Column({ name: 'visit_ended_at', type: 'timestamp', nullable: true })
  visitEndedAt: Date | null;

  @Column({ name: 'visit_start_time', type: 'timestamp', nullable: true })
  visitStartTime: Date | null;

  @Column({ name: 'visit_end_time', type: 'timestamp', nullable: true })
  visitEndTime: Date | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'duration_minutes', type: 'int', nullable: true })
  durationMinutes: number | null;

  @Column({ name: 'shelf_stock_json', type: 'jsonb', nullable: true })
  shelfStockJson: StoreVisitStockLine[] | null;

  @Column({ name: 'backroom_stock_json', type: 'jsonb', nullable: true })
  backroomStockJson: StoreVisitStockLine[] | null;

  @Column({ name: 'osa_issues_json', type: 'jsonb', nullable: true })
  osaIssuesJson: StoreVisitIssueLine[] | null;

  @Column({ name: 'promotions_json', type: 'jsonb', nullable: true })
  promotionsJson: Record<string, unknown>[] | null;

  @Column({ name: 'planogram_ok', type: 'boolean', nullable: true })
  planogramOk: boolean | null;

  @Column({ name: 'posm_ok', type: 'boolean', nullable: true })
  posmOk: boolean | null;

  @Column({ name: 'outlet_feedback', type: 'text', nullable: true })
  outletFeedback: string | null;

  @Column({
    name: 'estimated_sell_through_json',
    type: 'jsonb',
    nullable: true,
  })
  estimatedSellThroughJson: Record<string, unknown>[] | null;

  @Column({ name: 'suggested_order_json', type: 'jsonb', nullable: true })
  suggestedOrderJson: Record<string, unknown> | null;

  @Column({ name: 'last_order_date_snapshot', type: 'timestamp', nullable: true })
  lastOrderDateSnapshot: Date | null;

  @Column({ name: 'has_pending_delivery', type: 'boolean', default: false })
  hasPendingDelivery: boolean;

  @Column({
    type: 'jsonb',
    nullable: true,
    name: 'photo_urls',
  })
  photoUrls: string[] | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: StoreVisitStatus.IN_PROGRESS,
  })
  status: StoreVisitStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
