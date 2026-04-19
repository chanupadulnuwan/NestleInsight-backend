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

export enum RouteApprovalRequestType {
  DELIVERY_ORDERS = 'DELIVERY_ORDERS',
}

export enum RouteApprovalRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('route_approval_requests')
export class RouteApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'route_id', type: 'uuid' })
  routeId: string;

  @ManyToOne(() => SalesRoute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_id' })
  route: SalesRoute;

  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @Column({ type: 'varchar', length: 40 })
  type: RouteApprovalRequestType;

  @Column({ type: 'varchar', length: 30, default: RouteApprovalRequestStatus.PENDING })
  status: RouteApprovalRequestStatus;

  @Column({ name: 'requested_message', type: 'text' })
  requestedMessage: string;

  @Column({ name: 'requested_payload_json', type: 'jsonb' })
  requestedPayloadJson: Record<string, unknown>;

  @Column({ name: 'approved_payload_json', type: 'jsonb', nullable: true })
  approvedPayloadJson: Record<string, unknown> | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'pin_hash', type: 'varchar', length: 255, nullable: true })
  pinHash: string | null;

  @Column({ name: 'pin_expires_at', type: 'timestamp', nullable: true })
  pinExpiresAt: Date | null;

  @Column({ name: 'pin_verified_at', type: 'timestamp', nullable: true })
  pinVerifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
