'use strict';

const path = require('node:path');
const XLSX = require('xlsx');

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeHeader(value) {
  return cellText(value).toLowerCase().replace(/\s+/g, ' ').replace(/[_-]+/g, ' ').trim();
}

const HEADER_ALIASES = Object.freeze({
  title: ['profile name', 'profile title', 'name', 'title', 'browser profile', 'account name'],
  proxyMethod: ['proxy method', 'proxy type', 'proxy mode', 'proxy way'],
  proxyCombined: [
    'proxy',
    'proxy info',
    'proxy information',
    'proxy string',
    'proxy host:proxy port:proxy account:proxy password',
    'proxy host proxy port proxy account proxy password'
  ],
  proxyHost: ['proxy host', 'host', 'ip', 'proxy ip'],
  proxyPort: ['proxy port', 'port'],
  proxyUsername: ['proxy account', 'proxy username', 'username', 'proxy user'],
  proxyPassword: ['proxy password', 'password', 'proxy pass'],
  notes: ['notes', 'remark', 'remarks', 'description'],
  tagManagement: ['tag management', 'tag', 'tags'],
  systemProxyBehavior: ['system proxy behavior', 'proxy behavior'],
  dataDirName: ['data dir name', 'data directory', 'profile directory', 'user data dir']
});

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

  for (let index = 3; index < maxScan; index += 1) {
    const row = rows[index] || [];
    const normalized = row.map(normalizeHeader).filter(Boolean);
    if (normalized.length === 0) continue;

    let score = 0;
    if (findColumnIndex(row, HEADER_ALIASES.title) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.proxyMethod) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.proxyCombined) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.proxyHost) >= 0) score += 1;
    if (findColumnIndex(row, HEADER_ALIASES.proxyPort) >= 0) score += 1;

    if (score >= 2) return index;
  }

  return 3;
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

function parseWorkbookFile(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Workbook contains no sheets.');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (rows.length < 4) throw new Error('The selected file does not contain enough rows for the ixBrowser-style template.');

  const headerRowIndex = detectHeaderRowIndex(rows);
  const headers = rows[headerRowIndex] || [];
  const columns = {
    title: findColumnIndex(headers, HEADER_ALIASES.title),
    proxyMethod: findColumnIndex(headers, HEADER_ALIASES.proxyMethod),
    proxyCombined: findColumnIndex(headers, HEADER_ALIASES.proxyCombined),
    proxyHost: findColumnIndex(headers, HEADER_ALIASES.proxyHost),
    proxyPort: findColumnIndex(headers, HEADER_ALIASES.proxyPort),
    proxyUsername: findColumnIndex(headers, HEADER_ALIASES.proxyUsername),
    proxyPassword: findColumnIndex(headers, HEADER_ALIASES.proxyPassword),
    notes: findColumnIndex(headers, HEADER_ALIASES.notes),
    tagManagement: findColumnIndex(headers, HEADER_ALIASES.tagManagement),
    systemProxyBehavior: findColumnIndex(headers, HEADER_ALIASES.systemProxyBehavior),
    dataDirName: findColumnIndex(headers, HEADER_ALIASES.dataDirName)
  };

  if (columns.title < 0) throw new Error('Could not detect a profile title/name column.');

  const items = [];
  const errors = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (rowLooksEmpty(row)) continue;

    try {
      const title = getCell(row, columns.title) || `Imported Profile ${rowIndex + 1}`;
      const proxyMethod = parseProxyMethod(getCell(row, columns.proxyMethod));
      let systemProxyBehavior = parseSystemProxyBehavior(getCell(row, columns.systemProxyBehavior), 'DIRECT');

      if (proxyMethod === 'CUSTOM') systemProxyBehavior = 'PROFILE_PROXY';
      if (proxyMethod === 'SYSTEM') systemProxyBehavior = 'SYSTEM_PROXY';
      if (proxyMethod === 'DIRECT' || proxyMethod === 'NONE') systemProxyBehavior = 'DIRECT';

      const rawProxy = proxyMethod === 'CUSTOM' ? extractProxyFromRow(row, columns) : null;

      items.push({
        row: rowIndex + 1,
        title,
        proxyMethod,
        rawProxy,
        notes: getCell(row, columns.notes),
        tagManagement: parseBooleanInt(getCell(row, columns.tagManagement)),
        systemProxyBehavior,
        dataDirName: getCell(row, columns.dataDirName) || title
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
    errors
  };
}

module.exports = {
  parseWorkbookFile,
  parseBooleanInt,
  parseSystemProxyBehavior
};
