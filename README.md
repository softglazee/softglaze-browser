# SoftGlaze Browser

SoftGlaze Browser is a local-first Electron + React desktop app for managing
isolated browser profiles, reusable proxies, and spreadsheet-based profile
imports. Each profile runs in its own data directory with its own proxy and its
own browser fingerprint, so several accounts can be worked in parallel without
sharing cookies, storage, or device characteristics.

All data stays on the machine. There is no hosted backend and no profile
syncing to a remote server.

## Stack

- Electron main process
- React renderer via Vite
- Tailwind CSS v4 with Shadcn-style local UI primitives
- SQLite through Prisma ORM
- `puppeteer-extra` with the stealth plugin for launching profile windows
- `rebrowser-puppeteer-core` in `enableDisable` runtime-fix mode
- SheetJS `xlsx` for Excel/CSV parsing

## Features

**Profiles and isolation**

- Local browser profile management with per-profile data directories
- Per-profile fingerprint values for GPU, RAM, WebRTC and screen, applied as the
  single source of truth (the overlapping stealth-plugin evasions are disabled
  so the two layers cannot disagree)
- Coherence guard: the reported Chrome major version is kept consistent with the
  browser actually launched
- Optional use of a real installed Chrome binary instead of bundled Chromium
- Profile grouping, tagging, bulk operations, trash/restore

**Networking**

- Reusable proxy pool with health checking and background re-checks
- HTTP/3 (QUIC) disabled by default when a profile is proxied, so UDP cannot
  bypass the proxy
- Optional local-network-access blocking

**Import and workflow**

- Spreadsheet (`.xlsx` / `.xls` / `.csv`) batch import with preview-before-commit
- Profile import from other platforms via their APIs
- Managed browser extensions, with uBlock Origin (MV3) available per profile
- Team members with role-based access control
- Localized interface (English and Spanish)

## Intended use

Profile isolation of this kind is used for legitimate multi-account work such as
agency and client account management, ad-account separation, QA across device
profiles, and privacy-motivated browsing separation.

You are responsible for complying with the terms of service of any site you use
it with. Do not use it to evade a ban, misrepresent identity, commit fraud, or
break the rules of a platform you have agreed to.

## Requirements

- Node.js 20.19.0 or newer
- npm 10 or newer
- Windows, macOS, or Linux

## Install

```bash
cd softglaze-browser
npm install
```

`npm install` runs `prisma generate` automatically through the `postinstall` script.

## Development run

```bash
npm run dev
```

The app will:

1. Start the Vite renderer at `127.0.0.1:5173`.
2. Start Electron.
3. Create the SQLite database in Electron's user data directory.
4. Create the local profile root folder in Electron's user data directory.
5. Bootstrap missing tables/indexes automatically.

## Optional development migration

The runtime app can bootstrap the required SQLite schema automatically. For standard Prisma migration workflow, run:

```bash
cp .env.example .env
npm run prisma:migrate
```

## Build packaged app

```bash
npm run build
```

Build output is written to:

```txt
dist_installer/
```

## Local data locations

The app stores runtime data under Electron's `userData` path:

- SQLite DB: `softglaze.sqlite`
- Browser profile folders: `softglaze_profiles/`

You can view exact resolved paths in the app under:

```txt
Settings → Local Runtime
```

## Proxy formats

Single proxy fields:

```txt
host
port
username optional
password optional
```

Batch proxy input supports one proxy per line:

```txt
host:port:username:password
host:port
http://username:password@host:port
socks5://username:password@host:port
```

## Spreadsheet import

The batch importer supports `.xlsx`, `.xls`, and `.csv` files.

Expected behavior:

- Scans for the header row starting around row 4.
- Detects profile title/name columns.
- Maps proxy methods:
  - `Custom` or `2` → profile proxy
  - `System` or `1` → system proxy
  - `Direct`, `None`, or `0` → direct connection
- Supports combined proxy cells such as:

```txt
Proxy Host:Proxy Port:Proxy Account:Proxy Password
```

Import flow:

1. Open `Batch Import`.
2. Click `Open File Picker`.
3. Review parsed rows in the preview table.
4. Click `Commit Import` only after the preview is correct.

## Browser launch behavior

When launching a profile, Puppeteer opens Chromium with:

- Dedicated `userDataDir` per profile.
- Optional proxy server argument.
- Optional proxy authentication through `page.authenticate`.
- Standard window size of `1280x720`.

No manual user-agent override is applied.

## Security model

- Renderer has no direct Node.js access.
- `contextIsolation` is enabled.
- `nodeIntegration` is disabled.
- The preload exposes only narrow `window.softglaze` APIs.
- External navigation is blocked from replacing the app UI and is opened through the OS browser instead.
- Renderer permissions are denied by default.

## Important note about Chromium download

Installing Puppeteer downloads a compatible Chrome for Testing browser binary by default. This can be a large download. To use a system Chrome/Chromium instead, configure Puppeteer environment variables and pass an executable path in the backend before packaging.
