# Deploy note: customers, trials, email and admin API (November 2026)

For api.softglaze.com (Hostinger Node.js app, MySQL `u829149040_licensing`). Deploy only after the PR is
merged. Everything is backwards compatible: apps already in use keep working (their `/v1/license`
answers only gain a `type` field), and the new tables and columns are ignored by the old code, so the
previous build can be redeployed if needed.

Order: **server deploy and migration first**, then the owner's one-time steps, then the cron, then ship
the app release that calls the new endpoints (app PR #40).

## 1. Node version (once)

nodemailer 10 (the patched release; older ones have open security advisories) needs **Node 20 or newer**.
The app was built on Node 18 in October. In hPanel: Websites > api.softglaze.com > Node.js > build
settings: set the Node.js version to **22** (20 also works), then redeploy. `package.json` now says
`"engines": { "node": ">=20" }`.

## 2. Build and deploy the code

Same archive flow as on 7 October: zip the `licensing-server` folder with `src/` (it now includes
`src/data/disposable-domains.json`), `prisma/`, `scripts/`, `package.json` and `package-lock.json`; no
`node_modules`, `.env`, `tenants/` or `test/`. Upload, build (`npm run build` = `prisma generate`; the
install step brings in nodemailer), restart. The app starts without SMTP settings: until step 4 the
verification endpoint answers `503 email_unavailable`.

## 3. Migrate the database (backup first)

Over SSH, in the deployed app folder (`~/domains/softglaze.com/api/hbuilds/current`, or its `nodejs/`
sub-folder, whichever holds `src/env.js`):

```bash
bash scripts/migrate-deploy.sh
```

It (1) dumps the database to `~/backups/sg-licensing-<time>.sql` (mode 600) and stops if that fails,
(2) restores the schema engine's execute bit, (3) runs `prisma migrate deploy` with `config/.env`'s
`DATABASE_URL` (localhost forced to 127.0.0.1), (4) prints `migrate status`. Two migrations apply:

- `20261107120000_customers_trials_email`: 14 new tables; new nullable / defaulted columns on `Plan`,
  `Install`, `License`, `Payment`. Nothing is dropped, renamed or retyped.
- `20261107120100_backfill_customers_and_seed`: `Payment.paidAt` for settled payments; one `Customer`
  (source `app`, unverified) per distinct owner email on existing installs (Gmail dots / +tags folded);
  installs, licences and payments linked to them; a first `lead` status event; the 14 built-in email
  templates (7 keys x en/es) for every tenant. Every statement only fills empty values or inserts what is
  missing.

Tested on MariaDB 10.4 with live-like rows: applied on top of the three existing migrations, and the data
SQL run a second time changes nothing.

Check: `run.sh status` still works; `curl https://api.softglaze.com/health`;
`curl "https://api.softglaze.com/v1/plans/public?tenantId=cmu65rczt0000qkh0602kos0m"` lists pro and
enterprise.

## 4. Owner's one-time steps (in the owner's own terminal window)

Tools folder: `C:\Users\copyc\reports\softglaze-licensing-admin\` (double-click the `.cmd`, or
`run.sh <mode>` in Git Bash).

1. **set-smtp**: asks for the `no-reply@softglaze.com` mailbox password (hidden). The server first checks
   the login with smtp.hostinger.com:465; only then it backs up `config/.env` (`.env.bak-<time>`, mode 600)
   and writes `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. The app re-reads them within
   a minute: no restart. The password travels on the SSH channel's stdin, never on a command line, and is
   never printed. (The mailbox must exist in hPanel > Emails first.)
2. **set-site-admin-key**: creates the website's own admin key (label `website`, admin API only), writes
   it to `~/domains/softglaze.com/sg-form-data/admin-api.json` (mode 600), revokes older website keys and
   checks the new key against the live API. The key is never shown, and the owner's own admin key
   (`sgls_...`) is not changed. Run it again any time to replace the website key.
3. **check-ip** (before 1 December): asks for an admin key (hidden), compares the owner's public IP with
   what the server sees. `MATCH` = done. `MISMATCH` prints a number: run **set-proxy-hops** and type it,
   then check-ip again. api.softglaze.com resolves to Hostinger edge addresses (91.108.100.198,
   179.61.189.73), not the origin, so there may be two proxies in front of the app; the default
   `TRUST_PROXY_HOPS=1` takes the rightmost X-Forwarded-For entry. Until check-ip says MATCH, set
   `trial.networkLimit` to 0 in the admin settings so a proxy address can never block real people
   (private and carrier-grade NAT addresses are never counted anyway).

## 5. Cron job (every 15 minutes)

hPanel > Advanced > Cron Jobs > Create a custom cron job. Schedule: every 15 minutes (`*/15 * * * *`).
Command (one line, exactly):

```
/bin/bash -c 'for d in "$HOME/domains/softglaze.com/api/hbuilds/current/nodejs" "$HOME/domains/softglaze.com/api/hbuilds/current"; do if [ -f "$d/scripts/cron.sh" ]; then exec /bin/bash "$d/scripts/cron.sh"; fi; done; echo "sg-licensing cron: app folder not found" >&2; exit 1'
```

`scripts/cron.sh` uses the newest `/opt/alt/alt-nodejs*` Node, runs `scripts/run-cron.js` and appends one
JSON line per run (counts only: no addresses, no secrets) to `~/logs/sg-licensing-cron.log` (rotated at
1 MB). A database lock stops overlapping runs. Each run, per tenant: reconcile customers with licences,
payments and trials; queue due automations; send the outbox (daily cap); apply retention; write the day's
metric snapshot. Check after 15 minutes: the log has a line, and `GET /v1/admin/diagnostics` shows
`cron.lastFinishedAt`.

## 6. Settings to review in the admin (PATCH /v1/admin/settings)

- `email.companyAddress`: a postal address for marketing emails (CAN-SPAM). Empty until the owner decides.
- `email.dailyCap` (default 300 per rolling 24 h): set it under the mailbox's Hostinger sending limit.
- `trial.networkLimit` (2) / `trial.networkWindowDays` (30), see check-ip above.

## 7. Environment (all optional; config/.env)

| Variable | Default | |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | none | set by set-smtp; re-read live |
| `TRUST_PROXY_HOPS` | 1 | proxies in front of the app; re-read live; set by set-proxy-hops |
| `EMAIL_DOMAIN_ALLOWLIST` | none | comma list of domains allowed despite the disposable list |
| `PUBLIC_RATE_PER_MIN` / `VERIFY_RATE_PER_MIN` | 120 / 20 | per client IP per minute |

## 8. Keeping the disposable list fresh

`node scripts/update-disposable.js` (on a dev machine), commit `src/data/disposable-domains.json`, deploy.
Source: github.com/disposable-email-domains/disposable-email-domains, CC0 1.0 (public domain dedication,
no conditions). Shipped: 10 143 domains at upstream commit a72c0ce (4 Nov 2026).

## Rollback

Redeploy the previous build. The schema changes are additive, so the old code runs on the new schema; a
database restore from the step 3 backup is only needed if data must go back. Remove the cron job if the
old build is kept.

---

# Deploy note: install channel (app 1.0.23)

The app reports where it was installed from (`channel`: `store` | `website` | `base`, see
[ADMIN-API.md, Install channel](ADMIN-API.md#install-channel)). Deploy only after the PR is merged.

Order: **server first, then the 1.0.23 app** (website installer and Store package).

1. Build and deploy the code as in step 2 above (`npm run build` regenerates the Prisma client).
2. `bash scripts/migrate-deploy.sh` as in step 3 (backup first). One migration applies:
   `20261108120000_install_channel`: nullable `Install.channel` and `Customer.firstChannel`
   (`VARCHAR(16)`) and the index `Install_tenantId_channel_idx`. Nothing is dropped, renamed, retyped or
   backfilled; existing installs stay `NULL` (`unknown` in the metrics) until they run 1.0.23.
   Run it straight after the new build starts: the new build's Prisma client reads `Install.channel`,
   so its install calls fail until the column exists (the old build runs fine on the migrated schema).
3. Check: `GET /v1/admin/metrics` has `installsTotal` and `installsByChannel`;
   `GET /v1/admin/installs?channel=unknown` lists the existing installs.
4. Ship app 1.0.23.

Why this order: the new code reads and writes the new columns, so it needs the migration; the server
before this change already ignores `channel` in request bodies (routes pick their fields by name), so a
1.0.23 app talking to it keeps working, it just records nothing. Rollback: redeploy the previous build; the
two columns are ignored by the old code.
