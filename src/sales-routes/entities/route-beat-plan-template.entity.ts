import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('route_beat_plan_templates')
@Unique('uq_route_beat_plan_template_scope', ['salesRepId', 'territoryId', 'warehouseId'])
export class RouteBeatPlanTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @Column({ name: 'territory_id', type: 'uuid' })
  territoryId: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({ name: 'outlet_ids_json', type: 'jsonb' })
  outletIdsJson: string[];

  @Column({ name: 'last_applied_at', type: 'timestamp', nullable: true })
  lastAppliedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
