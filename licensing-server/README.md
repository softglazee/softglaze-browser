# SoftGlaze Licensing Server

Multi-tenant licensing + payment backend for SoftGlaze Browser. It is the **source
of truth** for who has paid and what they're entitled to — the desktop app only
*verifies* a short-lived, cryptographically-signed lease it cannot forge.

> **Status.** Tenant provisioning, hosted checkout and signature-verified webhooks
> for **Stripe, PayPal and Cryptomus**, Ed25519 license leases, backend-issued redeem
> codes, per-tenant key rotation and recurring Stripe subscriptions are all
> implemented and covered by `npm test` (23 unit tests) plus an end-to-end check
> against a running server (`scripts/e2e-local.js`, 18 checks). What is **not** done
> is operational: this is not hosted anywhere, no tenant's provider keys are set, and
> the recurring-subscription path has not been exercised against a live Stripe test
> account. It also sends no email, so a purchase made anywhere other than inside the
> app has no way to reach the buyer.

## Why this exists
The desktop app alone can't enforce licensing: a shipped signing secret can be
extracted and a locally-polled "paid" status can be spoofed. This server fixes both:

- **Payments are authenticated server-side** — each tenant's provider webhook is
  signature-verified here; the client never self-certifies payment.
- **Entitlement is un-forgeable** — each tenant has its own **Ed25519** keypair; the
  **private** key never leaves this server, and the desktop ships only the **public**
  key (baked into its build) to verify leases. No shared secret in any binary.

## Model (locked decisions)
- **Central multi-tenant** — one backend, many buyer-merchants (tenants).
- **Per-tenant stored keys** — each merchant supplies their own Stripe/PayPal/Cryptomus
  keys; stored AES-256-GCM-sealed at rest (`MASTER_KEY`).
- **Per-tenant Ed25519 keypair** — baked into each merchant's white-label build.
- **Baked tenant build** — `tenantId` + `apiBaseUrl` + `publicKeyPem` compiled in.
- **7-day offline leases** — refreshed online; offline grace until expiry.

