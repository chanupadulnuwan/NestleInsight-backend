import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('feedback_submissions')
export class FeedbackSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'varchar', length: 40, default: 'SUBMITTED' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
