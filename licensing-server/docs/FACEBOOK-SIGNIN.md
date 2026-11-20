# Facebook sign-in ("Continue with Facebook")

"Continue with Facebook" works exactly like "Continue with Google" (docs/GOOGLE-SIGNIN.md): the desktop app, the
phone app and the web app all send the person's browser to this server, the server sends it to Facebook, Facebook
comes back to **one** callback on this server, and the app gets a one-time code that only it can trade (PKCE).
The app secret never leaves the server.

Code: `src/auth/providers/facebook.js` (the provider), `src/auth/flow.js` (shared flow, missing-email rule),
`src/auth/accounts.js` (linking), `src/auth/facebookDeletion.js` + `src/routes/auth.js` (Meta's data deletion
callback). Tests: `test/facebookSignIn.test.js`.

## 1. What the server does (checked against Meta's docs on 20 November 2026)

| Step | Call |
|---|---|
| Dialog | `https://www.facebook.com/v27.0/dialog/oauth?client_id&redirect_uri&state&response_type=code&scope=email,public_profile&code_challenge&code_challenge_method=S256` (+ `auth_type=rerequest` when the person chose "Allow email access") |
| Callback | `GET https://api.softglaze.com/auth/callback/facebook?code&state` (state + browser nonce cookie checked, used once, 10 minutes) |
| Token | `GET https://graph.facebook.com/v27.0/oauth/access_token?client_id&redirect_uri&client_secret&code&code_verifier` (server to server) |
| Profile | `GET https://graph.facebook.com/v27.0/me?fields=id,name,email,picture&appsecret_proof=<hex HMAC-SHA256(access_token, app secret)>` with `Authorization: Bearer <access_token>` |

* **Graph API version:** v27.0 (the version Meta's manual-flow page shows today). Change it without a deploy with
  `FACEBOOK_GRAPH_VERSION=v28.0` in `config/.env` when Meta retires v27.0.
* **PKCE:** Meta documents `code_challenge` / `code_challenge_method=S256` on the dialog and `code_verifier` on the
  token call for its OpenID Connect code flow (marked "still in testing"); the classic manual-flow page does not
  list them. The server sends them on every sign-in anyway: the dialog accepts them (checked on 20 November 2026 with the real app
  id: Facebook answers with its normal redirect to the login page, no error), where Facebook enforces PKCE the code is tied to our verifier, and the flow is protected without them
  as well (app secret on the token call, one-time `state`, the browser nonce cookie). The apps' own PKCE (app to
  our server) is independent of this and always on.
* **appsecret_proof:** sent on every Graph call, so turn on **Require App Secret** in the Meta app (App settings >
  Advanced > Security) if you like: a leaked user token is then useless to anyone else.
* The access token is used for the one `/me` read and dropped; it is never stored or logged. `picture` is read but
  not stored (SoftGlaze shows no profile photos).
* **Stored:** an `Identity` row (the same table Google and GitHub use, no migration): `provider = 'facebook'`,
  `providerUserId` = the **app-scoped** Facebook user id, the email Facebook returned (if any), last used time. The
  session rows name `provider = 'facebook'`.

### Email: verified, missing, declined (decision)

Facebook returns `email` only when the person has a confirmed primary email on Facebook **and** granted the
`email` permission ("This field will not be returned if no valid email address is available"). So:

