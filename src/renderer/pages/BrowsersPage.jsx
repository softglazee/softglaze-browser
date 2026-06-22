import { useEffect, useState, useCallback, useRef } from 'react';
import { MonitorDown, Download, Check, Loader2, RefreshCcw, Cloud, Globe, Flame, HardDrive, Pause, Play, AlertTriangle } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

function MiniStat({ icon: Icon, label, value, color }) {
  return (
    <div className="rounded-xl p-4 relative overflow-hidden group animate-fade-up" style={{ background: `color-mix(in srgb, ${color} 8%, var(--card))`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
      <div className="absolute -top-5 -right-5 w-16 h-16 rounded-full opacity-10 group-hover:opacity-20 transition-opacity" style={{ background: color, filter: 'blur(18px)' }} />
      <div className="relative z-10 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)` }}>
          <Icon className="w-[18px] h-[18px]" style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[18px] font-bold text-foreground font-display leading-none">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}

// One downloadable/installed engine version row (shared by Chrome + Firefox).
function VersionRow({ label, versionText, installed, download, accent, onDownload, onPause, onResume }) {
  const d = download;
  const downloading = d && (d.state === 'downloading' || d.state === 'extracting' || d.state === 'installing' || d.state === 'queued');
  const paused = d && d.state === 'paused';
  const interrupted = d && d.state === 'interrupted';
  const failed = d && d.state === 'error';
  const canPause = d && (d.state === 'downloading' || d.state === 'queued');
  const stateLabel = d ? (d.state === 'extracting' || d.state === 'installing' ? 'Installing…' : d.state === 'queued' ? 'Queued…' : `${d.percent || 0}%`) : '';
  // Progress bar tint: amber while paused/interrupted, primary while active.
  const barColor = (paused || interrupted) ? '#f59e0b' : 'var(--primary)';
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-elevated border border-border">
      <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: installed ? 'color-mix(in srgb, #10b981 12%, transparent)' : `color-mix(in srgb, ${accent} 12%, transparent)`, border: `1px solid ${installed ? 'color-mix(in srgb, #10b981 22%, transparent)' : `color-mix(in srgb, ${accent} 22%, transparent)`}` }}>
        {installed ? <HardDrive className="w-[18px] h-[18px] text-emerald-400" /> : <Cloud className="w-[18px] h-[18px]" style={{ color: accent }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{label}</span>
          <span className="text-[11px] font-mono text-muted-foreground">{versionText}</span>
        </div>
        {(downloading || paused || interrupted) && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-card overflow-hidden max-w-[280px]">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${d.percent || 0}%`, background: barColor }} />
            </div>
            <span className="text-[11px] text-muted-foreground">
              {paused ? `Paused · ${d.percent || 0}%` : interrupted ? `Interrupted · ${d.percent || 0}%` : stateLabel}
            </span>
          </div>
        )}
        {failed && <p className="text-[11px] text-red-400 mt-1 truncate">{d.error}</p>}
      </div>
      {installed ? (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
          <Check className="w-3.5 h-3.5" /> Ready
        </span>
      ) : (paused || interrupted) ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border ${interrupted ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-secondary text-muted-foreground border-border'}`}>
            {interrupted ? <AlertTriangle className="w-3 h-3" /> : <Pause className="w-3 h-3" />} {interrupted ? 'Interrupted' : 'Paused'}
          </span>
          <button onClick={onResume} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 70%, #000))`, boxShadow: `0 8px 20px -8px ${accent}` }}>
            <Play className="w-3.5 h-3.5" /> Resume
          </button>
        </div>
      ) : downloading ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {d.state === 'extracting' || d.state === 'installing' ? 'Installing' : 'Downloading'}
          </span>
          {canPause && (
            <button onClick={onPause} title="Pause download" className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button onClick={onDownload} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white shrink-0 shadow-lg" style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 70%, #000))`, boxShadow: `0 8px 20px -8px ${accent}` }}>
          <Download className="w-3.5 h-3.5" /> {failed ? 'Retry' : 'Download'}
        </button>
      )}
    </div>
  );
}

export default function BrowsersPage() {
  const [items, setItems] = useState([]);          // Chrome versions
  const [ffItems, setFfItems] = useState([]);      // Firefox versions
  const [firefox, setFirefox] = useState(null);    // Firefox detection status { installed, path }
  const [loading, setLoading] = useState(true);
  const [ffLoading, setFfLoading] = useState(true);
  const [err, setErr] = useState('');
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [res, ff, ffList] = await Promise.all([
        softglazeApi.browsers.listAvailable(),
        softglazeApi.browsers.firefoxStatus().catch(() => ({ installed: false })),
        softglazeApi.browsers.firefoxList().catch(() => ({ items: [] }))
      ]);
      if (!mounted.current) return;
      setItems(Array.isArray(res?.items) ? res.items : []);
      setFirefox(ff);
      setFfItems(Array.isArray(ffList?.items) ? ffList.items : []);
    } catch (e) {
      setErr(e.message || 'Could not reach the browser catalog. Check your internet connection.');
    } finally {
      if (mounted.current) { setLoading(false); setFfLoading(false); }
    }
  }, []);

  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load]);

  // Live progress for BOTH engines; refresh counts the moment one finishes.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const [chromeRes, ffRes] = await Promise.all([
          softglazeApi.browsers.downloadStatus().catch(() => ({ downloads: [] })),
          softglazeApi.browsers.firefoxDownloadStatus().catch(() => ({ downloads: [] }))
        ]);
        let anyDone = false;

        const cList = chromeRes?.downloads || [];
        if (cList.length) {
          const byMajor = new Map(cList.map((d) => [d.major, d]));
          setItems((prev) => prev.map((it) => {
            const d = byMajor.get(it.major);
            if (!d) return it;
            if (d.state === 'done' && !it.installed) anyDone = true;
            return { ...it, download: d, installed: it.installed || d.state === 'done' };
          }));
        }

        const fList = ffRes?.downloads || [];
        if (fList.length) {
          const byMajor = new Map(fList.map((d) => [d.major, d]));
          setFfItems((prev) => prev.map((it) => {
            const d = byMajor.get(it.major);
            if (!d) return it;
            if (d.state === 'done' && !it.installed) anyDone = true;
            return { ...it, download: d, installed: it.installed || d.state === 'done' };
          }));
        }

        if (anyDone) load();
      } catch (e) { /* ignore poll errors */ }
    }, 1500);
    return () => clearInterval(id);
  }, [load]);

  async function startChromeDownload(version) {
    setErr('');
    setItems((prev) => prev.map((it) => (it.version === version ? { ...it, download: { state: 'queued', percent: 0 } } : it)));
    try { await softglazeApi.browsers.download(version); }
    catch (e) { setErr(e.message || 'Download failed.'); }
  }

  async function startFirefoxDownload(major) {
    setErr('');
    setFfItems((prev) => prev.map((it) => (it.major === major ? { ...it, download: { state: 'queued', percent: 0, major } } : it)));
    try { await softglazeApi.browsers.firefoxDownload(String(major)); }
    catch (e) { setErr(e.message || 'Download failed.'); }
  }

  async function pauseChrome(version) {
    setItems((prev) => prev.map((it) => (it.version === version ? { ...it, download: { ...(it.download || {}), state: 'paused' } } : it)));
    try { await softglazeApi.browsers.pauseDownload(version); } catch (e) { setErr(e.message || 'Pause failed.'); }
  }
  async function resumeChrome(version) {
    setErr('');
    setItems((prev) => prev.map((it) => (it.version === version ? { ...it, download: { ...(it.download || {}), state: 'queued' } } : it)));
    try { await softglazeApi.browsers.resumeDownload(version); } catch (e) { setErr(e.message || 'Resume failed.'); }
  }
  async function pauseFirefox(major) {
    setFfItems((prev) => prev.map((it) => (it.major === major ? { ...it, download: { ...(it.download || {}), state: 'paused' } } : it)));
    try { await softglazeApi.browsers.firefoxPauseDownload(String(major)); } catch (e) { setErr(e.message || 'Pause failed.'); }
  }
  async function resumeFirefox(major) {
    setErr('');
    setFfItems((prev) => prev.map((it) => (it.major === major ? { ...it, download: { ...(it.download || {}), state: 'queued' } } : it)));
    try { await softglazeApi.browsers.firefoxResumeDownload(String(major)); } catch (e) { setErr(e.message || 'Resume failed.'); }
  }

  const chromeInstalled = items.filter((i) => i.installed).length;
  const ffInstalled = ffItems.filter((i) => i.installed).length;
  const ffAvailable = ffItems.length - ffInstalled;
  // The system-detected Firefox counts as ready even if not a versioned install.
  const ffReady = ffInstalled + (firefox?.installed ? 1 : 0);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-1">Engines</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-display tracking-tight">Browsers</h1>
          <p className="text-xs text-muted-foreground mt-1">Download real Chrome &amp; Firefox builds on demand — installed automatically and ready to launch.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <RefreshCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MiniStat icon={Check} label="Chrome installed" value={chromeInstalled} color="#10b981" />
        <MiniStat icon={Cloud} label="Chrome available" value={Math.max(0, items.length - chromeInstalled)} color="#3b82f6" />
        <MiniStat icon={Flame} label="Firefox installed" value={ffReady} color="#f59e0b" />
        <MiniStat icon={Cloud} label="Firefox available" value={ffAvailable} color="#fb7185" />
      </div>

      {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{err}</div>}

      {/* FlowerBrowser (Firefox) section */}
      <div className="rounded-xl bg-card border border-border overflow-hidden animate-fade-up">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #f59e0b 14%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 24%, transparent)' }}>
            <Flame className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground">FlowerBrowser (Firefox engine)</h3>
              {firefox?.installed
                ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><Check className="w-3 h-3" /> Ready</span>
                : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Not detected</span>}
              <span className="text-[11px] text-muted-foreground">· {ffReady} installed · {ffAvailable} available</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {firefox?.installed
                ? `Ready. Detected at ${firefox.path}. Profiles set to FlowerBrowser launch real Firefox with proxy, UA, locale, timezone and WebRTC off.`
                : 'No system Firefox detected. Download a version below — it installs into the app and FlowerBrowser profiles will launch real Firefox with proxy, UA, locale, timezone and WebRTC off.'}
            </p>
          </div>
        </div>
        <div className="p-4 space-y-2 max-h-[44vh] overflow-y-auto">
          {ffLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              <span className="text-sm">Fetching the Firefox release catalog…</span>
            </div>
          ) : ffItems.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">No Firefox versions available (are you offline?).</div>
          ) : ffItems.map((it) => (
            <VersionRow
              key={it.major}
              label={`Firefox ${it.major}`}
              versionText={it.version}
              installed={it.installed}
              download={it.download}
              accent="#f59e0b"
              onDownload={() => startFirefoxDownload(it.major)}
              onPause={() => pauseFirefox(it.major)}
              onResume={() => resumeFirefox(it.major)}
            />
          ))}
        </div>
      </div>

      {/* SunBrowser (Chrome) section */}
      <div className="rounded-xl bg-card border border-border overflow-hidden animate-fade-up">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <div className="w-10 h-10 rounded-lg grid place-items-center" style={{ background: 'color-mix(in srgb, #3b82f6 12%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 22%, transparent)' }}>
            <Globe className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground">SunBrowser (Chrome for Testing)</h3>
              <span className="text-[11px] text-muted-foreground">· {chromeInstalled} installed · {Math.max(0, items.length - chromeInstalled)} available</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Real builds — UA, Client-Hints, TLS and workers all genuinely match the version.</p>
          </div>
        </div>
        <div className="p-4 space-y-2 max-h-[44vh] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-sm">Fetching the Chrome-for-Testing catalog…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">No versions available (are you offline?).</div>
          ) : items.map((it) => (
            <VersionRow
              key={it.version}
              label={`Chrome ${it.major}`}
              versionText={it.installedVersion || it.version}
              installed={it.installed}
              download={it.download}
              accent="#8b5cf6"
              onDownload={() => startChromeDownload(it.version)}
              onPause={() => pauseChrome(it.version)}
              onResume={() => resumeChrome(it.version)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
