CREATE TRIGGER IF NOT EXISTS reserve_order_item_inventory_before_insert
BEFORE INSERT ON order_items
WHEN NOT EXISTS (
  SELECT 1 FROM products
  WHERE id = NEW.product_id
    AND active = 1
    AND (inventory_quantity IS NULL OR inventory_quantity >= NEW.quantity)
)
BEGIN
  SELECT RAISE(ABORT, 'insufficient inventory or inactive product');
END;

CREATE TRIGGER IF NOT EXISTS reserve_order_item_inventory_after_insert
AFTER INSERT ON order_items
WHEN (SELECT inventory_quantity FROM products WHERE id = NEW.product_id) IS NOT NULL
BEGIN
  UPDATE products
  SET inventory_quantity = inventory_quantity - NEW.quantity,
      updated_at = datetime('now')
  WHERE id = NEW.product_id AND active = 1;
END;