1. **Email returned:** treated as verified (like Google's `email_verified`). Linking follows the usual rules: an
   existing Facebook link first, else the customer with the same email, else a new account. Disposable domains are
   refused as for every provider.
2. **No email, but this Facebook id is already linked** (the person signed in with Facebook before, then removed
   the email permission): signs in to the linked account. The stored email of the link is kept.
3. **No email and no link** (an account made with a phone number, or the person unticked email): nothing is
   created or linked. The app gets `error=email_missing` and shows
   *"Your Facebook account didn't share an email. Use Google or email sign-in, or allow email access."* with an
   **Allow email access** button, which starts the Facebook sign-in again with `auth_type=rerequest` (Facebook does
   not ask again for a declined permission without it). The token endpoints answer
   `403 { error: 'email_missing', message, rerequest: true }` for the same case.

We never link by name, and never create an account without an email address, because the email is how a
SoftGlaze account receives licences, invoices and its sign-in codes.

## 2. Meta app settings (the owner)

Meta for Developers > the **SoftGlaze** app:

1. **Use cases > Authenticate and request data from users with Facebook Login > Customize**: permissions
   `email` and `public_profile` (both are standard access; no App Review is needed for them).
2. **Facebook Login > Settings**: Client OAuth login **On**, Web OAuth login **On**, Use Strict Mode for redirect
   URIs **On**, Enforce HTTPS **On**, Valid OAuth Redirect URIs: `https://api.softglaze.com/auth/callback/facebook`
   (already registered). Nothing else: the phone and web apps never talk to Facebook directly.
3. **App settings > Basic**:
   * Privacy Policy URL and Terms of Service URL: the softglaze.com pages.
   * **User data deletion > Data deletion callback URL:**

     ```
     https://api.softglaze.com/auth/facebook/data-deletion
     ```

   * App icon, category, contact email.
4. **App settings > Advanced > Security**: Require App Secret **On** (optional, see appsecret_proof above).
5. Switch the app from **Development** to **Live** (App Mode at the top) once the deletion URL and the privacy
   policy are in. In Development mode only people with a role on the app can sign in.

## 3. Server keys

Same file and same way as Google (docs/GOOGLE-SIGNIN.md section 2: the owner types them into `config/.env` on the
server in his own SSH window; the server re-reads the file, no restart):

```bash
cp -p "$ENVF" "$ENVF.bak-$(date -u +%Y%m%dT%H%M%SZ)"
sed -i '/^FACEBOOK_APP_ID=/d;/^FACEBOOK_APP_SECRET=/d' "$ENVF"
read -r -p 'Facebook App ID: ' FBID
read -r -s -p 'Facebook App secret (hidden): ' FBSECRET; echo
printf '\nFACEBOOK_APP_ID=%s\nFACEBOOK_APP_SECRET=%s\n' "$FBID" "$FBSECRET" >> "$ENVF"
unset FBID FBSECRET
chmod 600 "$ENVF"
grep -c '^FACEBOOK_APP_' "$ENVF"   # must print 2
```

| Name in `config/.env` | Value | Needed for |
|---|---|---|
| `FACEBOOK_APP_ID` | App settings > Basic > App ID | Facebook button (all apps) |
| `FACEBOOK_APP_SECRET` | App settings > Basic > App secret (secret) | Facebook button, deletion callback |
| `FACEBOOK_GRAPH_VERSION` | optional, default `v27.0` | dialog + Graph calls |

Without both keys the providers lists (`/auth/providers`, `/v1/mobile/auth/providers`, `/v1/web/auth/providers`)
leave `facebook` out, every app hides the button, and the deletion callback answers 503. The local copy of the
values is `I:\Secrets\SoftGlaze\facebook-oauth.env`; never commit them.

## 4. Data Deletion Request Callback

Meta calls it when a person removes SoftGlaze in their Facebook settings (Settings > Apps and websites) and asks
for their data to be deleted.

```
POST https://api.softglaze.com/auth/facebook/data-deletion
     Content-Type: application/x-www-form-urlencoded     signed_request=<sig>.<payload>
  -> 200 { "url": "https://api.softglaze.com/auth/facebook/deletion-status?code=<code>", "confirmation_code": "<code>" }
  -> 400 { "error": "invalid_signed_request" }   (bad signature, algorithm or user id)
  -> 503 { "error": "provider_unavailable" }     (the keys are not set)

GET  https://api.softglaze.com/auth/facebook/deletion-status?code=<code>   -> HTML: done (200) or unknown code (404)
```

**Verification:** the part before the first `.` is the base64url HMAC-SHA256 of the payload part, keyed with the
app secret (compared in constant time); the payload must say `"algorithm": "HMAC-SHA256"` and carry a numeric
`user_id` (the app-scoped id). Standard base64 with `+ / =` is accepted too.

**What is deleted** (runs before the answer, so a confirmation code means "done"):

* every `Identity` with `provider = 'facebook'` and that Facebook user id (the Facebook id, and the email and name
  Facebook gave with it on that row), in every tenant;
* every session (desktop, phone, web) signed in through that link is ended, and the phone tied to such a session is
  signed out.

**What is kept:** the SoftGlaze account itself (its email address, licences, payments, invoices, trial records and
history). These are our own purchase and trial records, kept under the privacy policy and tax rules, and the same
account may also sign in with Google, GitHub or an email code. A history event `facebook_data_deleted` (without the
Facebook id) is added. The person can still delete the whole account (web app Settings > Account > delete request,
or support@softglaze.com); that follows the normal account deletion policy. One-time sign-in codes that carry a
Facebook profile live 60 seconds and are swept by retention.

**Confirmation code:** stateless and alphanumeric: base36 time (9) + number of links removed (1) + 20 hex
characters of an HMAC with a MASTER_KEY sub-key. The status page checks the HMAC, so it needs no table and stores
nothing about the person; a forged or mistyped code shows "unknown".

**Test it after deploying** (Meta's dashboard has no test button): from any shell,

```bash
node -e '
const c=require("crypto");const s=process.argv[1];
const p=Buffer.from(JSON.stringify({algorithm:"HMAC-SHA256",issued_at:Math.floor(Date.now()/1000),user_id:"1"})).toString("base64url");
console.log(c.createHmac("sha256",s).update(p).digest("base64url")+"."+p)' "$FACEBOOK_APP_SECRET" \
| xargs -I{} curl -s -X POST https://api.softglaze.com/auth/facebook/data-deletion --data-urlencode "signed_request={}"
```

It must answer `{"url":"https://api.softglaze.com/auth/facebook/deletion-status?code=...","confirmation_code":"..."}`
(user id `1` has no link, so nothing is removed).

## 5. Endpoints (summary)

| Client | Start | Result |
|---|---|---|
| Desktop | `GET /auth/start?provider=facebook&tenant&app_redirect&code_challenge&code_challenge_method=S256&state[&auth_type=rerequest]` | `app_redirect?code&state` or `?error=cancelled\|email_missing\|email_not_verified\|disposable_email\|failed`; then `POST /auth/exchange` |
| Phone | `GET /v1/mobile/auth/authorize?...&provider=facebook[&auth_type=rerequest]` | `softglaze-mobile://auth?code&state` or `?error=access_denied\|email_missing\|...`; then `POST /v1/mobile/auth/token` |
| Web | `GET /v1/web/auth/authorize?...&provider=facebook[&auth_type=rerequest]` | `<origin>/auth/callback?code&state` or `?error=...`; then `POST /v1/web/auth/token` |

## 6. Brand

The buttons follow Meta's brand rules: Facebook blue `#1877F2` background, the white "f" logo, the text
"Continue with Facebook", the logo unaltered. They sit under "Continue with Google" and above "Continue with LinkedIn" in every app.
