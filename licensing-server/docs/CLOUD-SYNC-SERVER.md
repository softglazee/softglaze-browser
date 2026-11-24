# Cloud sync phase 1: server side (`/v1/sync/*`)

End-to-end encrypted workspace store for the web app, the desktop app and (later) the phone app. The server keeps
ciphertext, public keys and signatures only. It cannot read a workspace, and it cannot add a device: device
certificates must be signed by the workspace's Member Key (its public half is `ownerSignPub`, and the workspace id is
derived from it). The client contract is `@softglaze/protocol` `src/ws/api.ts`; the code is `src/routes/sync.js`
(HTTP), `src/sync/store.js` (logic and checks) and `src/sync/wsCrypto.js` (signature formats, checked against the
protocol's shared vectors in `test/fixtures/ws-v1.json`).

Note: the spec (00-SPEC section 4.9) proposed the relay as the store. Phase 1 uses this server's MariaDB instead,
so the relay (being hardened separately) is not touched. Records are small (1 to 4 KB padded); move to the relay
or object storage at the spec's section 7.4 triggers.

## Routes

All take `Authorization: Bearer <token>` (desktop session, phone token or web access token). CORS: `WEB_APP_ORIGINS`.
JSON bodies up to 8 MB (this router is mounted before the global 256 KB parser). `Cache-Control: no-store`.

| Route | What | Checks |
|---|---|---|
| `GET /workspace` | `{ enabled, plan: { allowed, tier, quotaBytes, readOnly }, workspace \| null }` | |
| `POST /workspace` | create (first device) | id = workspaceIdOf(ownerSignPub); MK signature of `create`; time within 10 min; device cert signed by the MK; one per account |
| `DELETE /workspace` | delete everything | MK signature of `delete`, fresh |
| `PUT /workspace/keyring` | new keyring blob | signed by an active device; version = current + 1 (409 `{ version }`) |
| `PUT /workspace/recovery` | new recovery wrap | MK signature of `recovery` over SHA-256 of the wrap, fresh |
| `GET /devices` | `{ devices: [{ tag, cert, certSig, revokedAt }] }` | |
| `POST /devices` | add a device | cert signed by the MK; a known tag is 409 `exists` / `revoked` |
| `POST /devices/:tag/revoke` | revoke | MK-signed revocation for that tag |
| `POST /enrol` | a new device asks to join | shapes; 10 minutes; at most 5 waiting (429 `too_many`) |
| `GET /enrol` | waiting requests | |
| `GET /enrol/:id` | `{ status: pending \| approved \| denied \| expired, approval? }` | |
| `POST /enrol/:id/approve` | answer: device wrap + cert + MAC | cert signed by the MK and for the request's keys; registers the device |
| `POST /enrol/:id/deny` | | |
| `GET /records?since=&limit=` | changes after a sequence number (limit 1 to 1000, default 500) | |
| `GET /records/:rid` | one record | |
| `POST /records` | `{ writes: [...] }` (1 to 500) -> `{ results }` | per write: signed by an active device, body at most 512 KB, quota, version = current + 1 (else `conflict` with the held version) |

Each accepted write raises the workspace sequence inside a transaction (the UPDATE locks the workspace row, so writes
to one workspace are serialised and a deploy with two processes cannot let two writes of the same version through).

## Switches (`config/.env`, read live)

| Variable | Default | Meaning |
|---|---|---|
| `CLOUD_SYNC` | `off` | `off`: every route 404 `cloud_sync_off` (GET /workspace says `enabled: false`). `beta`: only `CLOUD_SYNC_BETA_EMAILS`. `on`: everyone on a paid plan or trial |
| `CLOUD_SYNC_BETA_EMAILS` | empty | comma list of account emails |
| `CLOUD_SYNC_QUOTA_PRO_MB` | 100 | Pro and trial |
| `CLOUD_SYNC_QUOTA_ENTERPRISE_MB` | 1024 | Enterprise |
| `CLOUD_SYNC_RATE_PER_MIN` | 600 | per client IP |

Plans: Pro, Enterprise and trial write. Free (never sold sync, or a plan that lapsed) is read-only: GET and DELETE
work, writes answer 403 `plan_required`. Account erasure (`src/customers/erase.js`) deletes the workspace.

## Migration `20261125120000_cloud_sync_p1` (by hand)

Four new tables (`SyncWorkspace`, `SyncDevice`, `SyncRecord`, `SyncEnrolment`), nothing else; `CREATE TABLE IF NOT
EXISTS`, so it can run twice. Prisma's schema engine hangs on Hostinger, so apply it with the mysql CLI and record it:

```sh
# 1. Backup first
mysqldump --single-transaction -u "$DB_USER" -p "$DB_NAME" > ~/backups/sg-licensing-$(date -u +%Y%m%dT%H%M%SZ).sql
# 2. Apply
mysql -u "$DB_USER" -p "$DB_NAME" < prisma/migrations/20261125120000_cloud_sync_p1/migration.sql
# 3. Record it (checksum = SHA-256 hex of the migration.sql bytes exactly as deployed)
SUM=$(sha256sum prisma/migrations/20261125120000_cloud_sync_p1/migration.sql | cut -d' ' -f1)
mysql -u "$DB_USER" -p "$DB_NAME" -e "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (UUID(), '$SUM', NOW(3), '20261125120000_cloud_sync_p1', NULL, NULL, NOW(3), 1);"
# 4. Check
mysql -u "$DB_USER" -p "$DB_NAME" -e "SHOW TABLES LIKE 'Sync%'; SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 3;"
```

Rollback: redeploy the previous build (the tables are then unused). To remove them after a backup:
`DROP TABLE SyncEnrolment, SyncRecord, SyncDevice, SyncWorkspace;` and
`DELETE FROM _prisma_migrations WHERE migration_name = '20261125120000_cloud_sync_p1';`.

## Deploy order

1. Migration (above). Harmless for the running build.
2. Deploy this server build with `CLOUD_SYNC` unset (= off). Check `GET /v1/sync/workspace` answers `enabled: false`.
3. Turn on `CLOUD_SYNC=beta` with the owner's account in `CLOUD_SYNC_BETA_EMAILS`, then ship the desktop build and
   the web app that use it. `on` only after the external crypto review (spec decision 10).
