// User-facing language preference over i18n, mirroring lib/theme.js: persist the choice, set
// <html lang>, and switch i18next live so components re-render without a reload.
import i18n, { LANG_KEY, SUPPORTED_LANGS, readStoredLang } from '@/i18n/index.js';

export { SUPPORTED_LANGS };

export const getStoredLang = readStoredLang;

export function setLang(code) {
  const codes = SUPPORTED_LANGS.map((l) => l.code);
  const next = codes.includes(code) ? code : 'en';
  try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* ignore */ }
  try { document.documentElement.setAttribute('lang', next); } catch (e) { /* ignore */ }
  i18n.changeLanguage(next);
  return next;
}
