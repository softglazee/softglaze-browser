# SoftGlaze Browser — Bug & Security Audit

**Audit date:** 2026-07-05
**Scope:** full codebase — all main-process modules, the React renderer, the autofill bridge, and the Firefox extension.
**Method:** every subsystem read in full; each finding verified against the actual source.

**~95 verified issues.** This is a working checklist — tick items as they're fixed.

> **Status (branch `fix/top5-systemic-audit`, 2026-07-05):** the 5 systemic themes below **plus C1** are addressed. Fixed: **C1** account-registration takeover (first-run-only guard on OTP send + register); **C2** persona/autofill bridge (origin-bound, passwords no longer sent to page JS, fill plan capped); the **single-instance lock**; a **permission-enforcement pass** (delete/purge, clone/from-template, batchAddProxies, syncVendorPool, rotateProxyIp + SSRF guard, getProxyProviderCreds, systemHumanType, persona-vault handlers, export scoping, switchMember/superAdminSetup auth); **fail-open → fail-closed** (rbacPolicy unknown-kind + combined creds, licensePolicy null-expiry, secretStore seal, softglazeApi sync-throw, Gate vault-status, DbGate); and **browser-lifecycle** hardening (launch try/catch, session dedupe, close timeout + force-kill, surfaced injection failures). Also fixed: **C3** updater (https-only feed + Authenticode-gated) and **download integrity** (https + vendor-host allowlist on browser/Firefox/CRX downloads; Firefox SHA256SUMS verification; CRX size cap) — plus the related 🔵 http-scheme findings for `apiBaseUrl`/`updateFeedUrl`. Verified: 90/90 tests pass + frontend builds clean. **Not yet done** (follow-ups): `xlsx` upgrade, SOCKS5-auth relay, fingerprint version-pin mismatch, and the remaining 🟡/🔵 items.

## Verified-correct (not bugs — do not "fix" these)
- Core crypto: AES-256-GCM with a random 12-byte IV per encryption, scrypt KDF, GCM tag verified on decrypt; Ed25519 lease verification. All correct.
- `totp.js` is a generator only (no verifier), and base32/HMAC/RFC-4226 truncation are correct.
- The IPC dispatcher (`registerHandler`, ipcHandlers.js:335) safely try/catches every handler → no crash-the-main-process bugs, and there are **no duplicate `ipcMain.handle` registrations**.
- Renderer IPC event listeners (`onCheckProgress`, `onRunProgress`, etc.) are all subscribed inside `useEffect` with proper `off()` cleanup — no duplicate-handler leaks.
- No `dangerouslySetInnerHTML`/`innerHTML` anywhere; the footer link builder escapes and restricts to `https?://`.

## Five systemic themes (root causes)
1. **Missing authorization on IPC handlers** — many privileged actions check *access scope* but never the *permission/role*, so an Operator can do Owner-only things.
2. **Fail-open defaults** — auth, licensing, RBAC redaction, and the vault gate grant access on error/unknown input instead of denying.
3. **The persona/autofill bridge is exposed to every web page** — the most dangerous class of bug for an anti-detect product.
4. **Browser process lifecycle leaks** — failed/double launches orphan Chrome; no single-instance lock kills live sessions.
5. **`http://` accepted + no download/update signature checks** — MITM → cleartext secrets and remote code execution.

---

## 🔴 CRITICAL — fix before any further release

- [x] **C1 · Workspace takeover via `account:register`** — `src/main/ipcHandlers.js:6768` — *FIXED (branch fix/top5-systemic-audit): `assertFirstRunSetup()` now gates both `accountSendOtp` and `accountRegister` to genuine first run (no members + no enabled vault).*
  Never checks whether an OWNER already exists; unconditionally creates a new OWNER, sets `currentMemberId`, and **overwrites the vault password**. Reachable because `account:sendOtp` (`ipcHandlers.js:6635`) returns the OTP to the caller (`devCode`) when no SMTP is configured (the default).
  **Fix:** refuse registration when an OWNER exists (require owner/super auth to add owners); never overwrite an existing vault here.

