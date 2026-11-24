ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'pending', 'succeeded', 'failed'));
ALTER TABLE orders ADD COLUMN refund_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_refund_id ON orders (refund_id) WHERE refund_id IS NOT NULL;
ALTER TABLE orders ADD COLUMN refund_amount_cents INTEGER CHECK (refund_amount_cents IS NULL OR refund_amount_cents >= 0);

CREATE INDEX IF NOT EXISTS orders_refund_status ON orders (refund_status, created_at DESC);
