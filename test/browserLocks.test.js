'use strict';
// Audit 2 Nov 2026 #4: "Disable browser developer tools" and "Disable installing/removing
// extensions" wrote a managed_policies.json into the profile folder, which Chromium never
// reads on Windows, so both settings did nothing. browserLocks.js enforces them over the
// browser-level CDP connection. Checked live against Chrome for Testing 157 (2 Nov 2026):
// an open DevTools panel, an auto-opened DevTools, chrome://extensions and the Web Store
// were all closed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { lockedReason, attachBrowserLocksToSession } = require('../src/main/browserLocks');

const ROOT = path.join(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'main', 'browserEngine.js'), 'utf8');

class FakeCdp extends EventEmitter {
  constructor(targets) { super(); this.targets = targets; this.sent = []; }
  async send(method, params) {
    this.sent.push([method, params]);
    if (method === 'Target.getTargets') return { targetInfos: this.targets };
    if (method === 'Target.setDiscoverTargets') {
      for (const t of this.targets) this.emit('Target.targetCreated', { targetInfo: t });
      return {};
    }
    if (method === 'Target.closeTarget') { this.targets = this.targets.filter((t) => t.targetId !== params.targetId); return { success: true }; }
    if (method === 'Target.createTarget') { this.targets.push({ targetId: 'new', type: 'page', url: params.url }); return { targetId: 'new' }; }
    return {};
  }
  detach() {}
}
const tick = () => new Promise((r) => setImmediate(r));
const closed = (cdp) => cdp.sent.filter(([m]) => m === 'Target.closeTarget').map(([, p]) => p.targetId);

test('lockedReason matches only what each setting covers', () => {
  const both = { disableDevtools: true, lockExtensions: true };
  assert.equal(lockedReason('devtools://devtools/bundled/devtools_app.html', both), 'devtools');
  assert.equal(lockedReason('chrome://extensions/', both), 'extensions');
  assert.equal(lockedReason('chrome://extensions/?id=abc', both), 'extensions');
  assert.equal(lockedReason('chrome://extensions-frame', both), 'extensions');
  assert.equal(lockedReason('https://chromewebstore.google.com/detail/x', both), 'extensions');
  assert.equal(lockedReason('https://chrome.google.com/webstore/category/extensions', both), 'extensions');
  assert.equal(lockedReason('https://example.com/devtools://x', both), null);
  assert.equal(lockedReason('chrome://extensionsfoo', both), null);
  assert.equal(lockedReason('https://chromewebstore.google.com.evil.test/', both), null);
  assert.equal(lockedReason('devtools://devtools/x', { lockExtensions: true }), null, 'devtools only when that lock is on');
  assert.equal(lockedReason('chrome://extensions/', { disableDevtools: true }), null, 'extensions only when that lock is on');
});

test('nothing attaches when both settings are off', async () => {
  const cdp = new FakeCdp([]);
  assert.equal(await attachBrowserLocksToSession(cdp, {}), null);
  assert.equal(cdp.sent.length, 0);
});

test('existing and new DevTools targets are closed; normal pages are not', async () => {
  const cdp = new FakeCdp([
    { targetId: 'p1', type: 'page', url: 'https://example.com/' },
    { targetId: 'd1', type: 'page', url: 'devtools://devtools/bundled/devtools_app.html' }
  ]);
  const lock = await attachBrowserLocksToSession(cdp, { disableDevtools: true });
  await tick();
  assert.deepEqual(closed(cdp), ['d1']);
  cdp.emit('Target.targetCreated', { targetInfo: { targetId: 'd2', type: 'other', url: 'devtools://devtools/x' } });
  await tick();
  assert.deepEqual(closed(cdp), ['d1', 'd2']);
  lock.detach();
});

test('a tab that navigates to chrome://extensions is closed, keeping the window open', async () => {
  const cdp = new FakeCdp([{ targetId: 'p1', type: 'page', url: 'about:blank' }]);
  await attachBrowserLocksToSession(cdp, { lockExtensions: true });
  cdp.targets[0].url = 'chrome://extensions/';
  cdp.emit('Target.targetInfoChanged', { targetInfo: cdp.targets[0] });
  await tick(); await tick(); await tick();
  const methods = cdp.sent.map(([m]) => m);
  assert.ok(methods.indexOf('Target.createTarget') < methods.indexOf('Target.closeTarget'), 'a blank tab is opened first when it is the only page');
  assert.deepEqual(closed(cdp), ['p1']);
});

test('the launch attaches the locks right after the browser starts', () => {
  assert.match(ENGINE, /const \{ attachBrowserLocks \} = require\('\.\/browserLocks'\);/);
  const launch = ENGINE.indexOf('browser = await engine.launch(launchOptions);');
  const attach = ENGINE.indexOf('await attachBrowserLocks(browser, {');
  const fpInject = ENGINE.indexOf('const fpInjectSource = ');
  assert.ok(launch > 0 && attach > launch && attach < fpInject, 'attached first in the post-launch setup');
  assert.match(ENGINE, /disableDevtools: browserSettings\.disableDevtools === true,\s*lockExtensions: browserSettings\.lockExtensions === true/);
});