- [ ] **C2 · Any website can steal the entire persona vault (plaintext passwords)** — `src/main/browserEngine.js:87-92`
  `page.exposeFunction('__sgPersonaList', …)` binds into the page's **main world**; any script can call `window.__sgPersonaList('https://x'+Math.random())`. Backend trusts the page-supplied URL and `serializePersona` (`ipcHandlers.js:4848`) returns `password` in cleartext. Persona IPC handlers (`ipcHandlers.js:4867-4940`) have no authorization, and the same secret leaks over the loopback bridge guarded only by a **hardcoded token shipped in the .xpi** (`src/main/autofillBridge.js:27`).
  **Fix:** derive origin from `page.url()` server-side (ignore page-supplied URL); never send `password` in the list payload (fetch it only on explicit fill of one id); require a user gesture; gate persona handlers behind `vault.manage`.

- [x] **C3 · Auto-updater = silent remote code execution** — `src/main/updater.js:51-79` + `src/main/tenantConfig.js:23` — *FIXED: tenantConfig drops non-https feed/api URLs; updater refuses non-https feeds and hard-disables unless the running build is Authenticode-signed.*
  `resolveFeed()` passes any `updateFeedUrl` (no scheme check) to `setFeedURL` with `autoDownload` + `autoInstallOnAppQuit`. Over `http://`, or on the unsigned builds this project ships, no Authenticode signature is verified → MITM/feed control = malicious installer auto-installed on next quit.
  **Fix:** refuse non-`https` feeds; hard-disable the updater unless the build is packaged *and* code-signed; verify a signature over `latest.yml`.

---

## 🟠 HIGH

### Authorization gaps (IPC)
- [ ] **Delete/purge enforce no permission** — `src/main/ipcHandlers.js:2882` (deleteProfile), `:2916` (purgeProfile), `:2936` (bulkDelete), `:2972` (bulkPurge). Check access scope but never `requirePermission('profiles.delete'/'purge')` → an Operator can irreversibly `fs.rm` profile data.
- [ ] **Full-workspace secret export at rank-1** — `src/main/ipcHandlers.js:4241` (gatherExport). Query unscoped (`deletedAt:null`, no tenant scope); emits **Proxy Password / Account Password / 2FA Key in cleartext**; gated only by `profiles.export` (every member).
- [ ] **`rotateProxyIp` = SSRF + no authz** — `src/main/ipcHandlers.js:483`. No access/permission check; persists renderer-supplied `rotationUrl` and `axios.get`s it (only `^https?://` checked) → target other members' proxies + coerce GETs to internal/localhost.
- [ ] **Decrypted provider secrets handed to renderer** — `src/main/ipcHandlers.js:4633` (getProxyProviderCreds). Returns `secretStore.open(...)` plaintext (password/token/apiToken) with no role gate.

### Licensing / payments
- [ ] **Entitlement on a bare `paid` boolean** — `src/main/payments.js:82/203/268` + `src/main/ipcHandlers.js:8069` (pollCheckout). `getStatus` never asserts amount/currency == plan; `pollCheckout` grants the full term on a **renderer-supplied** order id → point at any cheap already-paid invoice.
  **Fix:** `getStatus` must return the gateway's actual amount+currency; reject unless they meet the stashed plan price and the order id matches the one created in `startCheckout`.
- [ ] **Offline license secret ships in the binary** — `src/main/payments.js:292`. Hardcoded `LICENSE_SECRET`, signature truncated to 32 bits, `generatePurchaseCode` exported → anyone can mint lifetime codes. Gate real entitlement on the Ed25519 server lease; remove this fallback from production builds.

### Browser lifecycle
- [ ] **No single-instance lock → 2nd app launch kills the 1st's live browsers** — `src/main/main.js:245` + orphan cleanup `:84-104`. Every startup `taskkill /F`s any chrome whose command line contains `softglaze_profiles`; a second instance nukes all running profile sessions. **Likely the "browser closes by itself" bug.**
  **Fix:** `app.requestSingleInstanceLock()`; `app.quit()`/focus existing window on the second instance *before* orphan cleanup runs.
