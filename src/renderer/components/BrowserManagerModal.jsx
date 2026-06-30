import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Download, Check, Loader2, RefreshCcw, MonitorDown, Cloud, Play } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import { softglazeApi } from '@/lib/softglazeApi.js';

// On-demand browser manager: lists every Chrome-for-Testing build,
// shows installed vs downloadable, and downloads+installs on demand with progress.
export default function BrowserManagerModal({ onClose, onInstalled }) {
  const { dialogRef } = useDialog({ onClose });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await softglazeApi.browsers.listAvailable();
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setErr(e.message || 'Could not reach the browser catalog. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll download progress while the modal is open.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await softglazeApi.browsers.downloadStatus();
        const list = res?.downloads || [];
        if (!list.length) return;
        const byMajor = new Map(list.map((d) => [d.major, d]));
        let anyDone = false;
        setItems((prev) => prev.map((it) => {
          const d = byMajor.get(it.major);
          if (!d) return it;
          if (d.state === 'done') anyDone = true;
          return { ...it, download: d, installed: it.installed || d.state === 'done' };
        }));
        if (anyDone) { load(); if (onInstalledRef.current) onInstalledRef.current(); }
      } catch (e) { /* ignore */ }
    }, 1500);
    return () => clearInterval(id);
  }, [load]);

  async function startDownload(version) {
    setErr('');
    setItems((prev) => prev.map((it) => (it.version === version ? { ...it, download: { state: 'queued', percent: 0 } } : it)));
    try { await softglazeApi.browsers.download(version); }
    catch (e) { setErr(e.message || 'Download failed.'); }
  }

  async function resumeDownload(version) {
    setErr('');
    setItems((prev) => prev.map((it) => (it.version === version ? { ...it, download: { ...(it.download || {}), state: 'queued' } } : it)));
    try { await softglazeApi.browsers.resumeDownload(version); }
    catch (e) { setErr(e.message || 'Resume failed.'); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Browser manager" tabIndex={-1} className="w-[620px] max-w-full max-h-[82vh] flex flex-col bg-popover border border-border rounded-xl shadow-2xl shadow-black/50 animate-scale-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}>
              <MonitorDown className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="font-display text-[15px] font-semibold text-foreground">Browser manager</h2>
              <p className="text-xs text-muted-foreground">Download real Chrome builds on demand — installed automatically.</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={load} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title="Refresh"><RefreshCcw className="w-4 h-4" /></button>
            <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {err && <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{err}</div>}

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-sm">Fetching the Chrome-for-Testing catalog…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">No versions available (are you offline?).</div>
          ) : items.map((it) => {
            const d = it.download;
            const downloading = d && (d.state === 'downloading' || d.state === 'extracting' || d.state === 'queued');
            const halted = d && (d.state === 'paused' || d.state === 'interrupted');
            return (
              <div key={it.version} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-card border border-border">
                <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #8b5cf6 12%, transparent)', border: '1px solid color-mix(in srgb, #8b5cf6 22%, transparent)' }}>
                  <Cloud className="w-[18px] h-[18px] text-purple-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Chrome {it.major}</span>
                    <span className="text-[11px] font-mono text-muted-foreground">{it.installedVersion || it.version}</span>
                  </div>
                  {(downloading || halted) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden max-w-[260px]">
                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${d.percent || 0}%`, background: halted ? '#f59e0b' : 'var(--primary)' }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{halted ? `${d.state === 'paused' ? 'Paused' : 'Interrupted'} · ${d.percent || 0}%` : d.state === 'extracting' ? 'Installing…' : d.state === 'queued' ? 'Queued…' : `${d.percent || 0}%`}</span>
                    </div>
                  )}
                  {d && d.state === 'error' && <p className="text-[11px] text-red-400 mt-1 truncate">{d.error}</p>}
                </div>
                {it.installed ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                    <Check className="w-3.5 h-3.5" /> Installed
                  </span>
                ) : halted ? (
                  <button onClick={() => resumeDownload(it.version)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/25 shrink-0">
                    <Play className="w-3.5 h-3.5" /> Resume
                  </button>
                ) : downloading ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground shrink-0">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {d.state === 'extracting' ? 'Installing' : 'Downloading'}
                  </span>
                ) : (
                  <button onClick={() => startDownload(it.version)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/25 shrink-0">
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
