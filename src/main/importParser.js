'use strict';

const path = require('node:path');
const XLSX = require('xlsx');
const { parseDoNotTrack } = require('./doNotTrack');

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeHeader(value) {
  return cellText(value).toLowerCase().replace(/\s+/g, ' ').replace(/[_-]+/g, ' ').trim();
}

const HEADER_ALIASES = Object.freeze({
  title: ['profile title', 'profile name', 'name', 'title', 'browser profile', 'account name'],
  group: ['group name', 'group', 'group management', 'folder', 'category'],
  notes: ['profile notes', 'notes', 'remark', 'remarks', 'description'],
  dataDirName: ['data dir name', 'data directory', 'profile directory', 'folder path', 'user data dir'],

  os: ['operating system', 'os', 'platform', 'target os'],
  browserCore: ['browser core', 'browser engine', 'core', 'browser type', 'browser kernel'],
  browserBrand: ['browser brand', 'brand', 'browser identity', 'identity', 'browser flavor'],
  userAgent: ['user-agent', 'ua', 'ua(user agent)', 'user agent', 'useragent', 'ua user agent'],
  resolution: ['screen resolution', 'resolution', 'screen size'],

  proxyMethod: ['proxy method', 'proxy mode', 'proxy way'],
  proxyType: ['proxy protocol', 'protocol', 'proxy type'],
  proxyId: ['proxy id', 'saved proxy id', 'proxy reference'],
  proxyCombined: [
    'proxy info', 'proxy information', 'proxy', 'proxy string',
    'proxy host:proxy port:proxy account:proxy password',
    'proxy host proxy port proxy account proxy password'
  ],
  proxyHost: ['proxy host', 'host', 'ip', 'proxy ip'],
  proxyPort: ['proxy port', 'port'],
  proxyUsername: ['proxy account', 'proxy username', 'proxy user'],
  proxyPassword: ['proxy password', 'proxy pass'],
  proxyRotationUrl: ['proxy rotation url', 'rotation url', 'refresh url', 'change ip url'],

  webrtc: ['webrtc', 'webrtc mode', 'web rtc'],
  canvas: ['canvas', 'canvas mode', 'canvas spoofing'],
  webgl: ['webgl', 'webgl mode', 'webgl behavior'],
  webglVendor: ['webgl vendor', 'unmasked vendor'],
  webglRenderer: ['webgl renderer', 'unmasked renderer'],
  audio: ['audiocontext', 'audio context', 'audio'],
  cpuCores: ['cpu cores', 'cpu', 'cores', 'hardware concurrency'],
  ram: ['device memory', 'memory', 'ram', 'ram gb'],
  dnt: ['do not track', 'dnt'],

  timezoneMode: ['timezone mode', 'tz mode'],
  timezoneVal: ['custom timezone', 'timezone', 'time zone', 'tz'],
  localeMode: ['locale mode', 'language mode'],
  localeVal: ['custom locale', 'languages', 'locale', 'accept language', 'accept languages'],
  geoMode: ['geolocation mode', 'geolocation', 'geo mode'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],

  // Platform account credentials, not proxy creds
  accountUsername: ['account username', 'username', 'user name', 'login'],
  accountPassword: ['account password', 'login password', 'password', 'pass'],
  twoFa: ['2fa key', '2fa', 'two factor', 'otp secret', 'totp', '2fa secret', 'authenticator'],
  cookie: ['cookie', 'cookies'],
  openUrl: ['open the specified url', 'open url', 'startup url', 'startup urls', 'specified url', 'urls'],

  enableSystemProxy: ['enable system proxy', 'system proxy'],
  tagManagement: ['tag management', 'tag', 'tags'],
  systemProxyBehavior: ['system proxy behavior', 'proxy behavior'],
  country: ['country', 'country/region', 'region', 'geo', 'location', 'proxy country', 'target country']
});

// Phrases that mark a template's instruction rows. Bare words like "example" would drop real
// profiles ("Example Corp"), and detection only runs above the first data row (parseWorkbookFile).
const INSTRUCTION_PHRASES = [
  'please enter', 'please refer', 'please fill', 'please note', 'open the browser',
  'fill in the', 'the data is entered', 'for example', 'e.g.', 'it is required',
  'do not need to', 'do not fill', 'enter the correct', 'multiple urls',
  'country code', 'use system proxy', 'type:noproxy', 'refer to the',
  'this is an example', 'ua information'
];

