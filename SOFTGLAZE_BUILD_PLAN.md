# SOFTGLAZE BUILD PLAN — for Claude Code (VS Code)

> One file, all phases. Keep it in the repo. You never need to re-paste it.

## HOW TO USE THIS (read once)

1. Save this file at the **repo root** as `SOFTGLAZE_BUILD_PLAN.md` and commit it.
2. Open Claude Code in VS Code with the repo open.
3. To run a phase, send Claude Code a **one-line message**, e.g.:
   > Read `SOFTGLAZE_BUILD_PLAN.md`. Apply the GLOBAL RULES. Do **PHASE 0** only: run its pre-flight checks, show me the plan, and **wait for my approval before writing any code.**
4. Approve the plan → it builds → it self-verifies → you review → move to the next phase the same way.
5. Do the phases **in order**. Don't skip Phase 0 and Phase 1 — they unblock and protect everything after.

(You can also attach this file in chat by typing `@SOFTGLAZE_BUILD_PLAN.md`, but committing it to the repo is simpler — Claude Code can just read it.)

---

## GLOBAL RULES (apply to every phase)

**Workflow per phase:** (a) run the pre-flight greps, (b) report **EXISTS / PARTIAL / MISSING** for each item with file+line evidence, (c) propose *extend vs build-new* with the exact files + IPC channels you'll touch, (d) **wait for my approval**, (e) implement, (f) self-verify, (g) hand back complete files + a short "what changed / how I verified" note.

