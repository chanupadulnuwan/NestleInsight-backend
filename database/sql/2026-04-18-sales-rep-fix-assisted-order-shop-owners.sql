BEGIN;

-- Creates or refreshes active demo shop-owner accounts that match the seeded
-- sales-rep outlets so assisted orders request a PIN instead of falling back
-- to DRAFT.
--
-- Demo credentials after this script:
--   so.city.demo / Password123!
--   so.lake.demo / Password123!

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM outlets
    WHERE id = '55555555-5555-4555-8555-555555555555'
  ) OR NOT EXISTS (
    SELECT 1
    FROM outlets
    WHERE id = '66666666-6666-4666-8666-666666666666'
  ) THEN
    RAISE EXCEPTION
      'Seeded demo outlets were not found. Run 2026-04-18-sales-rep-mobile-e2e-seed.sql first.';
  END IF;
END $$;

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
  '88888888-8888-4888-8888-888888888881',
  NULL,
  'Nimal',
  'Perera',
  'so.city.demo',
  'city.mini.mart@example.com',
  '+94771111111',
  '$2b$10$t1rwKkGnhKHgr1fg/9oGG.ykNCIhmVSTsExR2kHH0THpdz/GJ6HMq',
  NULL,
  NULL,
  'City Mini Mart',
  'No. 101, Galle Road, Colombo 03',
  warehouse.name,
  outlet.territory_id,
  outlet.warehouse_id,
  outlet.latitude,
  outlet.longitude,
  'SHOP_OWNER',
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
FROM outlets outlet
LEFT JOIN warehouses warehouse
  ON warehouse.id = outlet.warehouse_id
WHERE outlet.id = '55555555-5555-4555-8555-555555555555'
ON CONFLICT (id) DO UPDATE
SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  phone_number = EXCLUDED.phone_number,
  password_hash = EXCLUDED.password_hash,
  shop_name = EXCLUDED.shop_name,
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
  rejection_reason = EXCLUDED.rejection_reason,
  is_email_verified = EXCLUDED.is_email_verified,
  otp_code_hash = EXCLUDED.otp_code_hash,
  otp_expires_at = EXCLUDED.otp_expires_at,
  otp_last_sent_at = EXCLUDED.otp_last_sent_at,
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
  '88888888-8888-4888-8888-888888888882',
  NULL,
  'Kamal',
  'Silva',
  'so.lake.demo',
  'lake.view.stores@example.com',
  '+94772222222',
  '$2b$10$t1rwKkGnhKHgr1fg/9oGG.ykNCIhmVSTsExR2kHH0THpdz/GJ6HMq',
  NULL,
  NULL,
  'Lake View Stores',
  'No. 44, Bauddhaloka Mawatha, Colombo 07',
  warehouse.name,
  outlet.territory_id,
  outlet.warehouse_id,
  outlet.latitude,
  outlet.longitude,
  'SHOP_OWNER',
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
FROM outlets outlet
LEFT JOIN warehouses warehouse
  ON warehouse.id = outlet.warehouse_id
WHERE outlet.id = '66666666-6666-4666-8666-666666666666'
ON CONFLICT (id) DO UPDATE
SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  phone_number = EXCLUDED.phone_number,
  password_hash = EXCLUDED.password_hash,
  shop_name = EXCLUDED.shop_name,
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
  rejection_reason = EXCLUDED.rejection_reason,
  is_email_verified = EXCLUDED.is_email_verified,
  otp_code_hash = EXCLUDED.otp_code_hash,
  otp_expires_at = EXCLUDED.otp_expires_at,
  otp_last_sent_at = EXCLUDED.otp_last_sent_at,
  otp_verified_at = EXCLUDED.otp_verified_at,
  updated_at = NOW();

SELECT
  outlet.id AS outlet_id,
  outlet.outlet_name,
  matched_owner.id AS shop_owner_id,
  matched_owner.username AS shop_owner_username,
  matched_owner.account_status,
  matched_owner.approval_status
FROM outlets outlet
LEFT JOIN LATERAL (
  SELECT
    users.id,
    users.username,
    users.account_status,
    users.approval_status
  FROM users
  WHERE users.role = 'SHOP_OWNER'
    AND (
      LOWER(users.email) = LOWER(outlet.owner_email)
      OR users.phone_number = outlet.owner_phone
      OR users.shop_name = outlet.outlet_name
    )
    AND (outlet.territory_id IS NULL OR users.territory_id = outlet.territory_id)
  ORDER BY
    CASE
      WHEN LOWER(users.email) = LOWER(outlet.owner_email) THEN 0
      WHEN users.phone_number = outlet.owner_phone THEN 1
      ELSE 2
    END,
    users.created_at ASC
  LIMIT 1
) matched_owner
  ON TRUE
WHERE outlet.id IN (
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666'
)
ORDER BY outlet.outlet_name;

COMMIT;