function looksLikeInstructionRow(row, titleIndex) {
  const title = getCell(row, titleIndex);
  if (!title) return true; // blank title = spacer/note row
  const t = title.toLowerCase();
  return INSTRUCTION_PHRASES.some((p) => t.includes(p));
}

function findColumnIndex(headers, aliases) {
  const normalizedHeaders = headers.map(normalizeHeader);

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const exactIndex = normalizedHeaders.findIndex((header) => header === normalizedAlias);
    if (exactIndex >= 0) return exactIndex;
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const fuzzyIndex = normalizedHeaders.findIndex((header) => header && (header.includes(normalizedAlias) || normalizedAlias.includes(header)));
    if (fuzzyIndex >= 0) return fuzzyIndex;
  }

  return -1;
}

function detectHeaderRowIndex(rows) {
  const maxScan = Math.min(rows.length, 30);

  // Scan from the first row: some templates put headers on row 1, instructions below, data from row 4.
  let best = -1, bestScore = 0;
  for (let index = 0; index < maxScan; index += 1) {
    const row = rows[index] || [];
    const normalized = row.map(normalizeHeader).filter(Boolean);
    if (normalized.length === 0) continue;

    let score = 0;
    if (findColumnIndex(row, HEADER_ALIASES.title) >= 0) score += 2; // title is the anchor
    if (findColumnIndex(row, HEADER_ALIASES.proxyMethod) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.proxyCombined) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.proxyType) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.country) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.userAgent) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.notes) >= 0) score += 1;

    if (score > bestScore) { bestScore = score; best = index; }
  }

  // Require at least the title column to be confident.
  return best >= 0 && bestScore >= 2 ? best : 0;
}

function getCell(row, index) {
  if (index < 0) return '';
  return cellText(row[index]);
}

function parseProxyMethod(value) {
  const text = normalizeHeader(value);
  if (!text) return 'NONE';
  if (text === '2' || text.includes('custom')) return 'CUSTOM';
  if (text === '1' || text.includes('system')) return 'SYSTEM';
  if (text === '0' || text.includes('none') || text.includes('no proxy') || text.includes('direct')) return 'DIRECT';
  return 'CUSTOM';
}

function normalizeProxyType(value) {
  const t = normalizeHeader(value);
  if (!t) return null;
  if (t.includes('socks5') || t === 'socks') return 'SOCKS5';
  if (t.includes('socks4')) return 'SOCKS4';
  if (t.includes('https')) return 'HTTPS';
  if (t.includes('http')) return 'HTTP';
  return null;
}

function normalizeOs(value) {
  const t = normalizeHeader(value);
  if (!t) return null;
  if (t.includes('mac') || t.includes('osx') || t.includes('os x')) return 'macOS';
  if (t.includes('linux') || t.includes('ubuntu') || t.includes('debian')) return 'Linux';
  if (t.includes('android')) return 'Android';
  if (t.includes('ios') || t.includes('iphone') || t.includes('ipad')) return 'iOS';
  if (t.includes('win')) return 'Windows';
  return null;
}

// Engine identifiers stored in Profile.browserCore.
const BROWSER_CORE = Object.freeze({ CHROMIUM: 'Chromium', FIREFOX: 'Firefox' });

// Legacy engine names from other tools' sheets and older exports/sync payloads. Accepted on input
// only, never stored, exported or shown; this file is the only place they appear.
const LEGACY_FIREFOX_CORE_NAMES = Object.freeze(['flowerbrowser', 'flower']);
const LEGACY_CHROMIUM_CORE_NAMES = Object.freeze(['sunbrowser', 'sun']);

// Map any engine name to its canonical identifier, or null when unrecognised.
function normalizeBrowserCore(value) {
  const t = normalizeHeader(value);
  if (!t) return null;
  if (t.includes('fire') || t.includes('gecko') || LEGACY_FIREFOX_CORE_NAMES.some((n) => t.includes(n))) return BROWSER_CORE.FIREFOX;
  if (t.includes('chrom') || t.includes('blink') || LEGACY_CHROMIUM_CORE_NAMES.some((n) => t.includes(n))) return BROWSER_CORE.CHROMIUM;
  return null;
}

