# SoftGlaze Smart Autofill — Firefox extension

Brings the Identity-Data-Vault autofill widget (already working in Chromium) to
Firefox profiles. Firefox is launched raw (no CDP / no `exposeFunction`), so it
needs a real WebExtension to inject the widget plus a loopback bridge back to the
persona vault.

## How it fits together

```
page  ──(Shadow-DOM widget)──►  sg-bridge.js  ──runtime.sendMessage──►  sg-background.js
                                (content script)                         (probes 127.0.0.1:47800-47809)
                                                                                  │  fetch + X-SG-Autofill-Token
                                                                                  ▼
                                                          SoftGlaze app — src/main/autofillBridge.js
                                                          GET /sg-autofill/list?url= · POST /sg-autofill/mark-used
                                                          (→ getAvailablePersonasForUrl / markPersonaUsed)
```

- `sg-widget.js` is **generated** from `src/main/personaAutofill.js` — the same
  bootstrap Chromium injects. Run `npm run build:firefox-ext` after changing the
  widget; the output is committed so the dev-launch path works without a build.
- `sg-bridge.js` provides `window.__sgPersonaList` / `__sgPersonaMarkUsed` (the
  surface the widget expects). No `__sgPersonaFillPlan` → the widget uses its
  in-page synthetic-typing fallback (Firefox has no CDP "trusted" typing).

## Loading it into Firefox

- **Developer Edition / Nightly / ESR-unbranded:** SoftGlaze drops this folder
  **unpacked** into `<profile>/extensions/autofill@softglaze.app/` and sets
  `xpinstall.signatures.required=false`, so it loads unsigned. Use this for testing.
- **Release / Beta Firefox:** signing is **mandatory** and the pref is locked, so
  an unsigned build will NOT load. Ship the Mozilla-signed `.xpi` (below).

## Signing for release (one-time, requires your Mozilla account)

Release Firefox only loads extensions signed by Mozilla. You can get a signed
`.xpi` WITHOUT a public listing via AMO "unlisted":

1. Create an AMO API credential at https://addons.mozilla.org/developers/addon/api/key/
2. Export the key/secret and run:

   ```bash
   export WEB_EXT_API_KEY=user:xxxxx:xxx
   export WEB_EXT_API_SECRET=xxxxxxxxxxxxxxxx
   npm run sign:firefox-ext
   ```

   This regenerates `sg-widget.js`, submits the extension to AMO unlisted, and
   drops the signed `autofill@softglaze.app.xpi` into `build/firefox-ext/`.
3. The packaging `afterPack` hook copies that signed `.xpi` into the installer's
   `resources/firefox-extension/`. SoftGlaze then installs it into release-Firefox
   profiles at launch.

> The signed `.xpi` lives under the gitignored `build/` dir — it is a build
> artifact and is never committed.

## Security / threat model of the bridge

The bridge binds **127.0.0.1 only** and sends **no CORS headers**, so a visited
web page cannot read it cross-origin. The `X-SG-Autofill-Token` is random per
app run: the app writes it to Firefox managed storage for this extension id at
every launch (`storage` permission, read with `browser.storage.managed`), and the
bridge only listens while a Firefox autofill session runs. The origin a call is
scoped to comes from `sender.url` in the background script, never from the
content script. Any change to these files needs a fresh Mozilla signature.
See `src/main/autofillBridge.js`.
