CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL,
 collection TEXT NOT NULL CHECK (collection IN ('fashion','interiors','objects','gifts')),
 image_url TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 50),
 currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
 inventory_quantity INTEGER CHECK (inventory_quantity IS NULL OR inventory_quantity >= 0),
 active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS products_active_collection ON products (active, collection, created_at DESC);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, stripe_session_id TEXT UNIQUE,
 status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','expired')),
 currency TEXT NOT NULL DEFAULT 'usd', subtotal_cents INTEGER NOT NULL, amount_total_cents INTEGER,
 items_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at DESC);
CREATE TABLE IF NOT EXISTS stripe_events (
 id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (datetime('now'))
);