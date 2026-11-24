# Cloud sync, phase 1 (solo workspaces)

Spec: `D:\SoftGlaze-Browser-Cloud-Sync\00-SPEC.md` (option B, owner decisions of 20 Nov 2026). Server side:
`licensing-server/docs/CLOUD-SYNC-SERVER.md`. Crypto and engine: `@softglaze/protocol` 0.2.0, module `src/ws`
(SoftGlaze-Mobile repo), vendored here in `src/main/mobile/vendor/softglaze-protocol.cjs`.

**Status: beta. The external crypto review (spec decision 10) is still required before general release.**

## What it does

The Owner turns cloud sync on in Settings > Cloud sync. The PC uploads an end-to-end encrypted copy of
profiles (all synced fingerprint fields, notes, tags, group, proxy, trash), proxies (with passwords), proxy
groups, groups and templates. app.softglaze.com (and later the phone and other PCs) read and change that copy
with the PC off; the PC picks the changes up within 20 seconds of coming back.

Never synced (spec 2.5): `launchArgs`, `dataDirName`, extension paths (`advancedExt`), `advancedSync`,
`advancedBrowser`, 2FA seeds, saved account passwords (`platformAccounts`), cookies and browser data, usage
counters, team member assignments (phase 4). `startupUrls` keep http(s) only; `rotationUrl` https only;
template snapshots lose PC-only keys. Every device re-checks every field it receives (`sanitizeValues`), and
the PC re-checks again before writing to its database.

## Keys (spec 3)

| Key | Where it lives | Leaves the device? |
|---|---|---|
| Recovery Secret (24 BIP39 words) | on paper with the user | never (shown once; the user types back 2 words) |
| Member Key seed (MK) | PC: `softglaze-cloud-sync.bin` sealed with safeStorage; web: the IndexedDB vault | only wrapped: under the RS (recovery wrap on the server) or to one device's X25519 key during enrolment |
| Keyring (record name key, collection key "admin", proxy-password secrets key) | server, sealed under a key derived from the MK | ciphertext only |
| Device keys (Ed25519 + X25519, per install) | same as the MK | public keys in an MK-signed certificate |
| Per-record key (DEK) | wrapped inside each record | wrapped only |

The workspace id is derived from the MK's public key, so every device can check that the keys or wraps the
server hands it belong to the workspace it expects.

## Adding a browser

Settings > Cloud sync > Show a code. The PC shows a 128-bit one-time code (text + QR). The browser posts its
public keys with an HMAC made with that code; the PC accepts only requests that check with the code, the user
clicks Approve, and the PC answers with the MK wrapped to the browser's key, a signed device certificate and a
second HMAC. The server never sees the code, so it cannot inject a device or give the browser a fake
workspace. A browser can also unlock with the 24 words.

## Sync rules (spec 4, phase 1 form)

Records are state-based: one sealed record per entity, fields stamped `{wall clock, Lamport counter, device}`.
Each cycle pulls changes since a cursor, merges three-way per field (newest stamp wins, both-sides edits of
proxy/fingerprint fields are reported as conflicts), applies only the changed fields locally and uploads with
compare-and-swap on the record version (a lost race re-reads and merges again). Deletes are tombstones; trash
is the `deletedAt` field. A record the PC refuses (plan profile limit, profile running during a delete) is kept
everywhere and retried. Rejected or forged records are reported and re-read next cycle.

## Threat model (short)

| Threat | Outcome |
|---|---|
| Server database or backup stolen | Ciphertext, opaque ids, sizes, times, device names and public keys only |
| Hostile server edits, swaps or replays records | Detected: AEAD binds workspace, record id and version; device signatures; clients keep the highest version seen (rollback refused) |
| Hostile server adds a device or a writer | Refused: device certificates need the MK signature; the enrolment needs the one-time code |
| Hostile server hands a fake workspace/keyring | Refused: workspace id derived from the MK; keyring version checked |
| Stolen account session (no device keys) | Can read ciphertext and delete the workspace with an MK-signed proof only; cannot write records (writes are device-signed) |
| Removed browser | Its writes are refused at once; it keeps what it already downloaded (phase 1 has no key rotation) |
| Compromised web app code (XSS, bad deploy) | Can read the keys of a user who opens it: the inherent web E2E limit (strict CSP, no third-party scripts) |
| Remote edit tries to run code on the PC | Blocked by the field allowlists above |
| Lost every device and the kit | Data cannot be recovered (true E2E, decision 2) |

Not yet covered (later phases): per-device signed op logs with hash chains and checkpoints (a server that
withholds a newer version is not detected, only rollbacks are), key rotation on device removal, clock-skew
clamping, team collections and roles, server push of "changed" hints (the PC polls every 20 s).

## Turning it on for testing

Server: `CLOUD_SYNC=beta` plus `CLOUD_SYNC_BETA_EMAILS=you@example.com` (see the server doc). The Settings
section stays hidden until the server reports cloud sync enabled for the signed-in account. `SG_CLOUD_SYNC=0`
switches it off on one PC.
