import test from "node:test";
import assert from "node:assert/strict";
import { checkoutConfigured, constantTimeEqual, linkStripeSession, reserveOrderInventory, validPaidCheckoutSession, validateProduct, verifyStripeSignature } from "../src/worker.js";
import { createHmac, randomUUID } from "node:crypto";

test("admin token comparison checks full strings and rejects mismatches", () => {
  assert.equal(constantTimeEqual("a".repeat(40), "a".repeat(40)), true);
  assert.equal(constantTimeEqual("a".repeat(40), "a".repeat(39) + "b"), false);
  assert.equal(constantTimeEqual("secret", ""), false);
});

test("product validation rejects unsafe URLs, invalid prices, and unknown collections", () => {
  const good = { name: "Ceramic Bowl", slug: "ceramic-bowl", description: "Hand finished ceramic bowl.", collection: "objects", imageUrl: "https://images.example.com/bowl.jpg", priceCents: 4500, inventoryQuantity: 4, shippingRequired: true, active: true };
  assert.equal(validateProduct(good).priceCents, 4500);
  assert.throws(() => validateProduct({ ...good, imageUrl: "http://images.example.com/bowl.jpg" }), /HTTPS/);
  assert.throws(() => validateProduct({ ...good, priceCents: 1 }), /Price/);
  assert.throws(() => validateProduct({ ...good, collection: "not-a-collection" }), /collection/);
  assert.throws(() => validateProduct({ ...good, slug: "Capital Letters" }), /slug/);
});

test("store checkout stays disabled until all operational gates are confirmed", () => {
  const base = {
    STORE_CHECKOUT_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_key", STRIPE_WEBHOOK_SECRET: "whsec_key",
    TURNSTILE_SECRET_KEY: "captcha-secret", TURNSTILE_SITE_KEY: "site-key", ADMIN_API_TOKEN: "x".repeat(40),
    PUBLIC_STORE_URL: "https://shop.example.com", STORE_POLICIES_CONFIRMED: "true", TAX_CONFIGURATION_CONFIRMED: "true"
  };
  assert.equal(checkoutConfigured(base), true);
  assert.equal(checkoutConfigured({ ...base, STORE_CHECKOUT_ENABLED: "false" }), false);
  assert.equal(checkoutConfigured({ ...base, STORE_POLICIES_CONFIRMED: "false" }), false);
  assert.equal(checkoutConfigured({ ...base, ADMIN_API_TOKEN: "short" }), false);
  assert.equal(checkoutConfigured({ ...base, PUBLIC_STORE_URL: "javascript:alert(1)" }), false);
  assert.equal(checkoutConfigured({ ...base, STRIPE_SECRET_KEY: "sk_live_example" }), false);
});

test("paid Stripe sessions must match order identity, currency, subtotal, and total", () => {
  const order = { id: "order-1", currency: "usd", subtotal_cents: 5000 };
  const session = {
    id: "cs_test_abc123",
    mode: "payment",
    payment_status: "paid",
    currency: "usd",
    amount_subtotal: 5000,
    amount_total: 5500,
    metadata: { order_id: "order-1" },
    client_reference_id: "order-1"
  };
  assert.equal(validPaidCheckoutSession(session, order), true);
  assert.equal(validPaidCheckoutSession({ ...session, id: "cs_live_abc123" }, order), false);
  assert.equal(validPaidCheckoutSession({ ...session, currency: "eur" }, order), false);
  assert.equal(validPaidCheckoutSession({ ...session, amount_subtotal: 4900 }, order), false);
  assert.equal(validPaidCheckoutSession({ ...session, amount_total: 4800 }, order), false);
  assert.equal(validPaidCheckoutSession({ ...session, client_reference_id: "another-order" }, order), false);
  assert.equal(validPaidCheckoutSession({ ...session, metadata: { order_id: "another-order" } }, order), false);
  assert.equal(validPaidCheckoutSession({ ...session, mode: "subscription" }, order), false);
  assert.equal(validPaidCheckoutSession({ ...session, payment_status: "unpaid" }, order), false);
});