- [ ] **Launch failure orphans Chrome forever** — `src/main/browserEngine.js:2003-2405`. No try/finally between `puppeteer.launch()` and `activeSessions.set()`; if `browser.pages()`/`newPage()` throws, the browser is never stored and never closed. Wrap in `try { … } catch { await browser.close().catch(()=>{}); throw }`.
- [ ] **`applyToPage` swallows *all* injection errors** — `src/main/browserEngine.js:2203-2302`. If UA/timezone/fingerprint/proxy-auth injection throws, launch still returns success while the page runs the **real identity**. Surface injection failures instead of unconditionally swallowing.
- [x] **Downloaded browsers/extensions executed with no signature/checksum** — `src/main/firefoxEngine.js:483`, `src/main/browserDownloader.js:176`, CRX `src/main/extensionManager.js:143` — *FIXED: new `downloadGuard` enforces https + a vendor-host allowlist on the URL and every redirect (all three paths); Firefox additionally verifies the installer against Mozilla's SHA256SUMS; CRX gains a 128 MB size cap.*

### Renderer (daily-use breakage)
- [ ] **Editing any proxy overwrites its password with the mask** — `src/renderer/pages/ProxyPoolPage.jsx:439/448`. `openEdit` prefills `'••••••••'`; `handleSaveProxy` sends it verbatim → any edit breaks proxy auth. Apply the `pass || undefined` guard used by the email settings beside it.
- [ ] **Member limit inputs lose focus after every keystroke** — `src/renderer/pages/MembersPage.jsx:907`. `NumLimit` declared inside `PermissionEditor`'s render → remounts each keystroke → one digit at a time. Hoist to module scope.

---

## 🟡 MEDIUM

### RBAC / crypto / auth policy
- [ ] Unknown `kind` → **allow** in `canReadRaw` — `src/main/rbacPolicy.js:33`. Default-deny.
- [ ] Proxy redaction masks only `username`/`password`, misses combined `host:port:user:pass` strings — `src/main/rbacPolicy.js:46`.
- [ ] Crash-leftover **plaintext DB adopted after password check only, no content authentication** — `src/main/database.js:172`. Decrypt the `.enc` into the working path (or hash-compare) instead of trusting unauthenticated plaintext.
- [ ] **License expiry checked against unclamped local clock** — `src/main/licenseClient.js:42`. Clock rollback keeps expired paid leases valid. Feed `verifyLease` the clamped last-seen time; persist a monotonic floor.
- [ ] `seal()` **silently persists plaintext** when OS encryption is unavailable — `src/main/secretStore.js:33`. Fail closed for real secrets.
- [ ] At-rest key allows a **4-char password** at default scrypt cost — `src/main/dbCrypto.js:53` + `src/main/database.js:218`. Enforce a strong passphrase and raise scrypt params.
- [ ] **Null `trialEndsAt` → never-expiring trial** — `src/main/licensePolicy.js:47`. Fail closed (missing expiry = expired).
- [ ] `effectivePermissions` trusts stored numeric limits/flags unclamped — `src/main/permissions.js:134`. Clamp to role default (`Math.min`/AND).

### More missing-authz IPC
- [ ] `cloneProfile`/`createProfileFromTemplate` skip create-permission + quota — `src/main/ipcHandlers.js:2285`/`:2339`.
- [ ] `batchAddProxies` no permission/quota, creates proxies with **null owner** (orphaned) — `src/main/ipcHandlers.js:1093`.
- [ ] `switchMember` lets you assume OWNER **without its password** when no member is active — `src/main/ipcHandlers.js:5906`.
- [ ] `superAdminSetup` — unauthenticated first-run Super-Admin claim — `src/main/ipcHandlers.js:5963`.
- [ ] `syncVendorPool` no proxies-manage gate — `src/main/ipcHandlers.js:1463`.
- [ ] `systemHumanType` types keystrokes into any session id with no access check — `src/main/ipcHandlers.js:9098`.

