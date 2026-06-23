# SoftGlaze Licensing Server

Multi-tenant licensing + payment backend for SoftGlaze Browser. It is the **source
of truth** for who has paid and what they're entitled to — the desktop app only
*verifies* a short-lived, cryptographically-signed lease it cannot forge.

> **Phase 1** (this scaffold): tenant provisioning, **Stripe** test-mode checkout +
> signature-verified webhook, Ed25519 license leases, backend-issued redeem codes.
> PayPal/Cryptomus and recurring subscriptions come in later phases.

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
Node + Express + Prisma/**Postgres**. Hosting-agnostic (runs on any Node host: a VPS,
Render/Railway/Fly, etc.). Needs a public HTTPS URL for provider webhooks.

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
1. `POST /v1/register {tenantId, machineId}` → `{installId}` (once per machine).
2. Buy: `POST /v1/checkout {tenantId, planKey, installId}` → `{url}` → open in browser.
3. Stripe → `POST /v1/webhooks/stripe/:tenantId` (verified) → license provisioned.
4. `POST /v1/license {tenantId, installId}` → `{lease}` (signed). The app verifies the
   lease with the baked public key, caches it (sealed), and re-checks within 7 days.

## Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| POST | `/v1/register` | tenant-scoped | register an install |
| POST | `/v1/checkout` | tenant-scoped | create a hosted payment session |
| POST | `/v1/webhooks/stripe/:tenantId` | Stripe signature | provision on payment |
| POST | `/v1/license` | tenant-scoped | issue a signed lease |
| POST | `/v1/redeem` | tenant-scoped | redeem an activation code |
| POST | `/v1/tenant/payment-config` | tenant API key | set provider keys |
| POST/GET | `/v1/tenant/plans` | tenant API key | manage plans |
| POST | `/v1/tenant/codes` | tenant API key | mint activation codes |

## Security notes / TODO before production
- Put this behind **HTTPS/TLS** (required for Stripe webhooks + the Bearer keys).
- `MASTER_KEY` should come from a real secret manager, not a flat `.env`, in prod.
- Add **rate limiting** + request logging on the public endpoints.
- Add **per-tenant key rotation** and an admin auth layer for cross-tenant ops.
- Phase 4: PayPal + Cryptomus (per-tenant stored keys, per-tenant webhook verify),
  recurring subscriptions, and replay/nonce hardening.

## What this does NOT do
Any client-side license can ultimately be patched out of an open desktop binary.
This makes **payment authentic** and **entitlement un-forgeable without cracking the
binary** — the right bar for a local tool. True uncrackability needs server-side
execution of the gated features, which isn't feasible for a local browser.
