import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, XCircle, X, Loader2, RefreshCcw, Radio } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const STATUS = {
  pass: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', Icon: CheckCircle2 },
  warn: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', Icon: AlertTriangle },
  fail: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', Icon: XCircle }
};

function CheckRow({ c }) {
  const cfg = STATUS[c.status] || STATUS.warn;
  const Icon = cfg.Icon;
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${cfg.bg}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-white">{c.label}</span>
          <span className={`text-[10px] uppercase tracking-wide ${cfg.color}`}>{c.status}</span>
        </div>
        <p className="text-[12px] text-[#9ca3af] mt-0.5 break-words">{c.detail}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col rounded-xl border border-[#2d3039] bg-[#1e2025] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d3039]">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-white font-medium text-[15px] leading-tight">Leak Check</h2>
              <p className="text-[12px] text-[#9ca3af] leading-tight">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded hover:bg-[#2a2d35] transition"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Static analysis */}
          <div>
            <h3 className="text-[13px] font-medium text-white mb-2">Configuration analysis</h3>
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-[#9ca3af]">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-[13px]">Testing proxy and analyzing fingerprint…</span>
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
            ) : report ? (
              <>
                <div className="flex items-center gap-2 mb-3 text-[12px]">
                  <span className="text-emerald-400">{report.summary.pass} pass</span><span className="text-[#3b3e48]">·</span>
                  <span className="text-amber-400">{report.summary.warn} warn</span><span className="text-[#3b3e48]">·</span>
                  <span className="text-red-400">{report.summary.fail} fail</span>
                </div>
                <div className="space-y-2">{report.checks.map((c) => <CheckRow key={c.key} c={c} />)}</div>
              </>
            ) : null}
          </div>

          {/* Live test */}
          <div className="border-t border-[#2d3039] pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-medium text-white flex items-center gap-2"><Radio className="w-4 h-4 text-[#9ca3af]" /> Live test (running browser)</h3>
              <Button size="sm" disabled={liveLoading} onClick={runLive} className="bg-blue-600 hover:bg-blue-500 text-white">
                {liveLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}Run
              </Button>
            </div>
            <p className="text-[12px] text-[#9ca3af] mb-3">Reads the real navigator, timezone and WebRTC values from the profile's open browser. The profile must be running.</p>
            {liveError && <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-[13px] text-red-200">{liveError}</div>}
            {live && (
              <div className="space-y-3">
                <div className="space-y-2">{live.checks.map((c) => <CheckRow key={c.key} c={c} />)}</div>
                <div className="rounded-lg border border-[#2d3039] bg-[#181a1f] p-3 text-[11px] font-mono text-[#9ca3af] space-y-1">
                  <div><span className="text-slate-500">exit ip:</span> {live.exit?.ip || '—'}{live.exit?.country ? ` (${live.exit.country})` : ''}</div>
                  <div><span className="text-slate-500">webrtc:</span> {live.webrtcIps.length ? live.webrtcIps.join(', ') : 'none'}</div>
                  <div><span className="text-slate-500">timezone:</span> {live.env?.timezone || '—'}</div>
                  <div><span className="text-slate-500">languages:</span> {(live.env?.languages || []).join(', ') || '—'}</div>
                  <div className="break-all"><span className="text-slate-500">ua:</span> {live.env?.userAgent || '—'}</div>
                  <div><span className="text-slate-500">cores/mem:</span> {live.env?.hardwareConcurrency ?? '—'} / {live.env?.deviceMemory ?? '—'}</div>
                  <div><span className="text-slate-500">screen:</span> {live.env?.screen ? `${live.env.screen.width}x${live.env.screen.height}` : '—'}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#2d3039]">
          <Button size="sm" variant="outline" disabled={loading} onClick={run} className="bg-[#181a1f] border-[#3b3e48] text-white"><RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Re-run</Button>
          <Button size="sm" onClick={onClose} className="bg-blue-600 hover:bg-blue-500 text-white">Close</Button>
        </div>
      </div>
    </div>
  );
}