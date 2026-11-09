'use strict';
// Renderer side of the "Use a profile with Playwright MCP or Chrome DevTools MCP (advanced)" card
// and the Connect tab copy around it: the card's state (src/renderer/lib/aiDevtools.mjs), then the
// real components rendered to HTML. rolldown (Vite's bundler) bundles the JSX with the '@' alias;
// packages stay external and load from node_modules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const R = path.join(ROOT, 'src', 'renderer');
const loadState = () => import('../src/renderer/lib/aiDevtools.mjs');
const loadCore = () => import('../src/renderer/lib/aiCore.mjs');

const WS = 'ws://127.0.0.1:53123/devtools/browser/0b6c2f1e';
const PORT_RE = /ws:\/\/127\.0\.0\.1:\d/;
const SESSIONS = [
  { profileId: 12, name: 'Shop-UK-3', engine: 'chromium', running: true },
  { profileId: 14, name: 'FF-Test', engine: 'firefox', running: true },
  { profileId: 15, name: 'Shop-DE-1', engine: 'chromium', running: true }
];
const snip = (tool, client, extra = '') => ({ tool, client, kind: client === 'claude-code' ? 'command' : 'json', text: `${tool}:${client}:${WS}${extra}`, docsUrl: 'https://example.org' });
const RESULT = {
  profileId: 12,
  wsEndpoint: WS,
  snippets: ['playwright', 'chrome-devtools'].flatMap((tl) => ['claude-code', 'claude-desktop', 'cursor', 'vscode'].map((c) => snip(tl, c, tl === 'chrome-devtools' ? ' --no-usage-statistics' : ''))),
  snippetsWithUsageStats: ['playwright', 'chrome-devtools'].flatMap((tl) => ['claude-code', 'claude-desktop', 'cursor', 'vscode'].map((c) => snip(tl, c)))
};

function run(reducer, state, ...actions) {
  return actions.reduce((s, a) => reducer(s, a), state);
}

// ---- state ------------------------------------------------------------------------------------

test('state: the first running Chromium profile is picked, Firefox never, and nothing is shown before Show', async () => {
  const { devtoolsReducer, initialDevtools, currentSnippet, hasChromium, normalizeSessions } = await loadState();
  const s = run(devtoolsReducer, initialDevtools, { type: 'sessions', list: [SESSIONS[1], SESSIONS[0], SESSIONS[2]] });
  assert.equal(s.profileId, 12, 'Firefox is skipped');
  assert.equal(s.reveal, null);
  assert.equal(currentSnippet(s), null);
  assert.equal(run(devtoolsReducer, s, { type: 'select', profileId: 14 }).profileId, 12, 'a Firefox profile cannot be chosen');
  assert.equal(run(devtoolsReducer, s, { type: 'select', profileId: '15' }).profileId, 15);
  assert.equal(hasChromium(normalizeSessions([SESSIONS[1]])), false);
  assert.deepEqual(normalizeSessions([{ profileId: 'x' }, { profileId: 3, running: false }, { profileId: 4 }, { profileId: 4 }]), [{ profileId: 4, name: '#4', engine: 'chromium' }]);
  const empty = run(devtoolsReducer, initialDevtools, { type: 'sessions', list: [] });
  assert.equal(empty.loaded, true);
  assert.equal(empty.profileId, null);
});

