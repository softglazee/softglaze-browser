// Chromium-family brand identity picker + reusable brand marks.
//
// Edge / Brave / Opera / Vivaldi / Yandex all run Softglaze's real Chrome engine;
// this control only chooses the *presented identity* (UA token, Sec-CH-UA brands,
// navigator globals). It's shown only when the core is SunBrowser (Chrome).
//
// The marks below are ORIGINAL stylized glyphs (currentColor), NOT the vendors'
// trademarked logos — same trademark-safe approach as the proxy provider marks.

import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/index.js';
import cmpUiEn from '@/i18n/locales/en/cmpUi.json';
import cmpUiEs from '@/i18n/locales/es/cmpUi.json';

// Register the shared "cmpUi" namespace without touching the central i18n config.
// addResourceBundle is a no-op if the bundle already exists, so this is safe across
// hot reloads and the other components that register the same namespace.
if (!i18n.hasResourceBundle('en', 'cmpUi')) i18n.addResourceBundle('en', 'cmpUi', cmpUiEn);
if (!i18n.hasResourceBundle('es', 'cmpUi')) i18n.addResourceBundle('es', 'cmpUi', cmpUiEs);

export const BROWSER_BRANDS = [
  { id: 'Chrome', label: 'Chrome', accent: '#4285F4' },
  { id: 'Edge', label: 'Edge', accent: '#0F8AE0' },
  { id: 'Brave', label: 'Brave', accent: '#FB542B' },
  { id: 'Opera', label: 'Opera', accent: '#FF1B2D' },
  { id: 'Vivaldi', label: 'Vivaldi', accent: '#EF3939' },
  { id: 'Yandex', label: 'Yandex', accent: '#FF3333' }
];

export function normalizeBrandId(brand) {
  const t = String(brand || '').toLowerCase();
  if (t.includes('edge')) return 'Edge';
  if (t.includes('brave')) return 'Brave';
  if (t.includes('opera') || t === 'opr') return 'Opera';
  if (t.includes('vivaldi')) return 'Vivaldi';
  if (t.includes('yandex') || t.includes('yabrowser')) return 'Yandex';
  return 'Chrome';
}

// Original, trademark-free geometric marks. fill/stroke inherit currentColor.
export function BrandMark({ id, className = 'w-4 h-4' }) {
  const k = normalizeBrandId(id);
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (k) {
    case 'Edge': // a forward swoosh
      return (<svg {...common}><path d="M4 14c1.5-6 7-9 11-7 3 1.4 4 4 3.4 6.2" /><path d="M19 13c.8 3-1.6 6-5.5 6-3.2 0-6-2.2-6.5-5" /></svg>);
    case 'Brave': // a shield
      return (<svg {...common}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9.5 11l2.5 3 2.5-3" /></svg>);
    case 'Opera': // a bold ring
      return (<svg {...common}><ellipse cx="12" cy="12" rx="6.5" ry="8" /></svg>);
    case 'Vivaldi': // three diagonal bars
      return (<svg {...common}><path d="M6 18L12 6" /><path d="M11 18L17 6" /><circle cx="12" cy="12" r="9" /></svg>);
    case 'Yandex': // rounded square with a slash
      return (<svg {...common}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M14 8l-4 8" /><path d="M14 8v8" /></svg>);
    case 'Chrome':
    default: // ring + inner dot
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /></svg>);
  }
}

export default function BrowserBrandSelect({ value, onChange }) {
  const { t } = useTranslation('cmpUi');
  const current = normalizeBrandId(value);
  return (
    <div className="flex flex-wrap gap-2">
      {BROWSER_BRANDS.map((b) => {
        const active = current === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            title={t('brandSelect.presentAs', { brand: b.label })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition ${active ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-muted hover:border-muted hover:text-foreground'}`}
          >
            <span style={{ color: b.accent }}><BrandMark id={b.id} className="w-4 h-4" /></span>
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
