import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('promotions')
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'code', type: 'varchar', length: 50, unique: true, nullable: true })
  code: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'start_date', type: 'timestamp' })
  startDate: Date;

  @Column({ name: 'end_date', type: 'timestamp' })
  endDate: Date;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'draft' })
  status: string;

  @Column({ name: 'promotion_type', type: 'varchar', length: 50 })
  promotionType: string;

  @Column({ name: 'discount_type', type: 'varchar', length: 50 })
  discountType: string;

  @Column({ name: 'discount_value', type: 'decimal', precision: 12, scale: 2 })
  discountValue: number;

  @Column({ name: 'min_quantity', type: 'int', nullable: true })
  minQuantity: number | null;

  @Column({ name: 'min_order_value', type: 'decimal', precision: 12, scale: 2, nullable: true })
  minOrderValue: number | null;

  @Column({ name: 'usage_limit', type: 'int', nullable: true })
  usageLimit: number | null;

  @Column({ name: 'per_shop_limit', type: 'int', nullable: true })
  perShopLimit: number | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