// Anything unrecognised is stored as Chromium, since the launcher routes every non-Firefox profile
// there. undefined/null/'' pass through so "not provided" keeps its meaning on partial updates.
function toStoredBrowserCore(value) {
  if (value === undefined || value === null || value === '') return value;
  return normalizeBrowserCore(value) || BROWSER_CORE.CHROMIUM;
}

// Chromium-family identity (Chrome | Edge | Brave | Opera | Vivaldi | Yandex).
function normalizeBrowserBrand(value) {
  const t = normalizeHeader(value);
  if (!t) return null;
  if (t.includes('edge') || t.includes('edg')) return 'Edge';
  if (t.includes('brave')) return 'Brave';
  if (t.includes('opera') || t === 'opr') return 'Opera';
  if (t.includes('vivaldi')) return 'Vivaldi';
  if (t.includes('yandex') || t.includes('yabrowser')) return 'Yandex';
  if (t.includes('chrome') || t.includes('chromium')) return 'Chrome';
  return null;
}

function parseResolution(value) {
  // Bounded input and a single bounded separator class avoid polynomial backtracking (ReDoS).
  const s = String(value || '').slice(0, 64);
  const m = /(\d{3,5})[\sx×*by]{1,8}(\d{3,5})/i.exec(s);
  if (!m) return null;
  return { w: m[1], h: m[2] };
}

// Canvas / WebGL / AudioContext "Real" => noise OFF (false); anything else
// (Noise / Block) => noise ON (true). Blank => undefined (keep generated default).
function modeToNoise(value) {
  const t = normalizeHeader(value);
  if (!t) return undefined;
  if (t.includes('real') || t.includes('off') || t.includes('disable') || t.includes('native')) return false;
  return true;
}

function normalizeWebrtc(value) {
  const t = normalizeHeader(value);
  if (!t) return null;
  if (t.includes('real')) return 'Real';
  if (t.includes('block') || t.includes('disable') || t.includes('off')) return 'Block';
  if (t.includes('noise') || t.includes('fake') || t.includes('replace')) return 'Noise';
  if (t.includes('forward') || t.includes('proxy')) return 'Forward';
  return null;
}

// The editor's word ('Open' / 'Close' / 'Default') for any understood cell, so an imported profile shows
// the right choice and launches with it; undefined (keep the default) for an empty or unknown cell.
function normalizeDnt(value) {
  return parseDoNotTrack(cellText(value)) || undefined;
}

// "Auto / Based on IP" vs "Manual / Custom" for timezone + locale.
function modeIsManual(value) {
  const t = normalizeHeader(value);
  if (!t) return null;
  if (t.includes('manual') || t.includes('custom') || t.includes('fixed') || t.includes('set')) return true;
  if (t.includes('auto') || t.includes('ip') || t.includes('based')) return false;
  return null;
}

function normalizeGeoMode(value) {
  const t = normalizeHeader(value);
  if (!t) return null;
  if (t.includes('custom') || t.includes('allow') || t.includes('manual')) return 'Custom';
  if (t.includes('block') || t.includes('deny') || t.includes('off')) return 'Block';
  if (t.includes('prompt') || t.includes('ask')) return 'Based on IP';
  return null;
}

function parseBooleanInt(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'yes', 'true', 'on', 'enabled'].includes(text) ? 1 : 0;
}

function parseSystemProxyBehavior(value, fallback = 'DIRECT') {
  const text = normalizeHeader(value);
  if (!text) return fallback;
  if (text.includes('profile') || text.includes('custom')) return 'PROFILE_PROXY';
  if (text.includes('system')) return 'SYSTEM_PROXY';
  if (text.includes('direct') || text.includes('none')) return 'DIRECT';
  return fallback;
}

