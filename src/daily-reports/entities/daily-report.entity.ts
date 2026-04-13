import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SalesRoute } from '../../sales-routes/entities/sales-route.entity';
import { User } from '../../users/entities/user.entity';

export enum DailyReportStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
}

@Entity('daily_reports')
export class DailyReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sales_rep_id' })
  salesRep: User;

  @Column({ name: 'route_id', type: 'uuid', nullable: true })
  routeId: string | null;

  @ManyToOne(() => SalesRoute, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'route_id' })
  route: SalesRoute | null;

  @Column({ name: 'report_date', type: 'date' })
  reportDate: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: DailyReportStatus.DRAFT,
  })
  status: DailyReportStatus;

  @Column({ name: 'route_summary_json', type: 'jsonb', nullable: true })
  routeSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'visit_summary_json', type: 'jsonb', nullable: true })
  visitSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'osa_summary_json', type: 'jsonb', nullable: true })
  osaSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'delivery_summary_json', type: 'jsonb', nullable: true })
  deliverySummaryJson: Record<string, unknown> | null;

  @Column({ name: 'return_summary_json', type: 'jsonb', nullable: true })
  returnSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'incident_summary_json', type: 'jsonb', nullable: true })
  incidentSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'rep_comments', type: 'text', nullable: true })
  repComments: string | null;

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
