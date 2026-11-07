'use strict';
// RFC 4180 CSV. parseCsv handles quotes, doubled quotes, commas and newlines inside quotes, CRLF and
// a UTF-8 BOM. stringifyCsv quotes when needed and, for spreadsheet safety, prefixes a cell that
// starts with = + - @ tab or CR with an apostrophe (OWASP CSV injection); importCell() removes it.

function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

const FORMULA = /^[=+\-@\t\r]/;

function exportCell(v) {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function importCell(v) {
  const s = String(v == null ? '' : v);
  return s.length > 1 && s[0] === "'" && FORMULA.test(s.slice(1)) ? s.slice(1) : s;
}

function stringifyCsv(rows) {
  return rows.map((r) => r.map(exportCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { parseCsv, stringifyCsv, exportCell, importCell };
