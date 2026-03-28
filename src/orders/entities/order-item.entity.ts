import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Product } from '../../products/entities/product.entity';
import { Order } from './order.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ name: 'sku_snapshot', type: 'varchar', length: 80 })
  skuSnapshot: string;

  @Column({ name: 'product_name_snapshot', type: 'varchar', length: 160 })
  productNameSnapshot: string;

  @Column({ name: 'pack_size_snapshot', type: 'varchar', length: 60, nullable: true })
  packSizeSnapshot: string | null;

  @Column({
    name: 'image_url_snapshot',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  imageUrlSnapshot: string | null;

  @Column({ name: 'case_price_snapshot', type: 'double precision' })
  casePriceSnapshot: number;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'line_total', type: 'double precision' })
  lineTotal: number;
}
