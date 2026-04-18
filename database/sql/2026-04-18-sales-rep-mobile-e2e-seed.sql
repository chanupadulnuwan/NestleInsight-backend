BEGIN;

-- Existing-database-safe seed for the imported Nestle dump.
-- This script reuses the base territory / warehouse / product catalog already
-- present in the database instead of trying to recreate them.
--
-- Expected existing base data:
--   territory slug: north-territory
--   warehouse slug: north-warehouse
--   product SKUs: MILO-400G, NESCAFE-CLASSIC-200G, MAGGI-COCONUT-300G
--
-- Demo password for both seeded users:
-- Password123!
-- bcrypt hash generated with rounds=10.

-- Stable demo IDs
-- Regional manager: 33333333-3333-4333-8333-333333333333
-- Sales rep: 44444444-4444-4444-8444-444444444444
-- Vehicle: 77777777-7777-4777-8777-777777777777
-- Outlet 1: 55555555-5555-4555-8555-555555555555
-- Outlet 2: 66666666-6666-4666-8666-666666666666

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM territories
    WHERE slug = 'north-territory'
  ) THEN
    RAISE EXCEPTION
      'Required territory "north-territory" was not found. Import the existing Nestle base dump first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM warehouses
    WHERE slug = 'north-warehouse'
  ) THEN
    RAISE EXCEPTION
      'Required warehouse "north-warehouse" was not found. Import the existing Nestle base dump first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM products
    WHERE sku = 'MILO-400G'
  ) THEN
    RAISE EXCEPTION
      'Required product SKU "MILO-400G" was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM products
    WHERE sku = 'NESCAFE-CLASSIC-200G'
  ) THEN
    RAISE EXCEPTION
      'Required product SKU "NESCAFE-CLASSIC-200G" was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM products
    WHERE sku = 'MAGGI-COCONUT-300G'
  ) THEN
    RAISE EXCEPTION
      'Required product SKU "MAGGI-COCONUT-300G" was not found.';
  END IF;
END $$;

-- Reset generated route/report activity for the seeded sales rep.
DELETE FROM daily_reports
WHERE sales_rep_id = '44444444-4444-4444-8444-444444444444';

DELETE FROM sales_incidents
WHERE sales_rep_id = '44444444-4444-4444-8444-444444444444';

DELETE FROM store_visits
WHERE sales_rep_id = '44444444-4444-4444-8444-444444444444';

DELETE FROM van_load_requests
WHERE route_id IN (
  SELECT id
  FROM sales_routes
  WHERE sales_rep_id = '44444444-4444-4444-8444-444444444444'
);

DELETE FROM sales_routes
WHERE sales_rep_id = '44444444-4444-4444-8444-444444444444';

