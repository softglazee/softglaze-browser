import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, XCircle, X, Loader2, RefreshCcw, Radio } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const STATUS = {
  pass: { color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/20', Icon: CheckCircle2 },
  warn: { color: 'text-amber-400', bg: 'bg-amber-500/5 border-amber-500/20', Icon: AlertTriangle },
  fail: { color: 'text-red-400', bg: 'bg-red-500/5 border-red-500/20', Icon: XCircle }
};

function CheckRow({ c }) {
  const cfg = STATUS[c.status] || STATUS.warn;
  const Icon = cfg.Icon;
  return (
    <div className={`flex items-start gap-4 rounded border px-4 py-3 shadow-sm ${cfg.bg}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">{c.label}</span>
          <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border border-current ${cfg.color}`}>{c.status}</span>
        </div>
        <p className="text-xs text-muted mt-1 break-words leading-relaxed">{c.detail}</p>
      </div>
    </div>
  );
}

export default function LeakCheckModal({ profileId, profileName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');
  const [live, setLive] = useState(null);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setReport(null);
    try { setReport(await softglazeApi.profiles.analyzeLeaks(profileId)); }
    catch (err) { setError(err.message || 'Leak check failed.'); }
    finally { setLoading(false); }
  }, [profileId]);

  useEffect(() => { run(); }, [run]);

  const runLive = async () => {
    setLiveLoading(true); setLiveError(''); setLive(null);
    try { setLive(await softglazeApi.profiles.liveLeak(profileId)); }
    catch (err) { setLiveError(err.message || 'Live test failed.'); }
    finally { setLiveLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[88vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-1.5 rounded border border-primary/20">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-zinc-100 font-bold text-sm leading-tight tracking-wide uppercase">Leak Check Analysis</h2>
              <p className="text-xs text-muted leading-tight mt-0.5">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-zinc-100 rounded hover:bg-muted-dark transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Static analysis */}
          <div>
            <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider mb-3">Configuration Analysis</h3>
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 bg-background border border-border rounded shadow-inner">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-xs text-muted font-medium">Testing proxy and analyzing fingerprint…</span>
              </div>
            ) : error ? (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
            ) : report ? (
              <div className="animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center gap-2 mb-4 text-xs font-semibold tracking-wide bg-surface p-2 rounded border border-border w-fit">
                  <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{report.summary.pass} Pass</span>
                  <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">{report.summary.warn} Warn</span>
                  <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded">{report.summary.fail} Fail</span>
                </div>
                <div className="space-y-3">{report.checks.map((c) => <CheckRow key={c.key} c={c} />)}</div>
              </div>
            ) : null}
          </div>

          {/* Live test */}
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary animate-pulse" /> Live Test (Running Browser)
              </h3>
              <Button size="sm" variant="primary" disabled={liveLoading} onClick={runLive}>
                {liveLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null} Execute Test
              </Button>
            </div>
            <p className="text-xs text-muted mb-4 bg-surface p-3 rounded border border-border">
              Reads the real navigator, timezone and WebRTC values from the profile's open browser. The profile must be running.
            </p>
            {liveError && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 mb-4">{liveError}</div>}
            {live && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="space-y-3">{live.checks.map((c) => <CheckRow key={c.key} c={c} />)}</div>
                
                <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wider mt-6 mb-2">Raw Extracted Data</h4>
                <div className="rounded border border-border bg-background p-4 text-xs font-mono text-zinc-300 space-y-2 shadow-inner">
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">exit ip:</span> <span className="text-primary">{live.exit?.ip || '—'}{live.exit?.country ? ` (${live.exit.country})` : ''}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">webrtc:</span> <span className="text-zinc-100">{live.webrtcIps.length ? live.webrtcIps.join(', ') : 'none'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">timezone:</span> <span className="text-zinc-100">{live.env?.timezone || '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">languages:</span> <span className="text-zinc-100">{(live.env?.languages || []).join(', ') || '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">ua:</span> <span className="text-zinc-100 break-all">{live.env?.userAgent || '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">cores/mem:</span> <span className="text-zinc-100">{live.env?.hardwareConcurrency ?? '—'} / {live.env?.deviceMemory ?? '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">screen:</span> <span className="text-zinc-100">{live.env?.screen ? `${live.env.screen.width}x${live.env.screen.height}` : '—'}</span></div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-surface">
          <Button size="sm" variant="secondary" disabled={loading} onClick={run}>
            <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Re-run Static
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}