test("Stripe signature accepts only valid recent signatures", async () => {
  const payload = JSON.stringify({ id: randomUUID() }); const secret = "whsec_example_for_tests";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(timestamp + "." + payload).digest("hex");
  assert.equal(await verifyStripeSignature(payload, "t=" + timestamp + ",v1=" + signature, secret), true);
  assert.equal(await verifyStripeSignature(payload, "t=" + timestamp + ",v1=invalid,v1=" + signature, secret), true);
  assert.equal(await verifyStripeSignature(payload, "t=" + timestamp + ",v1=bad", secret), false);
  assert.equal(await verifyStripeSignature(payload, "t=1,v1=" + signature, secret), false);
});


test("Stripe session linking remains valid when a paid webhook wins the race", async () => {
  let sql = "";
  let status = "paid";
  const db = {
    prepare(statement) {
      sql = statement;
      return {
        bind(sessionId, orderId) {
          assert.equal(sessionId, "cs_test_abc123");
          assert.equal(orderId, "order-1");
          return { run: async () => ({ meta: { changes: status === "pending" || status === "paid" ? 1 : 0 } }) };
        }
      };
    }
  };
  assert.equal(await linkStripeSession(db, "cs_test_abc123", "order-1"), true);
  assert.match(sql, /status IN \('pending', 'paid'\)/);
  status = "expired";
  assert.equal(await linkStripeSession(db, "cs_test_abc123", "order-1"), false);
});


test("public config reports checkout disabled when production gates are absent", async () => {
  const response = await (await import("../src/worker.js")).default.fetch(
    new Request("https://shop.example.com/api/config"),
    {}
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).checkoutEnabled, false);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("live Stripe Checkout sessions are rejected by the order-status route", async () => {
  const response = await (await import("../src/worker.js")).default.fetch(
    new Request("https://shop.example.com/api/order-status?session_id=cs_live_abc123"),
    {}
  );
  assert.equal(response.status, 400);
});

test("checkout fails closed before reading a request or contacting payment services", async () => {
  const response = await (await import("../src/worker.js")).default.fetch(
    new Request("https://shop.example.com/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [] })
    }),
    {}
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not activated/i);
});

test("admin routes reject missing credentials before database access", async () => {
  const response = await (await import("../src/worker.js")).default.fetch(
    new Request("https://shop.example.com/api/admin/orders"),
    {}
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Unauthorized.");
});

test("Stripe webhook rejects unsigned requests before database access", async () => {
  const response = await (await import("../src/worker.js")).default.fetch(
    new Request("https://shop.example.com/api/stripe/webhook", { method: "POST", body: "{}" }),
    {}
  );
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Invalid signature");
});


test("inventory reservation batches order creation and every item in one transaction", async () => {
  const batches = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        bind(...args) { return { sql, args }; }
      };
    },
    batch: async (statements) => {
      batches.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  const order = { sql: "INSERT INTO orders", bind: () => ({ sql: "INSERT INTO orders" }) };
  const items = [{ id: "product-1", quantity: 1 }, { id: "product-2", quantity: 2 }];
  const products = new Map(items.map((item) => [item.id, { priceCents: 2500 }]));
  assert.equal(await reserveOrderInventory(db, order, "order-atomic", items, products), true);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  assert.match(batches[0][1].sql, /INSERT INTO order_items/);
  assert.match(batches[0][2].sql, /INSERT INTO order_items/);
  assert.equal(batches[0][1].args[0], "order-atomic");
});

test("inventory reservation reports a failed order or item statement", async () => {
  const db = {
    prepare(sql) { return { sql, bind: (...args) => ({ sql, args }) }; },
    batch: async (statements) => statements.map((statement, index) => ({ meta: { changes: index === 1 ? 0 : 1 } }))
  };
  const items = [{ id: "product-1", quantity: 1 }];
  const products = new Map([["product-1", { priceCents: 2500 }]]);
  const order = { sql: "INSERT INTO orders" };
  assert.equal(await reserveOrderInventory(db, order, "order-incomplete", items, products), false);
});

test("inventory reservation propagates transaction aborts without partial compensation writes", async () => {
  const error = new Error("insufficient inventory");
  let batchCalls = 0;
  const db = {
    prepare(sql) { return { sql, bind: (...args) => ({ sql, args }) }; },
    batch: async () => { batchCalls += 1; throw error; },
    prepareCalls: []
  };
  const items = [{ id: "product-1", quantity: 1 }];
  const products = new Map([["product-1", { priceCents: 2500 }]]);
  await assert.rejects(() => reserveOrderInventory(db, { sql: "INSERT INTO orders" }, "order-abort", items, products), error);
  assert.equal(batchCalls, 1);
});
