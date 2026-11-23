import test from "node:test";
import assert from "node:assert/strict";
import { checkoutConfigured, constantTimeEqual, linkStripeSession, validateProduct, verifyStripeSignature } from "../src/worker.js";
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
