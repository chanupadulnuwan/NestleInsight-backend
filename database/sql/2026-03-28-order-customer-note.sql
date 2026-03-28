ALTER TABLE orders
ADD COLUMN IF NOT EXISTS customer_note text;