## Stack
Node + Express + Prisma/**MySQL**. Hosting-agnostic (runs on any Node host: a VPS,
Render/Railway/Fly, etc.). Needs a public HTTPS URL for provider webhooks. Production
runs on the Hostinger account's MySQL (shared hosting has no Postgres), so the schema's
Prisma provider is `mysql`.

## Setup
```bash
cd licensing-server
cp .env.example .env            # fill DATABASE_URL + MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # -> MASTER_KEY
npm install
npm run prisma:generate
npm run prisma:deploy           # apply prisma/migrations (see "Database migrations")
npm run dev                     # or: npm start
```

### Run with Docker (MySQL + server, one command)
```bash
cd licensing-server
export MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export DB_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
docker compose up --build        # `migrate` applies prisma/migrations, then serves :8787
```
MySQL is bound to `127.0.0.1` only and has no default password. Keep both values in
a safe place: `MASTER_KEY` unseals the stored provider secrets, and the database volume
only opens with the password it was created with.
### Run it without Docker Compose
`docker compose up --build` builds a Node image; if that stalls or you would rather
iterate on the host, run MySQL in a container and the server on the host — the
schema and everything else are identical:
```bash
cp .env.example .env    # then fill MASTER_KEY + DB_PASSWORD (see above)
docker run -d --name sg-licensing-db   -e MYSQL_USER=softglaze -e MYSQL_PASSWORD="$DB_PASSWORD" -e MYSQL_ROOT_PASSWORD="$DB_PASSWORD"   -e MYSQL_DATABASE=softglaze_licensing -p 127.0.0.1:3306:3306 mysql:8
npm install
npx prisma migrate deploy   # DATABASE_URL must use localhost
npx prisma generate
npm start
```
Stop and resume later with `docker start sg-licensing-db` — the volume keeps the data.

### Database migrations
The schema is versioned in `prisma/migrations` and applied with
`npx prisma migrate deploy` (`npm run prisma:deploy`); Compose runs it as the one-shot
`migrate` service before the server starts. Nothing runs `prisma db push
--accept-data-loss` any more, so a schema change can no longer silently drop data.
To change the schema: edit `prisma/schema.prisma`, then `npm run prisma:migrate --
--name <change>` against a dev database and commit the new folder.

**Baselining a database that was created by the old `db push`.** Its tables already
match `20260916000000_init`, but it has no migration history, so `migrate deploy`
would try to create them again. Mark the baseline as applied once, then deploy the rest:
```bash
npx prisma migrate resolve --applied 20260916000000_init
npx prisma migrate deploy      # applies 20261007000000_webhook_event_processed onwards
```
A fresh, empty database needs only `migrate deploy`.

### End-to-end check (proves both halves agree)
```bash
npm run provision -- "SoftGlaze"        # prints the tenant id + API key once
node scripts/e2e-local.js <tenantId> <tenantApiKey>
```
This registers an install, refuses a re-registration without the install secret,
mints and redeems an activation code, then takes the signed lease and verifies it
with the **desktop app's own** `licenseClient.verifyLease()` using nothing but the
public key from `tenants/<id>.config.json` — the file the app build bakes. It also
confirms a lease edited to claim a higher tier, and a lease checked against another
tenant's key, both fail. 18 checks; no payment provider needed.

Smoke-test a running server (no local DB needed):
```bash
BASE=http://localhost:8787 node scripts/smoke.js            # /health
BASE=http://localhost:8787 node scripts/smoke.js <tenantId> # + register + license
```

### Recurring subscriptions (Stripe)
Mark a plan `recurring: true` (and `interval: "month"|"year"`) and checkout uses
Stripe **subscription** mode. The webhook handles `checkout.session.completed`
(initial), `invoice.paid` (renewal → sets the exact period end; the subscription id
is read from `invoice.subscription` or `invoice.parent.subscription_details.subscription`,
whichever the endpoint's API version sends), and
`customer.subscription.deleted` (→ license expires). One-time plans
(`recurring: false`) keep the grant-N-months model. **Validate against a live
Stripe test account** — this path can't be exercised offline.

## Provision a tenant (merchant)
```bash
npm run provision -- "Acme Browsers"
```
Prints the **tenant API key** once and writes `tenants/<id>.config.json`:
```json
{ "tenantId": "...", "apiBaseUrl": "https://api.example.com", "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..." }
```
**Bake that config into the merchant's desktop build** (the client reads it at runtime
and verifies leases with `publicKeyPem`).

## Configure a tenant (using its API key)
```bash
# 1) Payment keys (returns the webhook URL to set in the merchant's Stripe dashboard)
curl -XPOST $BASE/v1/tenant/payment-config -H "Authorization: Bearer $TENANT_KEY" \
  -H 'content-type: application/json' \
  -d '{"provider":"stripe","enabled":true,"secretKey":"sk_test_...","webhookSecret":"whsec_..."}'

# 2) Plans
curl -XPOST $BASE/v1/tenant/plans -H "Authorization: Bearer $TENANT_KEY" \
  -H 'content-type: application/json' \
  -d '{"key":"pro","name":"Pro","tier":"pro","amount":500,"currency":"USD","months":1}'

# 3) (optional) Activation codes for manual sales
curl -XPOST $BASE/v1/tenant/codes -H "Authorization: Bearer $TENANT_KEY" \
  -H 'content-type: application/json' -d '{"tier":"pro","months":1,"count":5}'
```
`amount` is in **minor units** (cents): `500` = $5.00.

## Client (desktop) flow
1. `POST /v1/register {tenantId, machineId}` → `{installId, installSecret}` (once per
   machine). The secret is returned only on first registration; the server keeps its
   SHA-256. Re-registering a known machine requires `installSecret`, otherwise 403.
2. Buy: `POST /v1/checkout {tenantId, planKey, installId}` → `{url}` → open in browser.
3. Stripe → `POST /v1/webhooks/stripe/:tenantId` (verified) → license provisioned for that
   installId. An email in checkout is recorded but never selects or moves a licence.
4. `POST /v1/license {tenantId, installId, installSecret, machineHash}` → `{lease}` (signed).
   A wrong or missing secret is 401. The app verifies the lease with the baked public key,
   caches it (sealed), and re-checks within 7 days. See **Machine binding** below.
5. `POST /v1/redeem {tenantId, code, installId, installSecret}` applies a code to that install.

### Machine binding (audit L3)
An install secret alone could be copied to any number of PCs, so each install is now
bound to one machine:
- The desktop sends `machineHash`, a SHA-256 of its OS machine identity (Windows
  MachineGuid, macOS IOPlatformUUID, Linux machine-id) salted with the tenant id, on
  `/v1/register` and every `/v1/license`. Raw hardware ids never leave the machine; the
  server accepts only a 64-char hex hash.
- Trust on first use: an install with no stored hash (`Install.machineHash`) binds to the
  first one it sees. A different hash gets **403 `{error:"machine_mismatch"}`** and no
  lease; a missing hash gets 400 `machine_required`.
- The lease carries the hash as `mid`; the desktop refuses a lease whose `mid` is not its
  own. Leases issued before this change have no `mid` and are honoured only until their own
  expiry (at most `LEASE_DAYS`), then the app fetches a bound one.

Legitimate PC change, two ways:
- **Merchant reset** (no limit): `POST /v1/tenant/installs/:installId/reset-machine` with the
  tenant API key clears the binding; the customer's next licence check from the new PC
  binds to it.
  ```bash
  curl -XPOST $BASE/v1/tenant/installs/$INSTALL_ID/reset-machine -H "Authorization: Bearer $TENANT_KEY"
  ```
- **Self-service transfer**: `POST /v1/license/transfer {tenantId, installId, installSecret,
  machineHash, proof}` from the new PC (after the user moves the install id + secret there).
  The install secret is exactly what gets shared, so it is not enough on its own: `proof`
  must be a proof of purchase the schema already holds, strongest first: the activation
  code this install redeemed (`LicenseCode.redeemedBy`), the licence's provider reference
  (`License.providerRef`: Stripe subscription / order id, PayPal or Cryptomus order id), or
  the `providerRef` of a paid `Payment` for this install (checkout session / order id).
  Limited to **2 transfers per licence per rolling 30 days** (`License.rebindCount`,
  `rebindWindowStart`). Errors: 403 `invalid_proof`, 404 `no_license`, 429
  `transfer_limit` (with `retryAt`).

## Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| POST | `/v1/register` | tenant-scoped | register an install |
| POST | `/v1/checkout` | tenant-scoped | create a hosted payment session |
| POST | `/v1/webhooks/{stripe,paypal,cryptomus}/:tenantId` | provider signature | provision on payment |
| POST | `/v1/license` | tenant-scoped | issue a signed lease (machine-bound) |
| POST | `/v1/license/transfer` | install secret + proof of purchase | move a licence to a new PC (2 per 30 days) |
| POST | `/v1/redeem` | tenant-scoped | redeem an activation code |
| POST | `/v1/tenant/payment-config` | tenant API key | set provider keys |
| POST/GET | `/v1/tenant/plans` | tenant API key | manage plans |
| POST | `/v1/tenant/codes` | tenant API key | mint activation codes |
| POST | `/v1/tenant/rotate-key` | tenant API key | rotate the tenant Ed25519 keypair |
| POST | `/v1/tenant/installs/:installId/reset-machine` | tenant API key | clear an install's machine binding |

### Provider credentials (`/v1/tenant/payment-config`)
All keys are sealed at rest; configure the webhook URL it returns in the provider dashboard.
Each save replaces the provider's whole credential set; every required field must be
present and non-empty or the call is a 400 (`src/providers/configFields.js`).
- **stripe**: `{ secretKey, webhookSecret }` (both required)
- **paypal**: `{ clientId, clientSecret, webhookId, env? }` — `env` is `"live"` (default)
  or `"sandbox"`
- **cryptomus**: `{ merchantId, apiKey }` (both required; the webhook signature is
  verified offline with `apiKey`, and a webhook is rejected while it is empty)

### Webhook behaviour
- **Idempotent and retry-safe.** The `WebhookEvent` row is inserted before processing
  (a duplicate delivery hits the primary key and is answered `duplicate: true`).
  Provisioning and marking the event processed commit in one transaction; a failed
  attempt deletes its row and returns 500, so the provider's retry is processed.
- **One grant per payment.** A webhook provisions only the `Payment` recorded at
  checkout for that provider and ref, and only while it is `pending`; it becomes `paid`
  in the same transaction. A replayed or second event for a paid order does nothing.
- **Stripe**: a session is provisioned only when `payment_status` is `paid`; delayed
  methods are provisioned by `checkout.session.async_payment_succeeded`, and
  `checkout.session.async_payment_failed` marks the payment `failed`.
- **Stripe refunds and disputes** (`charge.refunded` when fully refunded,
  `charge.dispute.created`): the schema has one licence per install with stacked
  terms, so the conservative action is to take back exactly what that payment bought.
  A one-time payment becomes `refunded` and its plan term (`months × 30 days`) is cut
  from the install's licence; if nothing paid remains, the licence ends now as
  `canceled`. A subscription charge ends the subscription's licence now. Partial
  refunds leave the licence alone. The charge is matched through the Stripe API
  (Checkout Session by `payment_intent`, else the invoice's subscription).
- **PayPal**: `CHECKOUT.ORDER.APPROVED` captures the order (with a `PayPal-Request-Id`
  derived from the order id, so a retried capture is not a second charge) and
  provisions only if the capture is `COMPLETED`. A failed capture returns 500 so PayPal
  retries; a pending capture is provisioned by `PAYMENT.CAPTURE.COMPLETED`.

Public endpoints (`register`/`checkout`/`license`/`redeem`) are rate-limited (120/min/IP,
in-memory per instance — move to a shared store for multi-instance).

## Going live — the whole sequence

Nothing below is code work; it is the operational half that turning checkout on
depends on (see `browser-site/06-SITE-TERMS.md` §7).

1. **Host this server** on any Node host, behind a reverse proxy that terminates
   TLS. Set `DATABASE_URL`, `MASTER_KEY` (from a secret manager, not a file) and
   `PUBLIC_BASE_URL` to the public HTTPS origin. `MASTER_KEY` unseals every stored
   provider secret and tenant private key: lose it and every licence stops
   verifying; leak it and the signing keys are compromised. Back it up separately
   from the database, and never in the same place.
   The compose file publishes the server on `127.0.0.1` on purpose — the proxy
   reaches it there, and nothing should reach it in cleartext from outside.
2. **Provision the production tenant** on that host:
   `npm run provision -- "SoftGlaze"`. Store the tenant API key in a password
   manager; it is shown once and there is no recovery, only rotation.
3. **Set the payment keys** with `POST /v1/tenant/payment-config`, then point the
   provider's webhook at the URL that call returns. Stripe's signing secret must be
   the one for *that* endpoint.
4. **Create the plan**: `POST /v1/tenant/plans` with
   `{"key":"pro","name":"Pro","tier":"pro","amount":500,"currency":"USD","months":1,"interval":"month","recurring":true}`.
   `amount` is in cents, so 500 is the $5/month the site advertises.
5. **Exercise a real payment** in Stripe test mode, including a renewal. This is the
   one path that cannot be verified offline.
6. **Build the installer** from the app repo, which bakes the tenant config:
   `npm run build:tenant -- licensing-server/tenants/<tenantId>.config.json`.
   `scripts/check-tenant-baked.js` refuses a build whose config is empty, points at
   localhost, or carries a private key — so a base build cannot be shipped by
   accident. A base build is still fine for development:
   `SG_ALLOW_BASE_BUILD=1 npm run build`.
7. **Then** flip `commerce.checkoutEnabled` on the site, once there is a real
   checkout URL to send people to and step 3 is done.

Rotating a tenant's keypair (`POST /v1/tenant/rotate-key`) invalidates every lease
signed by the old key, so every install has to fetch a new one. Installs that are
offline keep working until their cached lease expires, then lock — so rotate only
deliberately, and ship the new public key in a build first.

## Security notes / TODO before production
- Put this behind **HTTPS/TLS** (required for Stripe webhooks + the Bearer keys).
- `MASTER_KEY` should come from a real secret manager, not a flat `.env`, in prod.
- Add request logging on the public endpoints (rate limiting is in place: 120/min/IP).
- Add an admin auth layer for any cross-tenant ops.
- Move the in-memory rate limiter to a shared store (Redis) for multi-instance.
- **Exercise the recurring-subscription path against a live Stripe test account.**
  The code handles `checkout.session.completed` in subscription mode, `invoice.paid`
  (renewal → exact period end) and `customer.subscription.deleted` (→ expired), but
  that cannot be verified offline, so treat it as untested until it has been.
- Decide how a buyer who paid outside the app receives their licence. Right now a
  licence binds to an `installId` and leases are issued only for that install, so
  the working purchase flow is in-app. A web purchase would need this server to
  email an activation code, and it has no mail transport.

## What this does NOT do
Any client-side license can ultimately be patched out of an open desktop binary.
This makes **payment authentic** and **entitlement un-forgeable without cracking the
binary** — the right bar for a local tool. True uncrackability needs server-side
execution of the gated features, which isn't feasible for a local browser.