test('state: Show reveals; Hide, another profile and closing the card forget the address', async () => {
  const { devtoolsReducer, initialDevtools, currentSnippet } = await loadState();
  let s = run(devtoolsReducer, initialDevtools, { type: 'sessions', list: SESSIONS }, { type: 'showStart' });
  assert.equal(s.busy, true);
  s = devtoolsReducer(s, { type: 'showDone', profileId: 12, result: RESULT });
  assert.equal(s.reveal.wsEndpoint, WS);
  assert.equal(currentSnippet(s).text, `playwright:claude-code:${WS}`);
  s = run(devtoolsReducer, s, { type: 'tool', tool: 'chrome-devtools' }, { type: 'client', client: 'vscode' });
  assert.equal(currentSnippet(s).text, `chrome-devtools:vscode:${WS} --no-usage-statistics`, 'usage statistics off by default');
  assert.equal(currentSnippet(devtoolsReducer(s, { type: 'usageStats', off: false })).text, `chrome-devtools:vscode:${WS}`, 'the checkbox needs no second call');
  assert.equal(devtoolsReducer(s, { type: 'tool', tool: 'selenium' }).tool, 'chrome-devtools');
  assert.equal(devtoolsReducer(s, { type: 'hide' }).reveal, null);
  assert.equal(devtoolsReducer(s, { type: 'select', profileId: 15 }).reveal, null);
  assert.equal(devtoolsReducer(s, { type: 'closed' }).reveal, null);
  assert.equal(devtoolsReducer(s, { type: 'select', profileId: 12 }).reveal.wsEndpoint, WS, 'choosing the same profile again keeps it');
});

test('state: a stop event or a poll without the profile clears the address and says so', async () => {
  const { devtoolsReducer, initialDevtools } = await loadState();
  const shown = run(devtoolsReducer, initialDevtools, { type: 'sessions', list: SESSIONS }, { type: 'showStart' }, { type: 'showDone', profileId: 12, result: RESULT });
  const ended = devtoolsReducer(shown, { type: 'ended', profileId: 12 });
  assert.equal(ended.reveal, null);
  assert.equal(ended.profileId, null);
  assert.deepEqual(ended.stopped, { profileId: 12, name: 'Shop-UK-3' });
  assert.deepEqual(ended.sessions.map((x) => x.profileId), [14, 15]);
  assert.equal(devtoolsReducer(ended, { type: 'sessions', list: SESSIONS.slice(1) }).profileId, null, 'the notice stays until the Owner picks again');
  const other = devtoolsReducer(shown, { type: 'ended', profileId: 15 });
  assert.equal(other.reveal.wsEndpoint, WS, 'another profile stopping changes nothing');

  const polled = devtoolsReducer(shown, { type: 'sessions', list: SESSIONS.slice(1) });
  assert.equal(polled.reveal, null, 'the poll catches a window closed by hand');
  assert.equal(polled.stopped.profileId, 12);

  // An answer that arrives after the profile stopped is dropped.
  const pending = run(devtoolsReducer, initialDevtools, { type: 'sessions', list: SESSIONS }, { type: 'showStart' }, { type: 'ended', profileId: 12 });
  assert.equal(devtoolsReducer(pending, { type: 'showDone', profileId: 12, result: RESULT }).reveal, null);
  // A failed Show keeps the address hidden and shows the reason.
  const failed = run(devtoolsReducer, initialDevtools, { type: 'sessions', list: SESSIONS }, { type: 'showStart' }, { type: 'showFailed', profileId: 12, message: 'Profile #12 is not running. Start it first.' });
  assert.equal(failed.reveal, null);
  assert.equal(failed.error, 'Profile #12 is not running. Start it first.');
});

// ---- the real components ------------------------------------------------------------------------

let compiled = null;
async function components(t) {
  if (compiled) return compiled;
  let rolldown;
  try { ({ rolldown } = await import('rolldown')); } catch (e) { t.skip('rolldown is not installed'); return null; }
  const slash = (p) => p.split(path.sep).join('/');
  const entry = [
    `export { default as AiConnectTab, ClientPanel } from ${JSON.stringify(slash(path.join(R, 'components', 'ai', 'AiConnectTab.jsx')))};`,
    `export { default as AiDevtoolsCard, DevtoolsCardBody } from ${JSON.stringify(slash(path.join(R, 'components', 'ai', 'AiDevtoolsCard.jsx')))};`
  ].join('\n');
  const bundle = await rolldown({
    input: 'virtual:entry',
    cwd: ROOT,
    platform: 'node',
    logLevel: 'silent',
    resolve: { alias: { '@': R } },
    external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('@/') && !id.startsWith('\0') && !path.isAbsolute(id) && id !== 'virtual:entry',
    plugins: [{
      name: 'entry',
      resolveId(id) { return id === 'virtual:entry' ? '\0virtual:entry' : null; },
      load(id) { return id === '\0virtual:entry' ? entry : null; }
    }]
  });
  const { output } = await bundle.generate({ format: 'cjs' });
  await bundle.close();
  const file = path.join(R, '__aiDevtoolsCard.test.bundle.cjs'); // never written; only names the module
  const m = new Module(file);
  m.filename = file;
  m.paths = Module._nodeModulePaths(R);
  m._compile(output[0].code, file);
  compiled = m.exports;
  return compiled;
}

