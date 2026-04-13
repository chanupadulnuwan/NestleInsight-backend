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

export enum VanLoadRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ADJUSTED = 'ADJUSTED',
}

export interface VanLoadRequestStockLine {
  productId: string;
  productName: string;
  quantityCases: number;
}

@Entity('van_load_requests')
export class VanLoadRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'route_id', type: 'uuid' })
  routeId: string;

  @ManyToOne(() => SalesRoute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_id' })
  route: SalesRoute;

  @Column({
    type: 'varchar',
    length: 30,
    default: VanLoadRequestStatus.PENDING,
  })
  status: VanLoadRequestStatus;

  @Column({ name: 'delivery_stock_json', type: 'jsonb' })
  deliveryStockJson: VanLoadRequestStockLine[];

  @Column({ name: 'free_sale_stock_json', type: 'jsonb' })
  freeSaleStockJson: VanLoadRequestStockLine[];

  @Column({ name: 'manager_notes', type: 'text', nullable: true })
  managerNotes: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
