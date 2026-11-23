const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const COLLECTIONS = new Set(["fashion", "interiors", "objects", "gifts"]);
const encoder = new TextEncoder();
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
function text(value, status = 400) { return new Response(value, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }); }
function secure(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' https: data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; upgrade-insecure-requests");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function safeStoreUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" || url.hostname === "localhost"; }
  catch { return false; }
}
function checkoutConfigured(env) {
  return env.STORE_CHECKOUT_ENABLED === "true"
    && Boolean(env.STRIPE_SECRET_KEY)
    && Boolean(env.STRIPE_WEBHOOK_SECRET)
    && Boolean(env.TURNSTILE_SECRET_KEY)
    && Boolean(env.TURNSTILE_SITE_KEY)
    && Boolean(env.ADMIN_API_TOKEN && env.ADMIN_API_TOKEN.length >= 32)
    && Boolean(env.PUBLIC_STORE_URL && safeStoreUrl(env.PUBLIC_STORE_URL))
    && env.STORE_POLICIES_CONFIRMED === "true"
    && env.TAX_CONFIGURATION_CONFIRMED === "true";
}
function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left)); const b = encoder.encode(String(right));
  let diff = a.length ^ b.length; const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
async function readJson(request, maxBytes = 16_384) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new Error("Request body is too large.");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maxBytes) throw new Error("Request body is too large.");
  try { return JSON.parse(raw); } catch { throw new Error("Request body must be valid JSON."); }
}
async function requireAdmin(request, env) {
  const expected = env.ADMIN_API_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return Boolean(expected && expected.length >= 32 && supplied && constantTimeEqual(supplied, expected));
}
function validateProduct(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const collection = typeof input.collection === "string" ? input.collection : "";
  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl.trim() : "";
  const priceCents = Number(input.priceCents);
  const inventoryQuantity = input.inventoryQuantity === "" || input.inventoryQuantity === null || input.inventoryQuantity === undefined ? null : Number(input.inventoryQuantity);
  let parsedImage;
  try { parsedImage = new URL(imageUrl); } catch { throw new Error("Product image must be a valid HTTPS URL."); }
  if (!name || name.length > 120) throw new Error("Product name is required and must be 120 characters or fewer.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 140) throw new Error("Use a unique lowercase product slug with letters, numbers, and hyphens.");
  if (!description || description.length > 2000) throw new Error("Product description is required (maximum 2,000 characters).");
  if (!COLLECTIONS.has(collection)) throw new Error("Choose a valid product collection.");
  if (parsedImage.protocol !== "https:") throw new Error("Product images must use HTTPS.");
  if (!Number.isInteger(priceCents) || priceCents < 50 || priceCents > 10000000) throw new Error("Price must be between $0.50 and $100,000.00.");
  if (inventoryQuantity !== null && (!Number.isInteger(inventoryQuantity) || inventoryQuantity < 0 || inventoryQuantity > 1000000)) throw new Error("Inventory must be a whole number of 0 or more, or left blank for unlimited stock.");
  return { name, slug, description, collection, imageUrl, priceCents, inventoryQuantity, shippingRequired: input.shippingRequired !== false, active: input.active === true };
}
async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY || !token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get("CF-Connecting-IP"); if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && result.hostname === new URL(request.url).hostname;
}
function hex(buffer) { return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  const parts = signature.split(",").map((part) => part.trim().split("=", 2).map((value) => value.trim()));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + payload)));
  return signatures.some((candidate) => constantTimeEqual(candidate, expected));
}
async function releaseOrder(db, orderId, status) {
  await db.batch([
    db.prepare("UPDATE products SET inventory_quantity = inventory_quantity + COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id = ? AND product_id = products.id AND inventory_reserved = 1), 0), updated_at = datetime('now') WHERE inventory_quantity IS NOT NULL AND id IN (SELECT product_id FROM order_items WHERE order_id = ? AND inventory_reserved = 1)").bind(orderId, orderId),
    db.prepare("UPDATE order_items SET inventory_reserved = 0 WHERE order_id = ? AND inventory_reserved = 1").bind(orderId),
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(status, orderId)
  ]);
}
async function reserveOrderInventory(db, orderId, items, productsById) {
  for (const item of items) {
    const product = productsById.get(item.id);
    const updated = await db.prepare("UPDATE products SET inventory_quantity = CASE WHEN inventory_quantity IS NULL THEN NULL ELSE inventory_quantity - ? END, updated_at = datetime('now') WHERE id = ? AND active = 1 AND (inventory_quantity IS NULL OR inventory_quantity >= ?) AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')").bind(item.quantity, item.id, item.quantity, orderId).run();
    if (updated.meta?.changes !== 1) {
      await releaseOrder(db, orderId, "failed");
      return false;
    }
    let inserted;
    try {
      inserted = await db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, inventory_reserved) SELECT ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')").bind(orderId, item.id, item.quantity, product.priceCents, orderId).run();
    } catch (error) {
      await db.prepare("UPDATE products SET inventory_quantity = inventory_quantity + ?, updated_at = datetime('now') WHERE id = ? AND inventory_quantity IS NOT NULL").bind(item.quantity, item.id).run();
      await releaseOrder(db, orderId, "failed");
      throw error;
    }
    if (inserted.meta?.changes !== 1) {
      await db.prepare("UPDATE products SET inventory_quantity = inventory_quantity + ?, updated_at = datetime('now') WHERE id = ? AND inventory_quantity IS NOT NULL").bind(item.quantity, item.id).run();
      await releaseOrder(db, orderId, "failed");
      return false;
    }
  }
  return true;
}
async function handleCheckout(request, env) {
  if (!checkoutConfigured(env)) return json({ error: "Online checkout is not activated yet. The store is being configured." }, 503);
  if (!env.DB) return json({ error: "Store database is unavailable." }, 503);
  const input = await readJson(request);
  if (!await verifyTurnstile(input.turnstileToken, request, env)) return json({ error: "Please complete the anti-bot check and try again." }, 400);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) return json({ error: "Your cart must contain between 1 and 20 different products." }, 400);
  const items = []; const seen = new Set();
  for (const entry of input.items) {
    const id = typeof entry?.id === "string" ? entry.id : ""; const quantity = Number(entry?.quantity);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || seen.has(id)) return json({ error: "Your cart contains an invalid item or quantity." }, 400);
    seen.add(id); items.push({ id, quantity });
  }
  const marks = items.map(() => "?").join(",");
  const productResult = await env.DB.prepare("SELECT id, slug, name, description, image_url AS imageUrl, price_cents AS priceCents, inventory_quantity AS inventoryQuantity, shipping_required AS shippingRequired FROM products WHERE active = 1 AND id IN (" + marks + ")").bind(...items.map((item) => item.id)).all();
  const products = productResult.results || [];
  if (products.length !== items.length) return json({ error: "One or more products are no longer available. Refresh your cart." }, 409);
  const byId = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0; let hasShipping = false;
  const snapshot = items.map((item) => {
    const product = byId.get(item.id);
    if (!product || (product.inventoryQuantity !== null && product.inventoryQuantity < item.quantity)) throw new Error("A product does not have enough stock. Refresh your cart.");
    subtotal += product.priceCents * item.quantity; hasShipping ||= product.shippingRequired === 1;
    return { id: product.id, slug: product.slug, name: product.name, description: product.description, imageUrl: product.imageUrl, quantity: item.quantity, unitPriceCents: product.priceCents, shippingRequired: Boolean(product.shippingRequired) };
  });
  if (subtotal > 10000000) return json({ error: "Your cart total exceeds the supported checkout limit." }, 400);
  if (hasShipping && !env.STRIPE_SHIPPING_RATE_ID) return json({ error: "Shipping has not been configured for this store yet." }, 503);
  const orderId = crypto.randomUUID(); const requested = JSON.stringify(items.map((item) => ({ ...item, priceCents: byId.get(item.id).priceCents })));
  const insertOrder = env.DB.prepare("INSERT INTO orders (id, status, currency, subtotal_cents, items_json) SELECT ?, 'pending', 'usd', ?, ? WHERE NOT EXISTS (SELECT 1 FROM json_each(?) AS item LEFT JOIN products AS p ON p.id = json_extract(item.value, '$.id') WHERE p.id IS NULL OR p.active <> 1 OR p.price_cents <> json_extract(item.value, '$.priceCents') OR (p.inventory_quantity IS NOT NULL AND p.inventory_quantity < json_extract(item.value, '$.quantity'))) AND (SELECT COUNT(*) FROM products WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))) = ?").bind(orderId, subtotal, JSON.stringify(snapshot), requested, requested, items.length);
  const created = await insertOrder.run();
  if (created.meta?.changes !== 1) return json({ error: "Stock changed while you were checking out. Refresh your cart and try again." }, 409);
  if (!await reserveOrderInventory(env.DB, orderId, items, byId)) return json({ error: "Stock changed while you were checking out. Refresh your cart and try again." }, 409);
  const storeUrl = new URL(env.PUBLIC_STORE_URL); const form = new URLSearchParams();
  form.set("mode", "payment"); form.set("client_reference_id", orderId);
  form.set("success_url", new URL("/success.html?session_id={CHECKOUT_SESSION_ID}", storeUrl).toString());
  form.set("cancel_url", new URL("/index.html?cancelled=1", storeUrl).toString());
  form.set("expires_at", String(Math.floor(Date.now() / 1000) + 1800));
  form.set("billing_address_collection", "auto");
  (env.SHIPPING_ALLOWED_COUNTRIES || "US").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean).slice(0, 5).forEach((country, index) => form.set("shipping_address_collection[allowed_countries][" + index + "]", country));
  snapshot.forEach((item, index) => {
    form.set("line_items[" + index + "][price_data][currency]", "usd");
    form.set("line_items[" + index + "][price_data][unit_amount]", String(item.unitPriceCents));
    form.set("line_items[" + index + "][price_data][product_data][name]", item.name);
    form.set("line_items[" + index + "][price_data][product_data][description]", item.description.slice(0, 500));
    if (item.imageUrl) form.set("line_items[" + index + "][price_data][product_data][images][0]", item.imageUrl);
    form.set("line_items[" + index + "][quantity]", String(item.quantity));
  });
  if (hasShipping) form.set("shipping_options[0][shipping_rate]", env.STRIPE_SHIPPING_RATE_ID);
  if (env.STRIPE_AUTOMATIC_TAX === "true") form.set("automatic_tax[enabled]", "true");
  form.set("metadata[order_id]", orderId); form.set("payment_intent_data[metadata][order_id]", orderId);
  if (typeof input.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) && input.email.length <= 254) form.set("customer_email", input.email);
  let stripeResponse;
  try {
    stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" }, body: form });
  } catch {
    await releaseOrder(env.DB, orderId, "failed");
    return json({ error: "Secure checkout could not be reached. Your stock reservation has been released." }, 502);
  }
  const session = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok || !session.id || !session.url) {
    await releaseOrder(env.DB, orderId, "failed");
    return json({ error: "The payment provider could not start checkout. Your stock reservation has been released." }, 502);
  }
  try {
    const linked = await linkStripeSession(env.DB, session.id, orderId);
    if (!linked) throw new Error("Order session link was not saved.");
  } catch {
    await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(session.id), { method: "POST", headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ expires_at: String(Math.floor(Date.now() / 1000)) }) }).catch(() => {});
    await releaseOrder(env.DB, orderId, "failed");
    return json({ error: "Checkout could not be finalized. Please try again." }, 502);
  }
  return json({ url: session.url });
}
async function linkStripeSession(db, sessionId, orderId) {
  const linked = await db.prepare("UPDATE orders SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ? AND stripe_session_id IS NULL AND status IN ('pending', 'paid')").bind(sessionId, orderId).run();
  return linked.meta?.changes === 1;
}