function i18nForTests() {
  const i18n = require('i18next').createInstance();
  const { initReactI18next } = require('react-i18next');
  i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { ai: JSON.parse(fs.readFileSync(path.join(R, 'i18n', 'locales', 'en', 'ai.json'), 'utf8')) } },
    defaultNS: 'ai',
    ns: ['ai'],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initImmediate: false
  });
  return i18n;
}

function renderer() {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { I18nextProvider } = require('react-i18next');
  const { MemoryRouter } = require('react-router-dom');
  const i18n = i18nForTests();
  const h = React.createElement;
  return { h, html: (el) => renderToStaticMarkup(h(I18nextProvider, { i18n }, h(MemoryRouter, null, el))) };
}

const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

test('render: the card is there for the Owner only, collapsed', async (t) => {
  const c = await components(t);
  if (!c) return;
  const { h, html } = renderer();
  const props = { status: { enabled: true, running: true, port: 8080 }, clients: [], loading: false, bridge: null, error: '', onRetry() {}, tokensCount: 1, tokensLoaded: true, onToggleServer() {}, toggling: false, onCreateToken() {} };
  for (const isOwner of [false, undefined]) {
    const out = html(h(c.AiConnectTab, { ...props, isOwner }));
    assert.doesNotMatch(out, /data-ai-devtools-card/, `isOwner ${isOwner}`);
    assert.doesNotMatch(out, /Playwright MCP/);
  }
  const owner = html(h(c.AiConnectTab, { ...props, isOwner: true }));
  assert.match(owner, /data-ai-devtools-card/);
  assert.match(text(owner), /Use a profile with Playwright MCP or Chrome DevTools MCP \(advanced\)/);
  assert.match(owner, /aria-expanded="false"/);
  assert.doesNotMatch(owner, /data-devtools-warning|data-devtools-endpoint/, 'collapsed: nothing below the title');
});

