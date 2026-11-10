'use strict';
// Connect snippets for the AI page and the website guide, generated with the real port and a
// <YOUR_TOKEN> placeholder. Formats checked against each client's official docs on 7 Nov 2026:
//   Claude Code   code.claude.com/docs/en/mcp           claude mcp add --transport http ... --header
//   Claude Desktop (stdio only in claude_desktop_config.json; remote HTTP needs a bridge)
//   Cursor        cursor.com/docs/mcp                    ~/.cursor/mcp.json  mcpServers.url + headers
//   VS Code       code.visualstudio.com/docs/copilot/reference/mcp-configuration
//                                                        .vscode/mcp.json servers.type "http" + inputs
//   Gemini CLI    geminicli.com/docs/tools/mcp-server     ~/.gemini/settings.json mcpServers.httpUrl
//   Codex / ChatGPT desktop  learn.chatgpt.com/docs/extend/mcp  ~/.codex/config.toml (shared)
//   Windsurf      ~/.codeium/windsurf/mcp_config.json serverUrl + headers (Devin Desktop: url + transport)
//   Cline         docs.cline.bot/mcp/configuring-mcp-servers  type "streamableHttp"
//   n8n           docs.n8n.io MCP Client Tool node: "SSE Endpoint" + Bearer credential

const TOKEN = '<YOUR_TOKEN>';

// The SoftGlaze extension for Claude Desktop (asks for the token and the port when installed; also
// what Claude Desktop chats and Cowork use). Live since 9 Nov 2026: 69,312 bytes, SHA-256
// f9d4384c268054cbcda52516e3bc092a0e65cf5a9ac981d1ee8163d9097e974b (.sha256 next to it).
const MCPB_URL = 'https://browser.softglaze.com/downloads/softglaze-browser.mcpb';

function urls(port, host = '127.0.0.1') {
  const base = `http://${host}:${port}`;
  return { mcp: `${base}/mcp`, sse: `${base}/mcp/sse` };
}

const json = (v) => JSON.stringify(v, null, 2);

