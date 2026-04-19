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

import { RouteApprovalRequest } from './route-approval-request.entity';
import { RouteBeatPlanItem } from './route-beat-plan-item.entity';
import { Territory } from '../../territories/entities/territory.entity';
import { User } from '../../users/entities/user.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';

export enum SalesRouteStatus {
  DRAFT = 'DRAFT',
  AWAITING_LOAD_APPROVAL = 'AWAITING_LOAD_APPROVAL',
  APPROVED_TO_START = 'APPROVED_TO_START',
  IN_PROGRESS = 'IN_PROGRESS',
  CLOSED = 'CLOSED',
}

export interface SalesRouteStockLine {
  productId: string;
  productName: string;
  quantityCases: number;
  quantityUnits: number;
}

@Entity('sales_routes')
export class SalesRoute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sales_rep_id' })
  salesRep: User;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true })
  vehicleId: string | null;

  @ManyToOne(() => Vehicle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle | null;

  @Column({ name: 'territory_id', type: 'uuid', nullable: true })
  territoryId: string | null;

  @ManyToOne(() => Territory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'territory_id' })
  territory: Territory | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: SalesRouteStatus.DRAFT,
  })
  status: SalesRouteStatus;

  @Column({ name: 'opening_stock_json', type: 'jsonb', nullable: true })
  openingStockJson: SalesRouteStockLine[] | null;

  @Column({ name: 'closing_stock_json', type: 'jsonb', nullable: true })
  closingStockJson: SalesRouteStockLine[] | null;

  @Column({ name: 'variance_json', type: 'jsonb', nullable: true })
  varianceJson: Record<string, unknown>[] | null;

  @Column({ name: 'return_items_json', type: 'jsonb', nullable: true, default: null })
  returnItemsJson: any[] | null;

  @Column({ name: 'delivery_order_ids_json', type: 'jsonb', nullable: true, default: null })
  deliveryOrderIdsJson: string[] | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @Column({
    name: 'warehouse_manager_pin_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  warehouseManagerPinHash: string | null;

  @Column({ name: 'pin_expires_at', type: 'timestamp', nullable: true })
  pinExpiresAt: Date | null;

  @OneToMany(() => RouteBeatPlanItem, (item) => item.route)
  beatPlanItems: RouteBeatPlanItem[];

  @OneToMany(() => RouteApprovalRequest, (request) => request.route)
  approvalRequests: RouteApprovalRequest[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
