// Native alert()/confirm()/prompt() can leave the window unable to take typing on
// Windows (see src/main/dialogFocus.js). Wrap the three so the main process
// re-focuses the window as soon as one returns. Kept framework-free (and .mjs) so
// the node:test suite can import it directly.

const DIALOGS = ['alert', 'confirm', 'prompt'];

export function installDialogFocusFix(target, refocus) {
  if (!target || typeof refocus !== 'function' || target.__sgDialogFocusFix) return false;
  for (const name of DIALOGS) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function dialogWithRefocus(...args) {
      try {
        return original.apply(target, args);
      } finally {
        // A failed refocus must never change what the dialog returned.
        try { refocus(); } catch (e) { /* ignore */ }
      }
    };
  }
  Object.defineProperty(target, '__sgDialogFocusFix', { value: true });
  return true;
}
