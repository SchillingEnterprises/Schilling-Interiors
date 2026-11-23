# Security and Content Policy

## Scope

This is a public static image-led archive of six historic brand collections. It is not a live shop, customer portal, or current representation of the referenced brands.

## Safe use

- Confirm image, video, logo, and trademark permissions before copying, republishing, or using archive material commercially.
- External image sources may change, block hotlinking, or disappear. Review external URLs before publication.
- Do not add customer data, credentials, private contact information, or payment details to the static site.
- Do not imply current brand affiliation, product availability, endorsement, or commercial authorization without verification.
- The static site does not provide authentication or collect customer information. Review any future form, analytics, or commerce integration before enabling it.

## Reporting

Report suspected vulnerabilities privately through GitHub's private vulnerability reporting feature when available. Do not put personal data or secrets in public issues.


## Separate commerce application

The Cloudflare storefront under storefront/ is a separate application. Keep checkout disabled until the production database, inventory controls, Stripe webhook, Turnstile, access token, tax/shipping configuration, customer policies, and fulfillment process are reviewed and tested. Never commit Worker secrets, D1 exports, customer data, or payment information. The storefront admin token must remain in a secret manager and must never be embedded in browser assets.