DELETE FROM activity_logs
WHERE user_id IN (
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

INSERT INTO users (
  id,
  public_user_code,
  first_name,
  last_name,
  username,
  email,
  phone_number,
  password_hash,
  employee_id,
  nic,
  shop_name,
  address,
  warehouse_name,
  territory_id,
  warehouse_id,
  latitude,
  longitude,
  role,
  platform_access,
  account_status,
  approval_status,
  approved_by,
  approved_at,
  rejection_reason,
  is_email_verified,
  otp_code_hash,
  otp_expires_at,
  otp_last_sent_at,
  otp_verified_at
)
SELECT
  '33333333-3333-4333-8333-333333333333',
  NULL,
  'Ruwan',
  'Manager',
  'rm.demo',
  'rm.demo@nestleinsight.local',
  '+94770000011',
  '$2b$10$t1rwKkGnhKHgr1fg/9oGG.ykNCIhmVSTsExR2kHH0THpdz/GJ6HMq',
  'RM-DEMO-001',
  '900000001V',
  NULL,
  'North Regional Office',
  warehouse.name,
  territory.id,
  warehouse.id,
  territory.latitude,
  territory.longitude,
  'REGIONAL_MANAGER',
  'WEB',
  'ACTIVE',
  'APPROVED',
  'seed-script',
  NOW(),
  NULL,
  TRUE,
  NULL,
  NULL,
  NULL,
  NOW()
FROM territories territory
JOIN warehouses warehouse
  ON warehouse.slug = 'north-warehouse'
 AND warehouse.territory_id = territory.id
WHERE territory.slug = 'north-territory'
ON CONFLICT (id) DO UPDATE
SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  phone_number = EXCLUDED.phone_number,
  password_hash = EXCLUDED.password_hash,
  employee_id = EXCLUDED.employee_id,
  nic = EXCLUDED.nic,
  address = EXCLUDED.address,
  warehouse_name = EXCLUDED.warehouse_name,
  territory_id = EXCLUDED.territory_id,
  warehouse_id = EXCLUDED.warehouse_id,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  role = EXCLUDED.role,
  platform_access = EXCLUDED.platform_access,
  account_status = EXCLUDED.account_status,
  approval_status = EXCLUDED.approval_status,
  approved_by = EXCLUDED.approved_by,
  approved_at = EXCLUDED.approved_at,
  is_email_verified = EXCLUDED.is_email_verified,
  otp_verified_at = EXCLUDED.otp_verified_at,
  updated_at = NOW();

INSERT INTO users (
  id,
  public_user_code,
  first_name,
  last_name,
  username,
  email,
  phone_number,
  password_hash,
  employee_id,
  nic,
  shop_name,
  address,
  warehouse_name,
  territory_id,
  warehouse_id,
  latitude,
  longitude,
  role,
  platform_access,
  account_status,
  approval_status,
  approved_by,
  approved_at,
  rejection_reason,
  is_email_verified,
  otp_code_hash,
  otp_expires_at,
  otp_last_sent_at,
  otp_verified_at
)
SELECT
  '44444444-4444-4444-8444-444444444444',
  NULL,
  'Saman',
  'Salesrep',
  'sr.demo',
  'sr.demo@nestleinsight.local',
  '+94770000012',
  '$2b$10$t1rwKkGnhKHgr1fg/9oGG.ykNCIhmVSTsExR2kHH0THpdz/GJ6HMq',
  'SR-DEMO-001',
  '900000002V',
  NULL,
  'North Territory Sales Route',
  warehouse.name,
  territory.id,
  warehouse.id,
  territory.latitude,
  territory.longitude,
  'SALES_REP',
  'MOBILE',
  'ACTIVE',
  'APPROVED',
  'seed-script',
  NOW(),
  NULL,
  TRUE,
  NULL,
  NULL,
  NULL,
  NOW()
FROM territories territory
JOIN warehouses warehouse
  ON warehouse.slug = 'north-warehouse'
 AND warehouse.territory_id = territory.id
WHERE territory.slug = 'north-territory'
ON CONFLICT (id) DO UPDATE
SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  phone_number = EXCLUDED.phone_number,
  password_hash = EXCLUDED.password_hash,
  employee_id = EXCLUDED.employee_id,
  nic = EXCLUDED.nic,
  address = EXCLUDED.address,
  warehouse_name = EXCLUDED.warehouse_name,
  territory_id = EXCLUDED.territory_id,
  warehouse_id = EXCLUDED.warehouse_id,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  role = EXCLUDED.role,
  platform_access = EXCLUDED.platform_access,
  account_status = EXCLUDED.account_status,
  approval_status = EXCLUDED.approval_status,
  approved_by = EXCLUDED.approved_by,
  approved_at = EXCLUDED.approved_at,
  is_email_verified = EXCLUDED.is_email_verified,
  otp_verified_at = EXCLUDED.otp_verified_at,
  updated_at = NOW();

INSERT INTO vehicles (
  id,
  territory_id,
  warehouse_id,
  vehicle_code,
  registration_number,
  label,
  type,
  capacity_cases,
  status
)
SELECT
  '77777777-7777-4777-8777-777777777777',
  territory.id,
  warehouse.id,
  'VAN-NORTH-01',
  'WP-NA-1001',
  'North Demo Van',
  'VAN',
  280,
  'ACTIVE'
FROM territories territory
JOIN warehouses warehouse
  ON warehouse.slug = 'north-warehouse'
 AND warehouse.territory_id = territory.id
WHERE territory.slug = 'north-territory'
ON CONFLICT (id) DO UPDATE
SET
  territory_id = EXCLUDED.territory_id,
  warehouse_id = EXCLUDED.warehouse_id,
  vehicle_code = EXCLUDED.vehicle_code,
  registration_number = EXCLUDED.registration_number,
  label = EXCLUDED.label,
  type = EXCLUDED.type,
  capacity_cases = EXCLUDED.capacity_cases,
  status = EXCLUDED.status,
  updated_at = NOW();

INSERT INTO warehouse_inventory_items (
  id,
  warehouse_id,
  product_id,
  quantity_on_hand,
  reorder_level,
  max_capacity_cases
)
SELECT
  CASE product.sku
    WHEN 'MILO-400G' THEN 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid
    WHEN 'NESCAFE-CLASSIC-200G' THEN 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid
    WHEN 'MAGGI-COCONUT-300G' THEN 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'::uuid
  END,
  warehouse.id,
  product.id,
  CASE product.sku
    WHEN 'MILO-400G' THEN 120
    WHEN 'NESCAFE-CLASSIC-200G' THEN 140
    WHEN 'MAGGI-COCONUT-300G' THEN 100
  END,
  CASE product.sku
    WHEN 'MILO-400G' THEN 12
    WHEN 'NESCAFE-CLASSIC-200G' THEN 12
    WHEN 'MAGGI-COCONUT-300G' THEN 10
  END,
  CASE product.sku
    WHEN 'MILO-400G' THEN 240
    WHEN 'NESCAFE-CLASSIC-200G' THEN 240
    WHEN 'MAGGI-COCONUT-300G' THEN 180
  END
FROM warehouses warehouse
JOIN products product
  ON product.sku IN ('MILO-400G', 'NESCAFE-CLASSIC-200G', 'MAGGI-COCONUT-300G')
WHERE warehouse.slug = 'north-warehouse'
ON CONFLICT (warehouse_id, product_id) DO UPDATE
SET
  quantity_on_hand = EXCLUDED.quantity_on_hand,
  reorder_level = EXCLUDED.reorder_level,
  max_capacity_cases = EXCLUDED.max_capacity_cases,
  updated_at = NOW();

INSERT INTO outlets (
  id,
  outlet_name,
  owner_name,
  owner_phone,
  owner_email,
  address,
  territory_id,
  warehouse_id,
  latitude,
  longitude,
  registered_by_sales_rep_id,
  status,
  rejection_reason,
  reviewed_by,
  reviewed_at
)
SELECT
  '55555555-5555-4555-8555-555555555555',
  'City Mini Mart',
  'Nimal Perera',
  '+94771111111',
  'city.mini.mart@example.com',
  'No. 101, Galle Road, Colombo 03',
  territory.id,
  warehouse.id,
  6.9041,
  79.8531,
  '44444444-4444-4444-8444-444444444444',
  'APPROVED',
  NULL,
  '33333333-3333-4333-8333-333333333333',
  NOW()
FROM territories territory
JOIN warehouses warehouse
  ON warehouse.slug = 'north-warehouse'
 AND warehouse.territory_id = territory.id
WHERE territory.slug = 'north-territory'
ON CONFLICT (id) DO UPDATE
SET
  outlet_name = EXCLUDED.outlet_name,
  owner_name = EXCLUDED.owner_name,
  owner_phone = EXCLUDED.owner_phone,
  owner_email = EXCLUDED.owner_email,
  address = EXCLUDED.address,
  territory_id = EXCLUDED.territory_id,
  warehouse_id = EXCLUDED.warehouse_id,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  registered_by_sales_rep_id = EXCLUDED.registered_by_sales_rep_id,
  status = EXCLUDED.status,
  rejection_reason = EXCLUDED.rejection_reason,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  updated_at = NOW();

INSERT INTO outlets (
  id,
  outlet_name,
  owner_name,
  owner_phone,
  owner_email,
  address,
  territory_id,
  warehouse_id,
  latitude,
  longitude,
  registered_by_sales_rep_id,
  status,
  rejection_reason,
  reviewed_by,
  reviewed_at
)
SELECT
  '66666666-6666-4666-8666-666666666666',
  'Lake View Stores',
  'Kamal Silva',
  '+94772222222',
  'lake.view.stores@example.com',
  'No. 44, Bauddhaloka Mawatha, Colombo 07',
  territory.id,
  warehouse.id,
  6.9020,
  79.8676,
  '44444444-4444-4444-8444-444444444444',
  'APPROVED',
  NULL,
  '33333333-3333-4333-8333-333333333333',
  NOW()
FROM territories territory
JOIN warehouses warehouse
  ON warehouse.slug = 'north-warehouse'
 AND warehouse.territory_id = territory.id
WHERE territory.slug = 'north-territory'
ON CONFLICT (id) DO UPDATE
SET
  outlet_name = EXCLUDED.outlet_name,
  owner_name = EXCLUDED.owner_name,
  owner_phone = EXCLUDED.owner_phone,
  owner_email = EXCLUDED.owner_email,
  address = EXCLUDED.address,
  territory_id = EXCLUDED.territory_id,
  warehouse_id = EXCLUDED.warehouse_id,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  registered_by_sales_rep_id = EXCLUDED.registered_by_sales_rep_id,
  status = EXCLUDED.status,
  rejection_reason = EXCLUDED.rejection_reason,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  updated_at = NOW();

SELECT
  territory.id AS territory_id,
  territory.name AS territory_name,
  warehouse.id AS warehouse_id,
  warehouse.name AS warehouse_name,
  sales_rep.id AS sales_rep_id,
  sales_rep.username AS sales_rep_username,
  manager.id AS manager_id,
  manager.username AS manager_username,
  vehicle.id AS vehicle_id,
  milo.id AS milo_product_id,
  nescafe.id AS nescafe_product_id,
  maggi.id AS maggi_product_id
FROM territories territory
JOIN warehouses warehouse
  ON warehouse.slug = 'north-warehouse'
 AND warehouse.territory_id = territory.id
JOIN users sales_rep
  ON sales_rep.id = '44444444-4444-4444-8444-444444444444'
JOIN users manager
  ON manager.id = '33333333-3333-4333-8333-333333333333'
JOIN vehicles vehicle
  ON vehicle.id = '77777777-7777-4777-8777-777777777777'
JOIN products milo
  ON milo.sku = 'MILO-400G'
JOIN products nescafe
  ON nescafe.sku = 'NESCAFE-CLASSIC-200G'
JOIN products maggi
  ON maggi.sku = 'MAGGI-COCONUT-300G'
WHERE territory.slug = 'north-territory';

COMMIT;
