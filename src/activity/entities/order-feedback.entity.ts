import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from '../../orders/entities/order.entity';
import { User } from '../../users/entities/user.entity';

@Entity('order_feedbacks')
export class OrderFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The Shop Owner who submitted this feedback. */
  @Column({ name: 'shop_owner_id', type: 'uuid' })
  shopOwnerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shop_owner_id' })
  shopOwner: User;

  /** The completed order this feedback is about. */
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  /** Star rating between 1 and 5. */
  @Column({ type: 'smallint' })
  rating: number;

  /** Optional written comment from the shop owner. */
  @Column({ type: 'text', nullable: true })
  comment: string | null;

  /**
   * Denormalised territory so the TM lookup is instant
   * and survives potential user territory re-assignments.
   */
  @Column({ name: 'territory_id', type: 'uuid' })
  territoryId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
