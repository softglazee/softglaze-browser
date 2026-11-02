'use strict';
// Proxy providers page: the provider list scrolls inside the detail card's height, trial tracking
// stays with the Super Admin, and the Account section reads plan, expiry, traffic and balance from
// each vendor's documented account endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = read('src/renderer/pages/ProxyProvidersPage.jsx');

test('the provider list scrolls inside the row the detail card sets', () => {
  assert.match(PAGE, /items-start xl:items-stretch/);
  // Size containment keeps the list out of the row height; the list region takes the rest and scrolls.
  assert.match(PAGE, /<Card className="overflow-hidden flex flex-col xl:\[contain:size\] xl:min-h-\[480px\]">/);
  assert.match(PAGE, /<div ref=\{listRef\} className="flex-1 min-h-0 overflow-auto max-h-\[60vh\] xl:max-h-none">/);
  assert.match(PAGE, /<thead className="sticky top-0 /);
  // Columns are unchanged.
  for (const col of ['colProvider', 'colState', 'colPool', 'colKind']) assert.match(PAGE, new RegExp(`t\\('table\\.${col}'\\)`), col);
});

const IPC = read('src/main/ipcHandlers.js');

// Body of a top-level function in a source file, up to the next top-level declaration.
function fnBody(src, name) {
  const start = src.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\r?\n(?:async function|function|const|let|module\.exports)\b/);
  return end < 0 ? rest : rest.slice(0, end);
}

test('trial tracking: the IPC read hides it and the IPC write refuses it below Super Admin', () => {
  assert.match(IPC, /const SUPER_ONLY_GLOBAL_KEYS = Object\.freeze\(\['proxyProviderTrials'\]\);/);
  assert.match(fnBody(IPC, 'activeIsSuperAdmin'), /m && m\.role === 'SUPER_ADMIN'/);
  assert.match(fnBody(IPC, 'getGlobalSettingsForActor'), /activeIsSuperAdmin\(\)\) \? all : withoutSuperOnlyKeys\(all\)/);
  const set = fnBody(IPC, 'setGlobalSettingsForActor');
  assert.match(set, /if \(!isSuper && SUPER_ONLY_GLOBAL_KEYS\.some/);
  assert.match(set, /err\.code = 'FORBIDDEN'/);
  assert.ok(set.indexOf("'FORBIDDEN'") < set.indexOf('setGlobalSettings(input)'), 'refused before anything is written');
  assert.match(IPC, /registerHandler\(CHANNELS\.SETTINGS_GET_GLOBAL, getGlobalSettingsForActor\);/);
  assert.match(IPC, /registerHandler\(CHANNELS\.SETTINGS_SET_GLOBAL, setGlobalSettingsForActor\);/);
});

test('trial tracking: the Trial row and its button render only for the Super Admin', () => {
  const panel = PAGE.slice(PAGE.indexOf('function DetailPanel('));
  const open = panel.indexOf('{!p.unavailable && isSuper && (');
  assert.ok(open > 0, 'trial row is gated on isSuper');
  const close = panel.indexOf('</Row>', open);
  const gated = panel.slice(open, close);
  assert.match(gated, /t\('detail\.trial'\)/);
  assert.match(gated, /t\('detail\.trialMark'\)/);
  const outside = panel.slice(0, open) + panel.slice(close);
  assert.doesNotMatch(outside, /detail\.trial|setTrialEdit\(\{/, 'no trial text or control outside the gate');
});
