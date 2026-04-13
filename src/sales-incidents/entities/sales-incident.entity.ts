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

export enum SalesIncidentType {
  FUEL_ISSUE = 'FUEL_ISSUE',
  VEHICLE_ISSUE = 'VEHICLE_ISSUE',
  SUSPICIOUS_OUTLET = 'SUSPICIOUS_OUTLET',
  DELIVERY_ISSUE = 'DELIVERY_ISSUE',
  STOCK_ISSUE = 'STOCK_ISSUE',
  ROUTE_ISSUE = 'ROUTE_ISSUE',
  WAREHOUSE_ISSUE = 'WAREHOUSE_ISSUE',
  OTHER = 'OTHER',
}

export enum SalesIncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

@Entity('sales_incidents')
export class SalesIncident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sales_rep_id' })
  salesRep: User;

  @Column({ name: 'route_id', type: 'uuid', nullable: true })
  routeId: string | null;

  @Column({ name: 'shop_id', type: 'uuid', nullable: true })
  shopId: string | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'incident_type', type: 'varchar', length: 50 })
  incidentType: SalesIncidentType;

  @Column({ type: 'varchar', length: 20 })
  severity: SalesIncidentSeverity;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'included_in_report', type: 'boolean', default: false })
  includedInReport: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
