'use strict';
// Setups for the AI page's "Use a profile with Playwright MCP or Chrome DevTools MCP (advanced)"
// card (Owner only, src/main/ai/ipc.js). Pure: the running profile's DevTools address in, the eight
// snippets (two MCP servers x four AI apps) out. Nothing here logs or stores the address.
//
// Versions are pinned here and only here (npm `latest` on 9 Nov 2026; bump deliberately):
//   @playwright/mcp      0.0.84   github.com/microsoft/playwright-mcp (README, v0.0.84)
//                                 --cdp-endpoint <endpoint>   "CDP endpoint to connect to" (ws:// or http://)
//   chrome-devtools-mcp  1.12.0   github.com/ChromeDevTools/chrome-devtools-mcp (docs/configuration.md)
//                                 --wsEndpoint=<ws url>       running Chrome over its WebSocket address
//                                 --browser-url=<http url>    the same browser by host and port
//                                 --no-usage-statistics       turns off the usage statistics sent to Google
// Client formats:
//   Claude Code     code.claude.com/docs/en/mcp: claude mcp add [options] <name> -- <command> [args...]
//   Claude Desktop  claude_desktop_config.json  {"mcpServers": {name: {command, args}}}
//   Cursor          ~/.cursor/mcp.json          {"mcpServers": {name: {command, args}}}
//   VS Code         .vscode/mcp.json            {"servers": {name: {type: "stdio", command, args}}}

const PLAYWRIGHT_MCP = '@playwright/mcp@0.0.84';
const CHROME_DEVTOOLS_MCP = 'chrome-devtools-mcp@1.12.0';

const DOCS_URL = 'https://browser.softglaze.com/docs/ai-playwright-devtools';

const TOOLS = Object.freeze({
  playwright: Object.freeze({
    label: 'Playwright MCP',
    serverName: 'playwright-softglaze',
    docsUrl: 'https://github.com/microsoft/playwright-mcp'
  }),
  'chrome-devtools': Object.freeze({
    label: 'Chrome DevTools MCP',
    serverName: 'chrome-devtools-softglaze',
    docsUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp'
  })
});
const TOOL_KEYS = Object.freeze(Object.keys(TOOLS));
const CLIENT_KEYS = Object.freeze(['claude-code', 'claude-desktop', 'cursor', 'vscode']);

const LOOPBACK = '127.0.0.1';

function refuse(message) {
  const e = new Error(message);
  e.code = 'DEVTOOLS_ADDRESS';
  return e;
}

// The profile's address must be a ws:// URL on 127.0.0.1 with a port. The error never repeats the
// address, so it can reach a log safely.
function parseEndpoint(wsEndpoint) {
  let u;
  try { u = new URL(String(wsEndpoint || '')); } catch (e) { throw refuse('The DevTools address is not a valid ws:// address.'); }
  if (u.protocol !== 'ws:') throw refuse('The DevTools address is not a ws:// address.');
  if (u.hostname !== LOOPBACK) throw refuse('The DevTools address is not on this computer (127.0.0.1), so SoftGlaze does not hand it out.');
  if (!u.port) throw refuse('The DevTools address has no port.');
  if (u.username || u.password) throw refuse('The DevTools address must not carry credentials.');
  return u;
}

// ws://127.0.0.1:P/devtools/browser/ID -> http://127.0.0.1:P (for --browser-url).
function browserUrlOf(wsEndpoint) {
  const u = parseEndpoint(wsEndpoint);
  return `http://${LOOPBACK}:${u.port}`;
}

// The npx arguments that start each MCP server attached to the profile.
function serverArgs(tool, wsEndpoint, noUsageStats) {
  if (tool === 'playwright') return ['-y', PLAYWRIGHT_MCP, '--cdp-endpoint', wsEndpoint];
  const args = ['-y', CHROME_DEVTOOLS_MCP, `--wsEndpoint=${wsEndpoint}`];
  if (noUsageStats) args.push('--no-usage-statistics');
  return args;
}

const json = (v) => JSON.stringify(v, null, 2);

function snippetText(tool, client, args) {
  const name = TOOLS[tool].serverName;
  if (client === 'claude-code') return `claude mcp add ${name} -- npx ${args.join(' ')}`;
  if (client === 'vscode') return json({ servers: { [name]: { type: 'stdio', command: 'npx', args } } });
  return json({ mcpServers: { [name]: { command: 'npx', args } } }); // Claude Desktop, Cursor
}

// { wsEndpoint, noUsageStats = true } -> [{ tool, client, kind, text, docsUrl }] x 8, Playwright first.
function buildDevtoolsSnippets({ wsEndpoint, noUsageStats = true } = {}) {
  const ws = parseEndpoint(wsEndpoint).toString();
  const out = [];
  for (const tool of TOOL_KEYS) {
    const args = serverArgs(tool, ws, noUsageStats !== false);
    for (const client of CLIENT_KEYS) {
      out.push({
        tool,
        client,
        kind: client === 'claude-code' ? 'command' : 'json',
        text: snippetText(tool, client, args),
        docsUrl: TOOLS[tool].docsUrl
      });
    }
  }
  return out;
}

const toolLabel = (tool) => (TOOLS[tool] ? TOOLS[tool].label : TOOLS.playwright.label);

module.exports = {
  PLAYWRIGHT_MCP,
  CHROME_DEVTOOLS_MCP,
  DOCS_URL,
  TOOLS,
  TOOL_KEYS,
  CLIENT_KEYS,
  buildDevtoolsSnippets,
  browserUrlOf,
  toolLabel
};
