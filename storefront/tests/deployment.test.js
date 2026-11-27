import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/deploy-storefront.yml", import.meta.url), "utf8");
const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("storefront production deployment remains manually triggered only", () => {
  const triggers = workflow.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1] ?? "";
  assert.match(triggers, /^\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(triggers, /^\s+(push|pull_request|schedule):/m);
});

test("deployment refuses live Stripe API keys", () => {
  assert.match(workflow, /STRIPE_SECRET_KEY.*?!= sk_test_\*/s);
});

test("paid checkout requires all payment and business release gates", () => {
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_SHIPPING_RATE_ID",
    "TURNSTILE_SECRET_KEY",
    "TURNSTILE_SITE_KEY"
  ]) {
    assert.match(workflow, new RegExp(key));
  }
  assert.match(workflow, /STORE_POLICIES_CONFIRMED.*?TAX_CONFIGURATION_CONFIRMED/s);
});

test("remote database migrations run before Worker deployment", () => {
  const migrations = workflow.indexOf("Apply D1 migrations");
  const deploy = workflow.indexOf("Deploy Worker and storefront assets");
  assert.notEqual(migrations, -1);
  assert.notEqual(deploy, -1);
  assert.ok(migrations < deploy);
});

test("new storefront configuration keeps checkout and confirmations disabled", () => {
  assert.equal(wrangler.vars.STORE_CHECKOUT_ENABLED, "false");
  assert.equal(wrangler.vars.STORE_POLICIES_CONFIRMED, "false");
  assert.equal(wrangler.vars.TAX_CONFIGURATION_CONFIRMED, "false");
});


test("production deployment requires explicit deployment and store release approvals", () => {
  assert.match(workflow, /STORE_DEPLOYMENT_APPROVED/);
  assert.match(workflow, /STORE_RELEASE_APPROVED/);
  assert.match(workflow, /STORE_DEPLOYMENT_APPROVED.*?!= "true".*?STORE_RELEASE_APPROVED.*?!= "true"/s);
  assert.equal(wrangler.vars.STORE_RELEASE_APPROVED, "false");
});

test("production deployment requires every business and operational release gate before remote migrations", () => {
  const requiredGates = [
    "STORE_POLICIES_CONFIRMED",
    "TAX_CONFIGURATION_CONFIRMED",
    "STORE_RETURNS_PRIVACY_POLICIES_CONFIRMED",
    "STORE_SHIPPING_FULFILLMENT_CONFIRMED",
    "STORE_BACKUP_RESTORE_VERIFIED",
    "STORE_END_TO_END_ACCEPTANCE_CONFIRMED"
  ];
  for (const key of requiredGates) {
    assert.match(workflow, new RegExp(key));
  }
  const gateLoop = workflow.indexOf('for key in "${release_gates[@]}"; do');
  const migrations = workflow.indexOf("Apply D1 migrations");
  assert.notEqual(gateLoop, -1);
  assert.ok(gateLoop < migrations, "All owner confirmations must be checked before remote D1 migrations");
});

test("production deployment requires explicit shipping scope and Stripe test credentials", () => {
  assert.match(workflow, /required=\([^\n]*SHIPPING_ALLOWED_COUNTRIES[^\n]*STRIPE_SECRET_KEY[^\n]*STRIPE_WEBHOOK_SECRET[^\n]*STRIPE_SHIPPING_RATE_ID[^\n]*TURNSTILE_SECRET_KEY[^\n]*TURNSTILE_SITE_KEY/);
  assert.match(workflow, /if \[\[ "\$STRIPE_SECRET_KEY" != sk_test_\* \]\]/);
  assert.match(workflow, /config\.vars\.SHIPPING_ALLOWED_COUNTRIES = process\.env\.SHIPPING_ALLOWED_COUNTRIES;/);
  assert.doesNotMatch(workflow, /SHIPPING_ALLOWED_COUNTRIES = process\.env\.SHIPPING_ALLOWED_COUNTRIES \|\| "US"/);
});