function extractProxyFromRow(row, columns) {
  const combined = getCell(row, columns.proxyCombined);
  if (combined) return combined;

  const host = getCell(row, columns.proxyHost);
  const port = getCell(row, columns.proxyPort);
  if (!host || !port) return null;

  const username = getCell(row, columns.proxyUsername);
  const password = getCell(row, columns.proxyPassword);

  return `${host}:${port}:${username}:${password}`;
}

function rowLooksEmpty(row) {
  return row.every((cell) => cellText(cell) === '');
}

// Row cap so a huge or hostile sheet cannot build an unbounded array and freeze the main thread.
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024; // 25 MB on-disk cap for an import file

// XLSX.readFile materializes the whole declared sheet before any row cap, so a tiny hostile .xlsx
// can OOM the main thread. Cap the file size and pass `sheetRows` so SheetJS stops at the cap.
function assertImportFileSane(filePath) {
  try {
    const st = require('node:fs').statSync(filePath);
    if (st && st.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error('Softglaze importer: that file is too large to import (max 25 MB).');
    }
  } catch (e) {
    if (e && /too large/.test(String(e.message))) throw e; // re-throw our own cap error
    // stat failure (missing/locked) surfaces later in readFile - don't mask it here.
  }
}

function parseWorkbookFile(filePath) {
  assertImportFileSane(filePath);
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false, sheetRows: MAX_IMPORT_ROWS + 5 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Softglaze importer: the workbook contains no sheets.');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (rows.length < 4) throw new Error('The selected file does not contain enough rows for the Softglaze template.');

  const headerRowIndex = detectHeaderRowIndex(rows);
  const headers = rows[headerRowIndex] || [];
  const columns = {
    title: findColumnIndex(headers, HEADER_ALIASES.title),
    proxyMethod: findColumnIndex(headers, HEADER_ALIASES.proxyMethod),
    proxyType: findColumnIndex(headers, HEADER_ALIASES.proxyType),
    proxyId: findColumnIndex(headers, HEADER_ALIASES.proxyId),
    proxyCombined: findColumnIndex(headers, HEADER_ALIASES.proxyCombined),
    proxyHost: findColumnIndex(headers, HEADER_ALIASES.proxyHost),
    proxyPort: findColumnIndex(headers, HEADER_ALIASES.proxyPort),
    proxyUsername: findColumnIndex(headers, HEADER_ALIASES.proxyUsername),
    proxyPassword: findColumnIndex(headers, HEADER_ALIASES.proxyPassword),
    accountUsername: findColumnIndex(headers, HEADER_ALIASES.accountUsername),
    accountPassword: findColumnIndex(headers, HEADER_ALIASES.accountPassword),
    twoFa: findColumnIndex(headers, HEADER_ALIASES.twoFa),
    cookie: findColumnIndex(headers, HEADER_ALIASES.cookie),
    userAgent: findColumnIndex(headers, HEADER_ALIASES.userAgent),
    openUrl: findColumnIndex(headers, HEADER_ALIASES.openUrl),
    enableSystemProxy: findColumnIndex(headers, HEADER_ALIASES.enableSystemProxy),
    notes: findColumnIndex(headers, HEADER_ALIASES.notes),
    group: findColumnIndex(headers, HEADER_ALIASES.group),
    tagManagement: findColumnIndex(headers, HEADER_ALIASES.tagManagement),
    systemProxyBehavior: findColumnIndex(headers, HEADER_ALIASES.systemProxyBehavior),
    dataDirName: findColumnIndex(headers, HEADER_ALIASES.dataDirName),
    country: findColumnIndex(headers, HEADER_ALIASES.country),
    os: findColumnIndex(headers, HEADER_ALIASES.os),
    browserCore: findColumnIndex(headers, HEADER_ALIASES.browserCore),
    browserBrand: findColumnIndex(headers, HEADER_ALIASES.browserBrand),
    resolution: findColumnIndex(headers, HEADER_ALIASES.resolution),
    proxyRotationUrl: findColumnIndex(headers, HEADER_ALIASES.proxyRotationUrl),
    webrtc: findColumnIndex(headers, HEADER_ALIASES.webrtc),
    canvas: findColumnIndex(headers, HEADER_ALIASES.canvas),
    webgl: findColumnIndex(headers, HEADER_ALIASES.webgl),
    webglVendor: findColumnIndex(headers, HEADER_ALIASES.webglVendor),
    webglRenderer: findColumnIndex(headers, HEADER_ALIASES.webglRenderer),
    audio: findColumnIndex(headers, HEADER_ALIASES.audio),
    cpuCores: findColumnIndex(headers, HEADER_ALIASES.cpuCores),
    ram: findColumnIndex(headers, HEADER_ALIASES.ram),
    dnt: findColumnIndex(headers, HEADER_ALIASES.dnt),
    timezoneMode: findColumnIndex(headers, HEADER_ALIASES.timezoneMode),
    timezoneVal: findColumnIndex(headers, HEADER_ALIASES.timezoneVal),
    localeMode: findColumnIndex(headers, HEADER_ALIASES.localeMode),
    localeVal: findColumnIndex(headers, HEADER_ALIASES.localeVal),
    geoMode: findColumnIndex(headers, HEADER_ALIASES.geoMode),
    latitude: findColumnIndex(headers, HEADER_ALIASES.latitude),
    longitude: findColumnIndex(headers, HEADER_ALIASES.longitude)
  };

  if (columns.title < 0) {
    throw new Error('Softglaze importer: could not detect a profile title/name column. Make sure the first row has column headers like "Profile Title".');
  }

  const items = [];
  const errors = [];
  const skipped = []; // instruction/note rows we deliberately skipped (surfaced to the UI)
  let sawData = false;
  let truncated = false;

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    if (items.length >= MAX_IMPORT_ROWS) { truncated = true; break; }
    const row = rows[rowIndex] || [];
    if (rowLooksEmpty(row)) continue;
    // Instruction rows only sit above the first data row; after one profile is imported, stop checking
    // so a profile titled "Example Corp" is never dropped.
    if (!sawData && looksLikeInstructionRow(row, columns.title)) {
      const skippedTitle = getCell(row, columns.title);
      if (skippedTitle) skipped.push({ row: rowIndex + 1, title: skippedTitle });
      continue;
    }
    sawData = true;

    try {
      const title = getCell(row, columns.title) || `Imported Profile ${rowIndex + 1}`;
      // A proxy is present if there's a combined "Proxy Info" string OR host/port.
      const rawProxy = extractProxyFromRow(row, columns);
      const proxyTypeCell = getCell(row, columns.proxyType);
      // Method may be 1/2/3 or a word; if absent but a proxy string exists, treat
      // it as a custom profile proxy (the common case for these templates).
      let proxyMethod = parseProxyMethod(getCell(row, columns.proxyMethod));
      if ((proxyMethod === 'NONE' || !getCell(row, columns.proxyMethod)) && rawProxy) proxyMethod = 'CUSTOM';

      let systemProxyBehavior = parseSystemProxyBehavior(getCell(row, columns.systemProxyBehavior), 'DIRECT');
      if (proxyMethod === 'CUSTOM') systemProxyBehavior = 'PROFILE_PROXY';
      if (proxyMethod === 'SYSTEM') systemProxyBehavior = 'SYSTEM_PROXY';
      if (proxyMethod === 'DIRECT' || proxyMethod === 'NONE') systemProxyBehavior = 'DIRECT';

      const res = parseResolution(getCell(row, columns.resolution));
      const tzManual = modeIsManual(getCell(row, columns.timezoneMode));
      const tzVal = getCell(row, columns.timezoneVal);
      const localeManual = modeIsManual(getCell(row, columns.localeMode));
      const localeVal = getCell(row, columns.localeVal);
      const lat = getCell(row, columns.latitude);
      const lng = getCell(row, columns.longitude);

      items.push({
        row: rowIndex + 1,
        title,
        proxyMethod,
        rawProxy: proxyMethod === 'CUSTOM' ? rawProxy : null,
        proxyType: normalizeProxyType(proxyTypeCell),
        proxyId: getCell(row, columns.proxyId),
        proxyRotationUrl: getCell(row, columns.proxyRotationUrl),
        accountUsername: getCell(row, columns.accountUsername),
        accountPassword: getCell(row, columns.accountPassword),
        twoFa: getCell(row, columns.twoFa),
        cookie: getCell(row, columns.cookie),
        userAgent: getCell(row, columns.userAgent),
        openUrl: getCell(row, columns.openUrl),
        notes: getCell(row, columns.notes),
        // Falls back to a legacy "Group Management"-style tag column.
        group: getCell(row, columns.group) || getCell(row, columns.tagManagement),
        tagManagement: parseBooleanInt(getCell(row, columns.tagManagement)),
        systemProxyBehavior,
        dataDirName: getCell(row, columns.dataDirName) || title,
        country: getCell(row, columns.country),

        os: normalizeOs(getCell(row, columns.os)),
        browserCore: normalizeBrowserCore(getCell(row, columns.browserCore)),
        browserBrand: normalizeBrowserBrand(getCell(row, columns.browserBrand)),
        resolutionW: res ? res.w : null,
        resolutionH: res ? res.h : null,

        // undefined keeps the generated default
        webrtc: normalizeWebrtc(getCell(row, columns.webrtc)),
        canvasNoise: modeToNoise(getCell(row, columns.canvas)),
        webglNoise: modeToNoise(getCell(row, columns.webgl)),
        audioNoise: modeToNoise(getCell(row, columns.audio)),
        webglVendor: getCell(row, columns.webglVendor),
        webglRenderer: getCell(row, columns.webglRenderer),
        cpuCores: getCell(row, columns.cpuCores),
        ramGb: getCell(row, columns.ram),
        doNotTrack: normalizeDnt(getCell(row, columns.dnt)),

        timezoneType: tzManual === null ? (tzVal ? 'Custom' : null) : (tzManual ? 'Custom' : 'Based on IP'),
        timezoneCustom: tzVal,
        languageType: localeManual === null ? (localeVal ? 'Custom' : null) : (localeManual ? 'Custom' : 'Based on IP'),
        languageCustom: localeVal,
        locationType: normalizeGeoMode(getCell(row, columns.geoMode)) || ((lat && lng) ? 'Custom' : null),
        locationLat: lat,
        locationLng: lng
      });
    } catch (error) {
      errors.push({
        row: rowIndex + 1,
        message: error instanceof Error ? error.message : 'Unknown parse error'
      });
    }
  }

  return {
    fileName: path.basename(filePath),
    filePath,
    sheetName,
    headerRow: headerRowIndex + 1,
    totalRows: items.length + errors.length,
    items,
    errors,
    skipped,   // instruction/note rows skipped above the first data row
    truncated, // true if the sheet exceeded MAX_IMPORT_ROWS and was cut
    maxRows: MAX_IMPORT_ROWS
  };
}