// bridge: { command, args, env } from bridgeInfo(), so the Claude Desktop config names real paths.
function buildSnippets({ port, bridge }) {
  const u = urls(port);
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const out = [];

  out.push({
    client: 'claude-code',
    title: 'Claude Code',
    kind: 'command',
    where: 'Without the plugins: run in a terminal. Add --scope user to use SoftGlaze in every project. Use the plugins or this command, not both.',
    text: `claude mcp add --transport http softglaze ${u.mcp} --header "Authorization: Bearer ${TOKEN}"`,
    docsUrl: 'https://code.claude.com/docs/en/mcp'
  });

  const desktopEnv = { ...(bridge && bridge.env ? bridge.env : {}), SOFTGLAZE_MCP_URL: u.mcp, SOFTGLAZE_TOKEN: TOKEN };
  out.push({
    client: 'claude-desktop',
    title: 'Claude Desktop',
    kind: 'json',
    where: `Settings > Developer > Edit Config (claude_desktop_config.json), then restart Claude Desktop. Claude Desktop runs local servers over stdio, so this starts the SoftGlaze bridge. Easier: install softglaze-browser.mcpb (${MCPB_URL}), which asks for your token and port and also serves Cowork.`,
    // The window shows `where` in its own language (ai.json connect.clients.<client>.where) and fills
    // these values in; `where` itself stays English for the website guide.
    whereVars: { mcpb: MCPB_URL },
    text: json({
      mcpServers: {
        softglaze: {
          command: bridge && bridge.command ? bridge.command : 'node',
          args: bridge && Array.isArray(bridge.args) ? bridge.args : ['softglaze-mcp-bridge.js'],
          env: desktopEnv
        }
      }
    }),
    docsUrl: 'https://claude.com/docs/connectors/building/mcpb'
  });

  out.push({
    client: 'cursor',
    title: 'Cursor',
    kind: 'json',
    where: '~/.cursor/mcp.json (all projects) or .cursor/mcp.json in a project. To keep the token out of the file use "Bearer ${env:SOFTGLAZE_TOKEN}".',
    text: json({ mcpServers: { softglaze: { url: u.mcp, headers: auth } } }),
    docsUrl: 'https://cursor.com/docs/mcp'
  });

  out.push({
    client: 'vscode',
    title: 'VS Code (GitHub Copilot)',
    kind: 'json',
    where: '.vscode/mcp.json in your workspace, or run "MCP: Open User Configuration". VS Code asks for the token once and stores it securely, so it never sits in the file.',
    text: json({
      inputs: [{ type: 'promptString', id: 'softglaze-token', description: 'SoftGlaze AI token', password: true }],
      servers: { softglaze: { type: 'http', url: u.mcp, headers: { Authorization: 'Bearer ${input:softglaze-token}' } } }
    }),
    docsUrl: 'https://code.visualstudio.com/docs/copilot/reference/mcp-configuration'
  });

  out.push({
    client: 'gemini-cli',
    title: 'Gemini CLI',
    kind: 'json',
    where: '~/.gemini/settings.json (merge into the file), or run: gemini mcp add --transport http -s user --header "Authorization: Bearer <YOUR_TOKEN>" softglaze ' + u.mcp,
    whereVars: { mcp: u.mcp },
    text: json({ mcpServers: { softglaze: { httpUrl: u.mcp, headers: auth } } }),
    docsUrl: 'https://geminicli.com/docs/tools/mcp-server/'
  });

  out.push({
    client: 'codex',
    title: 'ChatGPT desktop / Codex',
    kind: 'toml',
    where: '~/.codex/config.toml (shared by the ChatGPT desktop app, Codex CLI and the IDE extension). Set the environment variable SOFTGLAZE_TOKEN to your token first (Windows: setx SOFTGLAZE_TOKEN "<YOUR_TOKEN>"), then restart the app.',
    text: `[mcp_servers.softglaze]\nurl = "${u.mcp}"\nbearer_token_env_var = "SOFTGLAZE_TOKEN"\ntool_timeout_sec = 120\n`,
    docsUrl: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli'
  });

  out.push({
    client: 'windsurf',
    title: 'Windsurf',
    kind: 'json',
    where: '~/.codeium/windsurf/mcp_config.json, then refresh MCP servers. Devin Desktop (Windsurf\'s new name) uses ~/.config/devin/mcp_config.json with "url" and "transport": "http" instead of "serverUrl".',
    text: json({ mcpServers: { softglaze: { serverUrl: u.mcp, headers: auth } } }),
    docsUrl: 'https://docs.devin.ai/cli/extensibility/mcp/configuration'
  });

  out.push({
    client: 'cline',
    title: 'Cline',
    kind: 'json',
    where: 'Cline: MCP Servers > Configure (cline_mcp_settings.json).',
    text: json({ mcpServers: { softglaze: { type: 'streamableHttp', url: u.mcp, headers: auth, disabled: false, autoApprove: [] } } }),
    docsUrl: 'https://docs.cline.bot/mcp/configuring-mcp-servers'
  });

  out.push({
    client: 'n8n',
    title: 'n8n (MCP Client Tool)',
    kind: 'json',
    where: 'In the MCP Client Tool node: SSE Endpoint as below, Authentication "Bearer", and your token as the credential. If n8n runs in Docker Desktop, use host.docker.internal instead of 127.0.0.1 and add host.docker.internal to Extra allowed hosts in SoftGlaze AI settings. For unattended workflows use an automation token (pre-approved tools, limited to groups).',
    text: json({ sseEndpoint: u.sse, dockerSseEndpoint: urls(port, 'host.docker.internal').sse, authentication: 'Bearer', token: TOKEN }),
    docsUrl: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/'
  });

  out.push({
    client: 'generic',
    title: 'Other apps (generic HTTP MCP)',
    kind: 'json',
    where: 'Any MCP client that supports Streamable HTTP with headers. Clients that only speak the older HTTP+SSE transport use the SSE URL. Clients that only run local commands use the SoftGlaze bridge (see Claude Desktop).',
    text: json({ name: 'softglaze', transport: 'streamable-http', url: u.mcp, sseUrl: u.sse, headers: auth }),
    docsUrl: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports'
  });

  return out;
}

module.exports = { buildSnippets, urls, TOKEN, MCPB_URL };
