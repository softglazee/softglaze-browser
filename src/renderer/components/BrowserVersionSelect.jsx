import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download, Check, Loader2, Play } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import i18n from '@/i18n/index.js';
import cmpUiEn from '@/i18n/locales/en/cmpUi.json';
import cmpUiEs from '@/i18n/locales/es/cmpUi.json';

// Register the shared "cmpUi" namespace without touching the central i18n config.
// addResourceBundle is a no-op if the bundle already exists, so this is safe across
// hot reloads and the other components that register the same namespace.
if (!i18n.hasResourceBundle('en', 'cmpUi')) i18n.addResourceBundle('en', 'cmpUi', cmpUiEn);
if (!i18n.hasResourceBundle('es', 'cmpUi')) i18n.addResourceBundle('es', 'cmpUi', cmpUiEs);

// On-demand version picker: each version row carries its own download/install
// control. Installed versions show "Ready" (no download icon); missing ones show a
// download button that streams a progress bar inline and flips to "Ready" on finish.
// Works for both SunBrowser (Chrome-for-Testing) and FlowerBrowser (Firefox).
export default function BrowserVersionSelect({ core, value, onChange }) {
  const { t } = useTranslation('cmpUi');
  const isFirefox = core === 'FlowerBrowser';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const res = isFirefox
        ? await softglazeApi.browsers.firefoxList()
        : await softglazeApi.browsers.listAvailable();
      const list = Array.isArray(res?.items) ? res.items : [];
      const byMajor = new Map();
      for (const it of list) { if (!byMajor.has(it.major)) byMajor.set(it.major, it); }
      if (mounted.current) setItems(Array.from(byMajor.values()).sort((a, b) => b.major - a.major));
    } catch (e) {
      if (mounted.current) setErr(t('versionSelect.offlineError'));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [isFirefox, t]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  // Live progress while the popover is open.
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(async () => {
      try {
        const res = isFirefox
          ? await softglazeApi.browsers.firefoxDownloadStatus()
          : await softglazeApi.browsers.downloadStatus();
        const dl = res?.downloads || [];
        if (!dl.length) return;
        const byMajor = new Map(dl.map((d) => [d.major, d]));
        let anyDone = false;
        setItems((prev) => prev.map((it) => {
          const d = byMajor.get(it.major);
          if (!d) return it;
          if (d.state === 'done' && !it.installed) anyDone = true;
          return { ...it, download: d, installed: it.installed || d.state === 'done' };
        }));
        if (anyDone) load();
      } catch (e) { /* ignore poll errors */ }
    }, 1500);
    return () => clearInterval(id);
  }, [open, isFirefox, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function startDownload(it, e) {
    e.stopPropagation();
    setErr('');
    setItems((prev) => prev.map((x) => (x.major === it.major ? { ...x, download: { state: 'queued', percent: 0, major: it.major } } : x)));
    try {
      if (isFirefox) await softglazeApi.browsers.firefoxDownload(String(it.major));
      else await softglazeApi.browsers.download(String(it.version));
    } catch (err2) {
      setErr(err2.message || t('versionSelect.downloadFailed'));
    }
  }

  async function resumeDownload(it, e) {
    e.stopPropagation();
    setErr('');
    setItems((prev) => prev.map((x) => (x.major === it.major ? { ...x, download: { ...(x.download || {}), state: 'queued', major: it.major } } : x)));
    try {
      if (isFirefox) await softglazeApi.browsers.firefoxResumeDownload(String(it.major));
      else await softglazeApi.browsers.resumeDownload(String(it.version));
    } catch (err2) {
      setErr(err2.message || t('versionSelect.resumeFailed'));
    }
  }

  function pick(v, e) { if (e) e.stopPropagation(); onChange(String(v)); setOpen(false); }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="appearance-none bg-transparent outline-none text-muted hover:text-foreground pl-3 pr-2 py-2 text-sm cursor-pointer flex items-center gap-1"
      >
        {value || t('versionSelect.auto')}
        <ChevronDown className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 right-0 top-full mt-1.5 w-64 max-h-[19rem] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl py-1">
          <button
            type="button"
            onClick={(e) => pick('Auto', e)}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary transition-colors ${value === 'Auto' ? 'text-primary font-medium' : 'text-foreground'}`}
          >
            <span>{t('versionSelect.auto')}</span>
            {value === 'Auto' && <Check className="w-4 h-4" />}
          </button>

          {loading && (
            <div className="px-3 py-3 text-xs text-muted flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('versionSelect.loadingVersions')}
            </div>
          )}
          {err && <div className="px-3 py-2 text-xs text-red-400">{err}</div>}

          {items.map((it) => {
            const d = it.download;
            const busy = d && ['downloading', 'extracting', 'installing', 'queued'].includes(d.state);
            const halted = d && (d.state === 'paused' || d.state === 'interrupted');
            const failed = d && d.state === 'error';
            const label = `${isFirefox ? 'Firefox' : 'Chrome'} ${it.major}`;
            const selected = String(value) === String(it.major);
            return (
              <div
                key={it.major}
                onClick={(e) => pick(it.major, e)}
                className={`group flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary transition-colors ${selected ? 'text-primary font-medium' : 'text-foreground'}`}
              >
                <span className="flex-1 truncate">{label}</span>

                {it.installed ? (
                  <span title={t('versionSelect.readyTitle')} className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 shrink-0">
                    <Check className="w-3.5 h-3.5" /> {t('versionSelect.ready')}
                  </span>
                ) : halted ? (
                  <button
                    type="button"
                    title={t('versionSelect.resumeTitle', { state: d.state === 'paused' ? t('versionSelect.paused') : t('versionSelect.interrupted'), percent: d.percent || 0 })}
                    onClick={(e) => resumeDownload(it, e)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 hover:text-amber-300 shrink-0"
                  >
                    <Play className="w-3.5 h-3.5" /> {d.percent || 0}%
                  </button>
                ) : busy ? (
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    <span className="h-1.5 w-12 rounded-full bg-border overflow-hidden">
                      <span className="block h-full bg-primary transition-all duration-300" style={{ width: `${d.percent || 0}%` }} />
                    </span>
                    <span className="text-[10px] text-muted tabular-nums w-9 text-right">
                      {d.state === 'installing' || d.state === 'extracting' ? t('versionSelect.statusInstalling') : d.state === 'queued' ? t('versionSelect.statusQueued') : `${d.percent || 0}%`}
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    title={failed ? t('versionSelect.retryTitle', { error: d.error || t('versionSelect.downloadFailedShort') }) : t('versionSelect.downloadInstallTitle')}
                    onClick={(e) => startDownload(it, e)}
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors shrink-0 ${failed ? 'text-red-400 hover:bg-red-500/10' : 'text-muted hover:text-primary hover:bg-primary/10'}`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}

          {!loading && !items.length && !err && (
            <div className="px-3 py-3 text-xs text-muted">{t('versionSelect.noVersions')}</div>
          )}
        </div>
      )}
    </div>
  );
}
