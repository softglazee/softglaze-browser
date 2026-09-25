# Proxies.sx provider integration

This candidate adds Proxies.sx to the existing provider panel and importer. It does not purchase bandwidth, create ports, rotate a modem, grant a trial, or claim a successful connection after importing configuration.

## Pool Gateway

Open **Proxy Providers → Proxies.sx → Pool Gateway routes**. Copy the base proxy username and separate proxy password from [Pool Gateway in the customer dashboard](https://client.proxies.sx). A management API key is not the proxy password.

Choose HTTP (`gw.proxies.sx:7000`) or SOCKS5 (`gw.proxies.sx:7001`), Peer network or Carrier modems, country, route count and routing mode. Country selection requests available capacity; it does not prove country coverage. Peer network includes both residential and mobile devices. Carrier modems use the separate `mbl` pool.

Each generated route has an independent session ID saved on the existing proxy record. Assign a separate route to each browser profile. A blank session prefix creates a random prefix; reusing the same explicit prefix and settings skips existing records. An imported profile keeps its saved username across application restart. Re-import does not overwrite existing proxy passwords: update an existing row deliberately after changing credentials.

Sticky routing holds the selected endpoint while available, with strict failover configured to refuse a replacement endpoint. A carrier may still change that endpoint's public IP. Timer modes request reselection after 5, 10, 20 or 60 minutes on a subsequent connection; they do not interrupt an already established connection. The on-new-connection mode is `rot-ondemand`. Neither separate sessions nor a rotation request guarantees previously unseen or distinct public IPs.

## Owned dedicated ports

Select **Import owned dedicated ports** and supply your own customer API key with `account:read` and `ports:read` scopes. No staff/admin key is needed. Requests are pinned to `https://api.proxies.sx/v1`:

1. `GET /account/proxy-password` establishes the current account's canonical proxy username. The returned gateway password is discarded; it is not used as a dedicated-port password.
2. `GET /ports` lists that account's resources. The importer checks every record's `customerId` against the authenticated account ID and rejects unverified ownership before creating local records.
3. Only active, non-expired ports are mapped from `serverIp`, `httpPort`/`socksPort`, `proxyLogin`, and `proxyPassword`. Suspended, expired, deleted and grace-period ports are excluded. An empty list or malformed active port is an error, not a simulated success.

This path intentionally does not call `/account`: that route can generate deposit wallets. No management API key, rotation URL or account response is stored on an imported proxy. Dedicated modem rotation remains a separate action in the Proxies.sx dashboard; this importer does not add a rotation button or run rotations.

## Credentials and verification

The provider panel reuses the existing permission-gated provider credential store. Passwords and API keys use the existing OS `safeStorage` encryption. Imported proxy records use the existing Proxy table, which requires workspace database encryption for protection at rest. Nothing here creates a parallel store. API errors never echo a response body or credential into the UI.

Importing a gateway route performs no network request. Importing dedicated ports performs only the two reads above. Use the existing pool health check and browser profile launch to test connectivity. Import does not mark a requested country as observed geography or mark an endpoint healthy.

## Validation and live acceptance

Development base: SoftGlaze commit `57736209779b42364da6955d451fc589a59ddd45` (version 1.0.7).

```sh
npm ci --ignore-scripts
node --test test/proxiesSx.test.js test/dataimpulse.test.js test/liveProxies.test.js test/iproyal.test.js test/rotateIp.test.js test/proxyVendorUtils.test.js test/proxySeller.test.js test/newProxyConnectors.test.js test/vendorGateways.test.js test/ipcParity.test.js
npm run build:frontend
```

The tests execute the actual adapter, IPC import/deduplication path, serializer and credential handlers with fixtures at HTTPS, Prisma, permissions and OS encryption boundaries. They cover invalid authentication/scopes, rate limits, invalid/mixed-owner port data, expired resources, secret-safe errors, missing OS encryption, multiple sessions and credential separation. They do not authenticate to a live Proxies.sx account.

Before announcing native support, run these checks in a licensed SoftGlaze application with customer-entered credentials and an approved bandwidth balance:

- Read-only authentication and active owned-port import; test the empty and invalid-key paths too.
- A real HTTP browser profile, then SOCKS5, against an agreed harmless HTTPS page; compare observed country with the selected target.
- Two profiles concurrently, distinct saved sessions, stop/restart and persisted assignments.
- Sticky behavior over a browsing session, timer behavior over the actual interval, and on-new-connection routing, recording observations without promising unique/fixed IPs.
- Health/blocklist checks using the application's existing facilities; explicit cancellation, invalid proxy authentication and no direct-connection fallback.
- Actual usage delta and exact desktop build. Keep credentials and exit IPs out of shared reports.

Only the working connector accepted by the partner completes the integration milestone. A catalog entry, passing fixtures or a trial is not a paid customer or completed live integration.
