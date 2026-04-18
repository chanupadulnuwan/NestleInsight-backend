BEGIN;

-- Shortcut helper for the seeded demo flow.
-- Approves the latest pending load request for sr.demo and sets the start/close
-- PIN to 123456.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM sales_routes
    WHERE sales_rep_id = '44444444-4444-4444-8444-444444444444'
      AND status = 'AWAITING_LOAD_APPROVAL'
  ) THEN
    RAISE EXCEPTION
      'No AWAITING_LOAD_APPROVAL route was found for sr.demo. Create a route and submit a load request first.';
  END IF;
END $$;

WITH target_route AS (
  SELECT id
  FROM sales_routes
  WHERE sales_rep_id = '44444444-4444-4444-8444-444444444444'
    AND status = 'AWAITING_LOAD_APPROVAL'
  ORDER BY created_at DESC
  LIMIT 1
),
latest_request AS (
  SELECT
    van_load_request.id,
    van_load_request.route_id,
    van_load_request.delivery_stock_json,
    van_load_request.free_sale_stock_json
  FROM van_load_requests van_load_request
  INNER JOIN target_route route
    ON route.id = van_load_request.route_id
  ORDER BY van_load_request.created_at DESC
  LIMIT 1
),
reviewed_request AS (
  UPDATE van_load_requests
  SET
    status = 'APPROVED',
    manager_notes = 'Approved from SQL helper for mobile E2E testing.',
    reviewed_by = '33333333-3333-4333-8333-333333333333',
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id IN (SELECT id FROM latest_request)
  RETURNING id, route_id, delivery_stock_json, free_sale_stock_json
)
UPDATE sales_routes route
SET
  status = 'APPROVED_TO_START',
  opening_stock_json =
    COALESCE((SELECT delivery_stock_json FROM reviewed_request), '[]'::jsonb) ||
    COALESCE((SELECT free_sale_stock_json FROM reviewed_request), '[]'::jsonb),
  warehouse_manager_pin_hash = '$2b$10$t1rwKkGnhKHgr1fg/9oGG.ykNCIhmVSTsExR2kHH0THpdz/GJ6HMq',
  pin_expires_at = NOW() + INTERVAL '30 minutes',
  updated_at = NOW()
WHERE route.id IN (SELECT route_id FROM reviewed_request);

SELECT
  route.id AS route_id,
  route.status,
  route.pin_expires_at,
  '123456' AS start_pin
FROM sales_routes route
WHERE route.sales_rep_id = '44444444-4444-4444-8444-444444444444'
ORDER BY route.created_at DESC
LIMIT 1;

COMMIT;
