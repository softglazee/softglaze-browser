# SoftGlaze phone companion (desktop side)

The PC side of the SoftGlaze phone app: pairing by QR, an end to end encrypted relay client,
answering AI (MCP) approvals on the phone, live profile state on the phone, phone commands, and
profile sync between the PC and phones. The protocol, the relay and the phone app live in the
SoftGlaze-Mobile repository (`docs/PROTOCOL.md`, `docs/RELAY.md`, `docs/features/PROFILE-SYNC.md`).

Off by default. The Owner turns it on in **Settings > Phones**.

## Architecture

```
 Settings > Phones (PhonesSettings.jsx)      AI engine (ai/index.js onApprovalEvent)
          | mobile:* IPC (mobile/ipc.js)              | ai:approval-requested
          v                                           v
 mobile/index.js  ---- service: settings, identity, start/stop, hooks from ipcHandlers
   |-- companion.js   pairing offers, Noise sessions, sealed envelopes, revoke
   |     |-- relayClient.js   WebSocket to the relay (auth, send/ack, got, reconnect)
   |     |-- bridge.js        hello, state.snapshot/patch, commands, approvals, ActivityLog
   |     `-- devices.js       PairedDevice rows (Prisma)
   `-- sync/service.js        SyncSpaceOwner + SyncEngine (relay blob store), lease
         `-- sync/local.js    SyncLocal over desktop profiles (+ mapping.js)
 protocol.js -> vendor/softglaze-protocol.cjs   @softglaze/protocol, vendored (no crypto here)
 qr.js       -> vendor/qrcode-generator.js       QR as SVG (MIT, 2.0.4)
```

### Protocol package

`src/main/mobile/vendor/softglaze-protocol.cjs` is `@softglaze/protocol` (0.1.0) with its pinned
dependencies (@noble/ciphers, @noble/curves, @noble/hashes 2.4.0, valibot 1.5.0) bundled into one
CommonJS file by rolldown, so Electron main uses plain `require()` and no new runtime dependency.
`VENDOR.json` records the source commit and the sha256 (a unit test checks it). To update:

```
node scripts/vendor-softglaze-protocol.mjs --src D:/SoftGlaze-Mobile/packages/protocol --build
```

(`--build` runs `npm ci && npm run build` there first; without it the script refuses a stale `dist/`.)

### Identity and storage

| What | Where |
|---|---|
| PC X25519 + Ed25519 keys | Setting `mobileIdentity`, sealed with safeStorage (`secretStore.seal`). Without OS encryption nothing is created. |
| Settings (on/off, PC name, relay, synced profiles) | Setting `mobileCompanion` |
| Paired phones | `PairedDevice` table (migration `20261119000000_paired_devices`): pinned public keys, member, scopes |
| Sync key ring | Setting `mobileSyncKeyring`, sealed |
| Sync engine state | Setting `mobileSyncState` |
| Phone-only profile data (tabs, bookmarks, history, phone settings, proxy as edited on a phone) | Settings `mobileSync.side.<id>`, sealed |
| Cookie jar snapshot before a replace | Setting `mobileSync.jar.<id>`, sealed |

### Pairing

1. **Pair a phone** opens a 5 minute, single use offer (`PairingOffer.create`) and shows the
   `sgpair:1:` QR plus the text. The relay gets `pair_open(ticket)`.
2. The phone's PairInit arrives; `respond()` answers and both sides show the same 6 digits.
3. Nothing is stored until the user presses **Codes match, pair** and picks the member and the
   scopes. Then the PairedDevice row is written, the PC sends `link`, and once the link is active on
   both sides the phone gets `hello {deviceId, scopes}` and the state snapshot.
4. **Codes do not match** throws the session away.

Who a phone may act as: the Owner picks anyone; an Admin picks themselves or members they manage,
never the Owner (the AI token rule). In single-user mode the phone acts as the owner; a phone paired
then acts as the first Owner once members exist.

### Sessions and envelopes

- After every reconnect the phone opens a Noise IK session; `acceptSession` only takes a pinned,
  not revoked key. One `SeenCache` covers every session and sealed message (replays are dropped).
- State (`state.snapshot`, `state.patch`) only goes over a live session. Large workspaces are paged:
  one snapshot plus patches that each fit the 32 KiB plaintext limit.
- Approvals go sealed with `push: 'approval'` (the relay pushes the opaque blob when the phone is
  offline). Results go over the session, or sealed when the phone went away.
- The relay client answers the challenge, acks every routed `msg` with `got`, reconnects with
  jittered back-off (slow after 4001 auth failed / 4003 revoked), pings every 25 s, says `bye sleep`
  on suspend (no "PC offline" push) and reconnects on resume.

### Commands and checks

For every phone message: protocol scope (`checkScope`) -> the phone's member is active -> the
handler runs inside `aiActor.run({ memberId, via: 'mobile' })`, so `requirePermission`,
`assertCanAccessProfile` (ProfileAccess) and the plan checks are the app's own -> exactly one
ActivityLog row (`mobile.<command>`, detail `{source: 'mobile', deviceId, code}`) -> one `result`.

| Command | Scope | What happens |
|---|---|---|
| `state.request` | view | snapshot |
| `profile.start/stop/restart` | control_profiles | `launchProfile` / close session, per profile result |
| `approval.answer` | approve_ai | `canAnswerApproval(member, approval)`, then `respond(id, 'allow-once' / 'allow-hour' / 'deny')` |
| `team.*`, `totp.request`, `lease` | as per protocol | answered `unsupported` (not built yet) |

### Profile sync

Same role as `tools/sync-peer/peer.mjs`. Opt in per profile in Settings > Phones (Owner).
Space members are the phones with the `phone_profiles_linked` scope; removing a phone (revoke or
scope) rotates the key and re-seals every blob before the relay unlink.

- Applied to the desktop profile: title, notes, tags, start pages, folder (an existing group with
  that name), region (time zone, language, location, WebRTC).
- Kept for phones only: proxy as edited on a phone (never applied to the desktop proxy), the
  phone settings (`mobile`, `desktopSite`), tabs, bookmarks and history sent by phones.
- Not read from the desktop browser yet: its own tabs, bookmarks and history.
- Cookies: the whole Chromium jar via CDP (running) or a headless open of the stopped profile;
  replaced as a whole (`Network.clearBrowserCookies` then `setCookies`) after a sealed snapshot.
  Firefox profiles: no cookie sync.
- Lease: `launchProfileNow` calls `mobile.beforeLaunch` (IN_USE error while a phone holds it,
  `takeoverFromPhone: true` takes it over), renew every 30 s while running, release (jar upload)
  after the browser closed, checkpoint on suspend. A lost lease closes the profile on the PC.
- Rounds: on start, every 60 s, after a profile closes.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Phone companion on | off | Owner only |
| Relay address | `wss://relay.softglaze.com/v1` | `wss://` only, `ws://` only for localhost. `SG_RELAY_URL` overrides it (tests); `SG_RELAY_HOST` overrides the signed host name |
| Name of this computer on phones | computer name | |

