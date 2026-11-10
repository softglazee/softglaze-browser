'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildScoreboard, groupKeyOf, parseBlock, scoreOf, speedPart, levelOf, WINDOW_MS, MIN_CHECKS, WEIGHTS
} = require('../src/main/vendorScoreboard');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const IPC = read('src/main/ipcHandlers.js');
const PRELOAD = read('src/preload/preload.js');
const API = read('src/renderer/lib/softglazeApi.js');
const I18N = read('src/renderer/i18n/index.js');
const COMPONENT = read('src/renderer/components/VendorScoreboard.jsx');
const PAGE = read('src/renderer/pages/ProxyProvidersPage.jsx');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const VENDORS = { liveproxies: 'Live Proxies', proxyseller: 'Proxy-Seller' };

const proxy = (id, over = {}) => ({
  id, name: `Proxy ${id} • Residential`, provider: 'liveproxies', lastStatus: 'ok', lastBlacklisted: false,
  lastIsp: 'AS7922 Comcast Cable Communications', lastCheckedAt: new Date(NOW - HOUR), ...over
});
// n checks for one proxy, an hour apart, ending an hour ago.
const checks = (proxyId, n, status = 'ok', latencyMs = 400) => Array.from({ length: n }, (_, i) => ({
  proxyId, status, latencyMs: status === 'ok' ? latencyMs : null, ts: new Date(NOW - (i + 1) * HOUR)
}));
const block = (proxyId, site, ageMs = HOUR) => ({
  detail: JSON.stringify({ proxyId, provider: 'x', site, kind: 'captcha', action: 'none' }), createdAt: new Date(NOW - ageMs)
});
const rowOf = (board, key) => board.rows.find((r) => r.key === key);

test('percentages come from each proxy\'s last check', () => {
  const board = buildScoreboard({
    now: NOW,
    vendors: VENDORS,
    proxies: [
      proxy(1),
      proxy(2, { lastStatus: 'fail', lastBlacklisted: true }),
      proxy(3, { lastStatus: null, lastBlacklisted: null, lastCheckedAt: null }),
      proxy(4, { name: 'Plain', lastIsp: 'AS16509 Amazon.com, Inc.' })
    ]
  });
  const r = rowOf(board, 'liveproxies');
  assert.equal(r.name, 'Live Proxies');
  assert.equal(r.kind, 'vendor');
  assert.equal(r.proxies, 4);
  assert.equal(r.checked, 3, 'an unchecked proxy is left out of working %');
  assert.equal(r.workingPct, 67);
  assert.equal(r.blocklistedPct, 33, 'only proxies with a blocklist result count');
  assert.equal(r.datacenterPct, 25);
  assert.equal(r.lastCheckedAt, new Date(NOW - HOUR).toISOString());
});

test('success rate and median speed come from the checks in the window', () => {
  const events = [
    ...checks(1, 2, 'ok', 100), ...checks(1, 1, 'ok', 300), ...checks(2, 1, 'ok', 200), ...checks(2, 1, 'ok', 900),
    ...checks(2, 4, 'fail')
  ];
  const r = rowOf(buildScoreboard({ now: NOW, vendors: VENDORS, proxies: [proxy(1), proxy(2)], events }), 'liveproxies');
  assert.equal(r.checks, 9);
  assert.equal(r.successPct, 56);
  assert.equal(r.medianMs, 200, 'median of 100, 100, 200, 300, 900; failed checks have no speed');
});

test('the median ignores failed checks and averages the middle pair', () => {
  const events = [...checks(1, 1, 'ok', 100), ...checks(1, 1, 'ok', 300), ...checks(1, 1, 'ok', 200), ...checks(1, 1, 'ok', 900), ...checks(1, 3, 'fail')];
  assert.equal(rowOf(buildScoreboard({ now: NOW, proxies: [proxy(1)], events }), 'liveproxies').medianMs, 250);
});