### Networking / sync / payments
- [ ] **PUT that 404s is treated as a successful upload** → silent sync data loss — `src/main/syncTransport.js:53`. Only allow 404 on GET.
- [ ] `http://` sync sends the **bucket Bearer token in cleartext** — `src/main/syncTransport.js:42`.
- [ ] Relay redaction misses cookie `value` + `Authorization`/`Cookie` headers; screenshots never scrubbed — `src/main/remoteRelay.js:23`. Switch to deny-by-default allowlist.
- [ ] PayPal `/capture` runs inside every read-only status poll with **no idempotency key**; no idempotency on any create-invoice call — `src/main/payments.js:254`.
- [ ] LWW conflict returns an **auto-applicable resolution** + wall-clock winner → skewed clock permanently clobbers good data — `src/main/syncPolicy.js:44`. Return `resolution:null` on conflict; add a monotonic `rev`.
- [ ] Blanket `uncaughtException`/`unhandledRejection` swallow keeps a **corrupted process alive** — `src/main/main.js:46`. Scope tolerance to known-benign teardown; treat real exceptions as fatal.
- [ ] Webhook verify has no amount binding / replay / idempotency — `src/main/payments.js:102`.
- [ ] Sync response body buffered with **no size cap** (OOM) — `src/main/syncTransport.js:48`.

