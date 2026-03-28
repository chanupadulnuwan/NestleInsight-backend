import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from '../../orders/entities/order.entity';
import { DeliveryAssignment } from './delivery-assignment.entity';

@Entity('delivery_assignment_orders')
export class DeliveryAssignmentOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @ManyToOne(() => DeliveryAssignment, (a) => a.assignmentOrders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: DeliveryAssignment;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @ManyToOne(() => Order, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'shop_pin_hash', type: 'varchar', length: 255, nullable: true })
  shopPinHash: string | null;

  @Column({ name: 'shop_pin_expires_at', type: 'timestamp', nullable: true })
  shopPinExpiresAt: Date | null;

  @Column({ name: 'shop_return_pin_hash', type: 'varchar', length: 255, nullable: true })
  shopReturnPinHash: string | null;

  @Column({ name: 'shop_return_pin_expires_at', type: 'timestamp', nullable: true })
  shopReturnPinExpiresAt: Date | null;
}