test('only the last 7 days count', () => {
  const old = { proxyId: 1, status: 'fail', latencyMs: null, ts: new Date(NOW - WINDOW_MS - 1000) };
  const edge = { proxyId: 1, status: 'ok', latencyMs: 400, ts: new Date(NOW - WINDOW_MS + 1000) };
  const board = buildScoreboard({
    now: NOW,
    proxies: [proxy(1)],
    events: [old, edge],
    blocks: [block(1, 'google.com', WINDOW_MS + 1000), block(1, 'amazon.com', 2 * HOUR)]
  });
  const r = rowOf(board, 'liveproxies');
  assert.equal(r.checks, 1);
  assert.equal(r.successPct, 100);
  assert.equal(r.blocks, 1);
  assert.deepEqual(r.topSites, [{ site: 'amazon.com', count: 1 }]);
  assert.equal(board.windowDays, 7);
});

test('a row with too few checks is not scored', () => {
  const few = rowOf(buildScoreboard({ now: NOW, proxies: [proxy(1)], events: checks(1, MIN_CHECKS - 1) }), 'liveproxies');
  assert.equal(few.enoughData, false);
  assert.equal(few.score, null);
  assert.equal(few.level, null);
  assert.equal(few.successPct, 100, 'the measured numbers still show');

  const enough = rowOf(buildScoreboard({ now: NOW, proxies: [proxy(1)], events: checks(1, MIN_CHECKS) }), 'liveproxies');
  assert.equal(enough.enoughData, true);
  assert.equal(enough.score, 100);
  assert.equal(enough.level, 'good');
});

test('hand-added proxies group as your own, free ones as free proxies', () => {
  assert.equal(groupKeyOf(null), 'own');
  assert.equal(groupKeyOf(''), 'own');
  assert.equal(groupKeyOf('custom'), 'own');
  assert.equal(groupKeyOf(' Custom '), 'own');
  assert.equal(groupKeyOf('free'), 'free');
  assert.equal(groupKeyOf('LiveProxies'), 'liveproxies');

  const board = buildScoreboard({
    now: NOW,
    vendors: VENDORS,
    proxies: [proxy(1, { provider: null }), proxy(2, { provider: 'custom' }), proxy(3, { provider: undefined }), proxy(4, { provider: 'free' }), proxy(5, { provider: 'oldvendor', name: 'Plain' }), proxy(6, { provider: 'gonevendor', name: 'GoneVendor • US Dallas' })]
  });
  assert.deepEqual(board.rows.map((r) => r.key).sort(), ['free', 'gonevendor', 'oldvendor', 'own']);
  const own = rowOf(board, 'own');
  assert.equal(own.kind, 'own');
  assert.equal(own.name, null, 'the renderer names it');
  assert.equal(own.proxies, 3);
  assert.equal(rowOf(board, 'free').kind, 'free');
  assert.equal(rowOf(board, 'oldvendor').name, 'oldvendor', 'an unknown tag keeps its own row');
  // A removed provider's proxies keep the vendor name they were pulled with (1.0.27: ShopSocks5).
  assert.equal(rowOf(board, 'gonevendor').name, 'GoneVendor');
});

test('blocks count per vendor with the top blocking sites', () => {
  const blocks = [
    block(1, 'Google.com'), block(1, 'google.com'), block(2, 'google.com'), block(2, 'amazon.com'), block(2, 'x.com'),
    block(2, 'ebay.com'), block(2, ''), { detail: 'not json', createdAt: new Date(NOW) }, { detail: JSON.stringify({ site: 'a.com' }), createdAt: new Date(NOW) }
  ];
  const r = rowOf(buildScoreboard({ now: NOW, proxies: [proxy(1), proxy(2)], blocks }), 'liveproxies');
  assert.equal(r.blocks, 7, 'a block without a site still counts; rows that name no proxy do not');
  assert.equal(r.blocksPerProxy, 3.5);
  assert.deepEqual(r.topSites, [{ site: 'google.com', count: 3 }, { site: 'amazon.com', count: 1 }, { site: 'ebay.com', count: 1 }]);
});

