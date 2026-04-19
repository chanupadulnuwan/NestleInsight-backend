BEGIN;

ALTER TABLE sales_routes
  ADD COLUMN IF NOT EXISTS delivery_order_ids_json jsonb DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS route_beat_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_rep_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  territory_id uuid NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  outlet_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_applied_at timestamp NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_beat_plan_template_scope
  ON route_beat_plan_templates (sales_rep_id, territory_id, warehouse_id);

CREATE TABLE IF NOT EXISTS route_beat_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES sales_routes(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  outlet_name_snapshot varchar(150) NOT NULL,
  owner_name_snapshot varchar(150) NULL,
  source varchar(30) NOT NULL,
  is_selected boolean NOT NULL DEFAULT TRUE,
  has_pending_delivery boolean NOT NULL DEFAULT FALSE,
  pending_delivery_count integer NOT NULL DEFAULT 0,
  pending_delivery_order_ids_json jsonb NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_beat_plan_items_route_id
  ON route_beat_plan_items (route_id);

CREATE INDEX IF NOT EXISTS idx_route_beat_plan_items_outlet_id
  ON route_beat_plan_items (outlet_id);

CREATE TABLE IF NOT EXISTS route_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES sales_routes(id) ON DELETE CASCADE,
  sales_rep_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'PENDING',
  requested_message text NOT NULL,
  requested_payload_json jsonb NOT NULL,
  approved_payload_json jsonb NULL,
  decision_note text NULL,
  reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp NULL,
  pin_hash varchar(255) NULL,
  pin_expires_at timestamp NULL,
  pin_verified_at timestamp NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_approval_requests_route_id
  ON route_approval_requests (route_id);

CREATE INDEX IF NOT EXISTS idx_route_approval_requests_sales_rep_id
  ON route_approval_requests (sales_rep_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_routes_open_vehicle
  ON sales_routes (vehicle_id)
  WHERE vehicle_id IS NOT NULL
    AND status IN ('DRAFT', 'AWAITING_LOAD_APPROVAL', 'APPROVED_TO_START', 'IN_PROGRESS');

COMMIT;
