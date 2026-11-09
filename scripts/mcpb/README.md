# Claude Desktop extension (softglaze-browser.mcpb)

The SoftGlaze extension for Claude Desktop is not built from this repo. It is built separately and
published at
https://browser.softglaze.com/downloads/softglaze-browser.mcpb. The app links to that address
(`MCPB_URL` in `src/main/ai/snippets.js`, shown on the AI page's Connect tab).

Nothing here is packed, and no build script, `package.json` script or test reads this folder.
`manifest.json` is kept only as a reference for what the extension asks for (token and address).

Without the extension, the AI page's Claude Desktop setup gives a `claude_desktop_config.json`
entry that runs the stdio bridge in this repo, `src/main/ai/bridge/softglaze-mcp-bridge.js`.
