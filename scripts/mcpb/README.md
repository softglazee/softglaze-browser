# SoftGlaze.mcpb (Claude Desktop extension)

Claude Desktop starts local MCP servers as commands (stdio). SoftGlaze's MCP server runs inside the
app over HTTP, so the extension ships the small stdio bridge
`src/main/ai/bridge/softglaze-mcp-bridge.js`. It has no dependencies; Claude Desktop runs it with
its own Node runtime.

The bridge was not packed in this change: packing needs the `@anthropic-ai/mcpb` CLI, which is not
installed on the build machine. Pack it on a machine that has Node 18+:

```bash
# from the repo root
rm -rf build/mcpb && mkdir -p build/mcpb/server
cp scripts/mcpb/manifest.json build/mcpb/manifest.json
cp src/main/ai/bridge/softglaze-mcp-bridge.js build/mcpb/server/softglaze-mcp-bridge.js
cp public/logos/app-source-512.png build/mcpb/icon.png        # optional; then add "icon": "icon.png" to the manifest
# set "version" in build/mcpb/manifest.json to the app version
npx @anthropic-ai/mcpb validate build/mcpb/manifest.json
npx @anthropic-ai/mcpb pack build/mcpb build/SoftGlaze.mcpb
```

Sign it if you sign other releases (`npx @anthropic-ai/mcpb sign`), then attach `SoftGlaze.mcpb` to
the release and link it from the website guide.

## Installing (for users)

1. In SoftGlaze Browser, open the SoftGlaze AI page, switch SoftGlaze AI on and create a token.
2. Double-click `SoftGlaze.mcpb` (or Claude Desktop: Settings > Extensions > Install extension).
3. Paste the token when Claude Desktop asks for it. Keep the address unless you changed the port.

## Without the extension

The AI page shows a `claude_desktop_config.json` snippet (ai:snippets, client `claude-desktop`) that
starts the same bridge with the SoftGlaze executable in Node mode, so no separate Node.js is needed:

```json
{
  "mcpServers": {
    "softglaze": {
      "command": "C:\\Program Files\\SoftGlaze Browser\\SoftGlaze Browser.exe",
      "args": ["C:\\Program Files\\SoftGlaze Browser\\resources\\app.asar.unpacked\\src\\main\\ai\\bridge\\softglaze-mcp-bridge.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "SOFTGLAZE_MCP_URL": "http://127.0.0.1:8080/mcp",
        "SOFTGLAZE_TOKEN": "<YOUR_TOKEN>"
      }
    }
  }
}
```

The real paths and port come from the app (`ai:bridge-info`). This relies on Electron's
`RunAsNode` fuse staying on; if the fuses are hardened later, point `command` at `node` instead.
