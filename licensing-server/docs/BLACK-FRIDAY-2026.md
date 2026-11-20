# Black Friday 2026: lifetime plans, caps and sale windows

Code: `src/plans/sales.js` (branch `feat/black-friday`). Migration: `prisma/migrations/20261120110000_black_friday_lifetime_sales`.

## What the server does

| Rule | Where |
|---|---|
| A **lifetime plan** is `interval: "once"` with `months: 1200` (termDays(1200) = 36,500 days, so a licence runs to about 2126). `validatePlan` accepts 1200 only with interval `once` and not recurring. | `src/plans/service.js`, `src/plans/sales.js` |
| `saleCap` (how many may be sold, null = no cap), `saleStartsAt` / `saleEndsAt` (UTC, null = open on that side) are new nullable Plan columns. | schema + migration |
| **Sold** = the plan's Payment rows with status `paid`, from every route (website card, app checkout, invoice recorded in the admin, Microsoft Store). A refund frees its place. A pending website or app checkout holds a place for 30 minutes. | `salesCount`, `availability` |
| `POST /v1/checkout` answers **409** `sale_not_open`, `sale_ended` or `sold_out` (with `remaining`) before anything is created. | `src/routes/checkout.js` |
| `POST /v1/admin/payments` with a capped or windowed plan answers 409 the same way, unless the body has `allowOutsideOffer: true` (for an invoice issued inside the window and paid after it). The override is in the audit log. `grant.months` accepts 1200. | `src/admin/routes/payments.js` |
| `GET /v1/admin/plans` and `/plans/:key` show `lifetime` and `sales: { cap, sold, held, refunded, remaining, window, state, startsAt, endsAt }`. | `src/admin/routes/plans.js` |
| `GET /v1/plans/offers?tenantId=` (public, CORS `*`, cached 15 s): `{ offers: [{ key, name, tier, amount, amountDecimal, currency, lifetime, cap, sold, remaining, state, startsAt, endsAt }], at }`. `state` is `open`, `upcoming`, `ended` or `sold_out`. The website reads this for the "N of 500 left" line. | `src/routes/plansPublic.js` |
| `GET /v1/plans/public` **hides lifetime plans** unless `include=lifetime` (apps 1.0.26 and older would show "1200 months"). | `src/routes/plansPublic.js` |
| MRR leaves lifetime licences out: a licence on a lifetime plan, or any paid licence running more than 50 years (a redeemed lifetime code has no plan key). `computeMrr` returns `lifetimeLicences`. | `src/metrics/maths.js` |

A payment that settles after the cap was reached is still honoured (the buyer paid); only new checkouts are refused. With the 30-minute hold this can overshoot by at most the number of buyers who started checkout in the same few seconds as the last place.

The Microsoft Store sells whatever Partner Center offers: the server cannot stop a Store sale. Store sales still count in "sold" (they are Payment rows with the plan key). Stop a Store add-on with "Stop acquisition" in Partner Center when the window ends.

## Deploy (owner, by hand; production cannot run Prisma's schema engine)

1. Back up the database (as in `docs/DEPLOY.md`).
2. Apply the migration SQL by hand (MariaDB 11.8):
   ```sql
   ALTER TABLE `Plan` ADD COLUMN `saleCap` INTEGER NULL,
       ADD COLUMN `saleStartsAt` DATETIME(3) NULL,
       ADD COLUMN `saleEndsAt` DATETIME(3) NULL;
   CREATE INDEX `Payment_tenantId_plan_status_idx` ON `Payment`(`tenantId`, `plan`, `status`);
   ```
   Then record it as applied so a later `prisma migrate deploy` (if ever used) skips it, the same way the earlier hand-applied migrations were recorded.
3. Deploy the server build from `feat/black-friday` (merged into the release branch). The previous build runs fine on the new columns (it never reads them), so the SQL can go first.
4. Check: `curl -s "https://api.softglaze.com/v1/plans/offers?tenantId=<TENANT>"` answers `{"offers":[],...}`.

The Free plan migration `20261120120000_free_plan_partner_deals` (branch `feat/free-plan-server`) is independent: apply both, in either order.

## Admin steps: create the two lifetime plans (no code change)

`ADMIN_KEY` = an admin key; `API=https://api.softglaze.com`. Prices are cents. The window is 24 Nov 00:00 UTC to 1 Dec 23:59:59 UTC.

