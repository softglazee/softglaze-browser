import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, XCircle, X, Loader2, RefreshCcw } from 'lucide-react';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const STATUS = {
  pass: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', Icon: CheckCircle2 },
  warn: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', Icon: AlertTriangle },
  fail: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', Icon: XCircle }
};

export default function LeakCheckModal({ profileId, profileName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setReport(null);
    try {
      setReport(await softglazeApi.profiles.analyzeLeaks(profileId));
    } catch (err) {
      setError(err.message || 'Leak check failed.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { run(); }, [run]);

  const summary = report?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col rounded-xl border border-[#2d3039] bg-[#1e2025] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
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

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-[#9ca3af]">
              <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
              <span className="text-[13px]">Testing proxy and analyzing fingerprint…</span>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
          ) : report ? (
            <>
              <div className="flex items-center gap-2 mb-4 text-[12px]">
                <span className="text-emerald-400">{summary.pass} pass</span>
                <span className="text-[#3b3e48]">·</span>
                <span className="text-amber-400">{summary.warn} warn</span>
                <span className="text-[#3b3e48]">·</span>
                <span className="text-red-400">{summary.fail} fail</span>
              </div>
              <div className="space-y-2">
                {report.checks.map((c) => {
                  const cfg = STATUS[c.status] || STATUS.warn;
                  const Icon = cfg.Icon;
                  return (
                    <div key={c.key} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${cfg.bg}`}>
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
                })}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#2d3039]">
          <Button size="sm" variant="outline" disabled={loading} onClick={run} className="bg-[#181a1f] border-[#3b3e48] text-white">
            <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Re-run
          </Button>
          <Button size="sm" onClick={onClose} className="bg-blue-600 hover:bg-blue-500 text-white">Close</Button>
        </div>
      </div>
    </div>
  );
}