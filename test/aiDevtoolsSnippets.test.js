'use strict';
// src/main/ai/devtoolsSnippets.js: the eight setups behind the AI page's "Use a profile with
// Playwright MCP or Chrome DevTools MCP (advanced)" card, the pinned versions, the usage-statistics
// switch, and browserUrlOf refusing anything that is not this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('../src/main/ai/devtoolsSnippets');

const WS = 'ws://127.0.0.1:53123/devtools/browser/0b6c2f1e-8a4d-4c1b-9f00-3e2a1b7c9d10';

test('versions are pinned in one place, never @latest', () => {
  assert.equal(ds.PLAYWRIGHT_MCP, '@playwright/mcp@0.0.84');
  assert.equal(ds.CHROME_DEVTOOLS_MCP, 'chrome-devtools-mcp@1.12.0');
  for (const s of ds.buildDevtoolsSnippets({ wsEndpoint: WS })) assert.doesNotMatch(s.text, /@latest/, `${s.tool} ${s.client}`);
  assert.equal(ds.DOCS_URL, 'https://browser.softglaze.com/docs/ai-playwright-devtools');
});

test('the eight setups, exact text (usage statistics off by default)', () => {
  const list = ds.buildDevtoolsSnippets({ wsEndpoint: WS });
  assert.equal(list.length, 8);
  assert.deepEqual(list.map((s) => `${s.tool}/${s.client}/${s.kind}`), [
    'playwright/claude-code/command', 'playwright/claude-desktop/json', 'playwright/cursor/json', 'playwright/vscode/json',
    'chrome-devtools/claude-code/command', 'chrome-devtools/claude-desktop/json', 'chrome-devtools/cursor/json', 'chrome-devtools/vscode/json'
  ]);
  const by = Object.fromEntries(list.map((s) => [`${s.tool}/${s.client}`, s]));

  assert.equal(by['playwright/claude-code'].text,
    `claude mcp add playwright-softglaze -- npx -y @playwright/mcp@0.0.84 --cdp-endpoint ${WS}`);
  assert.equal(by['chrome-devtools/claude-code'].text,
    `claude mcp add chrome-devtools-softglaze -- npx -y chrome-devtools-mcp@1.12.0 --wsEndpoint=${WS} --no-usage-statistics`);

  const pwJson = [
    '{',
    '  "mcpServers": {',
    '    "playwright-softglaze": {',
    '      "command": "npx",',
    '      "args": [',
    '        "-y",',
    '        "@playwright/mcp@0.0.84",',
    '        "--cdp-endpoint",',
    `        "${WS}"`,
    '      ]',
    '    }',
    '  }',
    '}'
  ].join('\n');
  assert.equal(by['playwright/claude-desktop'].text, pwJson);
  assert.equal(by['playwright/cursor'].text, pwJson, 'Claude Desktop and Cursor share the mcpServers format');
  assert.equal(by['playwright/vscode'].text, [
    '{',
    '  "servers": {',
    '    "playwright-softglaze": {',
    '      "type": "stdio",',
    '      "command": "npx",',
    '      "args": [',
    '        "-y",',
    '        "@playwright/mcp@0.0.84",',
    '        "--cdp-endpoint",',
    `        "${WS}"`,
    '      ]',
    '    }',
    '  }',
    '}'
  ].join('\n'));

  const cdArgs = ['-y', 'chrome-devtools-mcp@1.12.0', `--wsEndpoint=${WS}`, '--no-usage-statistics'];
  assert.deepEqual(JSON.parse(by['chrome-devtools/claude-desktop'].text), { mcpServers: { 'chrome-devtools-softglaze': { command: 'npx', args: cdArgs } } });
  assert.equal(by['chrome-devtools/cursor'].text, by['chrome-devtools/claude-desktop'].text);
  assert.deepEqual(JSON.parse(by['chrome-devtools/vscode'].text), { servers: { 'chrome-devtools-softglaze': { type: 'stdio', command: 'npx', args: cdArgs } } });

  for (const s of list) {
    assert.equal(s.docsUrl, s.tool === 'playwright' ? 'https://github.com/microsoft/playwright-mcp' : 'https://github.com/ChromeDevTools/chrome-devtools-mcp');
    assert.deepEqual(Object.keys(s).sort(), ['client', 'docsUrl', 'kind', 'text', 'tool']);
  }
});

test('--no-usage-statistics follows the switch and only touches Chrome DevTools MCP', () => {
  const off = ds.buildDevtoolsSnippets({ wsEndpoint: WS, noUsageStats: true });
  const on = ds.buildDevtoolsSnippets({ wsEndpoint: WS, noUsageStats: false });
  for (let i = 0; i < 8; i++) {
    if (off[i].tool === 'playwright') {
      assert.equal(off[i].text, on[i].text, 'Playwright MCP has no such flag');
      assert.doesNotMatch(off[i].text, /usage-statistics/);
    } else {
      assert.match(off[i].text, /--no-usage-statistics/);
      assert.doesNotMatch(on[i].text, /usage-statistics/);
    }
  }
  assert.deepEqual(ds.buildDevtoolsSnippets({ wsEndpoint: WS }), off, 'off is the default');
});

test('browserUrlOf turns the ws address into http://127.0.0.1:<port> and refuses anything else', () => {
  assert.equal(ds.browserUrlOf(WS), 'http://127.0.0.1:53123');
  const bad = [
    'ws://192.168.1.20:53123/devtools/browser/x',
    'ws://localhost:53123/devtools/browser/x',
    'ws://127.0.0.1.attacker.example:53123/devtools/browser/x',
    'ws://[::1]:53123/devtools/browser/x',
    'ws://0.0.0.0:53123/devtools/browser/x',
    'wss://127.0.0.1:53123/devtools/browser/x',
    'http://127.0.0.1:53123',
    'ws://user:pw@127.0.0.1:53123/devtools/browser/x',
    'ws://127.0.0.1/devtools/browser/x',
    'not a url',
    '',
    null
  ];
  for (const b of bad) {
    assert.throws(() => ds.browserUrlOf(b), (e) => e.code === 'DEVTOOLS_ADDRESS' && !String(e.message).includes('53123'), String(b));
    assert.throws(() => ds.buildDevtoolsSnippets({ wsEndpoint: b }), (e) => e.code === 'DEVTOOLS_ADDRESS', `snippets for ${b}`);
  }
});
