import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Search, CornerDownLeft, LayoutDashboard, Fingerprint, Layers, Globe, Puzzle,
  FileSpreadsheet, Trash2, Settings, Users, MonitorDown, Wand2, UserCog
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import i18n from '@/i18n/index.js';
import cmpOverlaysEn from '@/i18n/locales/en/cmpOverlays.json';
import cmpOverlaysEs from '@/i18n/locales/es/cmpOverlays.json';

// Register the "cmpOverlays" namespace without touching the central i18n config.
// addResourceBundle is a no-op if the bundle already exists, so this is safe
// across hot reloads (and the OnboardingWizard performing the same registration).
if (!i18n.hasResourceBundle('en', 'cmpOverlays')) i18n.addResourceBundle('en', 'cmpOverlays', cmpOverlaysEn);
if (!i18n.hasResourceBundle('es', 'cmpOverlays')) i18n.addResourceBundle('es', 'cmpOverlays', cmpOverlaysEs);

// Global Ctrl/Cmd-K command palette. No new dependency — a window keydown listener,
// the existing router, and the existing list APIs. Jumps to any page and searches
// profiles / proxies / members. Mounted once in AppShell so it's available app-wide.
// `labelKey` is resolved to a translated display name at render time (module scope
// can't call the hook); the search filter matches on that translated label.
const NAV = [
  { path: '/dashboard', labelKey: 'palette.nav.dashboard', icon: LayoutDashboard },
  { path: '/profiles', labelKey: 'palette.nav.profiles', icon: Fingerprint },
  { path: '/groups', labelKey: 'palette.nav.groups', icon: Layers },
  { path: '/proxies', labelKey: 'palette.nav.proxies', icon: Globe },
  { path: '/browsers', labelKey: 'palette.nav.browsers', icon: MonitorDown },
  { path: '/extensions', labelKey: 'palette.nav.extensions', icon: Puzzle },
  { path: '/batch-import', labelKey: 'palette.nav.batchImport', icon: FileSpreadsheet },
  { path: '/trash', labelKey: 'palette.nav.trash', icon: Trash2 },
  { path: '/automation', labelKey: 'palette.nav.automation', icon: Wand2 },
  { path: '/members', labelKey: 'palette.nav.members', icon: Users },
  { path: '/account', labelKey: 'palette.nav.account', icon: UserCog },
  { path: '/settings', labelKey: 'palette.nav.settings', icon: Settings }
];

// The list APIs may return a bare array or a paginated envelope — normalize both.
function asArray(res) {
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object') return res.items || res.profiles || res.proxies || res.members || res.rows || res.data || [];
  return [];
}

export default function CommandPalette() {
  const { t } = useTranslation('cmpOverlays');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [data, setData] = useState({ profiles: [], proxies: [], members: [] });
  const inputRef = useRef(null);

  const close = useCallback(() => { setOpen(false); setQuery(''); setSel(0); }, []);

  // Toggle on Ctrl/Cmd-K from anywhere; Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Load searchable entities lazily, only while the palette is open.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0);
    (async () => {
      const [pf, px, mb] = await Promise.all([
        softglazeApi.profiles.list().catch(() => []),
        softglazeApi.proxies.list().catch(() => []),
        softglazeApi.members.list().catch(() => [])
      ]);
      if (!live) return;
      setData({ profiles: asArray(pf), proxies: asArray(px), members: asArray(mb) });
    })();
    return () => { live = false; };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    for (const n of NAV) {
      // Match the search filter against the TRANSLATED label so search still works
      // regardless of the active UI language.
      const label = t(n.labelKey);
      if (!q || label.toLowerCase().includes(q)) out.push({ icon: n.icon, label, hint: t('palette.hint.page'), run: () => navigate(n.path) });
    }
    if (q) {
      for (const p of data.profiles) {
        if (String(p.title || '').toLowerCase().includes(q)) out.push({ icon: Fingerprint, label: p.title || t('palette.fallback.profile', { id: p.id }), hint: t('palette.hint.profile'), run: () => navigate('/profiles') });
        if (out.length > 40) break;
      }
      for (const px of data.proxies) {
        const hay = `${px.name || ''} ${px.host || ''}`.toLowerCase();
        if (hay.includes(q)) out.push({ icon: Globe, label: px.name || px.host || t('palette.fallback.proxy', { id: px.id }), hint: t('palette.hint.proxy'), run: () => navigate('/proxies') });
        if (out.length > 60) break;
      }
      for (const m of data.members) {
        const hay = `${m.name || ''} ${m.email || ''}`.toLowerCase();
        if (hay.includes(q)) out.push({ icon: Users, label: m.name || m.email || t('palette.fallback.member', { id: m.id }), hint: t('palette.hint.member'), run: () => navigate('/members') });
        if (out.length > 80) break;
      }
    }
    return out;
  }, [query, data, navigate, t]);

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, results.length - 1))); }, [results.length]);

  if (!open) return null;

  const exec = (i) => { const r = results[i]; if (r) { r.run(); close(); } };

  const onListKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); exec(sel); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" onMouseDown={close}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label={t('palette.dialogLabel')} className="relative w-full max-w-[560px] rounded-xl bg-card border border-border shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSel(0); }}
            onKeyDown={onListKey}
            placeholder={t('palette.searchPlaceholder')}
            aria-label={t('palette.searchAriaLabel')}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="cmdk-results"
            aria-activedescendant={results[sel] ? `cmdk-opt-${sel}` : undefined}
            className="flex-1 bg-transparent text-[13.5px] text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="text-[10px] font-semibold text-muted-foreground border border-border rounded px-1.5 py-0.5">{t('palette.esc')}</kbd>
        </div>
        <div id="cmdk-results" role="listbox" aria-label={t('palette.resultsLabel')} className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">{t('palette.noMatches')}</div>
          )}
          {results.map((r, i) => {
            const Icon = r.icon;
            return (
              <button
                key={`${r.hint}-${r.label}-${i}`}
                id={`cmdk-opt-${i}`}
                role="option"
                aria-selected={i === sel}
                onMouseEnter={() => setSel(i)}
                onClick={() => exec(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] ${i === sel ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{r.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.hint}</span>
                {i === sel && <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
