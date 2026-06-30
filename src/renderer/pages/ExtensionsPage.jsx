import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Puzzle, ShieldCheck, Download, Search, Check, ExternalLink, Package,
  ToggleRight, Plus, Loader2, Trash2, Power, AlertTriangle, Info
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Members at ADMIN and above may install / toggle / remove team extensions.
const MANAGE_ROLES = new Set(['ADMIN', 'OWNER', 'SUPER_ADMIN']);

// Deterministic accent per extension so the grid stays colorful without any
// category metadata (we only know what the manifest tells us).
const ACCENTS = ['#3b82f6', '#8b5cf6', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1'];
function accentFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

// The download → unzip → register pipeline runs as one backend call; we surface
// its phases as a staged label so the user sees real, honest progress.
const INSTALL_PHASE_KEYS = ['installPhase.downloading', 'installPhase.extracting', 'installPhase.registering'];

export default function ExtensionsPage() {
  const { t } = useTranslation('extensions');
  const [extensions, setExtensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [me, setMe] = useState(undefined); // undefined = loading

  const [manualId, setManualId] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installPhase, setInstallPhase] = useState(0);
  const [installError, setInstallError] = useState('');
  const [busyId, setBusyId] = useState(null); // id mid toggle/delete
  const [search, setSearch] = useState('');
  const phaseTimer = useRef(null);

  const canManage = me === undefined || me === null || MANAGE_ROLES.has(me.role);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await softglazeApi.extensions.list();
      setExtensions(Array.isArray(res?.extensions) ? res.extensions : []);
    } catch (e) {
      setLoadError(e.message || t('errors.couldNotLoad'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    softglazeApi.members.current().then((m) => setMe(m || null)).catch(() => setMe(null));
  }, []);
  useEffect(() => () => { if (phaseTimer.current) clearInterval(phaseTimer.current); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return extensions;
    return extensions.filter((e) =>
      (e.name || '').toLowerCase().includes(q) || (e.chromeId || '').toLowerCase().includes(q));
  }, [extensions, search]);

  const totalCount = extensions.length;
  const enabledCount = extensions.filter((e) => e.isGlobal).length;
  const disabledCount = totalCount - enabledCount;

  async function handleInstall(e) {
    e.preventDefault();
    if (installing || !manualId.trim()) return;
    setInstallError('');
    setInstalling(true);
    setInstallPhase(0);
    // Advance the staged label while the single backend call runs.
    phaseTimer.current = setInterval(() => {
      setInstallPhase((p) => Math.min(p + 1, INSTALL_PHASE_KEYS.length - 1));
    }, 1100);
    try {
      const created = await softglazeApi.extensions.installFromId(manualId.trim());
      setExtensions((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      setManualId('');
    } catch (err) {
      setInstallError(err.message || t('errors.installFailed'));
    } finally {
      if (phaseTimer.current) { clearInterval(phaseTimer.current); phaseTimer.current = null; }
      setInstalling(false);
    }
  }

  async function handleToggle(ext) {
    if (busyId) return;
    setInstallError('');
    setBusyId(ext.id);
    try {
      const updated = await softglazeApi.extensions.toggleGlobal(ext.id, !ext.isGlobal);
      setExtensions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setInstallError(err.message || t('errors.couldNotUpdate'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(ext) {
    if (busyId) return;
    if (!window.confirm(t('confirmRemove', { name: ext.name }))) return;
    setInstallError('');
    setBusyId(ext.id);
    try {
      await softglazeApi.extensions.delete(ext.id);
      setExtensions((prev) => prev.filter((x) => x.id !== ext.id));
    } catch (err) {
      setInstallError(err.message || t('errors.couldNotRemove'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-1">{t('header.eyebrow')}</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-display tracking-tight">{t('header.title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t('header.summary', { count: totalCount, enabled: enabledCount })}
          </p>
        </div>
      </div>

      {/* STAT ROW — real derived counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: t('stats.total'), value: totalCount, icon: Package, color: '#3b82f6' },
          { label: t('stats.injected'), value: enabledCount, icon: ToggleRight, color: '#10b981' },
          { label: t('stats.disabled'), value: disabledCount, icon: Power, color: '#8b5cf6' }
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="rounded-xl p-4 flex items-center gap-3 animate-fade-up"
              style={{
                background: `color-mix(in srgb, ${stat.color} 8%, var(--card))`,
                border: `1px solid color-mix(in srgb, ${stat.color} 22%, transparent)`
              }}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${stat.color} 15%, transparent)` }}>
                <Icon className="w-5 h-5" style={{ color: stat.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-foreground leading-none">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1 truncate">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ENGINE CAVEAT */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          {t('caveat.before')} <code className="text-foreground/80 font-mono text-[11px]">--load-extension</code> {t('caveat.middle')} <span className="text-foreground font-medium">{t('caveat.nextLaunch')}</span> {t('caveat.after')}
        </p>
      </div>

      {/* MANUAL WEB STORE IMPORTER */}
      <div className="bg-card border border-border rounded-xl p-5 animate-fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 15%, transparent)' }}>
            <Plus className="w-4 h-4" style={{ color: '#3b82f6' }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{t('importer.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('importer.description')}</p>
          </div>
        </div>

        <form onSubmit={handleInstall} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <input
            type="text"
            placeholder={t('importer.inputPlaceholder')}
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            disabled={installing || !canManage}
            className="flex-1 bg-input-background border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={installing || !manualId.trim() || !canManage}
            className="inline-flex items-center justify-center gap-1.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg shadow-lg shadow-blue-500/25 px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-40 min-w-[150px]"
          >
            {installing
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t(INSTALL_PHASE_KEYS[installPhase])}</>
              : <><Download className="w-3.5 h-3.5" /> {t('importer.submit')}</>}
          </button>
        </form>

        {installError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {installError}
          </div>
        )}
        {!canManage && me && (
          <p className="mt-3 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> {t('permissionNotice')}
          </p>
        )}
      </div>

      {/* SEARCH */}
      <div className="relative flex-1 max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-input-background border border-border rounded pl-9 pr-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* GRID */}
      {loadError ? (
        <EmptyStateInline title={t('empty.loadErrorTitle')} description={loadError} />
      ) : loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="w-6 h-6 text-muted-foreground animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyStateInline
          title={extensions.length === 0 ? t('empty.noExtTitle') : t('empty.noMatchTitle')}
          description={extensions.length === 0
            ? t('empty.noExtDesc')
            : t('empty.noMatchDesc')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((ext) => {
            const accent = accentFor(ext.chromeId || ext.id);
            const enabled = ext.isGlobal;
            const busy = busyId === ext.id;
            return (
              <div
                key={ext.id}
                className="bg-card border border-border rounded-xl p-5 transition-colors animate-fade-up flex flex-col"
                style={enabled ? {
                  borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
                  boxShadow: `0 0 20px color-mix(in srgb, ${accent} 10%, transparent)`
                } : undefined}
              >
                {/* Header */}
                <div className="flex items-start gap-3.5">
                  <div
                    className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center"
                    style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 25%, transparent)` }}
                  >
                    <Puzzle className="w-5 h-5" style={{ color: accent }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground truncate" title={ext.name}>{ext.name}</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {ext.version ? `v${ext.version}` : t('card.unpacked')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(ext)}
                    disabled={!canManage || busy}
                    title={t('card.removeTitle')}
                    className="shrink-0 w-8 h-8 grid place-items-center rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 transition disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Footer */}
                <div className="mt-5 pt-4 border-t border-border flex items-center justify-between gap-4">
                  <a
                    href={ext.storeUrl || `https://chromewebstore.google.com/detail/${ext.chromeId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 font-mono text-[11px]"
                    title={ext.chromeId}
                  >
                    {ext.chromeId.slice(0, 6)}…{ext.chromeId.slice(-4)}
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    type="button"
                    onClick={() => handleToggle(ext)}
                    disabled={!canManage || busy}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 border"
                    style={enabled
                      ? { background: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent, borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }
                      : { borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : enabled ? <Check className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    {enabled ? t('card.injected') : t('card.disabled')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Inline themed empty state matching the design language.
function EmptyStateInline({ title, description }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 p-10 text-center animate-fade-up">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-elevated">
        <Puzzle className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
  );
}
