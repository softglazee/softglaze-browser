'use strict';
// Enforces the "Disable browser developer tools" and "Disable installing/removing
// extensions" settings on a launched Chromium profile.
//
// These used to be written as a managed_policies.json inside the profile folder, which
// Chromium never reads: on Windows it takes policy only from the registry
// (HKLM/HKCU\Software\Policies\...), and writing there would also lock the user's own
// personal Chrome. So the settings did nothing. Instead, this watches the profile's
// targets over the browser-level DevTools connection the app already holds and closes:
//   - any DevTools window or docked panel (devtools:// targets) when DevTools is disabled
//     (F12, Ctrl+Shift+I, "Inspect", chrome://inspect all open one);
//   - the Extensions page and the Chrome Web Store when extensions are locked, so the
//     profile's extensions (including the fingerprint "Core" extension) cannot be
//     removed, disabled or added from the UI.
// Only the browser-level Target domain is used (no Runtime on any page), so it adds no
// page-observable CDP footprint.

const DEVTOOLS_URL = /^devtools:\/\//i;
const EXTENSIONS_URL = /^chrome:\/\/(extensions|extensions-frame)(?=[/?#]|$)/i;
const WEB_STORE_URL = /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(?=[/?#]|$)/i;

// Which lock (if any) a target's URL falls under, given the settings.
function lockedReason(url, opts = {}) {
  const u = String(url || '');
  if (!u) return null;
  if (opts.disableDevtools && DEVTOOLS_URL.test(u)) return 'devtools';
  if (opts.lockExtensions && (EXTENSIONS_URL.test(u) || WEB_STORE_URL.test(u))) return 'extensions';
  return null;
}

// Attach the watcher. `cdp` is a browser-level CDP session (browser.target()
// .createCDPSession()); passed in so the logic can be tested without a browser.
// Returns null when neither lock is on, else { detach }.
async function attachBrowserLocksToSession(cdp, opts = {}, log = () => {}) {
  if (!cdp || (!opts.disableDevtools && !opts.lockExtensions)) return null;
  const busy = new Set();
  const enforce = async (info) => {
    if (!info || !info.targetId || busy.has(info.targetId)) return;
    const reason = lockedReason(info.url, opts);
    if (!reason) return;
    busy.add(info.targetId);
    try {
      if (reason === 'extensions' && info.type === 'page') {
        // Closing the last tab would close the whole window (and end the session), so
        // leave the user a blank tab first when this is the only page.
        const { targetInfos = [] } = await cdp.send('Target.getTargets').catch(() => ({}));
        const others = targetInfos.filter((t) => t.type === 'page' && t.targetId !== info.targetId && !DEVTOOLS_URL.test(t.url || ''));
        if (!others.length) await cdp.send('Target.createTarget', { url: 'about:blank' }).catch(() => {});
      }
      await cdp.send('Target.closeTarget', { targetId: info.targetId });
      log(`[SG][locks] closed ${reason} target`);
    } catch (e) {
      // Already gone (the user closed it, or the browser is shutting down).
    } finally {
      busy.delete(info.targetId);
    }
  };
  const onCreated = (e) => { enforce(e && e.targetInfo); };
  const onChanged = (e) => { enforce(e && e.targetInfo); };
  cdp.on('Target.targetCreated', onCreated);
  cdp.on('Target.targetInfoChanged', onChanged);
  // Discovery replays every existing target as targetCreated, so anything opened
  // before the watcher attached is handled too.
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  return {
    detach() {
      try { cdp.off('Target.targetCreated', onCreated); } catch (e) { /* ignore */ }
      try { cdp.off('Target.targetInfoChanged', onChanged); } catch (e) { /* ignore */ }
      try { cdp.detach(); } catch (e) { /* ignore */ }
    }
  };
}

// Convenience for a puppeteer Browser. Never throws: a lock that cannot attach must
// not fail the launch, but it is logged so it is visible.
async function attachBrowserLocks(browser, opts = {}, log = console.warn) {
  if (!browser || (!opts.disableDevtools && !opts.lockExtensions)) return null;
  try {
    const cdp = await browser.target().createCDPSession();
    return await attachBrowserLocksToSession(cdp, opts, () => {});
  } catch (e) {
    log('[SG][locks] could not enforce the DevTools/extension lock:', (e && e.message) || e);
    return null;
  }
}

module.exports = { lockedReason, attachBrowserLocksToSession, attachBrowserLocks };
