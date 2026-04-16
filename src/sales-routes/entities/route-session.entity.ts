import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('route_sessions')
export class RouteSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'role', type: 'varchar', length: 50 })
  role: string;

  @Column({ name: 'territory_id', type: 'uuid' })
  territoryId: string;

  @Column({ name: 'route_date', type: 'timestamp' })
  routeDate: Date;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'pending' })
  status: string;

  @Column({ name: 'start_time', type: 'timestamp', nullable: true })
  startTime: Date | null;

  @Column({ name: 'end_time', type: 'timestamp', nullable: true })
  endTime: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
