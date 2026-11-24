# Schilling Interiors Storefront

This is a separate Cloudflare Workers + D1 commerce application. It does not replace the existing GitHub Pages photo archive. The archive stays intact; this shop has its own deployment and URL.

## Implemented

- Public product catalogue and shopping bag.
- Admin-only product creation, editing, publishing/unpublishing, and read-only order list.
- D1-backed product, order, inventory-reservation, and Stripe-event records.
- Atomic order creation and inventory reservation in one D1 batch transaction, enforced by database triggers; finite stock cannot be oversold by concurrent checkouts.
- Stripe-hosted Checkout Sessions; card details never pass through this Worker.
- Signed, idempotent Stripe webhook handling for paid, expired, and failed checkout sessions. Paid sessions must match the stored order identity, currency, and item subtotal before an order can be marked paid.
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