```bash
curl -s -X POST "$API/v1/admin/plans" -H "Authorization: Bearer $ADMIN_KEY" -H "X-Admin-Actor: azhar" -H "Content-Type: application/json" -d '{
  "key": "pro-lifetime", "name": "Pro Lifetime", "tier": "pro", "amount": 4900, "currency": "USD",
  "interval": "once", "months": 1200, "recurring": false, "active": true, "sortOrder": 20,
  "saleCap": 500, "saleStartsAt": "2026-11-24T00:00:00Z", "saleEndsAt": "2026-12-01T23:59:59Z",
  "description": "Pro for the life of the product, one payment.", "note": "Black Friday 2026"
}'
curl -s -X POST "$API/v1/admin/plans" -H "Authorization: Bearer $ADMIN_KEY" -H "X-Admin-Actor: azhar" -H "Content-Type: application/json" -d '{
  "key": "enterprise-lifetime", "name": "Enterprise Lifetime", "tier": "enterprise", "amount": 24900, "currency": "USD",
  "interval": "once", "months": 1200, "recurring": false, "active": true, "sortOrder": 21,
  "saleCap": 100, "saleStartsAt": "2026-11-24T00:00:00Z", "saleEndsAt": "2026-12-01T23:59:59Z",
  "description": "Enterprise (25 seats) for the life of the product, one payment.", "note": "Black Friday 2026"
}'
curl -s "$API/v1/admin/plans/pro-lifetime" -H "Authorization: Bearer $ADMIN_KEY" | grep -o '"sales":{[^}]*}'
```

Creating them before 24 Nov is safe: checkout refuses them (`sale_not_open`) until the window opens.

**Christmas wave (20 to 31 Dec), same prices, new batch.** Either reuse the plans (sold keeps counting, so raise the cap by the new batch) or, cleaner for reporting, make new keys:

```bash
# Option A: reuse (cap = November sold + Christmas batch)
curl -s -X PATCH "$API/v1/admin/plans/pro-lifetime" -H "Authorization: Bearer $ADMIN_KEY" -H "X-Admin-Actor: azhar" -H "Content-Type: application/json" \
  -d '{"saleCap": <SOLD_IN_NOVEMBER + NEW_BATCH>, "saleStartsAt": "2026-12-20T00:00:00Z", "saleEndsAt": "2026-12-31T23:59:59Z", "note": "Christmas 2026 batch"}'
# Option B: new keys pro-lifetime-xmas / enterprise-lifetime-xmas with the POST above and the December dates.
```

(Option B needs the website's `blackFriday.planKeys` changed to the new keys.)

## An invoice sale (bank transfer or Payoneer request)

1. Send the SMC invoice. When the money is seen, record it **with the plan key**, so it counts against the cap:
   ```bash
   curl -s -X POST "$API/v1/admin/payments" -H "Authorization: Bearer $ADMIN_KEY" -H "X-Admin-Actor: azhar" -H "Content-Type: application/json" \
     -d '{"customerId":"<CUSTOMER_ID>","amount":4900,"currency":"USD","method":"bank_transfer","reference":"SG-BF-0001","plan":"pro-lifetime"}'
   ```
   Paid after 1 Dec for an invoice issued inside the window: add `"allowOutsideOffer": true`.
2. Give the licence: either `"grant": true` in the same call when you know the buyer's install (months come from the plan: 1200), or mint a code with `POST /v1/tenant/codes` `{ tier, months: 1200 }` and email it (the buyer enters it on Billing > "Have a purchase code?").

## Website card (Safepay)

`/buy` and `/black-friday` call `POST /v1/checkout` with `planKey: "pro-lifetime"` or `"enterprise-lifetime"`. The paid payment gets a single-use activation code of the plan's tier and 1200 months by email (`src/webPurchase.js`): no change needed there. The card button on `/black-friday` stays hidden until the website flag is on AND `/v1/checkout/methods` says card is live.

## Microsoft Store (durable add-ons)

The server side is ready: map the add-ons with `PATCH /v1/admin/settings` `{"store":{"productPlans":{"pro_monthly":"pro","enterprise_monthly":"enterprise","pro_lifetime":"pro-lifetime","enterprise_lifetime":"enterprise-lifetime"}}}` (keep the existing rows). A durable add-on reports `Active` with a far end date and no recurrence, which `interpretStore` already treats as active until that date. **The app's Store purchase screen only offers monthly and yearly subscription add-ons today (`src/main/storeCommerce.js` periods `month` / `year`)**, so selling a durable add-on in the app needs an app change and a Store certification first. Until then, do not create the Store add-ons for this sale.
