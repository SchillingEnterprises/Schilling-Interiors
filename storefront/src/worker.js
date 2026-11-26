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
function catalogPublishingEnabled(env) {
  return env.STORE_RELEASE_APPROVED === "true"
    && env.STORE_POLICIES_CONFIRMED === "true"
    && env.TAX_CONFIGURATION_CONFIRMED === "true";
}
function checkoutConfigured(env) {
  return env.STORE_CHECKOUT_ENABLED === "true"
    && catalogPublishingEnabled(env)
    && typeof env.STRIPE_SECRET_KEY === "string"
    && env.STRIPE_SECRET_KEY.startsWith("sk_test_")
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
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Request body must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object.");
  return parsed;
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
async function reserveOrderInventory(db, orderStatement, orderId, items, productsById) {
  const statements = [orderStatement];
  for (const item of items) {
    const product = productsById.get(item.id);
    statements.push(db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents, inventory_reserved) SELECT ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'pending')").bind(orderId, item.id, item.quantity, product.priceCents, orderId));
  }
  // D1 batch executes these statements in one transaction. The inventory trigger
  // reserves each item or aborts the entire order when any item is unavailable.
  const results = await db.batch(statements);
  return results.length === statements.length
    && results.every((result) => result.meta?.changes === 1);
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
  try {
    if (!await reserveOrderInventory(env.DB, insertOrder, orderId, items, byId)) {
      return json({ error: "Stock changed while you were checking out. Refresh your cart and try again." }, 409);
    }
  } catch (error) {
    if (/inventory|product unavailable/i.test(String(error))) {
      return json({ error: "Stock changed while you were checking out. Refresh your cart and try again." }, 409);
    }
    throw error;
  }
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

function validPaidCheckoutSession(session, order) {
  return Boolean(
    session
    && session.id
    && /^cs_test_[A-Za-z0-9]+$/.test(session.id)
    && session.mode === "payment"
    && session.payment_status === "paid"
    && String(session.currency || "").toLowerCase() === order.currency
    && Number.isInteger(session.amount_subtotal)
    && session.amount_subtotal === order.subtotal_cents
    && Number.isInteger(session.amount_total)
    && session.amount_total >= session.amount_subtotal
    && session.metadata?.order_id === order.id
    && session.client_reference_id === order.id
  );
}

async function handleStripeWebhook(request, env) {
  const payload = await request.text();
  if (encoder.encode(payload).byteLength > 256000) return text("Payload too large", 413);
  if (!await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) return text("Invalid signature", 400);
  let event;
  try { event = JSON.parse(payload); } catch { return text("Invalid event", 400); }
  if (!event.id || !event.type || !event.data?.object?.id) return text("Invalid event", 400);
  const session = event.data.object;
  const sessionId = session.id;
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) return text("Only test-mode Stripe Checkout Sessions are accepted", 400);
  const metadataOrderId = session.metadata?.order_id;
  const clientOrderId = session.client_reference_id;
  const orderId = metadataOrderId || clientOrderId;
  const db = env.DB;
  const statements = [db.prepare("INSERT OR IGNORE INTO stripe_events (id, event_type) VALUES (?, ?)").bind(event.id, event.type)];
  if (!orderId || (metadataOrderId && clientOrderId && metadataOrderId !== clientOrderId)) {
    statements.push(db.prepare("UPDATE stripe_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL").bind(event.id));
    await db.batch(statements);
    return text("ok", 200);
  }
  const order = await db.prepare("SELECT id, stripe_session_id, subtotal_cents, currency, status FROM orders WHERE id = ?").bind(orderId).first();
  if (!order || (order.stripe_session_id && order.stripe_session_id !== sessionId)) {
    statements.push(db.prepare("UPDATE stripe_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL").bind(event.id));
    await db.batch(statements);
    return text("ok", 200);
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (!validPaidCheckoutSession(session, order)) {
      statements.push(db.prepare("UPDATE stripe_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL").bind(event.id));
      await db.batch(statements);
      return text("ok", 200);
    }
    statements.push(db.prepare("UPDATE orders SET status = 'paid', amount_total_cents = ?, updated_at = datetime('now') WHERE id = ? AND currency = ? AND subtotal_cents = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?) AND status = 'pending' AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(session.amount_total, orderId, order.currency, order.subtotal_cents, sessionId, event.id));
    statements.push(db.prepare("UPDATE order_items SET inventory_reserved = 0 WHERE order_id = ? AND inventory_reserved = 1 AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'paid') AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(orderId, orderId, event.id));
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const status = event.type === "checkout.session.expired" ? "expired" : "failed";
    statements.push(db.prepare("UPDATE products SET inventory_quantity = inventory_quantity + COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id = ? AND product_id = products.id AND inventory_reserved = 1), 0), updated_at = datetime('now') WHERE inventory_quantity IS NOT NULL AND id IN (SELECT product_id FROM order_items WHERE order_id = ? AND inventory_reserved = 1) AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(orderId, orderId, event.id));
    statements.push(db.prepare("UPDATE order_items SET inventory_reserved = 0 WHERE order_id = ? AND inventory_reserved = 1 AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(orderId, event.id));
    statements.push(db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?) AND status = 'pending' AND EXISTS (SELECT 1 FROM stripe_events WHERE id = ? AND processed_at IS NULL)").bind(status, orderId, sessionId, event.id));
  }
  statements.push(db.prepare("UPDATE stripe_events SET processed_at = datetime('now') WHERE id = ? AND processed_at IS NULL").bind(event.id));
  await db.batch(statements); return text("ok", 200);
}
function publicOrderStatus(order) {
  const status = ["pending", "paid", "failed", "expired"].includes(order?.status) ? order.status : "pending";
  const fulfillmentStatus = ["unfulfilled", "processing", "shipped", "fulfilled"].includes(order?.fulfillmentStatus)
    ? order.fulfillmentStatus : "unfulfilled";
  let tracking = null;
  if (status === "paid" && ["shipped", "fulfilled"].includes(fulfillmentStatus)) {
    const carrier = typeof order.trackingCarrier === "string" ? order.trackingCarrier.trim().slice(0, 80) : "";
    const number = typeof order.trackingNumber === "string" ? order.trackingNumber.trim().slice(0, 120) : "";
    try {
      const url = new URL(order.trackingUrl);
      if (carrier && number && url.protocol === "https:") tracking = { carrier, number, url: url.toString() };
    } catch { /* Do not expose incomplete or unsafe tracking details. */ }
  }
  return { status, fulfillmentStatus, tracking };
}
function refundPaymentIntentFromSession(session, orderId, sessionId) {
  if (!session || session.id !== sessionId || !/^cs_test_[A-Za-z0-9]+$/.test(session.id)
    || session.mode !== "payment" || session.payment_status !== "paid"
    || session.metadata?.order_id !== orderId || session.client_reference_id !== orderId) return "";
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  return typeof paymentIntent === "string" && /^pi_[A-Za-z0-9]+$/.test(paymentIntent) ? paymentIntent : "";
}
function refundIdempotencyKey(orderId) {
  return "schilling-interiors-refund-" + orderId;
}

function safeAddressField(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}
function shippingAddressFromSession(session, orderId, sessionId) {
  if (!session || session.id !== sessionId || session.mode !== "payment"
    || session.metadata?.order_id !== orderId || session.client_reference_id !== orderId) return null;
  const details = session.shipping_details || session.shipping;
  const address = details?.address;
  if (!address || typeof address !== "object") return null;
  return {
    name: safeAddressField(details.name),
    line1: safeAddressField(address.line1),
    line2: safeAddressField(address.line2),
    city: safeAddressField(address.city),
    state: safeAddressField(address.state),
    postalCode: safeAddressField(address.postal_code),
    country: safeAddressField(address.country)
  };
}

function validateFulfillmentUpdate(input) {
  const fulfillmentStatus = typeof input.fulfillmentStatus === "string" ? input.fulfillmentStatus.trim() : "";
  const trackingCarrier = typeof input.trackingCarrier === "string" ? input.trackingCarrier.trim() : "";
  const trackingNumber = typeof input.trackingNumber === "string" ? input.trackingNumber.trim() : "";
  const trackingUrl = typeof input.trackingUrl === "string" ? input.trackingUrl.trim() : "";
  if (!["processing", "shipped", "fulfilled"].includes(fulfillmentStatus)) throw new Error("Choose a valid fulfillment status.");
  if (trackingCarrier.length > 80 || trackingNumber.length > 120) throw new Error("Tracking details are too long.");
  if (trackingUrl) {
    let parsed;
    try { parsed = new URL(trackingUrl); } catch { throw new Error("Tracking URL must be a valid HTTPS URL."); }
    if (parsed.protocol !== "https:") throw new Error("Tracking URL must use HTTPS.");
  }
  if (fulfillmentStatus === "shipped" && (!trackingCarrier || !trackingNumber || !trackingUrl)) throw new Error("Carrier, tracking number, and HTTPS tracking URL are required before marking an order shipped.");
  return { fulfillmentStatus, trackingCarrier, trackingNumber, trackingUrl };
}

async function adminRequest(request, env, path) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (request.method === "GET" && path === "/api/admin/products") {
    const result = await env.DB.prepare("SELECT id, slug, name, description, collection, image_url AS imageUrl, price_cents AS priceCents, inventory_quantity AS inventoryQuantity, shipping_required AS shippingRequired, active FROM products ORDER BY created_at DESC LIMIT 250").all();
    const canPublish = catalogPublishingEnabled(env);
    return json({ products: (result.results || []).map((product) => ({ ...product, active: canPublish && Boolean(product.active) })), catalogPublishingEnabled: canPublish });
  }
  if (request.method === "GET" && path === "/api/admin/orders") {
    const result = await env.DB.prepare("SELECT id, status, fulfillment_status AS fulfillmentStatus, tracking_carrier AS trackingCarrier, tracking_number AS trackingNumber, tracking_url AS trackingUrl, shipped_at AS shippedAt, fulfilled_at AS fulfilledAt, refund_status AS refundStatus, refund_id AS refundId, refund_amount_cents AS refundAmountCents, currency, subtotal_cents AS subtotalCents, amount_total_cents AS amountTotalCents, items_json AS itemsJson, created_at AS createdAt FROM orders ORDER BY created_at DESC LIMIT 100").all();
    return json({ orders: (result.results || []).map((order) => ({ ...order, items: JSON.parse(order.itemsJson || "[]") })) });
  }
  const refundMatch = path.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})\/refund$/i);
  if (refundMatch && request.method === "POST") {
    const input = await readJson(request);
    if (input.confirm !== true) return json({ error: "Explicit refund confirmation is required." }, 400);
    const order = await env.DB.prepare("SELECT status, stripe_session_id, refund_status FROM orders WHERE id = ?").bind(refundMatch[1]).first();
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.status !== "paid") return json({ error: "Only paid orders can be refunded." }, 409);
    if (order.refund_status !== "none") return json({ error: "A refund is already pending or has been processed. Reconcile it with the payment provider before retrying." }, 409);
    if (typeof env.STRIPE_SECRET_KEY !== "string" || !env.STRIPE_SECRET_KEY.startsWith("sk_test_")) return json({ error: "Test-mode payment-provider access is not configured." }, 503);
    if (!/^cs_test_[A-Za-z0-9]+$/.test(order.stripe_session_id || "")) return json({ error: "A valid test-mode checkout session is not linked to this order." }, 404);
    let sessionResponse;
    try {
      sessionResponse = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(order.stripe_session_id), {
        headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY }
      });
    } catch {
      return json({ error: "The payment session could not be verified. No refund was requested." }, 502);
    }
    if (!sessionResponse.ok) return json({ error: "The payment session could not be verified. No refund was requested." }, 502);
    const session = await sessionResponse.json().catch(() => null);
    const paymentIntent = refundPaymentIntentFromSession(session, refundMatch[1], order.stripe_session_id);
    if (!paymentIntent) return json({ error: "The test-mode payment session does not match this paid order." }, 409);
    const reserved = await env.DB.prepare("UPDATE orders SET refund_status = 'pending', updated_at = datetime('now') WHERE id = ? AND status = 'paid' AND refund_status = 'none'")
      .bind(refundMatch[1]).run();
    if (reserved.meta?.changes !== 1) return json({ error: "The refund state changed. Reload the order before retrying." }, 409);
    let refundResponse;
    try {
      refundResponse = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          authorization: "Bearer " + env.STRIPE_SECRET_KEY,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": refundIdempotencyKey(refundMatch[1])
        },
        body: new URLSearchParams({ payment_intent: paymentIntent, "metadata[order_id]": refundMatch[1] })
      });
    } catch {
      return json({ error: "Refund request outcome is unknown. The order is held as pending; reconcile with Stripe before any retry." }, 502);
    }
    const refund = await refundResponse.json().catch(() => null);
    if (!refundResponse.ok || !refund?.id) {
      if (refundResponse.status >= 400 && refundResponse.status < 500) {
        await env.DB.prepare("UPDATE orders SET refund_status = 'failed', updated_at = datetime('now') WHERE id = ? AND refund_status = 'pending'").bind(refundMatch[1]).run();
      }
      return json({ error: "The payment provider did not confirm the refund. Check Stripe before taking further action." }, 502);
    }
    const status = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
    await env.DB.prepare("UPDATE orders SET refund_status = ?, refund_id = ?, refund_amount_cents = ?, updated_at = datetime('now') WHERE id = ? AND refund_status = 'pending'")
      .bind(status, refund.id, Number.isInteger(refund.amount) ? refund.amount : null, refundMatch[1]).run();
    return json({ refundStatus: status });
  }
  const shippingMatch = path.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})\/shipping$/i);
  if (shippingMatch && request.method === "GET") {
    const order = await env.DB.prepare("SELECT status, stripe_session_id FROM orders WHERE id = ?").bind(shippingMatch[1]).first();
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.status !== "paid") return json({ error: "Shipping details are available only for paid orders." }, 409);
    if (typeof env.STRIPE_SECRET_KEY !== "string" || !env.STRIPE_SECRET_KEY.startsWith("sk_test_")) return json({ error: "Test-mode payment-provider access is not configured." }, 503);
    if (!/^cs_test_[A-Za-z0-9]+$/.test(order.stripe_session_id || "")) return json({ error: "A valid test-mode checkout session is not linked to this order." }, 404);
    let stripeResponse;
    try {
      stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(order.stripe_session_id), {
        headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY }
      });
    } catch {
      return json({ error: "Shipping details could not be retrieved from the payment provider." }, 502);
    }
    if (!stripeResponse.ok) return json({ error: "Shipping details could not be retrieved from the payment provider." }, 502);
    const session = await stripeResponse.json().catch(() => null);
    const shipping = shippingAddressFromSession(session, shippingMatch[1], order.stripe_session_id);
    if (!shipping) return json({ error: "The payment provider has no verified shipping address for this order." }, 404);
    return json({ shipping });
  }
  const fulfillmentMatch = path.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})\/fulfillment$/i);
  if (fulfillmentMatch && request.method === "PATCH") {
    const update = validateFulfillmentUpdate(await readJson(request));
    const current = await env.DB.prepare("SELECT status, fulfillment_status, tracking_carrier, tracking_number, tracking_url FROM orders WHERE id = ?").bind(fulfillmentMatch[1]).first();
    if (!current) return json({ error: "Order not found." }, 404);
    if (current.status !== "paid") return json({ error: "Only paid orders can enter fulfillment." }, 409);
    const transitions = { unfulfilled: ["processing"], processing: ["shipped", "fulfilled"], shipped: ["fulfilled"], fulfilled: [] };
    if (update.fulfillmentStatus !== current.fulfillment_status && !transitions[current.fulfillment_status]?.includes(update.fulfillmentStatus)) {
      return json({ error: "That fulfillment status transition is not allowed." }, 409);
    }
    const carrier = update.trackingCarrier || current.tracking_carrier || null;
    const trackingNumber = update.trackingNumber || current.tracking_number || null;
    const trackingUrl = update.trackingUrl || current.tracking_url || null;
    if (update.fulfillmentStatus === "shipped" && (!carrier || !trackingNumber || !trackingUrl)) return json({ error: "Carrier, tracking number, and HTTPS tracking URL are required before marking an order shipped." }, 400);
    const saved = await env.DB.prepare("UPDATE orders SET fulfillment_status = ?, tracking_carrier = ?, tracking_number = ?, tracking_url = ?, shipped_at = CASE WHEN ? = 'shipped' THEN COALESCE(shipped_at, datetime('now')) ELSE shipped_at END, fulfilled_at = CASE WHEN ? = 'fulfilled' THEN COALESCE(fulfilled_at, datetime('now')) ELSE fulfilled_at END, updated_at = datetime('now') WHERE id = ? AND status = 'paid' AND fulfillment_status = ?")
      .bind(update.fulfillmentStatus, carrier, trackingNumber, trackingUrl, update.fulfillmentStatus, update.fulfillmentStatus, fulfillmentMatch[1], current.fulfillment_status).run();
    if (saved.meta?.changes !== 1) return json({ error: "Order changed while saving. Reload and try again." }, 409);
    return json({ saved: true, fulfillmentStatus: update.fulfillmentStatus });
  }
  if (request.method === "POST" && path === "/api/admin/products") {
    const product = validateProduct(await readJson(request));
    if (product.active && !catalogPublishingEnabled(env)) return json({ error: "Product publishing is locked until the owner confirms the complete store release gate." }, 503);
    const id = crypto.randomUUID();
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
    if (product.active && !catalogPublishingEnabled(env)) return json({ error: "Product publishing is locked until the owner confirms the complete store release gate." }, 503);
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
  if (url.pathname === "/api/config" && request.method === "GET") return json({ checkoutEnabled: checkoutConfigured(env), catalogEnabled: catalogPublishingEnabled(env), turnstileSiteKey: env.TURNSTILE_SITE_KEY || "" });
  if (url.pathname === "/api/products" && request.method === "GET") {
    if (!catalogPublishingEnabled(env)) return json({ products: [], catalogEnabled: false });
    const result = await env.DB.prepare("SELECT id, slug, name, description, collection, image_url AS imageUrl, price_cents AS priceCents, inventory_quantity AS inventoryQuantity FROM products WHERE active = 1 ORDER BY created_at DESC LIMIT 100").all();
    return json({ products: result.results || [], catalogEnabled: true });
  }
  if (url.pathname === "/api/checkout" && request.method === "POST") return handleCheckout(request, env);
  if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return handleStripeWebhook(request, env);
  if (url.pathname === "/api/order-status" && request.method === "GET") {
    const sessionId = url.searchParams.get("session_id") || "";
    if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) return json({ error: "Invalid checkout session." }, 400);
    const order = await env.DB.prepare("SELECT status, fulfillment_status AS fulfillmentStatus, tracking_carrier AS trackingCarrier, tracking_number AS trackingNumber, tracking_url AS trackingUrl FROM orders WHERE stripe_session_id = ?").bind(sessionId).first();
    return order ? json(publicOrderStatus(order)) : json({ error: "Order not found." }, 404);
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
      const validation = ["Request body is too large.", "Request body must be valid JSON.", "Request body must be a JSON object."].includes(message)
        || message.startsWith("Product ") || message.startsWith("Use a unique") || message.startsWith("Price ") || message.startsWith("Inventory ") || message.startsWith("Choose ") || message.startsWith("Tracking ") || message.startsWith("Carrier, tracking") || message.startsWith("A product does not have enough stock.");
      const conflict = message.startsWith("A product does not have enough stock.");
      return json({ error: message }, conflict ? 409 : validation ? 400 : 500);
    }
  }
};
export { catalogPublishingEnabled, checkoutConfigured, constantTimeEqual, linkStripeSession, publicOrderStatus, reserveOrderInventory, validPaidCheckoutSession, refundIdempotencyKey, refundPaymentIntentFromSession, safeAddressField, shippingAddressFromSession, validateFulfillmentUpdate, validateProduct, verifyStripeSignature };
