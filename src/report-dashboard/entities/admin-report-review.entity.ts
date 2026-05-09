import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DailyReport } from '../../daily-reports/entities/daily-report.entity';
import { User } from '../../users/entities/user.entity';

export type AdminReportReviewStatus = 'READ' | 'SAVED' | 'CRITICAL' | 'WARNED';

@Entity('admin_report_reviews')
export class AdminReportReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'daily_report_id', type: 'uuid', unique: true })
  dailyReportId: string;

  @ManyToOne(() => DailyReport, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'daily_report_id' })
  dailyReport: DailyReport;

  @Column({ name: 'reviewed_by_id', type: 'uuid' })
  reviewedById: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy: User;

  @Column({ type: 'varchar', length: 20, default: 'READ' })
  status: AdminReportReviewStatus;

  @Column({ name: 'critical_reason', type: 'text', nullable: true })
  criticalReason: string | null;

  @Column({ name: 'warned_reason', type: 'text', nullable: true })
  warnedReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
