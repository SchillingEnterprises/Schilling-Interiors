CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  collection TEXT NOT NULL CHECK (collection IN ('fashion', 'interiors', 'objects', 'gifts')),
  image_url TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 50 AND 10000000),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  shipping_required INTEGER NOT NULL DEFAULT 1 CHECK (shipping_required IN (0, 1)),
  inventory_quantity INTEGER CHECK (inventory_quantity IS NULL OR inventory_quantity >= 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS products_active_collection ON products (active, collection, created_at DESC);
CREATE INDEX IF NOT EXISTS products_slug ON products (slug);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  amount_total_cents INTEGER,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 50),
  inventory_reserved INTEGER NOT NULL DEFAULT 0 CHECK (inventory_reserved IN (0, 1)),
  PRIMARY KEY (order_id, product_id)
);
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