test('block rows are parsed defensively', () => {
  assert.deepEqual(parseBlock({ detail: '{"proxyId":"12","site":" Shop.Example "}', createdAt: new Date(NOW) }), { proxyId: 12, site: 'shop.example', ts: NOW });
  assert.deepEqual(parseBlock({ detail: { proxyId: 3 }, createdAt: NOW }), { proxyId: 3, site: '', ts: NOW });
  assert.equal(parseBlock({ detail: '{broken', createdAt: NOW }), null);
  assert.equal(parseBlock({ detail: '{"proxyId":0}', createdAt: NOW }), null);
  assert.equal(parseBlock(null), null);
});

test('checks and blocks of proxies outside the list are ignored (scoping)', () => {
  const board = buildScoreboard({
    now: NOW,
    proxies: [proxy(1)],
    events: [...checks(1, 10), ...checks(99, 50, 'fail')],
    blocks: [block(99, 'google.com')]
  });
  assert.equal(board.rows.length, 1);
  const r = board.rows[0];
  assert.equal(r.checks, 10);
  assert.equal(r.successPct, 100);
  assert.equal(r.blocks, 0);
});

test('the score weighs success and blocklist most, then speed, then blocks', () => {
  assert.deepEqual(WEIGHTS, { success: 40, clean: 30, speed: 20, blocks: 10 });
  assert.equal(speedPart(400), 1);
  assert.equal(speedPart(500), 1);
  assert.equal(speedPart(1750), 0.5);
  assert.equal(speedPart(3000), 0);
  assert.equal(speedPart(null), null);
  assert.equal(scoreOf({ success: 1, clean: 1, speed: 1, blocks: 1 }), 100);
  assert.equal(scoreOf({ success: 0.75, clean: 0.5, speed: 0.5, blocks: 0 }), 55);
  assert.equal(scoreOf({ success: 0.5, clean: null, speed: 1, blocks: 1 }), 71, 'a part without data is left out');
  assert.ok(scoreOf({ success: 0.5, clean: 1, speed: 1, blocks: 1 }) < scoreOf({ success: 1, clean: 1, speed: 0.5, blocks: 1 }), 'success outweighs speed');
  assert.ok(scoreOf({ success: 1, clean: 0.5, speed: 1, blocks: 1 }) < scoreOf({ success: 1, clean: 1, speed: 1, blocks: 0 }), 'the blocklist outweighs site blocks');
  assert.equal(levelOf(80), 'good');
  assert.equal(levelOf(79), 'fair');
  assert.equal(levelOf(59), 'poor');
});

test('rows are ordered best score first, with unscored rows last', () => {
  const proxies = [
    proxy(1), proxy(2),
    proxy(3, { provider: 'proxyseller', lastBlacklisted: true }), proxy(4, { provider: 'proxyseller' }),
    proxy(5, { provider: null }),
    proxy(6, { provider: 'free', lastBlacklisted: null })
  ];
  const events = [
    ...checks(1, 10, 'ok', 400), ...checks(2, 10, 'ok', 400),
    ...checks(3, 8, 'ok', 1750), ...checks(4, 7, 'ok', 1750), ...checks(4, 5, 'fail'),
    ...checks(5, 3),
    ...checks(6, 10, 'fail')
  ];
  const blocks = [block(3, 'google.com'), block(4, 'google.com')];
  const board = buildScoreboard({ now: NOW, vendors: VENDORS, proxies, events, blocks });
  assert.deepEqual(board.rows.map((r) => r.key), ['liveproxies', 'proxyseller', 'free', 'own']);
  assert.equal(rowOf(board, 'liveproxies').score, 100);
  assert.equal(rowOf(board, 'proxyseller').score, 55, '(40 x 0.75 + 30 x 0.5 + 20 x 0.5 + 10 x 0) / 100');
  assert.equal(rowOf(board, 'proxyseller').level, 'poor');
  assert.equal(rowOf(board, 'free').score, 14, 'no check passed: success and speed are 0, no blocklist data');
  assert.equal(rowOf(board, 'own').score, null);
});

test('an empty pool gives an empty board', () => {
  const board = buildScoreboard({ now: NOW });
  assert.deepEqual(board.rows, []);
  assert.equal(board.minChecks, MIN_CHECKS);
  assert.equal(board.generatedAt, new Date(NOW).toISOString());
});

