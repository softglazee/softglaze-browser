// Urdu script font choice: the system font stack (default) or Nastaliq, the style most Urdu readers
// expect. Nastaliq ships with the app (Noto Nastaliq Urdu, SIL OFL 1.1, from the notofonts/nastaliq
// v4.000 release; licence in assets/fonts/noto-nastaliq-urdu/OFL.txt). Only the file's URL is in the
// bundle: the font itself (about 160 KB) is fetched from disk the first time Urdu + Nastaliq is
// active, so other languages never load it. index.css switches the font stack and the taller line
// height on <html data-urdu-font="nastaliq">, which is set only while the UI language is Urdu.
import nastaliqUrl from '@/assets/fonts/noto-nastaliq-urdu/NotoNastaliqUrdu-wght.woff2?url';

export const URDU_FONT_KEY = 'softglaze-urdu-font';
export const URDU_FONTS = ['default', 'nastaliq'];
export const NASTALIQ_FAMILY = 'SoftGlaze Nastaliq';

export function getStoredUrduFont() {
  try {
    const v = localStorage.getItem(URDU_FONT_KEY);
    return URDU_FONTS.includes(v) ? v : 'default';
  } catch (e) {
    return 'default';
  }
}

let fontPromise = null;

// Registers and loads the bundled face once. Never rejects: on failure the stack falls back to the
// installed Nastaliq fonts, then the system font.
export function loadNastaliq(doc = globalThis.document) {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    try {
      if (!doc || !doc.fonts || typeof FontFace === 'undefined') return false;
      const face = new FontFace(NASTALIQ_FAMILY, `url(${nastaliqUrl}) format('woff2')`, { weight: '400 700', style: 'normal', display: 'swap' });
      doc.fonts.add(face);
      await face.load();
      return true;
    } catch (e) {
      console.warn('[i18n] Nastaliq font failed to load', e);
      return false;
    }
  })();
  return fontPromise;
}

// Sets or clears <html data-urdu-font> for the given UI language and the saved choice.
export function applyUrduFont(lang, choice = getStoredUrduFont(), doc = globalThis.document) {
  try {
    const el = doc.documentElement;
    if (lang === 'ur' && choice === 'nastaliq') {
      loadNastaliq(doc);
      el.setAttribute('data-urdu-font', 'nastaliq');
    } else {
      el.removeAttribute('data-urdu-font');
    }
  } catch (e) { /* no DOM */ }
}

export function setUrduFont(choice, lang) {
  const next = URDU_FONTS.includes(choice) ? choice : 'default';
  try { localStorage.setItem(URDU_FONT_KEY, next); } catch (e) { /* ignore */ }
  applyUrduFont(lang, next);
  return next;
}
