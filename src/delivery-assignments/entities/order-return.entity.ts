import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { DeliveryAssignment } from './delivery-assignment.entity';
import { ReturnItem } from './return-item.entity';

@Entity('order_returns')
export class OrderReturn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId: string | null;

  @ManyToOne(() => DeliveryAssignment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: DeliveryAssignment | null;

  @Column({ name: 'distributor_id', type: 'uuid' })
  distributorId: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'distributor_id' })
  distributor: User;

  @Column({ name: 'return_type', type: 'varchar', length: 20, default: 'WAREHOUSE' })
  returnType: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'tm_verified', type: 'boolean', default: false })
  tmVerified: boolean;

  @Column({ name: 'verification_note', type: 'text', nullable: true })
  verificationNote: string | null;

  @OneToMany(() => ReturnItem, (item) => item.orderReturn, { cascade: true, eager: true })
  items: ReturnItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