test('render: the warning comes first, the address is masked until Show, Firefox is listed but disabled', async (t) => {
  const c = await components(t);
  if (!c) return;
  const { devtoolsReducer, initialDevtools, MASKED_ENDPOINT } = await loadState();
  const { h, html } = renderer();
  const noop = () => {};

  const opened = html(h(c.AiDevtoolsCard, { defaultOpen: true }));
  assert.match(opened, /aria-expanded="true"/);
  assert.ok(opened.indexOf('data-devtools-warning') > 0);
  assert.ok(opened.indexOf('data-devtools-warning') < opened.indexOf('Loading running profiles'), 'the warning shows before the list loads');

  const s = devtoolsReducer(initialDevtools, { type: 'sessions', list: SESSIONS });
  const masked = html(h(c.DevtoolsCardBody, { state: s, dispatch: noop, onShow: noop, onRetry: noop }));
  const plain = text(masked);
  assert.match(plain, /Websites can detect an outside debugger\./);
  assert.match(plain, /Anyone on this computer who has the address below can control the profile while it runs\./);
  assert.ok(masked.indexOf('data-devtools-warning') < masked.indexOf('data-devtools-endpoint'), 'warning before the address');
  assert.match(masked, /data-devtools-endpoint="masked"/);
  assert.ok(masked.includes(MASKED_ENDPOINT));
  assert.doesNotMatch(masked, PORT_RE, 'no port before Show');
  assert.match(plain, /New every time the profile starts\. Works only on this computer while the profile runs\./);
  assert.match(plain, /Press Show to see the setup/);
  assert.match(masked, /<option value="14" disabled="">FF-Test \(#14\) · Firefox: Firefox profiles have no DevTools endpoint<\/option>/);
  assert.match(masked, /<option value="12" selected="">Shop-UK-3 \(#12\) · Chromium<\/option>/);
  assert.match(masked, /<\/svg> Show<\/button>/);
  assert.match(masked, /role="tablist" aria-label="MCP server"/);
  assert.match(masked, /role="tab" aria-selected="true"[^>]*>Playwright MCP</);
  assert.match(masked, /role="tablist" aria-label="AI app"/);
  for (const app of ['Claude Code', 'Claude Desktop', 'Cursor', 'VS Code \\(Copilot\\)']) assert.match(masked, new RegExp(`role="tab"[^>]*>${app}<`), app);
  assert.match(plain, /When you are done, close the MCP server, then stop the profile\./);
  assert.match(masked, /href="https:\/\/browser\.softglaze\.com\/docs\/ai-playwright-devtools"/);
  assert.doesNotMatch(masked, /usage statistics/, 'the checkbox belongs to the Chrome DevTools MCP tab');
  const devtoolsTab = html(h(c.DevtoolsCardBody, { state: devtoolsReducer(s, { type: 'tool', tool: 'chrome-devtools' }), dispatch: noop, onShow: noop, onRetry: noop }));
  assert.match(devtoolsTab, /type="checkbox" class="[^"]*" checked=""/);
  assert.match(text(devtoolsTab), /Turn off Chrome DevTools MCP usage statistics/);

  const none = html(h(c.DevtoolsCardBody, { state: devtoolsReducer(initialDevtools, { type: 'sessions', list: [SESSIONS[1]] }), dispatch: noop, onShow: noop, onRetry: noop }));
  assert.match(text(none), /Start a Chromium profile first\./);
  assert.match(none, /href="\/profiles"/);
  assert.doesNotMatch(none, /data-devtools-endpoint/, 'no address row without a Chromium profile');
});

test('render: after Show the address and setup appear; a stop event clears them', async (t) => {
  const c = await components(t);
  if (!c) return;
  const { devtoolsReducer, initialDevtools } = await loadState();
  const { h, html } = renderer();
  const noop = () => {};
  const shownState = run(devtoolsReducer, initialDevtools, { type: 'sessions', list: SESSIONS }, { type: 'showStart' }, { type: 'showDone', profileId: 12, result: RESULT });
  const shown = html(h(c.DevtoolsCardBody, { state: shownState, dispatch: noop, onShow: noop, onRetry: noop }));
  assert.match(shown, /data-devtools-endpoint="shown"/);
  assert.ok(shown.indexOf('data-devtools-warning') < shown.indexOf(WS), 'the warning still comes first');
  assert.ok(shown.includes(`playwright:claude-code:${WS}`), 'the chosen setup');
  assert.match(shown, /<\/svg> Hide<\/button>/);
  assert.match(text(shown), /claude mcp remove playwright-softglaze first/);

  const after = html(h(c.DevtoolsCardBody, { state: devtoolsReducer(shownState, { type: 'ended', profileId: 12 }), dispatch: noop, onShow: noop, onRetry: noop }));
  assert.doesNotMatch(after, PORT_RE);
  assert.doesNotMatch(after, /data-devtools-endpoint/);
  assert.match(text(after), /This profile \(Shop-UK-3\) stopped\. Its address no longer works\./);
  assert.match(after, /role="status"/);
});

test('render: Claude Code shows the plugin install, the manual command stays; Claude Desktop links the .mcpb', async (t) => {
  const c = await components(t);
  if (!c) return;
  const { CLAUDE_PLUGIN_COMMANDS, INSTALL_DOCS_URL, mcpbUrlOf } = await loadCore();
  const { h, html } = renderer();
  const manual = 'claude mcp add --transport http softglaze http://127.0.0.1:8080/mcp --header "Authorization: Bearer <YOUR_TOKEN>"';
  const code = html(h(c.ClientPanel, {
    entry: { key: 'claude-code', known: true, title: 'Claude Code', kind: 'command', where: 'Without the SoftGlaze plugins (no Node.js needed): run in a terminal.', text: manual, docsUrl: 'https://browser.softglaze.com/docs/ai-agents#claude-code', appDocsUrl: null },
    bridge: null,
    onCreateToken() {}
  }));
  const codeText = text(code);
  assert.equal(CLAUDE_PLUGIN_COMMANDS, '/plugin marketplace add softglazee/softglaze-claude-plugin\n/plugin install softglaze-browser@softglaze\n/plugin install softglaze-browser-connector@softglaze');
  for (const line of CLAUDE_PLUGIN_COMMANDS.split('\n')) assert.ok(codeText.includes(line), line);
  assert.ok(codeText.indexOf('/plugin marketplace add') < codeText.indexOf('claude mcp add --transport http'), 'plugins first, the manual command after');
  assert.ok(codeText.includes(manual), 'the claude mcp add alternative stays');
  assert.match(codeText, /Or add the server yourself/);
  assert.match(codeText, /Claude Desktop chats and Cowork use softglaze-browser\.mcpb/);
  assert.ok(code.includes(`href="${INSTALL_DOCS_URL}"`));
  assert.match(code, /href="https:\/\/browser\.softglaze\.com\/docs\/ai-agents#claude-code"/);

  const url = 'https://browser.softglaze.com/downloads/softglaze-browser.mcpb';
  assert.equal(mcpbUrlOf({ mcpbUrl: url }), url);
  assert.equal(mcpbUrlOf({ mcpbUrl: 'javascript:alert(1)' }), null);
  assert.equal(mcpbUrlOf({ mcpbPath: 'C:\\x.mcpb' }), null);
  const desktopEntry = { key: 'claude-desktop', known: true, title: 'Claude Desktop', kind: 'json', where: 'Easiest: install softglaze-browser.mcpb', text: '{"mcpServers":{}}', docsUrl: 'https://browser.softglaze.com/docs/ai-agents#claude-desktop', appDocsUrl: null };
  const desktop = html(h(c.ClientPanel, { entry: desktopEntry, bridge: { command: 'x.exe', args: [], env: {}, mcpbPath: null, mcpbUrl: url }, onCreateToken() {} }));
  assert.match(text(desktop), /Install in Claude Desktop: download softglaze-browser\.mcpb/);
  assert.ok(desktop.includes(`href="${url}"`));
  assert.match(text(desktop), /Easiest: download softglaze-browser\.mcpb with the button below/);
  const oldEngine = html(h(c.ClientPanel, { entry: desktopEntry, bridge: { command: 'x.exe', args: [], env: {}, mcpbPath: null }, onCreateToken() {} }));
  assert.doesNotMatch(oldEngine, /softglaze-browser\.mcpb"/, 'no download link when the engine does not name one');

  for (const out of [codeText, text(desktop)]) {
    assert.doesNotMatch(out, /planned|coming soon|SoftGlaze\.mcpb/i);
    assert.doesNotMatch(out, /(listed|approved|available) in (Claude's|the Claude|Anthropic's) directory/i, 'the plugin is under review, not listed');
  }
});

test('copy: no locale or source claims the Claude plugin is listed or approved, or calls the .mcpb planned', () => {
  const files = [
    ...['en', 'es'].map((l) => path.join(R, 'i18n', 'locales', l, 'ai.json')),
    path.join(ROOT, 'src', 'main', 'ai', 'snippets.js'),
    path.join(R, 'components', 'ai', 'AiConnectTab.jsx'),
    path.join(R, 'components', 'ai', 'AiDevtoolsCard.jsx')
  ];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /coming soon|\bplanned\b|SoftGlaze\.mcpb|próximamente|planificad/i, f);
    assert.doesNotMatch(s, /directory/i, `${f}: say nothing about Claude's directory while the plugin is under review`);
  }
});