async function handleStripeWebhook(request, env) {
  const payload = await request.text();
  if (encoder.encode(payload).byteLength > 256000) return text("Payload too large", 413);
  if (!await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) return text("Invalid signature", 400);
  let event;
  try { event = JSON.parse(payload); } catch { return text("Invalid event", 400); }
  if (!event.id || !event.type || !event.data?.object?.id) return text("Invalid event", 400);
  const sessionId = event.data.object.id; const orderId = event.data.object.metadata?.order_id || event.data.object.client_reference_id; const db = env.DB;
  const statements = [db.prepare("INSERT OR IGNORE INTO stripe_events (id, event_type) VALUES (?, ?)").bind(event.id, event.type)];
  if (!orderId) {
    statements.push(db.prepare("UPDATE stripe_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL").bind(event.id));
    await db.batch(statements);
    return text("ok", 200);
  }
  if ((event.type === "checkout.session.completed" && event.data.object.payment_status === "paid") || event.type === "checkout.session.async_payment_succeeded") {
    statements.push(db.prepare("UPDATE orders SET status = 'paid', amount_total_cents = ?, updated_at = datetime('now') WHERE id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?) AND status = 'pending' AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(Number(event.data.object.amount_total || 0), orderId, sessionId, event.id));
    statements.push(db.prepare("UPDATE order_items SET inventory_reserved = 0 WHERE order_id = ? AND inventory_reserved = 1 AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(orderId, event.id));
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const status = event.type === "checkout.session.expired" ? "expired" : "failed";
    statements.push(db.prepare("UPDATE products SET inventory_quantity = inventory_quantity + COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id = ? AND product_id = products.id AND inventory_reserved = 1), 0), updated_at = datetime('now') WHERE inventory_quantity IS NOT NULL AND id IN (SELECT product_id FROM order_items WHERE order_id = ? AND inventory_reserved = 1) AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(orderId, orderId, event.id));
    statements.push(db.prepare("UPDATE order_items SET inventory_reserved = 0 WHERE order_id = ? AND inventory_reserved = 1 AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(orderId, event.id));
    statements.push(db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?) AND status = 'pending' AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(status, orderId, sessionId, event.id));
  }
  statements.push(db.prepare("UPDATE stripe_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL").bind(event.id));
  await db.batch(statements); return text("ok", 200);
}
async function adminRequest(request, env, path) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (request.method === "GET" && path === "/api/admin/products") {
    const result = await env.DB.prepare("SELECT id, slug, name, description, collection, image_url AS imageUrl, price_cents AS priceCents, inventory_quantity AS inventoryQuantity, shipping_required AS shippingRequired, active FROM products ORDER BY created_at DESC LIMIT 250").all();
    return json({ products: result.results || [] });
  }
  if (request.method === "GET" && path === "/api/admin/orders") {
    const result = await env.DB.prepare("SELECT id, status, currency, subtotal_cents AS subtotalCents, amount_total_cents AS amountTotalCents, items_json AS itemsJson, created_at AS createdAt FROM orders ORDER BY created_at DESC LIMIT 100").all();
    return json({ orders: (result.results || []).map((order) => ({ ...order, items: JSON.parse(order.itemsJson || "[]") })) });
  }
  if (request.method === "POST" && path === "/api/admin/products") {
    const product = validateProduct(await readJson(request)); const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO products (id, slug, name, description, collection, image_url, price_cents, inventory_quantity, shipping_required, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, product.slug, product.name, product.description, product.collection, product.imageUrl, product.priceCents, product.inventoryQuantity, product.shippingRequired ? 1 : 0, product.active ? 1 : 0).run();
    } catch (error) {
      if (/unique|constraint/i.test(String(error))) return json({ error: "That product slug is already in use." }, 409);
      throw error;
    }
    return json({ id }, 201);
  }
  const match = path.match(/^\/api\/admin\/products\/([0-9a-f-]{36})$/i);
  if (match && request.method === "PUT") {
    const product = validateProduct(await readJson(request));
    const result = await env.DB.prepare("UPDATE products SET slug = ?, name = ?, description = ?, collection = ?, image_url = ?, price_cents = ?, inventory_quantity = ?, shipping_required = ?, active = ?, updated_at = datetime('now') WHERE id = ?").bind(product.slug, product.name, product.description, product.collection, product.imageUrl, product.priceCents, product.inventoryQuantity, product.shippingRequired ? 1 : 0, product.active ? 1 : 0, match[1]).run();
    if (result.meta?.changes !== 1) return json({ error: "Product not found." }, 404);
    return json({ saved: true });
  }
  if (match && request.method === "DELETE") {
    const result = await env.DB.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").bind(match[1]).run();
    if (result.meta?.changes !== 1) return json({ error: "Product not found." }, 404);
    return json({ archived: true });
  }
  return json({ error: "Not found." }, 404);
}
async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/config" && request.method === "GET") return json({ checkoutEnabled: checkoutConfigured(env), turnstileSiteKey: env.TURNSTILE_SITE_KEY || "" });
  if (url.pathname === "/api/products" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, slug, name, description, collection, image_url AS imageUrl, price_cents AS priceCents, inventory_quantity AS inventoryQuantity FROM products WHERE active = 1 ORDER BY created_at DESC LIMIT 100").all();
    return json({ products: result.results || [] });
  }
  if (url.pathname === "/api/checkout" && request.method === "POST") return handleCheckout(request, env);
  if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return handleStripeWebhook(request, env);
  if (url.pathname === "/api/order-status" && request.method === "GET") {
    const sessionId = url.searchParams.get("session_id") || "";
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json({ error: "Invalid checkout session." }, 400);
    const order = await env.DB.prepare("SELECT status FROM orders WHERE stripe_session_id = ?").bind(sessionId).first();
    return order ? json({ status: order.status }) : json({ error: "Order not found." }, 404);
  }
  if (url.pathname.startsWith("/api/admin/")) return adminRequest(request, env, url.pathname);
  if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request, env) {
    try { return secure(await route(request, env)); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error.";
      const validation = ["Request body is too large.", "Request body must be valid JSON."].includes(message)
        || message.startsWith("Product ") || message.startsWith("Use a unique") || message.startsWith("Price ") || message.startsWith("Inventory ") || message.startsWith("Choose ") || message.startsWith("A product does not have enough stock.");
      const conflict = message.startsWith("A product does not have enough stock.");
      return json({ error: message }, conflict ? 409 : validation ? 400 : 500);
    }
  }
};
export { checkoutConfigured, constantTimeEqual, linkStripeSession, reserveOrderInventory, validateProduct, verifyStripeSignature };
