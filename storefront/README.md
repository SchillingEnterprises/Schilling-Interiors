# Schilling Interiors Storefront

This is a separate Cloudflare Workers + D1 commerce application. It does not replace the existing GitHub Pages photo archive. The archive stays intact; this shop has its own deployment and URL.

## Implemented

- Public product catalogue and shopping bag.
- Admin-only product creation, editing, publishing/unpublishing, and read-only order list.
- D1-backed product, order, inventory-reservation, and Stripe-event records.
- Atomic order creation and inventory reservation in one D1 batch transaction, enforced by database triggers; finite stock cannot be oversold by concurrent checkouts.
- Stripe-hosted Checkout Sessions; card details never pass through this Worker.
- Signed, idempotent Stripe webhook handling for test-mode paid, expired, and failed checkout sessions; live-mode session events are rejected before any database write. Paid sessions must match the stored order identity, currency, and item subtotal before an order can be marked paid.
- Reserved stock is released on failed or expired checkouts; successful payment finalizes the reservation.
- Cloudflare Turnstile gate on checkout and an admin token of at least 32 characters.
- No card details or shipping address are stored in D1.

There are deliberately no sample products. The old photo archive is not a product catalogue, and third-party brand imagery is not automatically stock Schilling Interiors is authorized to sell. Add only products, images, prices, and inventory the business is entitled to sell.

## Local checks

Run from this directory:

```sh
npm test
npm run check
```

For local Worker development, create a Cloudflare D1 database, replace the database ID in `wrangler.jsonc`, copy `.dev.vars.example` to `.dev.vars`, and use Wrangler to apply the local migration and start the Worker:

```sh
npx wrangler d1 migrations apply schilling-interiors-store --local
npx wrangler dev
```

The example secrets are intentionally invalid. Use Stripe test credentials, a test webhook signing secret, Turnstile keys, and a D1 database for end-to-end tests. Do not use real customer information for development.

## Production deployment

The manual `Deploy storefront` workflow deploys the Worker and static assets. It applies D1 migrations first. It requires these GitHub repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, and `ADMIN_API_TOKEN`.

Set these repository variables: `PUBLIC_STORE_URL` (the final HTTPS storefront URL), `STORE_CHECKOUT_ENABLED=false`, `STORE_POLICIES_CONFIRMED=false`, `TAX_CONFIGURATION_CONFIRMED=false`, `TURNSTILE_SITE_KEY`, `SHIPPING_ALLOWED_COUNTRIES` (ISO country codes; default US), and `STRIPE_AUTOMATIC_TAX` (keep false until correctly configured).

To enable paid checkout, also add secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SHIPPING_RATE_ID`, and `TURNSTILE_SECRET_KEY`. Configure a Stripe webhook at `https://YOUR_STORE_HOST/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.expired`, and `checkout.session.async_payment_failed`. Create a Stripe shipping rate that reflects real delivery costs. Update the public Turnstile domain/site settings. Then replace the policy placeholders in `public/policies.html`, publish the seller's contact details and final business policies, confirm tax obligations and the payment provider's tax settings, and only then set all three confirmation/enable flags to true.

This release intentionally accepts only Stripe test-mode API keys (`sk_test_`) and test Checkout Sessions (`cs_test_`). The Worker and manual deployment workflow reject live-mode keys/sessions. Do not remove this guard or enable live payments until the business owner has approved every release gate and the end-to-end acceptance process is complete. Complete test orders, shipping, tax, cancellation, expiration, webhook replay, and refund rehearsals using test credentials only. The deployment workflow is manual, so code pushes do not silently start taking live payments. Set up the Worker custom domain in Cloudflare and use its final HTTPS address as `PUBLIC_STORE_URL`.

## Cost notes

Cloudflare currently includes free Workers and D1 usage within published quotas; exceeding quotas, using paid Cloudflare features, purchasing a domain, and payment processing can cost money. Stripe processing fees still apply to successful payments. This is not a promise of zero-cost commerce.
## Order fulfillment and refunds

The admin order view supports the guarded paid-order lifecycle: unfulfilled → processing → shipped → fulfilled. Marking an order shipped requires a carrier, tracking number, and HTTPS tracking URL. Shipping addresses are retrieved on demand from the matching Stripe test Checkout Session for an authenticated admin; they are not persisted in D1 or written to logs. The admin view does not expose customer email or payment details.

A full-refund action is available only for a paid order linked to a verified Stripe test-mode Checkout Session and only when the Worker has an `sk_test_` key. The admin must explicitly confirm the action. Refund requests use a stable per-order Stripe idempotency key, and an uncertain provider response leaves the order in a pending refund state for reconciliation rather than permitting a duplicate retry. This is a test-mode engineering workflow, not production refund approval or live-payment capability.
The refund migration stores nullable provider IDs with a separate partial unique index so orders without refunds remain valid in SQLite/D1.

### Customer order tracking

The post-checkout confirmation page accepts only test-mode Checkout Session IDs and displays payment and fulfillment status. Once an authenticated administrator marks an order shipped with a carrier, tracking number, and HTTPS tracking URL, the customer confirmation page can display a direct carrier-tracking link. The public status response intentionally contains no customer email, shipping address, order line items, or payment details; the Checkout Session ID acts as the unguessable lookup reference.
