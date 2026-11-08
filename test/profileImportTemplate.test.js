'use strict';
// 1.0.23: the profile import template (Batch Import > Download template) showed Do Not Track as 0 / 1.
// Since 1.0.22 the importer stores the editor's words and reads 0 as Close (switched off), not as
// Default, and the exporter writes Open / Close / Default. The template now uses those words, the
// same ones the exporter writes, and its sample rows go through the real importer cleanly.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseWorkbookFile } = require('../src/main/importParser');
const { parseDoNotTrack } = require('../src/main/doNotTrack');

const ROOT = path.join(__dirname, '..');
const IPC = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipcHandlers.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'pages', 'BatchImportPage.jsx'), 'utf8');
const loadTemplate = () => import('../src/renderer/lib/profileImportTemplate.mjs');

// The header names of EXPORT_COLUMNS, read from the source (the list is not exported).
function exportHeaders() {
  const block = /const EXPORT_COLUMNS = \[([\s\S]*?)\n\];/.exec(IPC);
  assert.ok(block, 'EXPORT_COLUMNS found');
  return [...block[1].matchAll(/^\s*\['([^']+)',/gm)].map((m) => m[1]);
}

function importTemplate(csv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-template-'));
  const file = path.join(dir, 'softglaze-profiles-template.csv');
  try {
    // The page saves it with a UTF-8 BOM so Excel reads it as UTF-8.
    fs.writeFileSync(file, '﻿' + csv, 'utf8');
    return parseWorkbookFile(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('every Do Not Track sample is a word the importer reads, the same words the exporter writes', async () => {
  const { TEMPLATE_ROWS } = await loadTemplate();
  const samples = TEMPLATE_ROWS.map((r) => r['Do Not Track']).filter((v) => v !== undefined);
  assert.ok(samples.length >= 2, 'the template shows the column with values');
  for (const v of samples) {
    assert.ok(['Open', 'Close', 'Default'].includes(v), `"${v}" is one of the editor's words`);
    assert.equal(parseDoNotTrack(v), v, `"${v}" reads back unchanged`);
  }
  // No bare 0 / 1: 0 would import as Close, which is not what "Default" users expect.
  assert.ok(!samples.some((v) => /^[01]$/.test(String(v))));
  assert.match(IPC, /\['Do Not Track', \(p\) => doNotTrackChoice\(p\.doNotTrack\)\]/, 'the exporter writes the editor word');
});

test('the template uses the exporter\'s column names, so an export and a template import alike', async () => {
  const { TEMPLATE_HEADERS } = await loadTemplate();
  const exported = new Set(exportHeaders());
  // Cookie is import-only: the export does not write it.
  const notExported = TEMPLATE_HEADERS.filter((h) => !exported.has(h));
  assert.deepEqual(notExported, ['Cookie']);
  assert.ok(TEMPLATE_HEADERS.includes('Do Not Track'));
});

test('the sample rows import cleanly through the real parser', async () => {
  const { templateCsv } = await loadTemplate();
  const res = importTemplate(templateCsv());
  assert.deepEqual(res.errors, []);
  assert.equal(res.headerRow, 1);
  assert.equal(res.truncated, false);
  assert.deepEqual(res.items.map((i) => i.title), ['LeadGen_01', 'LeadGen_02', 'Testing_03']);
  assert.deepEqual(res.items.map((i) => i.doNotTrack), ['Default', 'Open', 'Close']);
  // Every column the template fills was read into a field (none silently ignored).
  const [first, second, third] = res.items;
  assert.equal(`${first.resolutionW}x${first.resolutionH}`, '1920x1080');
  assert.equal(first.group, 'Lead Gen');
  assert.equal(first.webrtc, 'Forward');
  assert.equal(second.timezoneCustom, 'Europe/Berlin');
  assert.equal(second.locationLat, '52.52');
  assert.equal(third.notes, 'No proxy (direct)');
});

test('the page builds the download from the shared template and keeps the BOM', () => {
  assert.match(PAGE, /import \{ templateCsv \} from '@\/lib\/profileImportTemplate\.mjs';/);
  assert.match(PAGE, /const csv = templateCsv\(\);/);
  assert.match(PAGE, /new Blob\(\['﻿' \+ csv\]/);
  assert.match(PAGE, /a\.download = 'softglaze-profiles-template\.csv';/);
  assert.doesNotMatch(PAGE, /'Do Not Track': '[01]'/);
});

test('the download button names the file type it saves', () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', 'en', 'batchImport.json'), 'utf8'));
  const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', 'locales', 'es', 'batchImport.json'), 'utf8'));
  assert.equal(en.step1.downloadButton, 'Download .CSV Template');
  assert.equal(es.step1.downloadButton, 'Descargar plantilla .CSV');
});
