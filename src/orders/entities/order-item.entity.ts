import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @Column({ name: 'product_code', type: 'varchar', length: 60 })
  productCode: string;

  @Column({ name: 'product_name', type: 'varchar', length: 160 })
  productName: string;

  @Column({
    name: 'image_asset_path',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  imageAssetPath: string | null;

  @Column({ name: 'unit_price', type: 'double precision' })
  unitPrice: number;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'line_total', type: 'double precision' })
  lineTotal: number;
}
