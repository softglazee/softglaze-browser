# Google sign-in, phone sign-in and web sessions

What this release adds to the licensing server (api.softglaze.com):

- **"Continue with Google"** for the desktop app, the phone app and a future web app. One Google OAuth client
  (type "Web application") serves all three, because every Google sign-in comes back through this server:
  `https://api.softglaze.com/auth/callback/google`. The server checks the Google ID token itself (Google's
  signing keys, issuer, audience, expiry, nonce, `email_verified`), so the client secret never leaves the server.
- **Phone endpoints** `/v1/mobile/auth/*` and `/v1/mobile/entitlement` (the contract in
  `D:\SoftGlaze-Mobile\docs\features\SECURITY-VAULT.md`), with a `MobileDevice` row per signed-in phone, a phone
  limit, 30-day sliding sessions, refresh, sign-out and "sign out all phones".
- **Web sessions** `/v1/web/auth/*` (PKCE public client, 15-minute access token, rotating refresh token) and the
  account API `/v1/account/me | sessions | sessions/:id/revoke | sign-out-all | delete-request | licence`.
- **Session expiry** for new sessions. Desktop sessions that exist today have no end and keep working.

Linking: a Google sign-in with a verified email joins the customer that already has that email (from a
6-digit code, GitHub or a purchase), exactly like GitHub (`src/auth/accounts.js`). An unverified Google email
is refused and nothing is written.

---

## 1. Google Cloud Console (the owner, about 15 minutes)

Use the Google account that should own the SoftGlaze sign-in (a company account, not a personal one, if
possible). Google renamed the consent screen pages to **Google Auth Platform** in 2025; the steps below use the
current names, with the old names in brackets.

### 1.1 Project

1. Open <https://console.cloud.google.com/>, top bar project picker > **New project**.
2. Name: `SoftGlaze`. Organization: none (or yours). **Create**, then select the project.

### 1.2 Branding (OAuth consent screen)

1. Menu > **Google Auth Platform** > **Branding** (old: APIs & Services > OAuth consent screen). If it asks,
   click **Get started**.
2. **App information**
   - App name: `SoftGlaze`
   - User support email: `support@softglaze.com` (it must be an address the console offers: the signed-in
     account or a Google Group it manages. If `support@softglaze.com` is not in the list, add the signed-in
     account first and change it later once the group exists.)
3. **Audience**: **External** (anyone with a Google account).
4. **Contact information** (developer contact): `support@softglaze.com`.
5. Agree to the Google API Services User Data Policy, **Create**.
6. Back on **Branding**, fill in and **Save**:
   - Application home page: `https://browser.softglaze.com`
   - Application privacy policy link: `https://browser.softglaze.com/privacy`
   - Application terms of service link: `https://browser.softglaze.com/terms`
   - Authorized domains: `softglaze.com` (covers api., browser. and app.softglaze.com)
   - App logo: leave empty for now. A logo makes Google review the brand (days); without it the consent screen
     shows the app name only and needs no review.

