import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { RoutePlanStop } from './route-plan-stop.entity';

@Entity('route_stop_events')
export class RouteStopEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'stop_id', type: 'uuid' })
  stopId: string;

  @ManyToOne(() => RoutePlanStop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stop_id' })
  stop: RoutePlanStop;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: string;

  @Column({ name: 'event_time', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  eventTime: Date;

  @Column({ name: 'reason_code', type: 'varchar', length: 50, nullable: true })
  reasonCode: string | null;

  @Column({ name: 'free_text_reason', type: 'text', nullable: true })
  freeTextReason: string | null;

  @Column({ name: 'triggered_by_user_id', type: 'uuid' })
  triggeredByUserId: string;
}
