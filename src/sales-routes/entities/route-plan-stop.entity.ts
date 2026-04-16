import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { RouteSession } from './route-session.entity';

@Entity('route_plan_stops')
export class RoutePlanStop {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'route_session_id', type: 'uuid' })
  routeSessionId: string;

  @ManyToOne(() => RouteSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_session_id' })
  routeSession: RouteSession;

  @Column({ name: 'outlet_id', type: 'uuid' })
  outletId: string;

  @Column({ name: 'suggested_seq', type: 'int' })
  suggestedSeq: number;

  @Column({ name: 'actual_seq', type: 'int', nullable: true })
  actualSeq: number | null;

  @Column({ name: 'purpose', type: 'varchar', length: 150 })
  purpose: string;

  @Column({ name: 'priority_score', type: 'decimal', precision: 5, scale: 2, nullable: true })
  priorityScore: number | null;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'pending' })
  status: string;

  @Column({ name: 'eta_minutes', type: 'int', nullable: true })
  etaMinutes: number | null;

  @Column({ name: 'distance_km', type: 'decimal', precision: 8, scale: 2, nullable: true })
  distanceKm: number | null;
}
