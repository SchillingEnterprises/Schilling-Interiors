const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_CART_LINES = 20;
const MAX_QUANTITY = 10;
const COLLECTIONS = new Set(["fashion", "interiors", "objects", "gifts"]);

export function parseCart(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CART_LINES) return null;
  const merged = new Map();
  for (const line of value) {
    if (!line || typeof line.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(line.slug)) return null;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) return null;
    const quantity = (merged.get(line.slug) || 0) + line.quantity;
    if (quantity > MAX_QUANTITY) return null;
    merged.set(line.slug, quantity);
  }
  return [...merged].map(([slug, quantity]) => ({ slug, quantity }));
}

export function validProductInput(value, partial = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = ["name", "slug", "description", "collection", "image_url", "price_cents"];
  if (!partial && fields.some((field) => !(field in value))) return false;
  if ("name" in value && (typeof value.name !== "string" || value.name.trim().length < 2 || value.name.length > 120)) return false;
  if ("slug" in value && (typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug))) return false;
  if ("description" in value && (typeof value.description !== "string" || value.description.length > 2000)) return false;
  if ("collection" in value && !COLLECTIONS.has(value.collection)) return false;
  if ("image_url" in value) {
    try { const image = new URL(value.image_url); if (image.protocol !== "https:") return false; }
    catch { return false; }
  }
  if ("price_cents" in value && (!Number.isSafeInteger(value.price_cents) || value.price_cents < 50 || value.price_cents > 100000000)) return false;
  if ("inventory_quantity" in value && value.inventory_quantity !== null &&
      (!Number.isSafeInteger(value.inventory_quantity) || value.inventory_quantity < 0)) return false;
  if ("active" in value && typeof value.active !== "boolean") return false;
  return true;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}