If the console asks you to verify `softglaze.com`, do it in Google Search Console
(<https://search.google.com/search-console>) with the same Google account (DNS TXT record on softglaze.com).

### 1.3 Scopes (Data Access)

**Google Auth Platform** > **Data Access** > **Add or remove scopes**. Tick only:

- `openid`
- `.../auth/userinfo.email` (email)
- `.../auth/userinfo.profile` (profile)

**Update**, **Save**. These three are non-sensitive scopes: no Google verification is needed for them.

### 1.4 Publish

**Google Auth Platform** > **Audience** > Publishing status **Testing** > **Publish app** > **Confirm**.
In "Testing" only the test users listed there can sign in; "In production" lets everyone sign in.

### 1.5 The OAuth client (one for desktop, phone and web)

1. **Google Auth Platform** > **Clients** > **Create client** (old: APIs & Services > Credentials > Create
   credentials > OAuth client ID).
2. Application type: **Web application**. Name: `SoftGlaze licensing server`.
3. **Authorized redirect URIs** > Add URI:
   - `https://api.softglaze.com/auth/callback/google`

   (Exactly this, no trailing slash. It is `PUBLIC_BASE_URL` + `/auth/callback/google`. For a local test server
   you may add `http://localhost:8787/auth/callback/google` too.)
4. **Authorized JavaScript origins**: not needed for this flow (the browser never talks to Google with
   JavaScript; it is redirected). If the web app later uses Google's own JavaScript button, add its origin
   then, e.g. `https://app.softglaze.com`.
5. **Create**. The dialog shows the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client
   secret** (starts with `GOCSPX-`). Copy both straight into the server file in step 2; do not paste the
   secret into chat, email or git. (Google shows a new secret only once; you can add another one later under
   the client's page.)

Do NOT create separate Android or iOS clients: the phone app signs in through this server (the browser sheet
opens `https://api.softglaze.com/v1/mobile/auth/authorize`), so Google only ever sees the web client.

---

## 2. Which file on the server gets the keys

The server reads its settings from **`config/.env`**: `src/env.js` walks up from the app's `src/` folder and
uses the first `config/.env` it finds (up to 8 folders up; `CONFIG_ENV_FILE` can point at another file). On
Hostinger it sits above the deployed build, outside `hbuilds/`, so deploys never overwrite it. It is the same
file that holds `DATABASE_URL`, `MASTER_KEY`, `SMTP_PASS` and `GITHUB_CLIENT_SECRET`. The keys below are read
**live** from that file (re-read when it changes): no restart is needed.

In **your own** Git Bash window (not through Claude), with the same SSH login as for the GitHub keys:

```bash
ssh -i ~/.ssh/hostinger_softglaze -p 65002 u829149040@77.37.37.207
```

On the server, paste one block at a time:

```bash
# Find config/.env above the app (the same search the server does).
d=$(cd ~/domains/softglaze.com/api/hbuilds/current && pwd -P)
while [ "$d" != "/" ] && [ ! -f "$d/config/.env" ]; do d=$(dirname "$d"); done
ENVF="$d/config/.env"; echo "File: $ENVF"

# Back it up, and remove older Google lines (only needed when you replace a secret).
cp -p "$ENVF" "$ENVF.bak-$(date -u +%Y%m%dT%H%M%SZ)"
sed -i '/^GOOGLE_CLIENT_ID=/d;/^GOOGLE_CLIENT_SECRET=/d' "$ENVF"

# Type or paste the two values. The secret is hidden while you paste and never goes into the history.
read -r -p 'Google Client ID: ' GID
read -r -s -p 'Google client secret (hidden): ' GSECRET; echo
printf '\nGOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' "$GID" "$GSECRET" >> "$ENVF"
unset GID GSECRET
chmod 600 "$ENVF"

# Must print 2.
grep -c '^GOOGLE_CLIENT_' "$ENVF"
```

The other new settings go in the same file (all optional; none is a secret except the signing key):

| Name in `config/.env` | Value | Needed for |
|---|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from 1.5 | Google button (all apps) |
| `GOOGLE_CLIENT_SECRET` | the Client secret from 1.5 (secret) | Google button (all apps) |
| `ACCOUNT_TENANT_ID` | `cmu65rczt0000qkh0602kos0m` (the SoftGlaze tenant) | phone and web sign-in; optional while the server has one active tenant |
| `WEB_APP_ORIGINS` | e.g. `https://app.softglaze.com` (comma list, https, no path) | web sign-in and CORS; empty = web sign-in off |
| `MOBILE_PHONES_ALLOWED` | `3` (1 to 100) | phone limit per account |
| `RELAY_ENTITLEMENT_SIGNING_KEY` | Ed25519 private key, see below (secret) | `POST /v1/mobile/entitlement`; empty = 503 |
| `MOBILE_ENTITLEMENT_FREE` | `0` = Free accounts get `403 no_entitlement`; default: a `type: free` token | `POST /v1/mobile/entitlement` |
| `ACCOUNT_API_RATE_PER_MIN` | `120` (read at start) | per-IP limit of `/v1/account/me` etc. |

`PUBLIC_BASE_URL` must stay `https://api.softglaze.com` (the Google redirect URI is built from it, and the
sign-in cookie is `Secure` only on https).

### The relay entitlement key

Run once on any computer with Node (it prints two lines; nothing is sent anywhere):

```bash
node -e "const k=require('crypto').generateKeyPairSync('ed25519');console.log('RELAY_ENTITLEMENT_SIGNING_KEY='+k.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'));console.log('RELAY_ENTITLEMENT_PUBKEY='+k.publicKey.export({format:'jwk'}).x)"
```

- The **first line** goes into the licensing server's `config/.env` (secret; same `read -r -s` way as above).
- The **second line** is the relay's `RELAY_ENTITLEMENT_PUBKEY` (public; the relay checks tokens with it,
  `D:\SoftGlaze-Mobile\relay\src\entitlement.ts`).

Token format: `base64url(JSON payload) + "." + base64url(Ed25519 signature over the first part)`, payload
`{ v: 1, customer, tier, type: "trial" | "paid", seats, phonesAllowed, iat, exp, mailbox? }`, `exp` at most 7
days ahead (the phone's offline grace) and never after the trial or paid period (plus the renewal grace).

---

## 3. Deploy (server first, then the apps)

1. Merge the PR on GitHub (server and desktop changes are in the same branch, `feat/google-signin-accounts`).
2. **Deploy the server code** as usual (`docs/DEPLOY.md` step 2): zip `licensing-server` (src, prisma, scripts,
   package.json, package-lock.json; no node_modules, .env, tenants or test), upload, build (`npm run build` =
   `prisma generate`), restart. No new npm dependency: Google is called with Node's own `fetch` and the ID token
   is checked with `node:crypto`.
3. **Migrate right after it starts**, over SSH in the deployed app folder
   (`~/domains/softglaze.com/api/hbuilds/current`, or its `nodejs/` sub-folder, whichever holds `src/env.js`):

   ```bash
   bash scripts/migrate-deploy.sh
   ```

   It backs up the database first (`~/backups/sg-licensing-<time>.sql`), then runs `prisma migrate deploy`.
   One migration applies, `20261119120000_accounts_google_mobile_web`, additive only:
   - `EmailVerification.challengeHash` (NULL, unique), `AuthState.clientId` (NULL);
   - `AuthSession`: `kind` (NOT NULL DEFAULT 'desktop'), `clientId`, `expiresAt`, `accessExpiresAt`,
     `refreshHash` (unique), `prevRefreshHash` (indexed), `userAgent` (all NULL);
   - new table `MobileDevice` (foreign key to `Tenant`).
   Existing sign-ins become `kind = 'desktop'` with `expiresAt = NULL` = no end, so nobody is signed out. The
   previous build runs fine on the migrated schema (it never reads the new columns).
4. **Add the keys** (section 2).
5. **Check** from any PC:
   - `curl "https://api.softglaze.com/auth/providers?tenantId=cmu65rczt0000qkh0602kos0m"` answers
     `{"providers":["google","github"],"email":true}` (`google` missing = the two lines are not in the right
     `config/.env`);
   - `curl https://api.softglaze.com/v1/mobile/auth/providers` lists the same providers;
   - open in a browser
     `https://api.softglaze.com/auth/start?provider=google&tenant=cmu65rczt0000qkh0602kos0m&app_redirect=softglaze://auth&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256&state=checkcheckcheck12`:
     it must show Google's "Choose an account / Sign in to continue to SoftGlaze" page (stop there; this test
     code is not an app). `Error 400: redirect_uri_mismatch` = the redirect URI in 1.5 is not exactly
     `https://api.softglaze.com/auth/callback/google`;
   - `curl https://api.softglaze.com/health` still answers ok.
6. Ship the desktop app with the Google button (the app shows it only when the server lists `google`).
7. The phone app: build with `EXPO_PUBLIC_AUTH_LIVE=1` once the endpoints are live (its Google button is a
   phone-side change: add `'google'` to its `AuthProvider` type and a button; the server already accepts
   `provider=google`).

Rollback: redeploy the previous build. The new columns and `MobileDevice` are then unused; desktop sign-ins
made with the new build (which have an end) keep working on the old build, which ignores the end. Google sign-in,
the phone endpoints and the web sessions stop until the new build is back.

---

## 4. Endpoint summary

Desktop (unchanged routes, Google added): `GET /auth/start?provider=google&...`, `GET /auth/callback/google`,
`POST /auth/exchange`, `GET /auth/providers` (see `src/routes/auth.js`).

Phone (`src/routes/mobileAuth.js`, client `softglaze-mobile`, redirect `softglaze-mobile://auth` only):

| Endpoint | Body / query | Answer |
|---|---|---|
| `GET /v1/mobile/auth/providers` | | `{ providers, email: true, apple: false }` |
| `POST /v1/mobile/auth/email/start` | `{ email, device }` | `{ challengeId, resendAfterSec, expiresAt }` |
| `POST /v1/mobile/auth/email/verify` | `{ challengeId, code, device }` | session; `400 invalid_code / code_expired`, `429 too_many_attempts`, `403 phone_limit` |
| `GET /v1/mobile/auth/authorize` | `client_id, redirect_uri, response_type=code, state, code_challenge, code_challenge_method=S256, provider=google\|github\|apple` | 302 to Google/GitHub, then `softglaze-mobile://auth?code&state` (or `?error&state`; Apple = `provider_not_configured`) |
| `POST /v1/mobile/auth/token` | `{ grant_type: authorization_code, client_id, redirect_uri, code, code_verifier, device }` | session; `400 invalid_grant`, `403 phone_limit` |
| `POST /v1/mobile/auth/refresh` | Bearer | session with a new token |
| `POST /v1/mobile/auth/sign-out` | Bearer | 204 |
| `POST /v1/mobile/auth/sign-out-all` | Bearer | `{ ok, revoked }` (all phones of the account) |
| `POST /v1/mobile/entitlement` | Bearer (phone session, or the desktop app's account session for the PC companion), `{ mailbox? }` | `{ token, exp, payload }` (`type` paid, trial or free); `403 no_entitlement`, `503 entitlement_unavailable` |

Session = `{ token, expiresAt (ms), account: { id, email, name, tier } }`. `device` = `{ platform: ios|android|web,
model, appVersion, id? }`; `id` (16 to 64 URL-safe characters, the app's own random install id) is optional but
lets the same phone sign in again without using a second slot of the phone limit.

Web (`src/routes/webAuth.js`, client `softglaze-web`, redirect `<origin>/auth/callback` for an origin in
`WEB_APP_ORIGINS`): `GET /v1/web/auth/authorize`, `POST /v1/web/auth/token` (`authorization_code` or
`refresh_token`), `POST /v1/web/auth/email/start | email/verify`, `POST /v1/web/auth/sign-out`. Tokens:
`{ access_token (15 min), token_type: Bearer, expires_in, refresh_token (rotates every use; 30 days sliding),
refresh_expires_at, account }`. Re-using an old refresh token ends the session.

Account (`src/routes/accountApi.js`, Bearer web access token or phone token, CORS = `WEB_APP_ORIGINS`):
`GET /v1/account/me`, `GET /v1/account/sessions`, `POST /v1/account/sessions/:id/revoke`,
`POST /v1/account/sign-out-all`, `POST /v1/account/delete-request` (records a `delete_requested` event and
queues an email to the support address in the admin settings; the erase stays a human step in the admin),
`GET /v1/account/licence`.

Session lifetimes: desktop 180 days after last use (new sessions only), phone 30 days after last use, web
access 15 minutes and refresh 30 days after last use. The retention cron deletes phone and web sessions that
ended more than 30 days ago.
