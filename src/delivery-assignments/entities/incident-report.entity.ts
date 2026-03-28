import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { DeliveryAssignment } from './delivery-assignment.entity';

@Entity('incident_reports')
export class IncidentReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId: string | null;

  @ManyToOne(() => DeliveryAssignment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: DeliveryAssignment | null;

  @Column({ name: 'reported_by', type: 'uuid' })
  reportedBy: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reported_by' })
  reporter: User;

  @Column({ name: 'incident_type', type: 'varchar', length: 50, default: 'OTHER' })
  incidentType: string; // VEHICLE_ACCIDENT | ROUTE_ISSUE | CUSTOMER_DISPUTE | OTHER

  @Column({ type: 'text', default: '' })
  description: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
