# Google Play review login

Google Play reviewers must be able to sign in to the phone app (`com.softglaze.mobile`), but they cannot read
our inbox, so the normal email code never reaches them. The review login gives ONE fixed address ONE fixed
6-digit code that we type into Play Console (App content > App access). Code: `src/auth/reviewLogin.js`.

## How it works

It is **off** unless both lines are in `config/.env` (or the real process environment):

```
REVIEW_LOGIN_EMAIL=play-review@softglaze.com
REVIEW_LOGIN_CODE_HASH=scrypt:32768:8:1:<salt base64url>:<key base64url>
```

- The hash is a salted scrypt hash of the 6-digit code (N a power of two from 2^14 to 2^20, r 8 to 16, p 1 to 4,
  salt of 16+ bytes, key of 32+ bytes). A bare sha256 or anything malformed is refused, and the feature stays off
  (one warning in the log). The plain code is never stored on the server, in the repo or in a log.
- The server re-reads `config/.env` when it changes. **Removing the two lines switches the review login off at
  once**, without a restart: the copy of a `config/.env` value made at startup is ignored for these two names
  (`liveEnvFresh` in `src/env.js`).
- Only that exact address counts: the normalised address (trimmed, lowercase) and the account key must both
  equal those of `REVIEW_LOGIN_EMAIL`. A `+tag`, another domain or any other address takes the normal path and
  the review code does nothing for it.

For the review address, on every client that uses the email code (phone `/v1/mobile/auth/email/*`, web
`/v1/web/auth/email/*`, desktop `/auth/email/*` and `/v1/account/verify/*`):

- **Asking for a code** runs every normal check and limit (disposable list, MX, resend throttle, hourly limits
  per address and per network, SMTP configured) and writes the normal verification row, holding the HMAC of a
  random code nobody receives. **No email is sent or queued**, and the answer is exactly the normal one
  (`{ challengeId, resendAfterSec, expiresAt }` on phone and web, `{ ok, sent: true, ... }` on desktop).
- **Checking a code** compares it with `REVIEW_LOGIN_CODE_HASH` in constant time instead of the row's hash. The
  row's expiry (10 min), single use, and 5 attempts per code still apply, plus a strict extra lock:
  **10 wrong codes for the review address in 24 hours refuse every check** (429 `too_many_attempts`) until the
  24 hours pass. Anyone who knows the address could trigger that lock, so the address should stay private
  (only in Play Console).
- **A successful sign-in** is a normal sign-in (session, phone limit, email identity) of a normal customer in the
  normal tenant (`ACCOUNT_TENANT_ID`), on the Free plan unless someone gives it more. It is logged as
  `[review-login] review sign-in ok: via=mobile|web|desktop customer=<id> at=<iso>` and recorded as the
  customer event `review_login` (`{ via }`), so reviewer activity shows in the server log and in the admin
  customer timeline. Neither ever holds the code or the hash.

Known limits:

- The review answer comes back a little faster than a real send (no SMTP round trip).
- The phone limit (`MOBILE_PHONES_ALLOWED`, default 3) applies to the review account like any other. If
  reviewers use many devices, sign the old phones out in the admin, or raise the limit for the review period.
- Emails the account would get later (automations) go to the review address; create it as a mailbox or a
  forwarder, or keep marketing off for it.

## Owner steps

The helper script lives outside the repo (`I:\reports\softglaze-play-review-login\review-login.sh`, README next
to it). Run it in your own Git Bash window:

1. `bash review-login.sh enable` — press Enter for the default address, then type a 6-digit code (hidden) or
   press Enter to generate one. It writes the two lines over SSH (backup of `config/.env` first) and prints
   the code **once**.
2. Play Console > App content > App access > "All or some functionality is restricted": add the address,
   the code, and: "On the sign-in screen enter the email, tap *Email me a code*, then type the 6-digit code.
   No email is needed."
3. Test once on a phone with the live app.
4. After the review (or if the code leaks): `bash review-login.sh disable`, or run `enable` again for a new
   code (the old one stops working).

Making a hash by hand on a trusted computer (the code on stdin, not on the command line):

```
printf '%s' 123456 | node -e "const c=require('crypto');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const N=32768,r=8,p=1,salt=c.randomBytes(16);const k=c.scryptSync(s,salt,32,{N,r,p,maxmem:256*N*r+1048576});console.log(['scrypt',N,r,p,salt.toString('base64url'),k.toString('base64url')].join(':'))})"
```

Tests: `test/playReviewLogin.test.js`.
