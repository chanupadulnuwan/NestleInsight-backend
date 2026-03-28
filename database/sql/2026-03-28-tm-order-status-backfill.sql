-- Run this once after deploying the TM workflow update.
-- It normalizes legacy approved orders into the new proceed state.

BEGIN;

UPDATE orders
SET status = 'PROCEED'
WHERE status = 'APPROVED';

COMMIT;
