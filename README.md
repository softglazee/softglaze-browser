# SoftGlaze Browser

SoftGlaze Browser is a local-first Electron + React desktop app for managing local browser profiles, reusable proxies, and spreadsheet-based profile imports.

This package intentionally does **not** include stealth plugins, fingerprint spoofing, driver-masking, or anti-detect evasion code. It provides legitimate local profile isolation, proxy routing, and profile management.

## Stack

- Electron main process
- React renderer via Vite
- Tailwind CSS v4 with Shadcn-style local UI primitives
- SQLite through Prisma ORM
- Puppeteer for launching local profile windows
- SheetJS `xlsx` for Excel/CSV parsing

## Features

- Local browser profile management with per-profile data directories
- Reusable proxy pool with health checking and background re-checks
- Spreadsheet (`.xlsx` / `.xls` / `.csv`) batch import with preview-before-commit
- Profile grouping, tagging, bulk operations, trash/restore
- Team members with role-based access control
- Localized interface (English and Spanish)

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
