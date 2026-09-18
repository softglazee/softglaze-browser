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
npm run prisma:migrate          # create the schema (dev)
npm run dev                     # or: npm start
```

### Run with Docker (MySQL + server, one command)
```bash
cd licensing-server
export MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export DB_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
docker compose up --build        # syncs the schema (prisma db push) then serves :8787
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
npx prisma db push --skip-generate --accept-data-loss   # DATABASE_URL must use localhost
npx prisma generate
npm start
```
Stop and resume later with `docker start sg-licensing-db` — the volume keeps the data.

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
(initial), `invoice.paid` (renewal → sets the exact period end), and
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
4. `POST /v1/license {tenantId, installId, installSecret}` → `{lease}` (signed). A wrong or
   missing secret is 401. The app verifies the lease with the baked public key, caches it
   (sealed), and re-checks within 7 days.
5. `POST /v1/redeem {tenantId, code, installId, installSecret}` applies a code to that install.

## Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| POST | `/v1/register` | tenant-scoped | register an install |
| POST | `/v1/checkout` | tenant-scoped | create a hosted payment session |
| POST | `/v1/webhooks/{stripe,paypal,cryptomus}/:tenantId` | provider signature | provision on payment |
| POST | `/v1/license` | tenant-scoped | issue a signed lease |
| POST | `/v1/redeem` | tenant-scoped | redeem an activation code |
| POST | `/v1/tenant/payment-config` | tenant API key | set provider keys |
| POST/GET | `/v1/tenant/plans` | tenant API key | manage plans |
| POST | `/v1/tenant/codes` | tenant API key | mint activation codes |
| POST | `/v1/tenant/rotate-key` | tenant API key | rotate the tenant Ed25519 keypair |

### Provider credentials (`/v1/tenant/payment-config`)
All keys are sealed at rest; configure the webhook URL it returns in the provider dashboard.
- **stripe**: `{ secretKey, webhookSecret }`
- **paypal**: `{ clientId, clientSecret, env: "live"|"sandbox", webhookId }`
- **cryptomus**: `{ merchantId, apiKey }` (webhook signature is verified offline)

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
