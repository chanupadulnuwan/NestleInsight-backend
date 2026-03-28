import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Category } from '../../categories/entities/category.entity';
import { ProductStatus } from '../../common/enums/product-status.enum';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_name', type: 'varchar', length: 120 })
  productName: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  sku: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => Category, (category) => category.products, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @Column({ type: 'varchar', length: 80, nullable: true })
  brand: string | null;

  @Column({ name: 'pack_size', type: 'varchar', length: 60 })
  packSize: string;

  @Column({ name: 'unit_price', type: 'double precision' })
  unitPrice: number;

  @Column({ name: 'products_per_case', type: 'int' })
  productsPerCase: number;

  @Column({ name: 'case_price', type: 'double precision' })
  casePrice: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  barcode: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: ProductStatus.ACTIVE,
  })
  status: ProductStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