// Generic sheet parser for data-driven macro runs: row 1 = headers, each later row = an object
// keyed by header text, referenced from macro steps as {{Header}}.
const MAX_DATA_ROWS = 1000;

function parseDataRows(filePath) {
  assertImportFileSane(filePath);
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false, sheetRows: MAX_DATA_ROWS + 5 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The spreadsheet contains no sheets.');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (!matrix.length) return { fileName: path.basename(filePath), sheetName, headers: [], rows: [] };

  // Preserve column order/positions; a blank header cell means "ignore this column".
  const rawHeaders = (matrix[0] || []).map((h) => cellText(h));

  const rows = [];
  for (let i = 1; i < matrix.length && rows.length < MAX_DATA_ROWS; i += 1) {
    const row = matrix[i] || [];
    if (rowLooksEmpty(row)) continue;
    // Keys come from user-controlled headers: null-prototype object, and prototype-polluting names skipped.
    const obj = Object.create(null);
    rawHeaders.forEach((header, idx) => {
      if (header && header !== '__proto__' && header !== 'constructor' && header !== 'prototype') {
        obj[header] = cellText(row[idx]);
      }
    });
    rows.push(obj);
  }

  return {
    fileName: path.basename(filePath),
    sheetName,
    headers: rawHeaders.filter(Boolean),
    rows
  };
}

module.exports = {
  parseWorkbookFile,
  parseDataRows,
  parseSystemProxyBehavior,
  BROWSER_CORE,
  normalizeBrowserCore,
  toStoredBrowserCore
};
