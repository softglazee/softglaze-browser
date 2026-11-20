# Microsoft sign-in ("Continue with Microsoft")

"Continue with Microsoft" works like "Continue with Google" (docs/GOOGLE-SIGNIN.md): every app (desktop, phone, web)
sends the browser to this server, the server sends it to Microsoft, Microsoft comes back to **one** callback on this
server, and the app gets a one-time code only it can trade (PKCE). The client secret never leaves the server.
Button order in every app: Google, Microsoft, Facebook, LinkedIn, GitHub, then email.

Code: `src/auth/providers/microsoft.js`, the association file in `src/server.js`. Tests: `test/microsoftSignIn.test.js`.

## 1. What the server does (checked 20 November 2026 on learn.microsoft.com/entra/identity-platform)

| Step | Call |
|---|---|
| Authorize | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id&response_type=code&redirect_uri&response_mode=query&scope=openid profile email&state&nonce&code_challenge&code_challenge_method=S256&prompt=select_account` |
| Callback | `GET https://api.softglaze.com/auth/callback/microsoft?code&state` (or `?error=access_denied`, shown to the apps as a cancel) |
| Token | `POST https://login.microsoftonline.com/common/oauth2/v2.0/token` (form): client_id, client_secret, grant_type=authorization_code, code, redirect_uri, code_verifier |
| ID token | RS256 against `https://login.microsoftonline.com/common/discovery/v2.0/keys`; `aud` = our client id; `tid` a GUID and `iss` exactly `https://login.microsoftonline.com/<tid>/v2.0` (the token's own tid in the template issuer); `exp`, `nbf`, `iat` (5 minutes of clock skew); `nonce` = the one we sent; `oid` a GUID |

* **Authority `common`:** personal Microsoft accounts (Outlook, Hotmail, Xbox) and work or school accounts from any
  organization.
* **No Microsoft Graph:** the scopes are `openid profile email` only; the ID token has what we need.
* **Identity key:** `providerUserId = "<tid>:<oid>"`, `provider = 'microsoft'` (oid is stable per user per tenant;
  `sub` is pairwise and `preferred_username`/`upn` can change, so neither is used).
* Tokens are used once and dropped, never stored or logged.

### Email (decision)

Microsoft says the `email` claim "isn't guaranteed to be correct, and is mutable over time" for work or school
accounts: an organization's admin can put any address on a user. Linking by such an address would let someone who
controls any Entra tenant sign in to another person's SoftGlaze account. So the email counts as verified only when

1. the account is a **personal Microsoft account** (`tid` = `9188040d-6c67-4c5b-b112-36a304b66dad`), or
2. the token carries **`xms_edov: true`** ("email domain owner verified": the address is on a domain the user's
   tenant has verified). This optional claim must be switched on in the app registration (section 2).

Then the usual rules apply (an existing Microsoft link, else the customer with that email, else a new account).
Otherwise the sign-in is refused with `email_not_verified` (the apps show "The account you signed in with has no
verified email address...") and **nothing is linked or created**; the person continues with Google, email or the
method they used before. `preferred_username` is never used as an email. Linking a non-verified work account to an
existing account from Settings > Account is not offered (it can be added later as an explicit, signed-in link).

## 2. App registration (the owner, Microsoft Entra admin center)

Entra admin center > Identity > Applications > **App registrations > New registration**:

1. Name `SoftGlaze`; **Supported account types: Accounts in any organizational directory (Any Microsoft Entra ID
   tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**.
2. Redirect URI: platform **Web**, `https://api.softglaze.com/auth/callback/microsoft`. Nothing else (the phone and
   web apps never talk to Microsoft directly). Leave implicit grant / ID tokens unticked: we use the code flow.
3. **Certificates & secrets > New client secret**: copy the **Value** (not the Secret ID) once; note the expiry date
   (24 months at most) and set a reminder to replace it.
4. **Token configuration > Add optional claim > ID**: tick **`email`** and **`xms_edov`** (accept the prompt to add
   the Microsoft Graph `email` permission, it is the OpenID `email` scope).
5. **API permissions**: Microsoft Graph delegated `openid`, `profile`, `email` (User.Read may stay, unused).
6. **Branding & properties**: logo, home page `https://softglaze.com`, terms and privacy URLs, and the **Publisher
   domain**. Verifying a publisher domain (and later Microsoft Partner Network publisher verification) removes the
   "unverified" label on the consent screen. Microsoft asks for
   `https://<domain>/.well-known/microsoft-identity-association.json`. This server answers that path with
   `{ "associatedApplications": [ { "applicationId": "<MICROSOFT_CLIENT_ID>" } ] }` whenever `MICROSOFT_CLIENT_ID` is
   set (404 otherwise), so `api.softglaze.com` can be verified directly. For `softglaze.com` itself, put the same
   JSON at that path on the main site.

Copy from **Overview**: Application (client) ID.

## 3. Server keys

Same file and same way as Google (docs/GOOGLE-SIGNIN.md section 2):

```bash
cp -p "$ENVF" "$ENVF.bak-$(date -u +%Y%m%dT%H%M%SZ)"
sed -i '/^MICROSOFT_CLIENT_ID=/d;/^MICROSOFT_CLIENT_SECRET=/d' "$ENVF"
read -r -p 'Microsoft Application (client) ID: ' MSID
read -r -s -p 'Microsoft client secret VALUE (hidden): ' MSSECRET; echo
printf '\nMICROSOFT_CLIENT_ID=%s\nMICROSOFT_CLIENT_SECRET=%s\n' "$MSID" "$MSSECRET" >> "$ENVF"
unset MSID MSSECRET
chmod 600 "$ENVF"
grep -c '^MICROSOFT_CLIENT_' "$ENVF"   # must print 2
```

| Name in `config/.env` | Value | Needed for |
|---|---|---|
| `MICROSOFT_CLIENT_ID` | Application (client) ID (a GUID) | Microsoft button (all apps), association file |
| `MICROSOFT_CLIENT_SECRET` | the client secret Value (secret) | Microsoft button |

Without both, no app shows the Microsoft button. The local copy is `I:\Secrets\SoftGlaze\microsoft-oauth.env`; never
commit it. When the secret expires, sign-ins fail with `failed` until a new one is typed in.

## 4. Endpoints

Desktop `GET /auth/start?provider=microsoft&...`, phone `GET /v1/mobile/auth/authorize?...&provider=microsoft`, web
`GET /v1/web/auth/authorize?...&provider=microsoft`: the same contract as Google (docs/GOOGLE-SIGNIN.md section 4).

## 5. Brand

Microsoft's sign-in button rules: the four-square Microsoft logo (unaltered), the text "Continue with Microsoft"
(or "Sign in with Microsoft"), font Segoe UI where available. Light theme: background `#FFFFFF`, 1px border
`#8C8C8C`, text `#5E5E5E`. Dark theme: background `#2F2F2F`, text `#FFFFFF`.
