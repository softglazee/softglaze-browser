// User-facing language preference over i18n, mirroring lib/theme.js: persist the choice, set
// <html lang dir>, and switch i18next live so components re-render without a reload. The new
// language loads in the background; the UI keeps the old one until it is ready.
import { LANG_KEY, SUPPORTED_LANGS, readStoredLang, switchLanguage } from '@/i18n/index.js';
import { filterLangs, isRtl, langOptionLabel } from '@/i18n/langs.mjs';

export { SUPPORTED_LANGS, filterLangs, isRtl, langOptionLabel };

export const getStoredLang = readStoredLang;

export function setLang(code) {
  const codes = SUPPORTED_LANGS.map((l) => l.code);
  const next = codes.includes(code) ? code : 'en';
  try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* ignore */ }
  switchLanguage(next);
  return next;
}
