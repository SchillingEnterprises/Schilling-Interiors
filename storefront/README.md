# Schilling Interiors Storefront

A separate Cloudflare Worker + D1 storefront foundation. It does not replace the GitHub Pages archive and is not deployed by the Pages workflow.

## Implemented

- Public catalog API returns active products only.
- Product writes require a bearer token of at least 32 characters.
- Product validation constrains slugs, collections, price ranges, inventory values, and HTTPS image URLs.
- Cart quantities are validated server-side; checkout prices are read from D1, never trusted from the browser.
- Stripe Checkout sessions are created server-side, with US shipping-address collection and optional configured shipping rate/tax.
- Stripe webhook signatures are checked with HMAC-SHA256 and a five-minute timestamp tolerance; event IDs are deduplicated.
- Static assets receive restrictive browser security headers.
- Finite inventory is blocked at checkout until atomic stock reservation is implemented. Use null inventory only for products explicitly managed as unlimited stock.

## Local development

1. Use Node.js 22 or newer.
2. From this directory, run npm test and npm run check.
3. Use a pinned Wrangler CLI, for example: npx --yes wrangler@4.48.0 dev.
4. Copy .dev.vars.example to .dev.vars and use Stripe test-mode credentials only.
5. Create a local D1 database and apply migrations/0001_initial.sql before starting the Worker.

Never commit .dev.vars, production credentials, customer data, or database exports.

## Product administration

Create products through the authenticated Worker API. New products are inactive by default:

    curl -X POST "$PUBLIC_STORE_URL/api/admin/products" \
      -H "Authorization: Bearer $ADMIN_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"name":"Linen Napkin","slug":"linen-napkin","description":"Washed linen tabletop piece.","collection":"objects","image_url":"https://images.example.com/linen.jpg","price_cents":1800,"inventory_quantity":null,"active":false}'

Activate a product only after confirming its details, price, stock policy, image rights, shipping/returns terms, and business authorization. PATCH /api/admin/products/{id} updates editable fields. Never place the admin token in browser code.

## Production release gates

Do not deploy publicly or accept live payments until all of these are complete:

- Create a production D1 database, set its actual ID in wrangler.jsonc, and apply migrations with a reviewed backup/restore plan.
- Configure Worker secrets STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and a unique random ADMIN_API_TOKEN using Wrangler secrets; never put values in tracked files.
- Configure and verify the Stripe webhook endpoint /api/stripe/webhook for checkout completion, expiration, and asynchronous payment failures.
- Configure a real HTTPS PUBLIC_STORE_URL, shipping rates, tax policy, refund/returns policy, customer support, privacy disclosures, and fulfillment process.
- Implement atomic inventory reservation/release before selling finite-stock products.
- Confirm catalog accuracy, product ownership, image/trademark permissions, pricing, shipping eligibility, and applicable consumer/legal requirements.
- Run Stripe test-mode checkout, webhook replay/idempotency, failure, cancellation, and refund scenarios before live-mode approval.

No production database, Stripe account, secrets, or live payment configuration is created by this repository change.