## Test locally

Needs the SoftGlaze-Mobile repository (default `D:/SoftGlaze-Mobile`, or set `SG_MOBILE_REPO`) with
`packages/protocol/dist` and `relay/dist` built and `relay/node_modules` installed:

```
cd D:/SoftGlaze-Mobile/packages/protocol && npm ci && npm run build
cd D:/SoftGlaze-Mobile/relay && npm ci && npm run build
```

Tests (plain `node --test`, part of `npm test`; the end to end ones skip without the relay):

```
node --test test/mobileCompanion.test.js        # unit: vendor, settings, identity, bridge rules, relay client, IPC rules, mapping, migration, strings
node --test test/mobileCompanion.e2e.test.js    # real relay: pairing + SAS, hello, snapshot, commands, approval round trip, replay, reconnect, revoke
node --test test/mobileSync.e2e.test.js         # real relay: sync both ways, lease + cookie jar, phone-made profile, revoke key rotation
node --test test/mobileService.e2e.test.js      # mobile/index.js as the app wires it
```

The phone used in the tests (`test/helpers/mobilePhone.js`) is built only from the protocol package.

By hand with the app:

```
cd D:/SoftGlaze-Mobile/relay
set RELAY_PORT=8787& set RELAY_PUBLIC_HOST=127.0.0.1& node dist/main.js
cd <this repo>
set SG_RELAY_URL=ws://127.0.0.1:8787/v1& set SG_USER_DATA_DIR=%TEMP%\sg-phones-test& npm run dev
```

Then Settings > Phones, turn it on, Pair a phone. Until the phone app has a real relay client,
pair with the test phone from a Node prompt (`TestPhone` in `test/helpers/mobilePhone.js`).

## Not built yet

- `tokenMemberId` / `tokenName` in `approval_request`: sent by the desktop, but dropped by the
  @softglaze/protocol 0.1.0 validator until the schema gets these optional fields.
- AccessGrant model, approval rules (quiet hours etc.), team requests, TOTP from the phone, live log,
  Send to PC, alerts to phones (crash / proxy dead), plan gating of the feature.
- The relay is not deployed and push keys are not configured, so nothing works outside a local relay.
