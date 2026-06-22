import { useEffect, useRef, useState } from 'react';
import { FolderSync, ShieldCheck, AlertTriangle, KeyRound, Terminal, CheckCircle2, Loader2, Globe2 } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Source platforms (mirrors the ids in src/main/migrationService.js).
const PLATFORMS = [
  { id: 'dolphin', label: 'Dolphin{anty}', placeholder: 'Dolphin_Token', instructionsUrl: 'https://dolphin-anty.com/docs/basic-templates-api/', warning: "Cookies won't be transferred if you're transferring from Dolphin's free plan." },
  { id: 'gologin', label: 'GoLogin', placeholder: 'GoLogin API token', instructionsUrl: 'https://gologin.com/docs/api-reference/quick-start' },
  { id: 'multilogin', label: 'Multilogin', placeholder: 'Multilogin automation token', instructionsUrl: 'https://documentation.multilogin.com/docs/quick-start-guide' },
  { id: 'adspower', label: 'AdsPower', placeholder: 'AdsPower Local API Key', instructionsUrl: 'https://localapi-doc-en.adspower.com/' },
  { id: 'ixbrowser', label: 'ixBrowser', placeholder: 'ixBrowser Local API Key', instructionsUrl: 'https://ixbrowser.com/' }
];

const LEVEL_CLASS = {
  info: 'text-foreground/70',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400'
};

export default function MigrationSettings() {
  const [me, setMe] = useState(undefined); // undefined = loading
  const [platformId, setPlatformId] = useState('dolphin');
  const [token, setToken] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]); // { level, message }
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');
  const logRef = useRef(null);

  // Owner / Super Admin only (single-user mode counts as the owner). Sub-members
  // (admin/manager/operator) never see or call the migration tool.
  const allowed = me !== undefined && (!me || me.role === 'OWNER' || me.role === 'SUPER_ADMIN');
  const platform = PLATFORMS.find((p) => p.id === platformId) || PLATFORMS[0];

  useEffect(() => {
    softglazeApi.members.current().then((m) => setMe(m || null)).catch(() => setMe(null));
  }, []);

  // Live progress stream from the main process -> terminal log.
  useEffect(() => {
    if (!allowed) return undefined;
    const unsubscribe = softglazeApi.migration.onProgress((data) => {
      if (!data || !data.message) return;
      setLog((prev) => [...prev, { level: data.level || 'info', message: data.message }]);
      if (data.phase === 'done') setSummary({ created: data.created, total: data.total, proxies: data.proxies, errors: data.errors });
    });
    return unsubscribe;
  }, [allowed]);

  // Keep the terminal scrolled to the latest line.
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  if (me === undefined) return null;
  if (!allowed) return null;

  async function startTransfer() {
    if (running) return;
    setErr('');
    setSummary(null);
    if (!token.trim()) { setErr(`Enter your ${platform.label} ${platform.placeholder}.`); return; }
    setLog([]);
    setRunning(true);
    try {
      await softglazeApi.migration.startTransfer({ platform: platformId, token: token.trim() });
    } catch (e) {
      setErr(e.message || 'Transfer failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 bg-sky-500/12 border border-sky-500/20">
          <FolderSync className="w-5 h-5 text-sky-400" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            Transfer Profiles
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/12 text-violet-300 border border-violet-500/20">
              <ShieldCheck className="w-3 h-3" /> Owner only
            </span>
          </h3>
          <p className="text-xs text-muted-foreground">Import your existing profiles from another anti-detect platform via its API.</p>
        </div>
      </div>

      {err && <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      <div className="mt-4 space-y-5">
        {/* Step 1 — source platform */}
        <div className="rounded-xl border border-border bg-elevated/50 p-4">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Source platform</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const active = p.id === platformId;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={running}
                  onClick={() => { setPlatformId(p.id); setErr(''); }}
                  className={`h-9 px-3.5 rounded-lg text-[13px] font-medium border transition disabled:opacity-50 ${active
                    ? 'bg-primary/15 border-primary/50 text-foreground'
                    : 'bg-input-background border-border text-muted-foreground hover:border-muted-dark hover:text-foreground'}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dolphin free-plan cookie warning */}
        {platform.warning && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-300">
                <span className="font-medium">Note:</span> {platform.warning}{' '}
                <a href={platform.instructionsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-amber-400/50 hover:text-amber-200">
                  <Globe2 className="w-3 h-3" /> Instructions
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Step 2 — token + start */}
        <div className="rounded-xl border border-border bg-elevated/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="w-4 h-4 text-muted-foreground" />
            <span className="text-[13px] font-semibold text-foreground">{platform.label} API token</span>
            {!platform.warning && (
              <a href={platform.instructionsUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Globe2 className="w-3 h-3" /> Instructions
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') startTransfer(); }}
              placeholder={platform.placeholder}
              autoComplete="off"
              spellCheck={false}
              disabled={running}
              className="flex-1 h-9 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary disabled:opacity-50 font-mono"
            />
            <button
              onClick={startTransfer}
              disabled={running || !token.trim()}
              className="shrink-0 h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderSync className="w-4 h-4" />}
              {running ? 'Transferring…' : 'Start transfer'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Your token is used once for this transfer and is never stored. Local platforms (AdsPower, ixBrowser) must be running with their Local API enabled.
          </p>
        </div>

        {/* Step 3 — live progress / log */}
        {(log.length > 0 || running) && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-1.5">
                <Terminal className="w-3 h-3" /> Migration log
              </span>
              {summary && (
                <span className="text-[11px] font-medium text-emerald-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {summary.created}/{summary.total} imported{summary.errors ? ` · ${summary.errors} error(s)` : ''}
                </span>
              )}
            </div>
            <div ref={logRef} className="rounded-lg bg-[#0b0f17] border border-border p-3 font-mono text-[11.5px] leading-relaxed h-44 overflow-y-auto whitespace-pre-wrap">
              {log.length === 0 ? (
                <span className="text-muted-foreground">Waiting for the platform to respond…</span>
              ) : log.map((line, i) => (
                <div key={i} className={LEVEL_CLASS[line.level] || LEVEL_CLASS.info}>{line.message}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
