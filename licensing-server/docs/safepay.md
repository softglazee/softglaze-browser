# Safepay (cards, Pakistan)

Safepay (getsafepay.pk) is a website checkout provider like Stripe, PayPal and Cryptomus. The app lists
it as **Safepay (cards)** once its keys are saved and enabled.

## 1. Get the sandbox keys

In the Safepay **sandbox** dashboard:

1. **Developer > API**: copy the **public key** (the merchant API key) and the **secret key**.
2. **Developer > Endpoints**: add the webhook URL

   ```
   https://api.softglaze.com/v1/webhooks/safepay/<tenantId>
   ```

   then click **View shared secret** and copy it. That is the `webhookSecret`.

## 2. Save them on the licensing server

```
POST /v1/tenant/payment-config        (Bearer: the tenant API key)
{
  "provider": "safepay",
  "enabled": true,
  "publicKey": "<public key>",
  "secretKey": "<secret key>",
  "webhookSecret": "<endpoint shared secret>",
  "env": "sandbox"
}
```

The response returns the webhook URL to paste into Safepay. All three keys are required; `env` is
`sandbox` (default) or `live`. Each save replaces the whole set. If the admin setting
`checkout.providers` is a list (not `null`), add `"safepay"` to it, or the app will not offer it.

**Webhooks may not arrive.** In the first sandbox test (18 Nov 2026) Safepay delivered no webhook at
all for a completed payment (Webhook Logs empty, endpoint "NO EVENT"), so one-time payments do not
depend on them. Subscriptions still do: their renewals and cancellations arrive only by webhook.

## 3. Test with sandbox cards

From Safepay's test-card list (Safepay's own examples use expiry `12/2028` and CVV `123`):

| Result | Card numbers |
| --- | --- |
| Success, frictionless | 4456 5300 0000 1005, 5200 0000 0000 1005 |
| Success, 3-D Secure step-up | 4000 0000 0000 2503, 4456 5300 0000 1096, 5200 0000 0000 1096 |
| Declined, frictionless | 4456 5300 0000 1013, 5200 0000 0000 1013 |
| Declined, step-up | 4456 5300 0000 1104, 5200 0000 0000 1104 |

Check each payment in the sandbox dashboard (**Payments > Payments 2.0**) and the matching row in
the admin payments list (status `paid`). Do one monthly subscription and one one-time plan if both
are sold.

## 4. Go live

1. Safepay must approve the live account and switch on card payments for it.
2. In the **live** dashboard, copy the live public and secret keys, add the same webhook URL under
   Developer > Endpoints and copy its **live** shared secret (it is different from the sandbox one).
3. Save again with `"env": "live"` and the three live keys.

## How it works

- **One-time plan**: the server creates a payment session (`POST /order/payments/v3/`, amount in
  cents from our Plan row) and an auth token, and sends the buyer to the hosted checkout
  (`/embedded/`). Safepay sends the buyer back to `/v1/checkout/return/success` and appends
  `?order_id=...&tracker=...`. **Verification on return is the primary path**: the server asks
  Safepay `GET /reporter/api/v1/payments/<tracker>` with the tenant's secret key, and only when Safepay
  answers `TRACKER_ENDED` (dashboard "Complete") with our amount and currency (`purchase_totals`
  quote amount, or base amount) does it provision the licence. The tracker in the URL only says which
  pending Payment to check; it never grants anything by itself. The cron (every 15 minutes) does the
  same check for one-time Safepay payments still pending 2 minutes to 48 hours after checkout, for
  buyers who closed the tab before the return page. The `payment.succeeded` webhook, if Safepay sends
  it, provisions the same way; whichever comes first wins and the others do nothing.
- **Website purchase** (browser.softglaze.com/buy, no app): `POST /v1/checkout` without `installId`,
  with the buyer's email in `account` (validated, no temporary-mail domains) and a one-time plan. The
  Payment is recorded with `method: "web"`. Safepay returns the buyer to
  `https://browser.softglaze.com/buy/thanks?order_id=...&tracker=...` (cancel: `/buy?cancelled=1`); that
  page polls `GET /v1/checkout/status?tenantId=...&tracker=...`, which runs the same Safepay check and
  answers only `{ "status": "paid" | "pending" | "unknown" }`. When paid, no licence is created: one
  single-use activation code (tier and months of the plan) is minted, written on the Payment's note and
  emailed to the buyer; they enter it in the app (Billing, "Have a purchase code?"). Retries, the cron
  and webhooks never mint a second code. CORS allows only the website origin and localhost.
- **Recurring plan**: each checkout creates its own Safepay plan from our Plan row
  (`POST /client/plans/v1/`, MONTH or YEAR), so the price charged can never differ from ours, and
  sends the buyer to `/checkout/auth/login`. The plan token is the checkout reference: the first
  `subscription.payment.succeeded` activates the licence, each later one extends it, and
  `subscription.cancelled` ends it. Abandoned checkouts leave unused plans in the Safepay dashboard;
  they charge nothing.
- **Safety**: every webhook must carry a valid `X-SFPY-SIGNATURE` (HMAC-SHA256 of the raw body with
  the shared secret). Events are processed once (event `token`). A failed payment, or an amount or
  currency different from the checkout, grants nothing; such a payment stays `pending` in the admin
  for a manual check.
