// Settings the app shows and saves but does not act on yet: nothing in main reads them when a
// profile launches or a member signs in. They are hidden for the 1 December 2026 launch so no one
// switches something that has no effect. The stored values, main's defaults and the components
// stay as they are; set SHOW_UNAPPLIED_SETTINGS to true to bring them all back, or take one out of
// its gate once main applies it. test/hiddenUnappliedSettings.test.js keeps them hidden until then.
export const SHOW_UNAPPLIED_SETTINGS = false;

// Settings page sections in which every control is unapplied (ids from buildSections):
// platform    = list icon and custom serial number display
// ipsetting   = IP auto-configuration priority and IP checker
// datasync    = Data Sync (cookies, passwords, bookmarks...)
// security    = remote-login and failed-login emails, login IP allowlist, two-step verification
// multidevice = Multi-Device Mode
export const UNAPPLIED_SECTIONS = Object.freeze(['platform', 'ipsetting', 'datasync', 'security', 'multidevice']);

// The section order the Settings page shows, nav and search included.
export function visibleSectionOrder(order, show = SHOW_UNAPPLIED_SETTINGS) {
  const list = Array.isArray(order) ? order : [];
  return show ? list.slice() : list.filter((id) => !UNAPPLIED_SECTIONS.includes(id));
}
