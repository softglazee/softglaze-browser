// Light/dark theme: persisted in localStorage and applied as a class on <html>.
// The index.css token variables switch on .light / .dark, so toggling the class
// re-themes the whole app instantly. Defaults to dark (the SoftGlaze look).
const KEY = 'softglaze-theme';

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'dark';
  } catch (e) {
    return 'dark';
  }
}

export function applyTheme(theme) {
  const el = document.documentElement;
  el.classList.remove('light', 'dark');
  el.classList.add(theme === 'light' ? 'light' : 'dark');
}

export function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
  applyTheme(next);
  return next;
}

export function toggleTheme() {
  return setTheme(getStoredTheme() === 'dark' ? 'light' : 'dark');
}

// Called once before React renders to avoid a flash of the wrong theme.
export function initTheme() {
  applyTheme(getStoredTheme());
}
