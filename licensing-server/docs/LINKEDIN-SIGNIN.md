# LinkedIn sign-in ("Continue with LinkedIn")

"Continue with LinkedIn" works like "Continue with Google" (docs/GOOGLE-SIGNIN.md) and "Continue with Facebook"
(docs/FACEBOOK-SIGNIN.md): every app (desktop, phone, web) sends the browser to this server, the server sends it to
LinkedIn, LinkedIn comes back to **one** callback on this server, and the app gets a one-time code only it can trade
(PKCE). The client secret never leaves the server. Button order in every app: Google, Microsoft, Facebook,
LinkedIn, GitHub, then email.

Code: `src/auth/providers/linkedin.js`. Tests: `test/linkedinSignIn.test.js`.

## 1. What the server does (checked 20 November 2026)

Sources: "Sign In with LinkedIn using OpenID Connect" and "LinkedIn 3-Legged OAuth Flow" on learn.microsoft.com,
and the live discovery document https://www.linkedin.com/oauth/.well-known/openid-configuration.

| Step | Call |
|---|---|
| Authorize | `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id&redirect_uri&state&scope=openid profile email&nonce&code_challenge&code_challenge_method=S256` |
| Callback | `GET https://api.softglaze.com/auth/callback/linkedin?code&state` (or `?error=user_cancelled_login\|user_cancelled_authorize`, shown to the apps as a cancel) |
| Token | `POST https://www.linkedin.com/oauth/v2/accessToken` (form): grant_type, code, client_id, client_secret, redirect_uri, code_verifier |
| ID token | RS256 signature against `https://www.linkedin.com/oauth/openid/jwks`; `iss` = `https://www.linkedin.com/oauth` (also accepted: `https://www.linkedin.com`, the value on the older doc page); `aud` = our client id; `exp`, `iat`; the nonce when LinkedIn includes it |
| Userinfo | `GET https://api.linkedin.com/v2/userinfo` (Bearer): `sub` must equal the ID token's; gives `email` and `email_verified` |

* **Email rule:** LinkedIn's `email` and `email_verified` are optional. Only an address with
  `email_verified: true` is used, so an account is linked by email only when LinkedIn verified it. No email, or an
  unverified one, refuses the sign-in (`email_not_verified`, the same message as Google/GitHub) and nothing is
  linked or created.
* **PKCE:** LinkedIn's pages do not document PKCE for this product (only for approved native apps), but the
  authorization endpoint accepts `code_challenge` (checked with the real client id: 303 to LinkedIn's login page,
  while a wrong redirect URI or client id is refused) and its token errors mention the "code verifier". The server
  sends it. If the first real sign-in fails with an `invalid_request` about the code verifier, set
  `LINKEDIN_PKCE=off` in `config/.env` (no restart): the flow stays protected by the client secret, the one-time
  state and the browser nonce cookie.
* **Nonce:** sent (a one-way value of the browser nonce cookie); checked when LinkedIn puts it in the ID token.
  LinkedIn does not document echoing it, so a token without one is accepted.
* **No refresh token** is requested or kept, and the access token is used once for userinfo and dropped. We only
  need who the person is.
* **Stored:** an `Identity` row with `provider = 'linkedin'`, `providerUserId` = `sub` (LinkedIn's pairwise member id
  for our app), the verified email. Name: kept as the customer's name only when it has none. Picture: not stored.
* LinkedIn's note: "Sign In with LinkedIn using OpenID Connect does not verify user identities". We treat it like
  any other sign-in method, never as identity proof.

## 2. LinkedIn app settings (the owner)

LinkedIn Developers > My apps > the SoftGlaze app:

1. **Products:** "Sign In with LinkedIn using OpenID Connect" added (gives the scopes `openid`, `profile`,
   `email`).
2. **Auth > Authorized redirect URLs for your app:** `https://api.softglaze.com/auth/callback/linkedin` (already
   registered). Nothing else: the phone and web apps never talk to LinkedIn directly.
3. **Settings:** app name and logo (shown on LinkedIn's consent screen), privacy policy URL.

LinkedIn has no data deletion callback. When a member removes the app in LinkedIn (Settings > Data privacy >
Permitted services), LinkedIn stops answering for them; the link row stays until the person removes it or deletes
the account, like the GitHub and Google links.

## 3. Server keys

Same file and same way as Google (docs/GOOGLE-SIGNIN.md section 2):

```bash
cp -p "$ENVF" "$ENVF.bak-$(date -u +%Y%m%dT%H%M%SZ)"
sed -i '/^LINKEDIN_CLIENT_ID=/d;/^LINKEDIN_CLIENT_SECRET=/d' "$ENVF"
read -r -p 'LinkedIn Client ID: ' LIID
read -r -s -p 'LinkedIn Primary Client Secret (hidden): ' LISECRET; echo
printf '\nLINKEDIN_CLIENT_ID=%s\nLINKEDIN_CLIENT_SECRET=%s\n' "$LIID" "$LISECRET" >> "$ENVF"
unset LIID LISECRET
chmod 600 "$ENVF"
grep -c '^LINKEDIN_CLIENT_' "$ENVF"   # must print 2
```

| Name in `config/.env` | Value | Needed for |
|---|---|---|
| `LINKEDIN_CLIENT_ID` | Auth tab > Client ID | LinkedIn button (all apps) |
| `LINKEDIN_CLIENT_SECRET` | Auth tab > Primary Client Secret (secret) | LinkedIn button |
| `LINKEDIN_PKCE` | optional, `off` to stop sending PKCE | see section 1 |

Without both keys no app shows the LinkedIn button. The local copy of the values is
`I:\Secrets\SoftGlaze\linkedin-oauth.env`; never commit them. The client secret can only be proven by a real
sign-in: LinkedIn answers a test token call the same way for a right or a wrong secret.

## 4. Endpoints

Desktop `GET /auth/start?provider=linkedin&...`, phone `GET /v1/mobile/auth/authorize?...&provider=linkedin`,
web `GET /v1/web/auth/authorize?...&provider=linkedin`: the same contract as Google (docs/GOOGLE-SIGNIN.md section 4).

## 5. Brand

LinkedIn's brand rules for sign-in buttons: LinkedIn blue `#0A66C2` background, the white "in" logo (unaltered),
the text "Continue with LinkedIn".