**Anti-hallucination (hard):**
1. Every `require`/`import` must resolve to a real file or a package already in `package.json`. Need a new package? Add it to `package.json` explicitly and run `npm install` — never rely on an unsaved local `node_modules`.
2. No second design system / no invented components. Reuse `src/renderer/components/ui/*` (`Button`, `Card`, `Dialog`, `Input`, `Textarea`, `Badge`) and the Tailwind v4 `@theme` tokens (indigo `--color-primary`, `--color-surface/card/border`, `Space Grotesk` display font).
3. Stubs behave like stubs: marked `// TODO`, return an explicit "not configured / offline" state, and **never report success for work that didn't happen.**
4. Don't duplicate what exists (see CURRENT STATE). If a task's premise is wrong (already built, or a bug doesn't reproduce), say so and stop.

**Architecture (must respect):** Electron `contextIsolation:true, sandbox:true`, `nodeIntegration:false`. All renderer↔main traffic goes through the **four IPC layers**: `CHANNELS` map in `src/main/ipcHandlers.js` → `registerHandler(channel, fn)` → `CHANNELS`+`ALLOWED_CHANNELS`+frozen `api` in `src/preload/preload.js` → wrapper in `src/renderer/lib/softglazeApi.js`. A channel wired in fewer than four places is a bug. Table-less config uses the `Setting` key/value model via `readSetting`/`writeSetting`. Secrets at rest use `src/main/secretStore.js`; secret-bearing serializers pass through `src/main/rbacPolicy.js → redactForRole`. Privileged handlers use the existing `requirePermission` / RBAC.

**Definition of done (every phase):**
- `npx vite build` is green.
- `node --check` passes on every touched file under `src/main/**` and `src/preload/**`.
- New Prisma field/model → a new timestamped folder under `prisma/migrations/<TS>_<name>/migration.sql` that the app's own runner (`src/main/database.js → applyMigrations`) can apply (plain SQL, statement-per-line; the runner splits on `;`).
- Complete files only — no partial diffs, no "…unchanged…".

---

## CURRENT STATE (verified — DO NOT REBUILD)

Stack: Electron + preload allow-list + React 19/Vite/Tailwind v4 + Prisma/SQLite. ~23k LOC, **137 IPC channels**, 16 migrations.

Already implemented (extend, never duplicate):
- **Profiles**: `pages/ProfilesPage.jsx`, engine `main/browserEngine.js`; fingerprint gen (`main/fingerprintGenerator.js`) + injection, leak check, cookie manager, templates, trash, clone, bulk ops.
- **Browsers**: `main/browserDownloader.js`, version/brand selectors, Firefox engine `main/firefoxEngine.js`, per-profile QUIC.
- **Proxies**: pool + health checker + **background sweep scheduler** (`startProxyScheduler`/`runProxyHealthSweep`, `Setting.proxyScheduler`), IP-provider integrations (`components/IpProvidersSettings.jsx`), **IP rotation** (`components/ProxyRotationModal.jsx`, `proxy:rotate*`). `browserEngine.js` has **`lookupProxyGeo`**.
- **Members + RBAC**: hierarchy (`Member.parentMemberId`), per-member login (`passwordHash/Salt`), permissions engine `main/permissions.js`, invites (`inviteCode/inviteStatus`), super-admin, **credential redaction** `main/rbacPolicy.js` (`redactForRole(role, kind, record)`, kinds: `proxyCredentials|tokenString|cookieDump`).
- **Account/auth**: vault (scrypt), `pages/AccountSettingsPage.jsx`, avatar (`Member.avatarUrl`), logout, OTP-gated edits, native TOTP `main/totp.js` (`generateTotp`, `totpToken`, `base32Decode`).
- **Monetization**: `License` model, Cryptomus `main/payments.js`, `components/BillingSettings.jsx` + `MonetizationSettings.jsx`.
- **Local Developer API**: `main/localApi.js` (loopback `127.0.0.1`, Bearer `sg_…`, SHA-256-hashed `ApiToken`, off by default; launcher injected via `configure()`).
- **Automation**: `Macro` model + `pages/AutomationPage.jsx`; channels `automation:get-macros|save-macro|delete-macro|get-history|start-warmer|warmer-progress` (no-code macros + cookie warmer).
- **Extensions**: `main/extensionManager.js`, `Extension` model (Chrome `.crx` download/unzip/inject).
- **Data**: batch import/export, profile migration `main/migrationService.js`.
- **Enterprise FOUNDATIONS** (crypto real, transport stubbed): cloud sync `main/cloudSync.js` (`CloudSyncEngine`, injected `transport.put/get`, real scrypt+AES-GCM envelope); shadowing relay `main/remoteRelay.js` (`RemoteRelay`, `relay` singleton, `sanitizeFrame`, `attachTransport` stub, frames `{t,sessionId,ts,payload}`).
- **Archive**: `.sgz` export/import `main/profileArchive.js` (`exportProfileArchive`, `decryptArchive`; format `SGZ1`+salt+iv+ciphertext+authTag, scrypt key).
- Dashboard charts, theme system.

Models: `Proxy, Group, Template, ActivityLog, Setting, Member, License, IpProvider, Macro, ApiToken, Extension, Profile`. Routes: `/ /dashboard /profiles /groups /proxies /browsers /extensions /automation /batch-import /trash /members /account /settings`.

Known gaps the phases address: **4 runtime deps missing from `package.json`**, no tests, no CI, plaintext SQLite, no macro recorder/scheduler/parallel-runner, the two Enterprise transports stubbed.

Existing deps: puppeteer(+extra+stealth), nodemailer, @prisma/client, electron-updater, xlsx, @radix-ui/react-dialog, lucide-react. (No express/ws/otplib — built-ins are used; keep it that way unless a phase says otherwise.)

---

# PHASE 0 — Fix the ship-blocking missing dependencies

**Goal:** make a clean `git clone && npm install` (and the packaged build) start without crashing.

**Why:** `archiver`, `axios`, `extract-zip`, `proxy-agent` are `require()`d but absent from `package.json`. `ipcHandlers.js` loads `extensionManager` and `profileArchive` at boot, which top-level-require `axios`/`extract-zip`/`archiver` → on any machine that didn't `npm install` them ad-hoc, the app **crashes on startup**. It only runs locally because they're in an unsaved local `node_modules`.

**Pre-flight:**
```bash
grep -rnE "require\('(archiver|axios|extract-zip|proxy-agent)'\)" src/main
node -e "const d=require('./package.json').dependencies; ['archiver','axios','extract-zip','proxy-agent'].forEach(p=>console.log(p, !!d[p]))"
```

**Tasks:**
1. Add the four to `package.json` `dependencies` with a verified compatible version each (check the latest stable on npm; do not guess blindly). Run `npm install` so `package-lock.json` updates.
2. (Recommended) make the boot-path requires lazy: move `require('axios')`/`require('extract-zip')` in `extensionManager.js` and `require('archiver')` in `profileArchive.js` to *inside* the functions that use them, so a missing optional binary degrades that one feature instead of bricking startup.
3. Create `scripts/check-deps.js`: scan `src/**` for bare `require('pkg')` and `import … from 'pkg'` (ignore `node:*`, relative `./`/`../`, and the package's own name), and exit non-zero if any imported package is not listed in `package.json` deps/devDeps. Print the offenders.
4. Add an npm script `"check:deps": "node scripts/check-deps.js"`.

**Acceptance:**
- `node -e "require('archiver');require('axios');require('extract-zip');require('proxy-agent')"` resolves.
- `npm run check:deps` passes.
- `npx vite build` green; `node --check` clean on touched main files.

**Don't:** don't refactor unrelated code; this phase is intentionally tiny.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 0** only. Run the pre-flight, show me the plan, wait for approval.

---

# PHASE 1 — Safety net: tests + CI + code-split

**Goal:** stop regressions before adding more features; make CI catch problems like Phase 0 automatically.

**Pre-flight:**
```bash
ls .github 2>/dev/null; find . -path ./node_modules -prune -o -name "*.test.*" -print
node -e "console.log(require('./package.json').scripts)"
```

**Tasks:**
1. Add a lightweight test runner (prefer **`node:test`** built-in — no new dep; or `vitest` if you justify it). Unit tests for the crypto seams:
   - `main/totp.js` against the RFC-6238 SHA-1 test vectors.
   - `main/profileArchive.js` export→`decryptArchive` round-trip on a temp dir (wrong password must fail the GCM tag).
   - `main/cloudSync.js` envelope encrypt→decrypt round-trip; tampered ciphertext fails.
   - `main/rbacPolicy.js → redactForRole`: OPERATOR gets `••••••••` for `proxyCredentials/tokenString/cookieDump`; OWNER gets raw.
2. **IPC parity smoke test** (pure, no Electron): assert every `CHANNELS` value in `ipcHandlers.js` is registered via `registerHandler` AND mirrored in `preload.js`'s `CHANNELS`+`ALLOWED_CHANNELS`. This catches half-wired channels.
3. `.github/workflows/ci.yml`: on push/PR → `npm ci` → `npm run check:deps` → `npx vite build` → `node --check` on `src/main/**` + `src/preload/**` → `node --test` → `npx electron-builder --dir` (build only, no publish). Use `PUPPETEER_SKIP_DOWNLOAD` / `ELECTRON_SKIP_BINARY_DOWNLOAD` where appropriate to keep CI fast.
4. **Code-split the renderer** (bundle is one ~762 KB chunk): convert the heavy pages in `App.jsx` (`ProfilesPage`, `SettingsPage`, `AutomationPage`, `BatchImportPage`) to `React.lazy` + `<Suspense>` with a small fallback.

**Acceptance:** `node --test` passes; CI workflow valid; `npx vite build` shows multiple chunks; nothing else behaves differently.

**Don't:** don't add Jest/heavy frameworks if `node:test` suffices; don't touch feature logic.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 1** only. Plan first, wait for approval.

---

# PHASE 2 — Proxy-at-scale + Macro recorder & scheduler

**Goal:** make proxies coherent automatically and let macros be recorded and run on a timer.

**Pre-flight:**
```bash
grep -n "lookupProxyGeo\|runProxyHealthSweep\|startProxyScheduler\|proxyScheduler" src/main/browserEngine.js src/main/ipcHandlers.js
grep -oE "'(proxy|automation):[a-z-]+'" src/main/ipcHandlers.js | sort -u
sed -n '1,60p' src/renderer/pages/AutomationPage.jsx
```

**Tasks:**
1. **Geo auto-match (extend, don't re-detect):** on proxy assignment/launch, use the existing `lookupProxyGeo` country to set the profile's timezone, locale, and WebRTC policy when those are on "Auto". Add a per-profile/global toggle in `Setting`. Wire at launch in `browserEngine.js` (and `firefoxEngine.js` if it has the same hooks).
2. **Rotation policy layer (the rotation primitive already exists):** add `Setting.proxyPolicy` (per group/profile): rotate-each-launch | sticky-per-profile | auto-failover-to-next-healthy. Apply during proxy selection at launch. New channels `settings:get-proxy-policy` / `set-proxy-policy`.
3. **Concurrent bulk health test:** the current sweep is sequential — add a worker-capped concurrent variant (e.g. 8 at a time) behind a "Test all" action; reuse the existing checker.
4. **Macro visual recorder:** capture clicks / input / navigation inside a launched profile (via the existing Puppeteer/CDP session) and serialize into the **existing** `Macro.stepsJson` shape. Add `automation:start-recording` / `stop-recording`. Do **not** create a parallel macro store.
5. **Macro scheduler:** cron-style timed runs reusing the proxy-sweep timer pattern (`setInterval` + `unref`, persisted in `Setting.macroSchedule`). New channels `automation:get-schedule` / `set-schedule`. On fire, run the macro and append to the existing automation history.

**Acceptance:** assigning a proxy auto-sets TZ/locale on an Auto profile; policy persists and is honored at launch; recorder produces replayable steps that the existing runner accepts; scheduler fires and logs to history. Build + checks green.

**Don't:** don't reimplement proxy rotation, geo lookup, macro storage, or history — they exist.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 2** only. Plan first, wait for approval.

---

# PHASE 3 — Parallel runner + live run console (+ relay framing)

**Goal:** run a macro across many profiles at once with a live, redacted status stream.

**Pre-flight:**
```bash
sed -n '1,40p' src/main/remoteRelay.js
grep -n "launchProfileSession\|closeProfileSession\|activeSessions\|sessionId" src/main/browserEngine.js | head
grep -oE "'automation:[a-z-]+'" src/main/ipcHandlers.js | sort -u
```

**Tasks:**
1. **Parallel runner:** run a selected macro across N chosen profiles with a concurrency cap (configurable). Track per-run state (queued/running/passed/failed) and append results to the existing automation history. Reuse `launchProfileSession`/`closeProfileSession`; never exceed the launch concurrency.
2. **Live run console (renderer):** a panel in `AutomationPage.jsx` showing per-profile progress in real time. Stream events from main via the **existing** `remoteRelay` framing (`{t,sessionId,ts,payload}`) — every frame must pass through `sanitizeFrame` (no cookies/creds in the stream). New channels `automation:run-parallel` and an event channel for progress (mirror the `warmer-progress` pattern already in the codebase).
3. **Data-driven runs:** optionally bind a spreadsheet (use the existing `xlsx` dep / `importParser.js` patterns) so each profile/run gets variables from one row.

**Acceptance:** launching a parallel run on 3+ profiles shows live per-profile status; concurrency cap respected; no secrets ever appear in the stream (assert via a test). Build + checks green.

**Don't:** don't build a new event bus — reuse the relay framing and the existing progress-channel pattern.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 3** only. Plan first, wait for approval.

---

# PHASE 4 — Team-at-scale: handoff, locking, seats, audit export

**Goal:** make multi-operator use safe and accountable.

**Pre-flight:**
```bash
grep -n "assignedMemberId\|ownerMemberId\|ActivityLog\|requirePermission" src/main/ipcHandlers.js | head
sed -n '1,40p' src/main/permissions.js
grep -n "model License" -A12 prisma/schema.prisma
```

**Tasks:**
1. **Profile lock-when-in-use:** when a profile is launched, mark it in-use (member + session); block a second concurrent launch by another member with a clear message; clear on close/crash (tie into the orphan-cleanup that already exists). Store transient lock in memory + a `Setting`/column as appropriate.
2. **Handoff / reassignment with audit:** reassign a profile's `assignedMemberId` and write an `ActivityLog` entry (actor, target, profile). Gate with `requirePermission`.
3. **Seat enforcement:** cap the number of active (non-suspended) members to the seats implied by the `License`; surface remaining seats in `BillingSettings.jsx`; block invites past the cap with an upgrade prompt.
4. **Audit log export:** CSV/JSON export of the activity feed (`team:activity` / `ActivityLog`), filterable by member/date/action. New channel `team:export-activity`.

**Acceptance:** two members can't launch the same profile at once; reassignment logs an audit row; invites blocked past seat cap; export produces a valid file. Build + checks green.

**Don't:** don't rebuild the members/RBAC/permissions engine or the activity feed — extend them.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 4** only. Plan first, wait for approval.

---

# PHASE 5 — Cloud sync transport `[needs backend]`

**Goal:** make the existing E2E sync foundation actually sync, offline-first.

**Pre-flight:**
```bash
cat src/main/cloudSync.js
grep -n "transport\|pushEnvelope\|pullEnvelope\|put\|get" src/main/cloudSync.js
```

**Tasks:**
1. Implement a concrete `transport` (`put(key,buffer)` / `get(key)`) for `CloudSyncEngine` against a simple object store (S3-compatible or a thin REST bucket). The client **must** encrypt with the existing scrypt+AES-GCM envelope **before** upload — keep zero-knowledge; the server only stores opaque ciphertext + envelope.
2. Conflict policy: last-write-wins per profile with a version/updatedAt guard; surface conflicts rather than silently clobbering.
3. **Sync status UI** (in `AccountSettingsPage.jsx` or Settings): enabled/disabled, last-synced, pending, errors. If no endpoint configured → explicit "Sync disabled" — **never fake success.**
4. New channels `sync:status` / `sync:configure` / `sync:run`. Endpoint creds via `secretStore`.

**Acceptance:** with a configured test bucket, two installs converge; the bucket contents are unreadable ciphertext; with no config the UI shows disabled and nothing pretends to sync. Build + checks green; a round-trip test passes.

**Don't:** don't change the crypto envelope (it's tested) — only add transport + conflict handling + UI. Mark the server side clearly as a separate service.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 5** only. Plan first, wait for approval.

---

# PHASE 6 — Full DB encryption at rest + workspace backup/restore

**Goal:** encrypt the whole SQLite file (today only field-level secrets are sealed) and allow full encrypted backups. **Highest blast radius — backup-first, behind a flag, reversible.**

**Pre-flight:**
```bash
sed -n '1,60p' src/main/database.js
grep -n "PrismaClient\|DATABASE_URL\|new PrismaClient" src/main/database.js
cat src/main/profileArchive.js
```

**Tasks:**
1. **DB encryption:** integrate SQLCipher via `better-sqlite3-multiple-ciphers` (add to deps), key derived from the vault password. Provide a **one-time, reversible** migration that copies the plaintext DB into an encrypted one with a verified integrity check, keeps a timestamped backup of the original, and only deletes it after success. Gate the whole thing behind a Settings toggle; default OFF until the user opts in.
2. **Workspace backup/restore:** extend the `.sgz` format in `profileArchive.js` to optionally include the DB + `Setting` rows (passphrase-based), with a restore path that verifies the GCM tag before overwriting anything.
3. Add explicit recovery guidance in the UI: if the vault password is lost and DB encryption is on, data is unrecoverable — make the user confirm they understand before enabling.

**Acceptance:** with encryption ON, the SQLite file is not readable by a plain reader; toggling OFF restores plaintext from backup; a corrupted/locked DB never bricks boot (graceful error + restore prompt). Backup→restore round-trips. Build + checks + tests green.

**Don't:** don't enable by default; don't delete the plaintext backup until the encrypted copy verifies.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 6** only. Plan first, wait for approval. Treat this as high-risk: backup-first, reversible, flagged.

---

# PHASE 7 — UX polish + mobile/Android profiles

**Goal:** faster operation at scale + a new mobile profile type.

**Pre-flight:**
```bash
grep -oE 'path="[^"]+"' src/renderer/App.jsx | sort -u
grep -n "os\|osVersion\|deviceName\|userAgent" prisma/schema.prisma | head
sed -n '1,40p' src/main/fingerprintGenerator.js
```

**Tasks:**
1. **Command palette + global search + keyboard shortcuts:** Ctrl/Cmd-K palette to jump to profiles/proxies/members/pages and run common actions. No new heavy deps — build on existing routing.
2. **First-run onboarding wizard:** account → SMTP (optional) → first proxy → first profile, reusing existing pages/components.
3. **Mobile/Android device profiles:** a new profile "device class" that emits mobile UA + touch + device-metrics + appropriate screen/DPR, coherent with `fingerprintGenerator.js`. (The `public/logos` already include android/ios.) Make sure the trust/coherence checks treat mobile UA + desktop GPU as inconsistent.

**Acceptance:** palette navigates + runs actions; wizard completes a fresh setup; a mobile profile launches and presents a coherent mobile fingerprint (verify on a fingerprint test page). Build + checks green.

**Don't:** don't add a UI framework; extend the existing one.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 7** only. Plan first, wait for approval.

---

# PHASE 8 — Checkout at registration + Trial→Grace→Ban lifecycle + Super-Admin controls

**Goal:** put plan/trial/buy choices on the register page, enforce a 7-day trial → 3-day grace → auto-ban, and give the Super Admin block/unblock/delete + license controls. **Extend** the existing license/payments — do not rebuild them.

**Pre-flight (report EXISTS / PARTIAL / MISSING):**
```bash
grep -n "TRIAL_DAYS\|trialEndsAt\|WARNS but does not block\|isExpired\|daysLeft" src/main/ipcHandlers.js
grep -oE "'(license|payment|monetization):[a-z-]+'" src/main/ipcHandlers.js | sort -u
grep -n "generatePurchaseCode\|verifyPurchaseCode\|checkout-start\|checkout-poll" src/main/payments.js src/main/ipcHandlers.js
sed -n '1,80p' src/renderer/components/Gate.jsx
grep -n "SUPER_ADMIN\|status\|suspend\|MEMBER_DELETE\|member:update" src/main/ipcHandlers.js | head -25
```
Expected: 7-day trial **EXISTS**; expiry **PARTIAL** (warn-only, no grace/ban); Cryptomus checkout + `license:redeem` **EXIST** (reuse); register-page plan selection **MISSING**; super-admin block/unblock **PARTIAL** (suspend + delete exist, no lifecycle ban).

**Tasks:**
1. **Lifecycle in main** (~`ipcHandlers.js:3910+`): add `GRACE_DAYS = 3` beside `TRIAL_DAYS = 7`. Make `license:get` return a state machine: `paid` (type paid, active); `trialing` (`now ≤ trialEndsAt`, returns `daysLeftTrial`); `grace` (`trialEndsAt < now ≤ trialEndsAt + GRACE_DAYS`, returns `daysLeftGrace`/`graceEndsAt`, app works but nags); `banned` (`now > trialEndsAt + GRACE_DAYS` and not paid). Return `{ state, isPaid, isTrial, isBanned, daysLeftTrial, daysLeftGrace, graceEndsAt, endsAt }`. Keep **Super Admin exempt** (id -1). On first transition to `banned`, set the OWNER `Member.status='banned'` (extend status to `active|suspended|banned`) + a `banReason`; idempotent and reversible.
2. **Enforcement at the gate** (`Gate.jsx`, after unlock, call `license:get`): `banned` → render a **blocking screen** (not the app): explanation + "Enter purchase code" (`license:redeem`) + "Pay now" (`payment:checkout-start`) + "Contact admin", no profile access. `grace` → allow the app but show a persistent banner/modal with pay CTA + grace countdown. `trialing` → show days-left unobtrusively. Also enforce in **main**: refuse profile launch when `banned` (never trust the renderer alone).
3. **Register-page plan selection** (`Gate.jsx` register flow): add a plan step at/after account creation — **Start 7-day free trial** (default, no payment, creates trial as today) / **I have a purchase code** (`license:redeem`) / **Buy now** (`payment:checkout-start` → `payment:checkout-poll` → mark paid). Record the chosen plan/version (Pro vs Enterprise) on the license/tier so gating can read it; reuse `MonetizationSettings` links where relevant.
4. **Payment/redeem → grant** (reuse existing): on success set license `type='paid'`, `status='active'`, clear the ban, restore owner `Member.status='active'`. One shared `grantPaid()` helper used by both redeem and checkout-poll.
5. **Super-Admin controls** (UI in `MembersPage.jsx`; enforced in main, gated to SUPER_ADMIN/OWNER): **block/unblock** a member → `member:set-status` (or extend `member:update`) to `banned`/`active`; **delete** → existing `member:delete` with a confirm; **view license state** per owner-tree and **grant/extend/reset** → `license:grant`, `license:extend`, `license:reset`. All main-side, never UI-trusted.
6. **Best-effort clock-tamper guard** (local): persist a monotonic `lastSeenAt` in `Setting`; if the system clock jumps materially backward, don't silently re-extend the trial — flag/clamp. (Not tamper-proof — see caveat.)

**Acceptance:** register page offers trial/buy/redeem (trial→7-day license, buy/redeem→paid); `trialEndsAt` in the past by ≤3 days → app works with pay prompt, by >3 days → blocked screen + owner `banned` + launch refused in main; paying/redeeming clears the ban; Super Admin can block/unblock/delete a member and grant/extend/reset a license (all main-enforced); new unit test for the state machine; `npx vite build` + `node --check` + `node --test` green.

**Don't:** don't rebuild Cryptomus checkout, `license:redeem`, or trial creation — extend them; don't enforce only in the renderer; don't add a payment SDK (the `payments.js` node:https pattern stays).

**Honest caveat (must stay true):** local-first trial/ban enforcement is **bypassable** (editing the SQLite file or the system clock). It's the UX + best-effort gate, not unbreakable DRM — real protection needs the licensing **backend** from Phase 5 (signed, server-time-validated licenses). A Super Admin can only manage **this install's** member tree; cross-install user management also needs that backend.

**Start command:**
> Read `SOFTGLAZE_BUILD_PLAN.md`, apply GLOBAL RULES, do **PHASE 8** only. Run the pre-flight, show me the plan, wait for approval.

---

## TIER MAPPING (for the new work)

| Capability | Pro | Enterprise |
|---|---|---|
| Geo auto-match, rotation policy (P2) | ✅ | ✅ |
| Macro recorder + scheduler (P2) | ✅ | ✅ |
| Parallel runner + live console (P3) | Limited | ✅ |
| Data-driven runs (P3) | ✅ | ✅ |
| Profile lock / handoff / seats / audit export (P4) | ➖ | ✅ |
| Cloud sync transport (P5) `[backend]` | ➖ | ✅ |
| Full DB encryption (P6) | ➖ | ✅ |
| Workspace backup/restore (P6) | ✅ | ✅ |
| Mobile profiles, command palette (P7) | ✅ | ✅ |
| Checkout + trial/grace/ban + super-admin (P8) | ✅ | ✅ |

Phases 0 and 1 are internal (not tiered) — do them first.

---

## HONEST CAVEATS (keep these true)
- `[needs backend]` items (cloud-sync transport, shadowing transport, online license activation) can't be enforced or shared from the client alone — keep them offline-first, client-holds-keys, never fake success.
- Phase 6 (full DB encryption) can permanently lock users out — reversible migration, backup-first, explicit user confirmation, flagged OFF by default.
- This is a dual-use product category. Keep the warmer / automation / spoofing aimed at legitimate multi-account, QA, ad-verification, and privacy use — don't build features whose primary purpose is fraud or ToS-evasion you couldn't defend.