### Browser engines
- [ ] Reported Chrome major (pinned ≤149) **mismatches the real launched binary** (150+) → UA/Client-Hints vs TLS/JA4 mismatch — `src/main/fingerprintGenerator.js:397` + `src/main/browserEngine.js:361`.
- [ ] `close()` awaited with no timeout and **never force-kills via the tracked PID** → hung Chrome blocks app quit — `src/main/browserEngine.js:2741`. PID_FILE registry (`:234`) is write-only, never read back to reap orphans.
- [ ] Double-launch of one profile **overwrites `activeSessions`** and orphans the first browser — `src/main/browserEngine.js:2383`. Dedupe by session id.
- [ ] **Authenticated SOCKS5 fails silently** (Chromium can't auth SOCKS; `page.authenticate` only answers 407) — `src/main/browserEngine.js:2230`. Route through the local relay like Firefox, or reject clearly.
- [ ] Firefox spawned with **undrained piped stdio** → fills OS pipe buffer and hangs — `src/main/firefoxEngine.js:285`. Use `stdio:'ignore'`.
- [ ] Firefox `onGone` on both `exit` and `error` → **double-fires** cleanup + inflates crash count → false restart — `src/main/firefoxEngine.js:298`. Guard with a settled flag.
- [ ] Truncation check bypassed when server omits Content-Length — `src/main/browserDownloader.js:287`.
- [ ] Firefox auth relay **leaks in-flight tunnels on close**, no upstream timeout, open authenticated local proxy while running — `src/main/firefoxEngine.js:127`.

### Autofill / import
- [ ] `__sgPersonaMarkUsed` trusts page args → a site can mark every identity "used" on arbitrary domains — `src/main/browserEngine.js:95`.
- [ ] **`xlsx@0.18.5` runs on untrusted files in the main process** — CVE-2023-30533 (prototype pollution) + CVE-2024-22363 (ReDoS), fixed only in SheetJS 0.20.2+ — `src/main/importParser.js:4`. Upgrade or sandbox in a worker.
- [ ] Import ReDoS + no row cap in `parseWorkbookFile`, all main-thread → freezes the app — `src/main/importParser.js:197`.
- [ ] `profileArchive` has **no safe-extract helper** (zip-slip/symlink) — the moment an importer is wired to `decryptArchive` it writes outside the target dir — `src/main/profileArchive.js:84`.
- [ ] `__sgPersonaFillPlan` accepts an unbounded plan/value and drives the CDP keyboard 50-150ms/char → a 100k-char value hangs the main process — `src/main/browserEngine.js:106`.
- [ ] `looksLikeInstructionRow` silently drops legit profiles titled "Example Corp"/"Notes…" with no error — `src/main/importParser.js:79`.

### Renderer
- [ ] `GlobalPreferences` reads `s.security.*`, `s.multiDevice.*`, `s.captcha.*` etc. with **no guards** → a partial settings object throws and kills the whole panel — `src/renderer/pages/SettingsPage.jsx:507`.
- [ ] Search refetches 7 IPC calls **per keystroke, no debounce, no out-of-order guard** → stale results overwrite fresh — `src/renderer/pages/ProfilesPage.jsx:624`.
- [ ] "Running…" state can stick **forever** if the terminal progress frame is dropped — `src/renderer/pages/AutomationPage.jsx:816`/`:1213`.
- [ ] **`window.prompt` is unsupported in this renderer** — "Save preset" (`src/renderer/pages/ProfilesPage.jsx:1012`) and "Save warmer list" (`src/renderer/pages/AutomationPage.jsx:1133`) silently do nothing. Use the in-app modal pattern (as MacrosPanel already does).
- [ ] `MacroRunModal` effect depends on `t`/`profileName` → a language switch mid-run **starts a second concurrent macro run** — `src/renderer/pages/AutomationPage.jsx:652`. Depend only on `macro.id`/`profileId`.
- [ ] Direct mutation of `platformAccounts` nested objects corrupts the preview snapshot — `src/renderer/pages/ProfilesPage.jsx:1356`.
- [ ] Optimistic settings `apply` replaces state with full server snapshots → out-of-order responses drop a toggle — `src/renderer/pages/SettingsPage.jsx:473`.
- [ ] **Gate fails OPEN on any error** — `evaluate()` catch → licensing, licensing catch → `ready`, and `vault.status().catch(()=>({locked:false}))` treats an unreadable vault as *unlocked* — `src/renderer/components/Gate.jsx:399`/`:555`. Vault read failure should fail *closed*.
- [ ] `softglazeApi` wrappers **throw synchronously** (before returning a promise) when `window.softglaze` is missing → every `.catch()` guard is bypassed, feeding the Gate fail-open — `src/renderer/lib/softglazeApi.js:1`.
- [ ] Gate `pollPurchase` interval never stored/cleared → leaks, keeps `busy` true ~10 min, can fire `setPhase` after sign-out — `src/renderer/components/Gate.jsx:579`.
- [ ] Gate `verifyAndCreate` has no in-flight guard and OTP inputs stay editable → double `account.register` — `src/renderer/components/Gate.jsx:458`.
- [ ] Banned-screen `PayMethods` selects `methods[0]` once at mount, before methods load async → no pay button renders — `src/renderer/components/Gate.jsx:253`.

---

## 🔵 LOW

- [x] License transport permits `http://` for register/checkout/redeem — `src/main/licenseClient.js:60`; same unvalidated schemes in `src/main/tenantConfig.js:18` — *FIXED at the source: tenantConfig now rejects non-https `apiBaseUrl` (http allowed only for localhost dev), so the client never receives an http base URL.*
- [ ] Tenant binding skipped when lease omits `tenant` — `src/main/licenseClient.js:41`.
- [ ] "Remember me" stores the raw vault password in a user-reversible DPAPI blob — `src/main/rememberStore.js`.
- [ ] Migration idempotency swallows *all* "already exists" errors → silent schema drift recorded as applied — `src/main/database.js:409`.
- [ ] `secretStore.open()` returns the still-sealed blob when decryption fails → used as a literal credential — `src/main/secretStore.js:48`.
- [ ] `secureUnlink` single-pass overwrite is ineffective on SSD/journaled FS — `src/main/dbCrypto.js:154`.
- [ ] `clampNow` rollback tolerance is a full day and stored in the same editable DB — `src/main/licensePolicy.js:84`.
- [ ] `getProxyHealthHistory`/`getProxyRotation`/`setProxyRotation` miss per-resource access checks — `src/main/ipcHandlers.js:935`/`:954`/`:4403`.
- [ ] `importPreviewCache` never deleted on commit / no TTL → parsed credentials resident indefinitely — `src/main/ipcHandlers.js:3896`.
- [ ] `cookieRobot` target URLs not scheme-validated (`file://` reachable) — `src/main/ipcHandlers.js:564`.
- [ ] Dead/contradictory guard in `startTrial` — `src/main/ipcHandlers.js:7821`.
- [ ] `localApi` unauthenticated `/health` + no Host/Origin check → DNS-rebinding fingerprint — `src/main/localApi.js:71`.
- [ ] `windowIcon` PowerShell string escapes `\` but not `'` → breaks for usernames like `O'Brien` — `src/main/windowIcon.js:143`.
- [ ] Export uses bare `path.join` instead of the containment-checked resolver — `src/main/ipcHandlers.js:537`.
- [ ] `archiver` ENOENT warnings swallowed → silent partial profile export reported as `ok` — `src/main/profileArchive.js:63`.
- [ ] `readBody` can hang on abort/close (no resolve) — `src/main/autofillBridge.js:53`.
- [ ] `parseProxyString` misclassifies `socks4://` as SOCKS5 — `src/main/browserEngine.js:277`.
- [ ] Dead `createProxyAuthExtension` writes proxy creds in plaintext to disk (unused, latent) — `src/main/browserEngine.js:1127`.
- [ ] Per-tab `framenavigated`/request-interception handlers accumulate over a long session — `src/main/browserEngine.js:2311`.
- [ ] `reconcileStrayZips` can extract concurrently with an active install — `src/main/browserDownloader.js:353`.
- [ ] `BillingPage` checkout interval leak on second checkout — `src/renderer/pages/BillingPage.jsx:125`.
- [ ] `DashboardPage` loader has no mounted guard — `src/renderer/pages/DashboardPage.jsx:343`.
- [ ] Proxy-type casing mismatch (`SOCKS5` vs `Socks5`) in the profile editor `<select>` — `src/renderer/pages/ProfilesPage.jsx:1256`.
- [ ] `EnvRow`/`EnvHead`/`SuperLink` components defined in render → remount each keystroke — `src/renderer/pages/ProfilesPage.jsx:1732`, `src/renderer/components/Gate.jsx:624`.
- [ ] Index-as-key on reorderable/removable lists — `src/renderer/pages/AutomationPage.jsx:563`/`:1336`.
- [ ] `AppShell` nav visibility defaults to allowed (`feats[key] !== false`) — `src/renderer/components/AppShell.jsx:75`.
- [ ] `DbGate` fails open on status-read error — `src/renderer/components/DbGate.jsx:22`.
- [ ] `ProxyProviders` check/sync results not stale-guarded — `src/renderer/components/ProxyProviders.jsx:142`.
- [ ] `useDialog` capture-phase Escape closes stacked dialogs / blocks CommandPalette Escape — `src/renderer/lib/useDialog.js:36`.
- [ ] `DeveloperApiSettings` destructuring shadows the translation function `t` — `src/renderer/components/DeveloperApiSettings.jsx:25`.
- [ ] `BillingSettings` `PaymentGatewayCard` spins forever on config error — `src/renderer/components/BillingSettings.jsx:124`.
- [ ] `WorkspaceBackupSettings` size shows `NaN KB` if `dbBytes` missing — `src/renderer/components/WorkspaceBackupSettings.jsx:39`.
- [ ] `CookieManagerModal` trusts response shapes un-defensively; `key={r.sessionId}` can duplicate — `src/renderer/components/CookieManagerModal.jsx:58`.
- [ ] `OnboardingWizard` default profile name captured once at mount (stale after language switch) — `src/renderer/components/OnboardingWizard.jsx:62`.
- [ ] Stale `t` in memoized loaders across several settings components (`SyncSettings`, `DbEncryptionSettings`, `IpProvidersSettings`, `MonetizationSettings`) — cosmetic error strings after a mid-session language switch.

---

## Recommended fix order (systemic)
1. **Close the persona/autofill hole (C2)** — origin-bind the exposed functions, stop shipping passwords in the list payload, require a gesture.
2. **Add the single-instance lock (`main.js`)** — cheap; almost certainly stops the "app kills my running browsers" bug.
3. **Permission-enforcement pass on `ipcHandlers.js`** — add `requirePermission` + scope checks to every write/delete/export/reveal handler. Consider a central channel→required-rank table enforced in `registerHandler` so new handlers can't ship ungated by default.
4. **Flip every fail-open to fail-closed** — Gate vault-status, `DbGate`, `rbacPolicy` unknown-kind, `licensePolicy` null-expiry, `secretStore` seal; fix `softglazeApi` to reject-not-throw so `.catch()` works.
5. **Harden the browser lifecycle** — try/finally around launch, dedupe sessions, `close()` timeout → PID force-kill, consume PID_FILE on startup, stop swallowing `applyToPage` errors.
6. **Require `https` + verify signatures** — updater feed (C3), license/sync transports, SHA-256-pin all browser/extension downloads.
7. **Upgrade `xlsx`** to a patched SheetJS build; add a safe-extract helper before wiring any archive importer.
8. **Two quick renderer wins** — proxy-password-mask overwrite; member-limit focus-loss.