test('the handler is registered, gated and scoped', () => {
  assert.match(IPC, /PROXY_VENDOR_SCOREBOARD: 'proxy:vendor-scoreboard'/);
  assert.match(PRELOAD, /PROXY_VENDOR_SCOREBOARD: 'proxy:vendor-scoreboard'/);
  assert.match(IPC, /registerHandler\(CHANNELS\.PROXY_VENDOR_SCOREBOARD, getVendorScoreboard\)/);
  assert.match(PRELOAD, /vendorScoreboard: \(\) => invoke\(CHANNELS\.PROXY_VENDOR_SCOREBOARD\)/);
  assert.match(API, /vendorScoreboard: \(\) => getSoftglazeApi\(\)\.proxies\.vendorScoreboard\(\)/);

  const start = IPC.indexOf('async function getVendorScoreboard(');
  assert.notEqual(start, -1);
  const fn = IPC.slice(start, IPC.indexOf('\n}', start));
  const gate = fn.indexOf("await requirePermission('proxies.manage')");
  assert.ok(gate !== -1 && gate < fn.indexOf('getPrisma()'), 'the permission check runs before any query');
  assert.match(fn, /const scope = await scopedProxyWhere\(undefined\)/);
  assert.match(fn, /db\.proxy\.findMany\(\{\s*where: scope,/, 'only proxies this member may use');
  assert.match(fn, /scope \? \{ proxyId: \{ in: ids \}, ts: \{ gte: since \} \}/, 'a member\'s checks are limited to their proxies');
  assert.match(fn, /take: SCOREBOARD_MAX_EVENTS/, 'the event window is capped');
  assert.match(fn, /action: 'proxy\.blocked', createdAt: \{ gte: since \}/);
  assert.match(fn, /buildScoreboard\(\{ proxies, events, blocks, now, vendors: PROXY_VENDORS \}\)/, 'blocks are matched to the scoped proxies');
  assert.match(IPC, /const SCOREBOARD_MAX_EVENTS = 50000;/);
});

test('the page shows the scoreboard in its own component', () => {
  assert.match(PAGE, /import VendorScoreboard from '@\/components\/VendorScoreboard\.jsx';/);
  assert.match(PAGE, /<VendorScoreboard onSelect=/);
  assert.match(COMPONENT, /softglazeApi\.proxies\.vendorScoreboard\(\)/);
  assert.match(COMPONENT, /<table[\s>]/);
  assert.match(COMPONENT, /<th\s+key=\{col\.key\}\s+scope="col"\s+aria-sort=/, 'sortable headers say how they sort');
  assert.match(COMPONENT, /<div className="overflow-x-auto">/, 'a narrow window scrolls the table, not the page');
});

test('the scoreboard namespace is registered and English and Spanish match', () => {
  const en = JSON.parse(read('src/renderer/i18n/locales/en/scoreboard.json'));
  const es = JSON.parse(read('src/renderer/i18n/locales/es/scoreboard.json'));
  const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  assert.deepEqual(keys(es).sort(), keys(en).sort(), 'Spanish has exactly the English keys');
  for (const k of keys(es)) assert.ok(String(k.split('.').reduce((o, p) => o[p], es)).trim(), `es ${k} is empty`);

  assert.match(I18N, /import scoreboardEn from '\.\/locales\/en\/scoreboard\.json';/);
  assert.match(I18N, /import scoreboardEs from '\.\/locales\/es\/scoreboard\.json';/);
  assert.match(I18N, /'captcha', 'scoreboard',/);
  assert.match(I18N, /scoreboard: scoreboardEn/);
  assert.match(I18N, /scoreboard: scoreboardEs/);

  const columns = [...COMPONENT.matchAll(/\{ key: '(\w+)', value:/g)].map((m) => m[1]);
  assert.equal(columns.length, 9);
  for (const c of columns) assert.ok(en.col[c], `col.${c}`);
  for (const level of ['good', 'fair', 'poor']) assert.ok(en.level[level], `level.${level}`);
  for (const k of ['own', 'free', 'notEnough', 'notEnoughTitle_one', 'notEnoughTitle_other', 'checks_one', 'checks_other', 'note', 'scoreHelp', 'truncated']) assert.ok(en[k], k);
});
