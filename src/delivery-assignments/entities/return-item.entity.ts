import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Product } from '../../products/entities/product.entity';
import { OrderReturn } from './order-return.entity';

@Entity('return_items')
export class ReturnItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'return_id', type: 'uuid' })
  returnId: string;

  @ManyToOne(() => OrderReturn, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'return_id' })
  orderReturn: OrderReturn;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ name: 'product_name_snapshot', type: 'varchar', length: 200, default: '' })
  productNameSnapshot: string;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @Column({ type: 'text', default: '' })
  reason: string;
}