function secure(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("content-security-policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function authorized(request, env) {
  const token = env.ADMIN_API_TOKEN;
  const supplied = request.headers.get("authorization") || "";
  return typeof token === "string" && token.length >= 32 && supplied === "Bearer " + token;
}
function publicProduct(row) {
  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description,
    collection: row.collection, image_url: row.image_url, price_cents: row.price_cents,
    currency: row.currency, inventory_quantity: row.inventory_quantity
  };
}
async function parseBody(request, limit = 16000) {
  const text = await request.text();
  if (text.length > limit) throw new Error("Request body is too large.");
  return JSON.parse(text);
}
function storeUrl(env) {
  const value = env.PUBLIC_STORE_URL;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("PUBLIC_STORE_URL must use HTTPS.");
  }
  return url.origin;
}
async function listProducts(env) {
  const result = await env.DB.prepare(
    "SELECT id, slug, name, description, collection, image_url, price_cents, currency, inventory_quantity FROM products WHERE active = 1 ORDER BY created_at DESC"
  ).all();
  return (result.results || []).map(publicProduct);
}
async function checkout(request, env) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return json({ error: "Checkout is not configured yet." }, 503);
  let body;
  try { body = await parseBody(request); } catch { return json({ error: "Invalid JSON request." }, 400); }
  const cart = parseCart(body.items);
  if (!cart) return json({ error: "Cart must contain 1–20 valid product lines, with quantities from 1 to 10." }, 400);

  const placeholders = cart.map(() => "?").join(",");
  const result = await env.DB.prepare(
    "SELECT id, slug, name, description, price_cents, currency, inventory_quantity, active FROM products WHERE slug IN (" + placeholders + ")"
  ).bind(...cart.map((line) => line.slug)).all();
  const products = new Map((result.results || []).map((product) => [product.slug, product]));
  if (products.size !== cart.length) return json({ error: "One or more products are unavailable." }, 409);

  let subtotal = 0;
  const lineItems = [];
  const snapshot = [];
  for (const line of cart) {
    const product = products.get(line.slug);
    if (!product.active) return json({ error: "One or more products are unavailable." }, 409);
    if (product.inventory_quantity !== null) {
      return json({ error: "This item requires inventory reservation to be enabled before checkout." }, 409);
    }
    const lineTotal = product.price_cents * line.quantity;
    if (!Number.isSafeInteger(lineTotal) || subtotal + lineTotal > 1000000000) return json({ error: "Cart total exceeds the supported limit." }, 400);
    subtotal += lineTotal;
    snapshot.push({ product_id: product.id, slug: product.slug, name: product.name, quantity: line.quantity, unit_price_cents: product.price_cents });
    lineItems.push({
      price_data: { currency: "usd", product_data: { name: product.name, description: product.description.slice(0, 500) }, unit_amount: product.price_cents },
      quantity: line.quantity
    });
  }

  const orderId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO orders (id, status, currency, subtotal_cents, items_json) VALUES (?, 'pending', 'usd', ?, ?)"
  ).bind(orderId, subtotal, JSON.stringify(snapshot)).run();

  const base = storeUrl(env);
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", base + "/success.html?session_id={CHECKOUT_SESSION_ID}");
  form.set("cancel_url", base + "/?checkout=cancelled");
  form.set("client_reference_id", orderId);
  form.set("metadata[order_id]", orderId);
  form.set("billing_address_collection", "required");
  form.set("shipping_address_collection[allowed_countries][0]", "US");
  lineItems.forEach((item, index) => {
    form.set("line_items[" + index + "][quantity]", String(item.quantity));
    form.set("line_items[" + index + "][price_data][currency]", item.price_data.currency);
    form.set("line_items[" + index + "][price_data][unit_amount]", String(item.price_data.unit_amount));
    form.set("line_items[" + index + "][price_data][product_data][name]", item.price_data.product_data.name);
    form.set("line_items[" + index + "][price_data][product_data][description]", item.price_data.product_data.description);
  });
  if (env.STRIPE_SHIPPING_RATE_ID) form.set("shipping_options[0][shipping_rate]", env.STRIPE_SHIPPING_RATE_ID);
  if (env.STRIPE_AUTOMATIC_TAX === "true") form.set("automatic_tax[enabled]", "true");

  const stripe = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" },
    body: form
  });
  const session = await stripe.json();
  if (!stripe.ok || !session.url || !session.id) {
    await env.DB.prepare("UPDATE orders SET status = 'failed', updated_at = datetime('now') WHERE id = ?").bind(orderId).run();
    return json({ error: "The payment provider could not start checkout." }, 502);
  }
  await env.DB.prepare("UPDATE orders SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ?").bind(session.id, orderId).run();
  return json({ url: session.url });
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function verifyStripeSignature(payload, header, secret) {
  const entries = header.split(",").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  });
  const timestampValue = entries.find(([key]) => key === "t")?.[1];
  const signatures = entries.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestampValue || !signatures.length || !/^\d+$/.test(timestampValue)) return false;
  const timestamp = Number(timestampValue);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestampValue + "." + payload)));
  const expected = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((candidate) => safeEqual(candidate, expected));
}
async function stripeWebhook(request, env) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  if (!await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET || "")) return json({ error: "Invalid webhook signature." }, 400);
  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: "Invalid event." }, 400); }
  const eventInsert = env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, event_type) VALUES (?, ?)").bind(event.id, event.type);
  const session = event.data?.object;
  const orderId = session?.metadata?.order_id || session?.client_reference_id;
  if (!orderId) {
    const inserted = await eventInsert.run();
    return json({ received: true, duplicate: !inserted.meta?.changes });
  }
  let orderUpdate = null;
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && session.payment_status === "paid") {
    orderUpdate = env.DB.prepare("UPDATE orders SET status = 'paid', amount_total_cents = ?, updated_at = datetime('now') WHERE id = ? AND stripe_session_id = ?")
      .bind(session.amount_total || null, orderId, session.id);
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    orderUpdate = env.DB.prepare("UPDATE orders SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND status = 'pending'").bind(orderId);
  }
  const results = await env.DB.batch(orderUpdate ? [eventInsert, orderUpdate] : [eventInsert]);
  return json({ received: true, duplicate: !results[0]?.meta?.changes });
}
async function adminProducts(request, env, id = null) {
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
  let body;
  try { body = await parseBody(request); } catch { return json({ error: "Invalid JSON request." }, 400); }
  if (!validProductInput(body, id !== null)) return json({ error: "Product fields are invalid." }, 400);
  if (id === null) {
    const productId = crypto.randomUUID();
    try {
      await env.DB.prepare(
        "INSERT INTO products (id, slug, name, description, collection, image_url, price_cents, inventory_quantity, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(productId, body.slug, body.name.trim(), body.description, body.collection, body.image_url, body.price_cents, body.inventory_quantity ?? null, body.active === true ? 1 : 0).run();
    } catch { return json({ error: "Product could not be created. Check for a duplicate slug." }, 409); }
    return json({ id: productId }, 201);
  }
  const allowed = ["name", "description", "collection", "image_url", "price_cents", "inventory_quantity", "active"];
  const fields = allowed.filter((field) => field in body);
  if (!fields.length) return json({ error: "No editable fields supplied." }, 400);
  const assignments = fields.map((field) => field + " = ?").join(", ");
  const values = fields.map((field) => field === "active" ? (body[field] ? 1 : 0) : body[field]);
  const result = await env.DB.prepare("UPDATE products SET " + assignments + ", updated_at = datetime('now') WHERE id = ?")
    .bind(...values, id).run();
  return result.meta?.changes ? json({ updated: true }) : json({ error: "Product not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        response = json({ status: "ok", checkout_configured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) });
      } else if (request.method === "GET" && url.pathname === "/api/products") {
        response = json({ products: await listProducts(env) });
      } else if (request.method === "POST" && url.pathname === "/api/checkout") {
        response = await checkout(request, env);
      } else if (request.method === "POST" && url.pathname === "/api/stripe/webhook") {
        response = await stripeWebhook(request, env);
      } else if (request.method === "POST" && url.pathname === "/api/admin/products") {
        response = await adminProducts(request, env);
      } else if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/products/")) {
        response = await adminProducts(request, env, decodeURIComponent(url.pathname.split("/").pop()));
      } else if (url.pathname.startsWith("/api/")) {
        response = json({ error: "Not found." }, 404);
      } else {
        response = await env.ASSETS.fetch(request);
      }
    } catch (error) {
      console.error("Storefront request failed:", error instanceof Error ? error.message : "unknown error");
      response = json({ error: "The storefront could not complete that request." }, 500);
    }
    return secure(response);
  }
};
