# SoftGlaze licensing server: admin API and the new public endpoints

Base URL: `https://api.softglaze.com`. All bodies are JSON (`Content-Type: application/json`) unless
noted. Dates are ISO 8601 in UTC. **Money is always an integer in minor units (cents): `2900` = US$29.00.**

Contents: [Conventions](#conventions) · [Auth](#authentication) · [Customers](#customers) ·
[Trials and installs](#trials-and-installs) · [Licences](#licences) · [Payments](#payments) ·
[Plans](#plans) · [Email](#email) · [Segments](#segments) · [Settings](#settings) ·
[Metrics](#metrics) (with the maths) · [Audit log](#audit-log) · [Diagnostics](#diagnostics) ·
[App 1.0.23: sign-up required, lead fields, payment switches](#app-1023-sign-up-required-lead-fields-payment-switches) ·
[Public endpoints (app and website)](#public-endpoints-app-and-website) · [Privacy and retention](#privacy-and-retention)

## Conventions

- **Errors** are `{ "error": "<code>", "message": "<plain English>", ...extra }`. Codes used everywhere:
  `unauthorized` (401), `forbidden` (403), `not_found` (404), `validation_failed` (400, with
  `fields: { field: "what is wrong" }`), `bad_json` (400), `payload_too_large` (413),
  `rate_limited` (429). Endpoint-specific codes are listed with each endpoint.
- **Lists** take `page` (from 1) and `pageSize` (1-200, default 50) and answer
  `{ "items": [...], "total": 123, "page": 1, "pageSize": 50 }`.
- **Booleans in query strings**: `1`/`true`/`yes` and `0`/`false`/`no`. **Lists in query strings**: comma separated.
- Every change made through this API, every export, email send and erase is written to the
  [audit log](#audit-log). Plain reads are not.
- Admin responses carry `Cache-Control: no-store`. The admin API accepts bodies up to 10 MB (CSV imports).
- Rate limit: 600 requests per minute per client IP.

## Authentication

`Authorization: Bearer <key>` where the key is either

| Key | Looks like | Can call |
|---|---|---|
| Tenant admin key (the owner's, made by `run.sh new-key`) | `sgls_...` | `/v1/admin/*` and `/v1/tenant/*` |
| Scoped admin key (the website's, made by `run.sh set-site-admin-key`) | `sgla_...` | `/v1/admin/*` only |

The scoped website key cannot read or change payment-provider keys, rotate the signing key or mint
activation codes (`/v1/tenant/*`). Revoking or replacing it never touches the owner's key.

Send `X-Admin-Actor: <who>` (at most 100 characters, e.g. the logged-in team member) on every call from
the website. The audit log records `<key label>:<actor>`, e.g. `website:sara`.

**Website key file.** `run.sh set-site-admin-key` writes `~/domains/softglaze.com/sg-form-data/admin-api.json`
(mode 600) on the server:

```json
{ "apiBaseUrl": "https://api.softglaze.com", "tenantId": "cmu65rczt0000qkh0602kos0m",
  "keyId": "cm...", "adminKey": "sgla_...", "label": "website", "createdAt": "2026-11-20T09:00:00.000Z" }
```

The PHP admin reads it server-side only and never sends the key to a browser.

Errors: `401 unauthorized` (missing, wrong or revoked key), `403 forbidden` (key without the admin scope).

---

## Customers

One customer per person per tenant. The uniqueness key is `emailKey`: the address lowercased, and for
`gmail.com` / `googlemail.com` with the dots and `+tag` of the local part removed (and googlemail folded
into gmail), so `John.Smith+x@googlemail.com` and `johnsmith@gmail.com` are one customer.

**Customer object**

```json
{
  "id": "cm3x...", "email": "ana.lopez@example.com", "emailKey": "ana.lopez@example.com",
  "emailVerifiedAt": "2026-11-20T10:01:00.000Z", "name": "Ana Lopez", "company": "lopez.example", "country": "MX",
  "phone": "+52 55 1234 5678", "useCase": "ecommerce", "useCaseOther": null, "lang": "es", "source": "app",
  "status": "trial", "statusAuto": "trial", "statusOverride": null, "statusNote": null, "tier": "enterprise",
  "firstSeenAt": "2026-11-20T09:58:00.000Z", "lastSeenAt": "2026-11-21T08:00:00.000Z", "appVersion": "1.0.23",
  "firstChannel": "store",
  "trialStartedAt": "2026-11-20T10:02:00.000Z", "trialEndsAt": "2026-11-27T10:02:00.000Z",
  "paidSince": null, "paidUntil": null, "complimentaryUntil": null, "totalPaidCents": 0, "currency": null,
  "marketingConsent": true, "consentAt": "2026-11-20T10:01:00.000Z", "consentSource": "app_signup",
  "unsubscribedAt": null, "notes": null, "tags": ["beta"], "deletedAt": null,
  "createdAt": "2026-11-20T09:58:00.000Z", "updatedAt": "2026-11-21T08:00:00.000Z"
}
```

- `source`: `app` | `manual` | `import` | `invoice` | `website`.
- `phone`, `company`, `useCase`, `useCaseOther`: what the person typed in the app's sign-up or
  "Confirm your email" step (app 1.0.23 and later), stored once the code is proven. `useCase` is one of
  `ecommerce` | `social_media` | `affiliate_marketing` | `agency` | `web_research` | `other` (the use cases on
  the website home page); `useCaseOther` is their own words when they chose `other`, else `null`. A later
  confirmation with a field filled in replaces it; an empty field keeps what is stored. `null` for customers
  from older apps until they confirm.
- `firstChannel`: where the customer first installed the app from, `store` | `website` | `base`: the
  [install channel](#install-channel) of their earliest install that reported one; `null` until an
  install of theirs runs app 1.0.23 or later. Computed like `statusAuto` (read-only).
- `status` is what to show: `statusOverride` when set, else `statusAuto`. `statusAuto` is computed from
  licences, payments and trials (cron every 15 minutes and right after each change):

  | statusAuto | when (first match wins) |
  |---|---|
  | `paid` | an active, not complimentary licence whose term has not ended, or ended less than `billing.renewalGraceDays` (3) ago |
  | `cancelled` | had a paid licence; the latest was revoked or refunded |
  | `churned` | had a paid licence; it ran out (or the subscription ended) without renewal |
  | `trial` | a trial whose end is in the future |
  | `trial_expired` | had a trial, never paid |
  | `lead` | none of the above |

- A complimentary licence never makes a customer `paid`; it sets `complimentaryUntil` and `tier`.
- `totalPaidCents` sums settled (not refunded) payments in the customer's `currency` (that of their
  first payment).

### GET /v1/admin/customers

Filters (all optional, combined with AND):

| Param | Meaning |
|---|---|
| `status` | effective status list, e.g. `paid,churned` |
| `tier` | `pro`, `enterprise`, `none` |
| `source` | `app,manual,import,invoice,website` |
| `country` | ISO codes, `unknown` for none: `PK,US,unknown` |
| `useCase` | `ecommerce,social_media,affiliate_marketing,agency,web_research,other`, `none` for not given |
| `consent` | marketing consent `1` / `0` |
| `verified` | email verified by us `1` / `0` |
| `unsubscribed` | `1` / `0` |
| `complimentary` | has an active complimentary licence `1` / `0` |
| `tag` | tags list; the customer must have all of them |
| `q` | text search in email, name, company, phone, the "other" use case text; or an exact id |
| `createdFrom`, `createdTo`, `lastSeenFrom`, `lastSeenTo`, `paidUntilFrom`, `paidUntilTo`, `trialEndsFrom`, `trialEndsTo` | date ranges (inclusive) |
| `deleted` | `include` (also soft-deleted) or `only`; default: soft-deleted are left out |
| `ids` | comma-separated customer ids |
| `sort` | `createdAt` (default), `updatedAt`, `firstSeenAt`, `lastSeenAt`, `email`, `name`, `company`, `country`, `useCase`, `status`, `tier`, `paidUntil`, `paidSince`, `trialEndsAt`, `trialStartedAt`, `totalPaidCents`, `emailVerifiedAt` |
| `order` | `desc` (default) or `asc` |

Response: `{ "items": [Customer], "total": 2, "page": 1, "pageSize": 50 }`. Errors: `400 validation_failed`
(`fields` name the bad filters).

### GET /v1/admin/customers/export

The same filters, `sort` and `order`. Answers `text/csv; charset=utf-8` (UTF-8 BOM, CRLF) as an
attachment `customers-YYYY-MM-DD.csv` with every column:
`id,email,name,company,country,phone,useCase,useCaseOther,lang,source,status,statusAuto,statusOverride,statusNote,tier,emailVerifiedAt,firstSeenAt,lastSeenAt,appVersion,trialStartedAt,trialEndsAt,paidSince,paidUntil,complimentaryUntil,totalPaidCents,currency,marketingConsent,consentAt,consentSource,unsubscribedAt,tags,notes,createdAt,updatedAt,deletedAt`.
`useCase` and `useCaseOther` come from the app; an import lists them under `ignoredColumns`.
Tags are joined with `;`. Cells that start with `= + - @` are prefixed with `'` so spreadsheets do not run
them as formulas; the import removes that prefix again. Audited as `customers.export`.

### POST /v1/admin/customers/import

Body `{ "csv": "<file text>", "dryRun": true, "onExisting": "skip" }`, or the raw file with
`Content-Type: text/csv` and `?dryRun=false&onExisting=update`. `dryRun` defaults to **true**.

- Columns read (header names, any order, case-insensitive): `email` (required), `name`, `company`,
  `country` (ISO-2), `phone`, `lang`, `source`, `marketingConsent` (true/false/yes/no/1/0), `consentAt`,
  `consentSource`, `unsubscribedAt` (a date, or true), `tags` (`a;b`), `notes`. Any other column (for
  example the computed ones in an export) is listed in `ignoredColumns`.
- Duplicates are found by `emailKey`, inside the file and against existing customers.
- `onExisting: "skip"` leaves existing customers alone; `"update"` fills empty fields, adds tags, can
  turn consent on (never off) and records an unsubscribe. It never blanks a field.
- A consent without `consentAt` / `consentSource` is accepted with the import time and source `import`
  (reported as warnings). Up to 10 000 rows.

Dry-run response:

```json
{
  "dryRun": true, "onExisting": "skip",
  "summary": { "rows": 3, "create": 1, "update": 0, "skip": 1, "error": 1 },
  "items": [
    { "line": 2, "email": "new@example.com", "action": "create", "errors": [], "warnings": [] },
    { "line": 3, "email": "known@example.com", "action": "skip", "errors": [], "warnings": ["exists"], "customerId": "cm..." },
    { "line": 4, "email": "bad-address", "action": "error", "errors": ["invalid_email"], "warnings": [] }
  ],
  "ignoredColumns": ["status"], "columns": ["email", "name"]
}
```

Row errors: `invalid_email`, `duplicate_in_file:line_N`, `invalid_country`, `invalid_lang`, `invalid_source`,
`invalid_marketingConsent`, `invalid_consentAt`, `invalid_unsubscribedAt`. Row warnings: `exists`,
`disposable_email`, `consent_date_missing_used_import_time`, `consent_source_missing_used_import`.
Commit response: `{ "dryRun": false, "results": { "created": 1, "updated": 0, "skipped": 1, "errors": 1 }, "items": [...], "ignoredColumns": [...] }`.
Errors: `400 bad_request` (no file), `empty_file`, `missing_email_column`, `too_many_rows` (`max`).

### POST /v1/admin/customers/bulk

`{ "ids": ["cm1", "cm2"], "action": "addTags" | "removeTags" | "delete" | "restore", "tags": ["q4"] }`
(up to 5000 ids) → `{ "ok": true, "found": 2, "changed": 2 }`.

### GET /v1/admin/customers/:id

```json
{
  "customer": { "...": "Customer" },
  "installs": [{ "id": "...", "machineId": "...", "appVersion": "1.0.23", "channel": "store", "lastSeenAt": "...", "machineHash": "..." }],
  "trials": [{ "id": "...", "startedAt": "...", "endsAt": "...", "convertedAt": null, "resetAt": null, "machineLocked": true, "emailLocked": true }],
  "licenses": [{ "id": "...", "tier": "enterprise", "status": "active", "currentPeriodEnd": "...", "complimentary": false, "source": "manual", "note": "..." }],
  "payments": [{ "id": "...", "provider": "manual", "method": "invoice", "providerRef": "INV-2026-014", "amount": 2900, "currency": "USD", "status": "paid", "paidAt": "..." }],
  "emails": [{ "id": "...", "templateKey": "welcome", "subject": "...", "status": "sent", "sentAt": "..." }],
  "signInMethods": [{ "provider": "github", "email": "ana@example.com", "login": "ana-dev", "linkedAt": "...", "lastUsedAt": "..." },
                    { "provider": "email", "email": "ana@example.com", "login": null, "linkedAt": "...", "lastUsedAt": null }],
  "signIns": [{ "id": "...", "provider": "github", "installId": "...", "at": "...", "lastUsedAt": "...", "revokedAt": null }],
  "identities": [{ "id": "...", "provider": "github", "email": "ana@example.com", "login": "ana-dev", "emailVerified": true, "linkedAt": "...", "lastUsedAt": "..." }],
  "timeline": [{ "at": "...", "kind": "event | install | licence | payment | email", "type": "trial_started", "data": {} }]
}
```

The timeline merges status changes, sign-up, verification, consent changes, trials, licences, payments,
emails and notes, newest first. Errors: `404 not_found`.

One-click sign-in (app 1.0.26, see [One-click sign-in](#one-click-sign-in-app-1026) below):
`signInMethods` is what the customer can sign in with (their linked `Identity` rows, plus `email` whenever the
email is verified, since a code to it always works); `signIns` are the latest 50 app sign-ins (where and when,
never the session token); `identities` are the raw linked methods. The timeline gains `signed_in`
(`{ provider, installId, linked: identity | email | new }`), `signin_linked` (a new method was linked) and
`licence_moved` (`{ licenseId, from, to, by: "signin" }`) events.

### POST /v1/admin/customers

| Field | Rule |
|---|---|
| `email` | required, a real address |
| `name`, `company` | up to 200 characters |
| `country` | ISO-2, e.g. `PK` |
| `phone` | digits, spaces and `+ ( ) - .` |
| `lang` | two letters |
| `source` | `manual` (default), `import`, `invoice`, `website` |
| `tags` | array (or comma list); normalised to lowercase-with-dashes |
| `notes` | up to 10 000 characters |
| `marketingConsent` | boolean; `true` needs `consentSource` (where it was given) |
| `unsubscribed` | boolean |
| `statusOverride` | a status or null; setting one needs `statusNote` |

→ `201 { "customer": Customer, "warnings": ["disposable_email"] }`.
Errors: `400 validation_failed`, `409 customer_exists` (`customerId`, `deleted`).

### PATCH /v1/admin/customers/:id

Any field above. Changing `email` re-keys the customer and clears `emailVerifiedAt`. Turning consent off
records `consentSource: "admin"`. `statusOverride: null` clears an override.
→ `{ "customer": Customer, "changed": ["name", "status", "statusOverride"] }`.
Errors: `400 validation_failed`, `404 not_found`, `409 customer_exists`.

### DELETE /v1/admin/customers/:id

Soft delete: hidden from lists, receives no email, queued email cancelled. → `{ "ok": true, "deleted": true }`.

### POST /v1/admin/customers/:id/restore

→ `{ "customer": Customer }`.

### POST /v1/admin/customers/:id/erase

Privacy erase. Body `{ "confirm": "<the customer's email>" }` (any alias of the same mailbox is accepted).
→ `{ "erased": true, "kept": { "payments": 1, "totalPaidCents": 2900 } }`. See
[Privacy and retention](#privacy-and-retention) for what is kept. Errors: `400 confirm_mismatch`, `404 not_found`.

### POST /v1/admin/customers/:id/reset-trial

`{ "release": "all" | ["machine", "email", "network"], "reason": "Support ticket 42" }` → resets every trial
of this customer, see [trial reset](#post-v1admintrialsidreset). Errors: `404 no_trial`, `400 validation_failed`.

---

## Trials and installs

### GET /v1/admin/trials

Params: `customerId`, `installId`, `active` (1/0), `converted` (1/0), `from`, `to` (start date), paging.
Items: `{ id, customerId, installId, tier, startedAt, endsAt, convertedAt, networkCounted, resetAt, resetReason, resetBy, machineLocked, emailLocked }`
(hashes are never returned).

### POST /v1/admin/trials/:id/reset

`{ "release": "all" | ["machine", "email", "network"], "reason": "..." }` (reason 3-500 characters).
Clears the chosen locks so the same machine / email / network can start one more trial; the trial row
stays as history and a running trial keeps running. → `{ "ok": true, "reset": 1, "release": ["machine","email","network"] }`.

### GET /v1/admin/trial-attempts

Every `POST /v1/trial/start` outcome: `granted`, `repeat` (same install asked again), `used_machine`,
`used_email`, `used_network`, `not_verified`, `already_licensed`. Params: `outcome`, `from`, `to`, paging.

### GET /v1/admin/installs

Params: `customerId`, `unlinked=1` (installs without a customer), `channel` (list of `store`, `website`,
`base`, `unknown`; `unknown` = installs that never reported one, i.e. apps before 1.0.23; case-insensitive),
paging. Items have no secret hash; `machineBound` says if a machine is bound; `channel` is the
[install channel](#install-channel) (`null` when unknown).

```json
{ "items": [{ "id": "cm...", "machineId": "...", "account": null, "customerId": "cm...", "appVersion": "1.0.23",
  "channel": "store", "createdAt": "...", "lastSeenAt": "...", "machineHash": "...", "machineBoundAt": "...",
  "machineBound": true }], "total": 1, "page": 1, "pageSize": 50 }
```

Errors: `400 validation_failed` (`fields.channel`) for a value outside that list.

### POST /v1/admin/installs/:id/reset-machine

Clears the machine binding so the next licence check from a new PC binds it. → `{ "ok": true, "installId": "..." }`.

---

## Licences

A licence belongs to one install (one PC); the app gets leases for it from `/v1/license`. A month is 30 days and
12 months are 365 days (a yearly plan lasts a year).

### GET /v1/admin/licenses

Params: `status` (`active,canceled,expired`), `tier`, `customerId`, `installId`, `source` (`manual` or
`checkout` = gateway and activation codes), `complimentary` (1/0), `active` (1 = active and not ended),
`endsFrom`, `endsTo`, `sort` (`createdAt`, `updatedAt`, `currentPeriodEnd`), `order`, paging.

### POST /v1/admin/licenses (grant)

```json
{ "customerId": "cm...", "installId": "cm...", "tier": "enterprise", "months": 3,
  "plan": "enterprise", "complimentary": false, "reason": "Invoice INV-2026-014 paid by bank transfer" }
```

- `customerId` or `installId` (or both) is required. Term: `months` (1-120), `days` (1-3650) or `until` (a future date).
- Without an install the licence is **unbound**: it attaches automatically to the first install where the
  customer verifies their email, or use `/assign`.
- `complimentary: true` = free licence (partners, press): never counted as revenue, MRR or a paying customer.

→ `201 { "license": License, "bound": true }`.
Errors: `400 validation_failed`, `404 not_found`, `409 license_exists` (`licenseId`: extend it instead),
`409 install_other_customer`.

### POST /v1/admin/licenses/:id/extend

`{ "months": 1, "reason": "Goodwill after outage" }` (or `days`, or `until`). Extends from the current end
or from now, whichever is later, and re-activates a revoked licence. → `{ "license": License }`.

### POST /v1/admin/licenses/:id/revoke

`{ "reason": "Chargeback" }`. Ends it now (`status: canceled`); the app stops getting leases at its next
refresh and falls back to its offline grace. → `{ "license": License }`. Errors: `409 already_revoked`.

### POST /v1/admin/licenses/:id/assign

`{ "installId": "..." }` binds an unbound licence. Errors: `409 already_bound`, `409 license_exists`, `409 install_other_customer`.

---

## Payments

### GET /v1/admin/payments

Params: `status` (`pending,paid,failed,refunded`), `provider` (`stripe,paypal,cryptomus,manual,microsoft_store`),
`method`, `currency`, `customerId`, `from`, `to` (paid date), `sort` (`createdAt`, `paidAt`, `amount`), `order`, paging.

Microsoft Store payments (`provider=microsoft_store`, `method: store`) are recorded by the server, one per
billing period the Store reports active (`providerRef` = `msstore:<entitlementId>:<period end YYYY-MM-DD>`).
`amount`/`currency` are the Store's gross price the customer saw, in their currency, before Microsoft's fee
(15% for apps) and taxes; the money arrives as Microsoft's monthly payout, not per payment. `note` says
whether the purchase was verified with the Microsoft Store or only reported by the app (UNVERIFIED).
A Store refund marks the period's payment `refunded`; `POST /:id/refund` refuses them (`409 not_manual`).

### POST /v1/admin/payments (record a manual payment)

```json
{ "customerId": "cm...", "amount": 2900, "currency": "USD", "method": "bank_transfer",
  "reference": "UBL-TRX-88231", "paidAt": "2026-11-21T00:00:00Z", "plan": "enterprise",
  "note": "Paid in PKR, converted at the bank", "grant": { "months": 1, "tier": "enterprise", "installId": "cm..." } }
```

- `method`: `invoice`, `bank_transfer`, `payoneer`, `2checkout`, `other`. `reference` (2-120 characters) is
  the invoice number or transfer id; the same method + reference cannot be recorded twice.
- `grant` (optional; `true` or an object) also grants or extends the licence in the same call: the given
  install's licence, else the customer's latest paid licence, else a new one (bound to the customer's only
  free install, or unbound). Months and tier default to the plan's.

→ `201 { "payment": Payment, "license": License | null, "customer": { "id", "status", "paidUntil", "totalPaidCents" } }`.
Errors: `400 validation_failed`, `404 not_found`, `409 duplicate_payment` (`paymentId`).

### POST /v1/admin/payments/:id/refund

Manual payments only: `{ "reason": "..." }` → `{ "payment": Payment }` (status `refunded`, `refundedAt`).
The licence is not touched; revoke it separately if wanted. Gateway refunds arrive by webhook.
Errors: `409 not_manual`, `409 not_paid`.

---

## Microsoft Store subscriptions

The Store version of the app sells Pro and Enterprise as Microsoft Store subscription add-ons
(Product IDs mapped to plans in `settings.store.productPlans`). Each add-on on each install is a
**Store entitlement**; it drives one licence (`source: microsoft_store`, `providerRef: msstore:<id>`, see
`GET /v1/admin/licenses?source=microsoft_store`) and one payment per billing period.

**Verified vs unverified.** With the Microsoft Entra ID app saved for the tenant (`POST /v1/tenant/payment-config`
`{ "provider": "microsoft_store", "enabled": true, "entraTenantId", "clientId", "clientSecret" }`, tenant key; no
webhook), the server checks every claim with the Microsoft Store collection and purchase APIs and the cron
re-checks active subscriptions every 6 hours (renewals, cancellations, refunds) and renews the customers'
Store ID keys (valid 30 days) after 20 days. Without it, a purchase the app reports is accepted
**unverified**: at most `store.unverifiedDays` (7) at a time, extended only by the app reporting again, and
listed as an alert. `store.acceptUnverified: false` records such claims as `pending` instead, for the owner
to approve or refuse.

Entitlement fields: `id`, `installId`, `customerId`, `licenseId`, `productId` (Partner Center Product ID),
`planKey`, `tier`, `status` (`active`, `grace` (renewal payment failed, our short grace), `pending` (waiting for
the owner), `expired`, `canceled`, `refunded`, `revoked` (by the owner), `moved` (taken over by another
computer), `replaced` (reinstall on the same computer), `not_owned` (Microsoft does not list it)), `verified`,
`verifyNote` (`not_configured`, `no_keys`, `store_unreachable`, `store_auth`, `store_error`, `approved_by_admin`),
`expiresAt` (end of the paid period at Microsoft), `accessUntil` (what the licence grants), `autoRenew`,
`recurrenceId`, `recurrenceState`, `storeId`, `skuStoreId`, `subscriptionKey`, `priceFormatted`, `currency`,
`hasKeys`, `keysIssuedAt`, `movedAt`, `firstClaimAt`, `lastClaimAt`, `lastCheckedAt`, `lastCheckError`. The
sealed Store ID keys are never returned.

One subscription works on one computer at a time, like a website licence: a claim from a second computer
gets `409 store_in_use` until the customer chooses "Move it to this computer" (`store.maxMovesPer30Days`, 2;
then `429 store_move_limit`). A reinstall on the same computer (same machine hash) takes over by itself.

**Selling in the app.** The app offers "Microsoft Store" as a payment method only when
`settings.store.salesEnabled` is `true` (default `false`) **and** the Microsoft Store returns the add-ons'
prices. Turn it on once the add-ons exist in Partner Center and the Entra ID app is saved. With it off, a
customer who already has a Store subscription can still restore and manage it.

### GET /v1/admin/store/status

→ `{ configured, salesEnabled, acceptUnverified, unverifiedDays, productPlans, counts: { <status>: n }, unverifiedActive,
pendingReview, checkErrors, unknownPlans: [{ productId, plan }], alerts }`. `alerts` lists
`credentials_missing`, `unverified_entitlements`, `pending_review`, `check_errors`, `unknown_plans` (a mapped
plan key that is missing or inactive). The same alerts are in `GET /v1/admin/diagnostics` under `store`.

### GET /v1/admin/store/entitlements

Params: `status` (comma list), `verified` (`1`/`0`), `productId` (comma list), `customerId`, `installId`,
`alert=1` (unverified access, pending review, or a failed re-check), `sort` (`updatedAt`, `createdAt`,
`accessUntil`, `lastClaimAt`), `order`, paging. → `{ items, total, page, pageSize }`.

### POST /v1/admin/store/entitlements/:id/recheck

Asks Microsoft now. → `{ entitlement }`. Errors: `409 not_configured`, `409 no_keys` (the app has not sent
keys for it yet; they come with its next report), `502 <store error code>`.

### POST /v1/admin/store/entitlements/:id/approve

`{ "reason": "Seen in Partner Center acquisitions" }`: grants a `pending` claim until the period end the app
reported (at most 35 days), still unverified. Errors: `409 not_pending`, `409 expired`.

### POST /v1/admin/store/entitlements/:id/revoke

`{ "reason": "..." }`: ends access now (status `revoked`, licence `canceled`). Microsoft is not told: refunds
of Store purchases go through Microsoft. Errors: `409 not_active`.

---

## Plans

Plans are the single source of prices. The app and the website read [`GET /v1/plans/public`](#get-v1planspublic);
their built-in prices are fallbacks only.

**Plan fields**: `key` (1-40 of `a-z 0-9 - _`, fixed once created), `name`, `tier` (`pro` | `enterprise`),
`amount` (cents), `currency` (ISO 4217), `interval` (`month` | `year` | `once`), `months` (term per payment,
1-120; 30 days a month, 365 days per 12 months), `recurring`, `active`, `highlight`, `sortOrder`, `description`, `features` (up to 30 strings),
`limits` (`{ seats, maxParallel, auditExport }` or null for the tier defaults: Pro 3 / 3 / no,
Enterprise 25 / 10 / yes).

| Endpoint | Body / result |
|---|---|
| `GET /v1/admin/plans` | `{ items: [Plan + effectiveLimits] }`, all plans including inactive |
| `GET /v1/admin/plans/:key` | `{ plan }` |
| `GET /v1/admin/plans/:key/history` | `{ items: [{ planKey, oldAmount, newAmount, oldCurrency, newCurrency, changedAt, changedBy, note }] }` newest first |
| `POST /v1/admin/plans` | plan fields + optional `note` → `201 { plan }`; `409 plan_exists` |
| `PATCH /v1/admin/plans/:key` | any fields except `key`, + `note` explaining a price change → `{ plan, changed }` |
| `DELETE /v1/admin/plans/:key` | only if no licence or payment uses it → `{ ok, deleted }`; else `409 plan_in_use` (`licenses`, `payments`): set `active: false` instead |

Every price or currency change (also through `POST /v1/tenant/plans` and the owner's scripts) is written
to the price history; the whole change goes to the audit log. A change reaches `/v1/plans/public` at once.
Changing a price never changes existing licences.

---

## Email

From `no-reply@softglaze.com` through Hostinger SMTP; replies go to `email.replyTo` (support@).

**Categories**

| Category | Consent | Unsubscribe | Used for |
|---|---|---|---|
| `essential` | not needed | always sent, no unsubscribe link | sign-in codes |
| `lifecycle` | not needed | stops it | welcome, tips and trial reminders |
| `service` | not needed | stops it | custom account / product notices |
| `marketing` | **needs `marketingConsent`** | stops it | come back, news |

Deleted customers get nothing. The consent rules are checked again just before each send.

**Placeholders**: `{{name}}` (first name, or "there"), `{{greeting}}` ("Hi Ana," / "Hola, Ana:"),
`{{email}}`, `{{trialEndsAt}}` (e.g. "Friday 27 November 2026"), `{{daysLeft}}`, `{{plan}}`,
`{{downloadUrl}}`, `{{unsubscribeUrl}}`, `{{supportEmail}}`, `{{appName}}`, `{{companyName}}`,
`{{companyAddress}}`, `{{code}}` and `{{codeMinutes}}` (verification only). Values are HTML-escaped.
Templates are the body only: the layout, the footer, the unsubscribe link (not for essential) and, for
marketing, `email.companyAddress` are added when sending. Templates with unknown placeholders, scripts,
frames, forms, event handlers or `javascript:` links are refused.

### Templates

| Endpoint | Body / result |
|---|---|
| `GET /v1/admin/email/templates` | `{ items, placeholders, languages: ["en","es"], builtInKeys }` |
| `GET /v1/admin/email/templates/:key?lang=en` | `{ template }` |
| `PUT /v1/admin/email/templates/:key` | `{ lang, subject, html, text, name? }` (custom templates may also change `category`) → `{ template }` |
| `POST /v1/admin/email/templates` | new custom template `{ key, lang, name, category: service|marketing, subject, html, text }` → `201`; `409 template_exists` |
| `POST /v1/admin/email/templates/:key/reset` | `{ lang }` restores the built-in copy; `400 not_built_in` |
| `DELETE /v1/admin/email/templates/:key?lang=en` | custom only; `400 built_in` |
| `POST /v1/admin/email/templates/:key/preview` | `{ lang?, customerId?, subject?, html?, text? }` (unsaved edits can be previewed) → `{ subject, html, text, category }` |

Built-in keys: `verify_code` (essential), `welcome`, `tips`, `trial_ending`, `trial_ended`,
`locks_tomorrow` (lifecycle), `come_back` (marketing), each in `en` and `es`. The category of a built-in
template cannot change. A customer gets their `lang` version, else English.

### Automations

Queued by the cron (every 15 minutes), each at most once per trial:

| key | due at | category | skipped when |
|---|---|---|---|
| `welcome` | trial start + 0 h | lifecycle | |
| `tips` | trial start + 48 h | lifecycle | |
| `trial_ending` | trial end - 48 h (day 5) | lifecycle | paid |
| `trial_ended` | trial end + 0 h (day 7) | lifecycle | paid |
| `locks_tomorrow` | trial end + 48 h (the app locks after 3 grace days) | lifecycle | paid |
| `come_back` | trial start + 336 h (day 14) | marketing | paid, or no consent |

An automation more than `email.catchUpHours` (48) late is not sent. A skipped one is logged with status `skipped` and the reason.

- `GET /v1/admin/email/automations` → `{ items: [{ key, anchor: "trialStart"|"trialEnd", enabled, offsetHours, category, template, skipIfPaid }], catchUpHours }`
- `PUT /v1/admin/email/automations/:key` `{ enabled?, offsetHours? }` (offset -720..2160) → `{ key, enabled, offsetHours }`

### POST /v1/admin/email/send (custom email)

```json
{ "mode": "preview" | "test" | "send",
  "category": "service" | "marketing",
  "audience": { "customerIds": ["cm1"] } | { "segmentId": "sg1" } | { "filters": { "tag": "launch", "status": "trial" } },
  "templateKey": "price-change", "lang": "en",
  "subject": "...", "html": "...", "text": "...",
  "testTo": "you@softglaze.com" }
```

Give `templateKey` or `subject` + `html` + `text`. Up to 5000 recipients. Essential templates cannot be
sent by hand; a marketing template must be sent as `marketing`.

- `preview` → `{ "mode": "preview", "counts": { "matched": 3, "eligible": 1, "skipped": { "no_consent": 1, "unsubscribed": 1 } }, "sample": { "to", "subject", "html", "text" } }`
- `test` sends one copy to `testTo` with `[Test]` in the subject → `{ "mode": "test", "sent": true, "counts": {...} }`
- `send` queues one email per eligible customer and starts sending (the daily cap applies; the cron
  finishes the rest) → `202 { "mode": "send", "campaignId": "cmp_...", "queued": 1, "counts": {...} }`

Previews and tests use a dummy unsubscribe link, never a real customer's. Errors: `400 validation_failed`
(`fields.placeholders`, `fields.html`, `fields.audience`...), `503 email_unavailable` (SMTP not set),
`502 email_failed` (test send).

### Outbox and send log

| Endpoint | |
|---|---|
| `GET /v1/admin/email/outbox` | params `status` (`queued,sending,sent,failed,skipped,cancelled`), `category`, `customerId`, `campaignId`, `templateKey`, `from`, `to`; items without bodies: `{ id, customerId, toEmail, templateKey, category, campaignId, subject, status, attempts, lastError, sentAt, nextAttemptAt, createdBy, createdAt }` |
| `GET /v1/admin/email/outbox/:id` | `{ email }` with `html` and `text` (kept 90 days; sign-in codes are never stored) |
| `POST /v1/admin/email/outbox/:id/retry` | failed or cancelled → queued; `409 not_retryable`, `409 no_body` |
| `POST /v1/admin/email/outbox/:id/cancel` | queued → cancelled; `409 not_queued` |
| `GET /v1/admin/email/status` | `{ smtp: { configured, host, port, secure, from }, dailyCap, sentLast24h, queued, failedLast24h }` |

Sending: failures retry after 5 min, 30 min, 2 h, 6 h (5 attempts); an SMTP 5xx refusal fails at once.
`email.dailyCap` (default 300) is a rolling 24 hours. Sign-in codes are sent at once and never held by the
cap, but they count towards it.

---

## Segments

Saved customer filters (the [customer list filters](#get-v1admincustomers)), usable as an email audience.

- `GET /v1/admin/segments` → `{ items: [{ id, name, filters, createdAt, updatedAt }] }`
- `POST /v1/admin/segments` `{ name, filters }` → `201 { segment }`; `409 segment_exists`
- `PATCH /v1/admin/segments/:id` `{ name?, filters? }` → `{ segment }`
- `DELETE /v1/admin/segments/:id` → `{ ok: true }`

---

## Settings

`GET /v1/admin/settings` → `{ settings }`; `PATCH /v1/admin/settings` with any sections and keys →
`{ settings }`; unknown or out-of-range values → `400 validation_failed` naming each one.

| Section.key | Default | Range / meaning |
|---|---|---|
| `trial.days` | 7 | 1-60 |
| `trial.tier` | `enterprise` | `pro` / `enterprise` |
| `trial.networkLimit` | 2 | trials per network per window; 0 = off |
| `trial.networkWindowDays` | 30 | 1-365 |
| `verify.codeTtlMinutes` | 10 | 2-60 |
| `verify.maxAttempts` | 5 | 1-10 |
| `verify.resendSeconds` | 60 | 10-600 |
| `verify.maxSendsPerHourPerEmail` / `PerInstall` / `PerNetwork` | 5 / 8 / 20 | |
| `email.dailyCap` | 300 | 0-100000 |
| `email.catchUpHours` | 48 | 1-720 |
| `email.replyTo`, `email.supportEmail` | support@softglaze.com | |
| `email.appName`, `email.companyName` | SoftGlaze Browser, SoftGlaze | |
| `email.companyAddress` | empty | postal address shown in marketing emails |
| `email.downloadUrl` | https://browser.softglaze.com/download | https only |
| `email.domainAllowlist` / `email.domainBlocklist` | [] | domains to allow despite the disposable list / to refuse |
| `email.mxCheck` | true | |
| `billing.renewalGraceDays` | 3 | days a lapsed paid customer still counts as paid |
| `billing.reportingCurrency` | USD | |
| `store.salesEnabled` | false | the app offers "Microsoft Store" as a payment method (it also needs the Store's prices) |
| `store.productPlans` | `{ "pro_monthly": "pro", "enterprise_monthly": "enterprise" }` | Partner Center add-on Product ID -> plan key (replaced as a whole) |
| `store.acceptUnverified` | true | accept app-reported Store purchases while the Store APIs are not set up |
| `store.unverifiedDays` | 7 | 1-35: the most an unverified report grants at a time |
| `store.renewalGraceDays` | 3 | 0-30: slack after a renewing period ends, and access during a failed renewal |
| `store.maxMovesPer30Days` | 2 | 0-20: moves of one Store subscription to another computer |
| `checkout.providers` | null | website payment providers the app offers, in this order. `null` = every provider whose keys are saved and enabled; a list (ids such as `stripe`, `paypal`, `cryptomus`) = only those of them; `[]` = none |
| `checkout.labels` | {} | the name the app shows for a provider, e.g. `{ "stripe": "Card" }` (at most 60 characters each; replaced as a whole) |
| `privacy.unverifiedRetentionDays` | 30 | |
| `privacy.outboxBodyRetentionDays` | 90 | |
| `privacy.trialAttemptRetentionDays` | 180 | |
| `automations.<key>.enabled` / `.offsetHours` | see Automations | |

`EMAIL_DOMAIN_ALLOWLIST` (comma list in the server's config/.env) is added to `email.domainAllowlist`.

---

## Metrics

### GET /v1/admin/metrics

Params: `from`, `to` (`YYYY-MM`, default the last 12 months), `days` (1-366, default 30, for the daily trial series).

```json
{
  "asOf": "2026-12-15T09:00:00.000Z",
  "customersByStatus": { "lead": 120, "trial": 14, "trial_expired": 60, "paid": 9, "cancelled": 1, "churned": 2 },
  "customersByComputedStatus": { "...": "same, ignoring manual overrides" },
  "customersTotal": 206, "verifiedCustomers": 150, "marketingConsent": 70, "complimentaryActive": 3,
  "payingCustomers": 9, "payingLicences": 10, "unpricedLicences": 0,
  "mrr": [{ "currency": "USD", "mrrCents": 20100, "arrCents": 241200 }],
  "mrrCents": 20100, "arrCents": 241200, "currency": "USD", "arpaCents": 2233,
  "activeTrials": 14,
  "installsTotal": 412,
  "installsByChannel": { "store": 150, "website": 230, "base": 0, "unknown": 32 },
  "lifetimeNetRevenueCents": 31900, "customersEverPaid": 12, "lifetimeRevenuePerPayingCustomerCents": 2658,
  "trials": { "perDay": [{ "date": "2026-12-01", "trials": 3 }], "perWeek": [{ "weekStart": "2026-11-30", "trials": 9 }] },
  "trialRefusalsLast30Days": { "used_machine": 4, "used_email": 2, "used_network": 1, "not_verified": 7 },
  "conversion": [{ "cohort": "2026-12", "trials": 40, "converted": 6, "conversionRate": 0.15 }],
  "churn": [{ "month": "2026-12", "payingStart": 5, "newPaying": 6, "reactivated": 0, "churned": 1, "cancelled": 1, "payingEnd": 9, "churnRate": 0.4 }],
  "revenue": [{ "month": "2026-12", "currency": "USD", "grossCents": 23300, "refundsCents": 2900, "netCents": 20400, "payments": 9 }],
  "monthly": [{ "month": "2026-12", "...": "see /monthly" }],
  "topCountries": [{ "country": "PK", "customers": 40, "paying": 3 }]
}
```

### GET /v1/admin/metrics/monthly

Same range params; `?format=csv` downloads the table. Columns: `month, newCustomers, newTrials,
trialsConverted, conversionRate, payingStart, newPaying, reactivated, churned, cancelled, payingEnd,
churnRate, currency, revenueGrossCents, refundsCents, revenueNetCents, payments,
revenuePerPayingCustomerCents, mrrEndCents, mrrSnapshotDay`. JSON: `{ asOf, currency, columns, rows }`.

### Definitions (the maths, unit-tested in test/metrics.test.js)

- **MRR**: the sum, over active paid licences (status active, not complimentary, term end in the
  future), of the licence plan's monthly-equivalent amount = `amount / termMonths`, where `termMonths` is
  the plan's `months` (at least 12 when `interval` is `year`). A licence without a plan key (activation
  codes) is priced by the active plan of its tier with the shortest term; a licence with no matching plan
  counts in `unpricedLicences` and adds 0. Per currency; rounded to the cent once, at the end.
  **ARR** = MRR x 12. These are list prices, not discounted amounts.
- **Paying customers**: distinct customers with at least one such licence. (`customersByStatus.paid`
  also includes customers inside the 3-day renewal grace.)
- **ARPA** = MRR / paying customers.
- **Churn (month M)**: paid customers whose paid-until date passed without renewal, dated at the
  paid-until day and recorded only once the renewal grace has passed (`churned`), plus paid customers whose
  licence was revoked or refunded (`cancelled`). **Churn rate** = (churned + cancelled) / paying customers
  at the start of M. A customer who pays again later is counted as `reactivated`, and the earlier churn
  stays in its month. Always `payingEnd = payingStart + newPaying + reactivated - churned - cancelled`.
- **Conversion (cohort M)**: trials started in month M that later became paid (a paid licence or payment
  on or after the trial start). Rate = converted / trials.
- **Revenue (month M)**: gross = settled payments (paid, or paid and later refunded) by paid date;
  refunds = refunded payments by refund date; net = gross - refunds. Per currency (monthly rows use the
  main currency). Pending and failed payments never count.
- **Revenue per paying customer (month M)** = net revenue in M / customers who were paying at any time in M.
- **Lifetime revenue per paying customer** = net revenue of all time / customers who ever had a paid licence.
- **New trials** per UTC day and per ISO week (weeks start on Monday). **Top countries**: by customers, with
  how many of them pay; `unknown` when no country is known.
- **mrrEndCents**: MRR from the last daily snapshot (written by the cron) in that month; `null` for months
  before snapshots existed (history starts on the deploy day).
- **Installs**: `installsTotal` = every install row of the tenant (registered app installs, all time).
  `installsByChannel` splits them by [install channel](#install-channel); `unknown` = installs that never
  reported one (apps before 1.0.23 that have not updated). The four always add up to `installsTotal`.
  Not in the daily snapshots.
- Status history (and so churn and paying counts) starts on the deploy day: customers backfilled from
  existing installs start as `lead` from the day their install was first seen, and the first cron run records
  later statuses dated when they really happened (a paid licence at its start date).

---

## Audit log

`GET /v1/admin/audit` params: `action` (prefix, e.g. `customer.`), `targetType`, `targetId`, `actor`
(contains), `from`, `to`, paging. Items: `{ id, at, actor, keyId, action, targetType, targetId, detail }`.
Customer changes store the changed field names, never the values of personal fields.

Actions: `customer.create|update|delete|restore|erase`, `customers.export|import|bulk.*`, `license.grant|extend|revoke|assign`,
`payment.record|refund`, `plan.create|update|delete`, `email.template.*`, `email.automation.update`, `email.send|test|retry|cancel`,
`segment.*`, `settings.update`, `trial.reset`, `install.reset_machine`, `metrics.export`, `store.recheck|approve|revoke`.

## Diagnostics

- `GET /v1/admin/diagnostics` → `{ smtp, cron: { lastStartedAt, lastFinishedAt, lastResult }, disposableList: { count, upstreamCommit, fetchedAt, licence }, trustProxyHops, trialsLast30Days, busiestNetworksTrialCounts, networkLimit, store: { configured, alerts, unverifiedActive, pendingReview } }`.
  If one network holds most trials, the server is probably counting a proxy's address: run `run.sh check-ip`.
- `GET /v1/admin/diagnostics/request` → what the server received for this request: `{ chain, trustProxyHops, clientIp, isPublic }`
  (`chain` = socket address, then X-Forwarded-For from right to left). Used by `run.sh check-ip`.

---

## App 1.0.23: sign-up required, lead fields, payment switches

**Every workspace confirms its email with this server.** From app 1.0.23 (website and Microsoft Store
builds), the app asks [`POST /v1/account/status`](#post-v1accountstatus) on every start. While it answers
`verified: false`, the app shows "Confirm your email" before it can be used: the Owner's name and email
(editable), phone, use case and company, then the 6-digit code from
[`verify/start`](#post-v1accountverifystart) and [`verify/check`](#post-v1accountverifycheck). Installs that
signed up through app 1.0.22 already have a verified customer and are not asked. A team member who is not the
Owner sees a message asking the Owner to do it. If this server cannot be reached the app lets them in and asks
again at the next start, for at most 7 days (a paid licence is never locked out by the server being down).

**What the website admin can add**

| Where | What | API |
|---|---|---|
| Customers list | columns Phone, Use case, Company; a "Use case" filter | `useCase`, `useCaseOther`, `phone`, `company` on every customer; `?useCase=` filter, `sort=useCase` |
| Customers export | the same columns in the CSV | `GET /v1/admin/customers/export` |
| Settings, Microsoft Store | "Sell in the Microsoft Store app" switch (default off) | `PATCH /v1/admin/settings` `{ "store": { "salesEnabled": true } }` |
| Settings, Payments | which website providers the app offers, their order and names | `PATCH /v1/admin/settings` `{ "checkout": { "providers": ["stripe", "paypal"], "labels": { "stripe": "Card" } } }`; `{ "checkout": { "providers": null } }` goes back to "every enabled provider" |
| Store page | show the switch's state | `salesEnabled` in `GET /v1/admin/store/status` |

A provider still needs its keys saved and enabled with the owner's key (`POST /v1/tenant/payment-config`,
not the website key) before the app can list it. The app reads the list from
[`GET /v1/checkout/methods`](#get-v1checkoutmethodstenantid) (cached 15 minutes in the app), so a provider
added on this server later reaches the app without a new app version; offline, the app uses the providers
baked into its build.

**Deploy order**: this server first, then `prisma migrate deploy` (migration `20261108140000_signup_lead_fields`:
six nullable columns on `Customer` and `EmailVerification`, nothing else), then app 1.0.23. An app 1.0.23 that
meets an older server cannot ask for the status (`404`) and treats it like "server not reachable".

---

## Public endpoints (app and website)

These keep the shapes in spec section A (the desktop app PR depends on them). Install-authenticated
endpoints answer `400 bad_request`, `404 unknown_tenant`, `401 invalid_install` (wrong install secret:
the only 401), and with a machine hash `400 machine_required` / `403 machine_mismatch`.

### Install channel

From app 1.0.23, `POST /v1/register`, `/v1/license`, `/v1/account/verify/start` and `/v1/trial/start` also
carry `channel`: where the app was installed from.

| `channel` | meaning |
|---|---|
| `store` | the Microsoft Store package (AppX/MSIX) |
| `website` | the website installer (a licensing tenant is baked in) |
| `base` | a build with no licensing backend (never calls this server in practice) |

- Optional. Requests without it (older apps) work exactly as before. A value outside the list (any case
  and surrounding spaces are folded) is ignored, never refused.
- Stored on the install (`Install.channel`); the latest valid value wins. The customer's `firstChannel`
  is derived from their installs.
- Shown in `GET /v1/admin/installs` (with a `channel` filter), `GET /v1/admin/customers*` (`firstChannel`)
  and `GET /v1/admin/metrics` (`installsTotal`, `installsByChannel`).
- Deploy order: this server (with `prisma migrate deploy`, migration `20261108120000_install_channel`)
  before app 1.0.23. Servers before this change already ignore the unknown field, so the order is not
  critical for the app, but the channel is only recorded once this server runs.

### POST /v1/account/verify/start

`{ tenantId, installId, installSecret, email, name?, consentMarketing, lang, country?, phone?, useCase?, useCaseOther?, company?, appVersion?, channel? }`
→ `200 { "ok": true, "sent": true, "expiresInSec": 600, "resendAfterSec": 60 }`. Sends a 6-digit code from
no-reply@softglaze.com (10 minutes, 5 attempts). The code is never returned. `country` (ISO-2, optional)
fills the customer's country; else the region of `lang` (`es-MX`) is used.

Lead fields (app 1.0.23+, all optional here; the app requires `useCase`): `phone` starts with `+` (or `00`)
and the country code, 7 to 15 digits, spaces ( ) . - allowed, at most 40 characters; `useCase` is one of the
six values above; `useCaseOther` (at most 200 characters) is kept only with `useCase: "other"`; `company`
(company or website, at most 200 characters). They wait on the code and reach the customer only when
`verify/check` proves it.

Errors: `400 invalid_email`, `400 disposable_email`, `400 no_mx`, `400 invalid_phone`, `400 invalid_use_case`, `429 rate_limited` (`retryAfterSec`,
`Retry-After` header: 60 s between codes per install and address, 5 per address / 8 per install / 20 per
network per hour), `503 email_unavailable`, `502 email_failed` (no throttle is charged).

### POST /v1/account/verify/check

`{ tenantId, installId, installSecret, email, code }` → `200 { "verified": true, "customerId": "cm..." }`.
Creates or updates the customer (verified, consent if ticked, name, language, and the lead fields sent with
the code), links the install, and
attaches a licence an admin granted to this customer without an install. Asking again with the same code
returns the same answer.

Errors: `400 invalid_email`, `400 invalid_code` (`attemptsLeft`), `404 no_code`, `410 code_expired`
(also for a code already used), `429 too_many_attempts`.

### POST /v1/account/status

`{ tenantId, installId, installSecret, appVersion?, channel? }` → `200 { "verified": true, "email": "ana@example.com" }`
or `200 { "verified": false }`. `true` when a code was proven **on this install** for the customer the install
is linked to, and that customer is verified and not deleted (the same test the trial ledger uses). An email
only claimed at register (older apps) is not verified. `Cache-Control: no-store`. The general rate limit
(120 per minute per IP), because every app start asks. Errors: the install errors above.

### One-click sign-in (app 1.0.26)

"Continue with GitHub" and "Continue with email" (a 6-digit code, no password). Google and Microsoft plug into
the same routes later (`src/auth/providers/index.js`). Mounted at `/auth` (not `/v1`), with its own per-IP
limit `AUTH_RATE_PER_MIN` (default 30 per minute).

**Browser leg** (HTML pages; the app opens the first URL in the system browser):

- `GET /auth/start?provider=github&tenant=<tenantId>&app_redirect=<redirect>&code_challenge=<S256>&code_challenge_method=S256&state=<app state>`
  - `app_redirect` must be exactly `softglaze://auth` or `http://127.0.0.1:<port>/auth` (port 1024-65535);
    anything else is refused. `code_challenge` is the app's PKCE S256 challenge (43 characters; `plain` is
    refused); `state` is 16-128 base64url characters, returned to the app unchanged.
  - Stores an `AuthState` (10 minutes, only hashes of the server state and nonce), sets an HttpOnly,
    SameSite=Lax nonce cookie for `/auth/callback`, and redirects to GitHub with this server's own state and
    PKCE challenge and the scope `read:user user:email`. At most 30 starts per network per hour.
  - Pages: `400` (bad request or redirect), `429`, `503` (GitHub keys not set).
- `GET /auth/callback/github` (GitHub's callback; set it as the OAuth App's callback URL)
  - The state must be known, unused, unexpired and for GitHub, and the browser must hold that sign-in's nonce
    cookie; otherwise a "link expired" page and nothing goes to the app.
  - The code is traded with GitHub server side (client secret, PKCE verifier); the user's **primary verified**
    email is read from `/user/emails`. No verified primary email, or a disposable domain: refused.
  - Success: a one-time code (60 seconds, single use, only its hash stored) to
    `<app_redirect>?code=...&state=<app state>` (a 302 for loopback, a page with a button and a meta refresh for
    `softglaze://`). Failures go back as `?error=cancelled | email_not_verified | disposable_email | failed&state=...`.

**App calls** (JSON; install-authenticated like `/v1/account/*`: `tenantId`, `installId`, `installSecret`):

| Call | Body | Answer |
|---|---|---|
| `GET /auth/providers?tenantId=` | | `{ "providers": ["github"], "email": true }` (GitHub listed only when its keys are set) |
| `POST /auth/exchange` | `code`, `codeVerifier`, `expectCustomerId?` | a sign-in (below); `400 invalid_grant` for any problem with the code (unknown, used, expired, other tenant, wrong verifier; the first attempt spends it), `409 account_mismatch` |
| `POST /auth/email/start` | `email`, `lang?`, `name?`, `consentMarketing?` | exactly `POST /v1/account/verify/start`: same template, limits, disposable and MX checks |
| `POST /auth/email/verify` | `email`, `code`, `expectCustomerId?` | a sign-in; or the `verify/check` errors; `409 account_mismatch` (checked before the code is tried) |
| `POST /auth/me` | `session` | `{ signedIn, provider, customer, methods, licence }`; `401 session_invalid` |
| `POST /auth/profile` | `session`, `useCase`, `useCaseOther?` | `{ ok, saved }` ("What will you use SoftGlaze for?") |
| `POST /auth/licence/move` | `session`, `move: true` | `{ ok, moved, remaining }`; `400 confirm_required`, `404 no_licence`, `429 move_limit { retryAt }`, `409 move_conflict` |
| `POST /auth/logout` | `session` | `{ ok: true }` always |

A sign-in answers:

```json
{ "ok": true, "session": "<43 characters, shown once>", "provider": "github", "isNew": false, "linked": "email",
  "customer": { "id": "cm...", "email": "ana@example.com", "name": "Ana Lopez", "useCase": null },
  "methods": [{ "provider": "github", "email": "ana@example.com", "login": "ana-dev", "linkedAt": "...", "lastUsedAt": "..." }],
  "licence": { "state": "elsewhere", "tier": "enterprise", "until": "...", "movesLeft": 2 } }
```

- **Linking**: the `Identity` for (provider, provider user id) first; else the customer with the same email key
  (a GitHub verified email links automatically, no 6-digit code); else a new customer with `emailVerifiedAt`
  set. An unverified email is never linked. `expectCustomerId` (the workspace's own account, sent when the app
  unlocks or links an existing workspace) refuses any other account before anything is written.
- The install is linked to the customer like after `verify/check`, and the sign-in counts for the trial ledger
  and `/v1/account/status` like a proven code (one trial per computer and per email still holds).
- `licence.state`: `here` (an active licence on this install), `elsewhere` (a website/invoice licence on
  another install; `POST /auth/licence/move` moves it, at most 2 times per licence per 30 days, the same limit
  as `/v1/license/transfer`), `store` (only a Microsoft Store subscription: "Restore Microsoft Store
  purchases" moves it), `none`.
- Sessions: only the SHA-256 is stored (`AuthSession`). Daily use of the app never needs one (the workspace
  opens offline); the app uses it for Settings > Account and Sign out.

### GET /v1/checkout/methods?tenantId=...

No auth. CORS open, `Cache-Control: public, max-age=60`.

```json
{ "providers": [{ "id": "stripe", "label": "Stripe (cards)", "kind": "automated" }],
  "store": { "salesEnabled": false } }
```

`providers`: the website payment providers whose keys are saved and enabled for the tenant, picked, ordered
and renamed by `settings.checkout`; never `microsoft_store` (that is the Store's Entra ID app, not a checkout).
Every provider is a hosted checkout: the app sends its `id` to `POST /v1/checkout` and opens the `url` it
gets back. `store.salesEnabled` is `settings.store.salesEnabled`. Errors: `400 bad_request` (no tenantId),
`404 unknown_tenant`.

### POST /v1/trial/start

`{ tenantId, installId, installSecret, machineHash, email, appVersion?, channel? }` →

```json
{ "lease": "<payload>.<signature>", "exp": 1795526400, "tier": "enterprise", "type": "trial",
  "trialEndsAt": "2026-11-27T10:02:00.000Z", "currentPeriodEnd": "2026-11-27T10:02:00.000Z" }
```

The lease is the existing Ed25519 format; its signed payload carries `type: "trial"`, `plan: "trial"`,
`tier`, `mid` (machine hash), `sub` (install id) and `exp` = the trial end (7 days). Asking again during
the trial returns the same trial (never a longer one). Granted only if the email was verified **on this
install**, this machine never had a trial, this email key never had one, and this network had fewer than
`trial.networkLimit` (2) trials in `trial.networkWindowDays` (30).

Errors: `409 { "error": "trial_used", "reason": "machine" | "email" | "network" }`,
`403 email_not_verified`, `409 already_licensed` (a running licence, or the customer already paid), `400 invalid_email`.

### POST /v1/store/session and POST /v1/store/claim (Microsoft Store build)

Install-authenticated, with the machine hash. `session` → `{ products: [{ productId, plan, tier, name }],
verification }` where `verification` is `{ mode: "verified", collectionsTicket, purchaseTicket, publisherUserId }`
(Entra ID tokens for the two key audiences; the app passes them to `StoreContext.GetCustomerCollectionsIdAsync`
/ `GetCustomerPurchaseIdAsync`) or `{ mode: "unverified" | "pending_review" }`.

`claim` body: `licenseRead` (the app could read its Store licence), `addOns: [{ inAppOfferToken, skuStoreId,
isActive, expiresAtMs }]` (from `GetAppLicenseAsync().AddOnLicenses`), `prices: { <productId>: { formatted,
formattedRecurrence, currencyCode } }`, optional `keys: { collections, purchase }` (Store ID keys), optional
`purchase: { productId, status }`, `move`. → `{ ok, mode, verified, verifyNote, licensed, conflicts, entitlements }`;
errors `409 store_in_use`, `429 store_move_limit`, `404 store_not_owned`. The app then fetches its lease from
`/v1/license` as usual.

### POST /v1/license (changed, compatible)

An install with several licences (for example an invoice licence and a Store subscription) is leased the
active one with the best tier, then the latest end; with none active, the most recently updated as before.

Also accepts `appVersion` and `channel` ([install channel](#install-channel)). A paid answer adds `"type": "paid"`. With no active paid licence but a running
trial it returns the trial lease (same shape as `/v1/trial/start`). After a trial: `{ "lease": null, "status": "none", "trialEndsAt": "..." }`.
Every lease payload now has `type` (`paid` or `trial`).

### POST /v1/register (changed, compatible)

Also accepts `appVersion` and `channel` ([install channel](#install-channel)). An install that registers with an owner `account` email is linked to a
customer (`source: app`, unverified until verify/check).

### GET /v1/plans/public?tenantId=...

No auth. CORS open (`Access-Control-Allow-Origin: *`), `Cache-Control: public, max-age=60`, cached 60 s in
the server (an admin change clears it at once). Active plans, by `sortOrder` then price:

```json
[{ "key": "pro", "name": "Pro", "tier": "pro", "amount": 500, "amountDecimal": "5.00", "currency": "USD",
   "interval": "month", "months": 1, "highlight": false, "features": [],
   "limits": { "seats": 3, "maxParallel": 3, "auditExport": false } }]
```

Errors: `400 bad_request` (no tenantId), `404 unknown_tenant`.

### GET / POST /v1/email/unsubscribe?t=TOKEN

The link in every lifecycle, service and marketing email, and the `List-Unsubscribe` header (with
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`, RFC 8058). GET shows a small page with a button and
changes nothing (mail scanners open links); POST (the button, or the mail provider's one-click) sets
`unsubscribedAt`, withdraws marketing consent and cancels queued non-essential email. The token is the
customer id plus an HMAC; it never expires and holds no email address.

---

## Privacy and retention

- **Stored as hashes only**: client IPs (HMAC-SHA256 with a key derived from MASTER_KEY; IPv6 per /64),
  verification codes, and in the trial ledger the email key (HMAC). Machine hashes are already one-way
  hashes made by the app.
- **Privacy erase** (`POST /customers/:id/erase`) deletes the customer, their verification codes, sent-email
  log rows and timeline, removes their email from installs, licences and payments, and clears audit details
  about them. Kept without anything that identifies the person: payment amounts, currencies, dates,
  status, provider and reference (accounting); licence terms (an active licence keeps working on its PC);
  the trial ledger hashes (so the same person cannot take a second trial); status history under a random
  anonymous id (so past churn and paying counts do not change).
- **Retention (cron)**: unconfirmed verification codes after 30 days; unverified app sign-ups after 30 days
  if they have no licence, payment or trial and nothing an admin added (notes, tags, status override);
  email bodies in the send log after 90 days (the row stays); trial attempt records after 180 days;
  one-click sign-in browser states and one-time codes after a day.
- **One-click sign-in** stores the provider user id, the verified email and the GitHub username
  (`Identity`), and per sign-in the install, time and a hashed network (`AuthSession`). Session tokens, codes,
  states and nonces are stored only as SHA-256 hashes; the GitHub access token is used for two reads and never
  stored. The privacy erase deletes the customer's sign-in methods and sessions.
  Backfilled customers count their 30 days from the deploy day.
