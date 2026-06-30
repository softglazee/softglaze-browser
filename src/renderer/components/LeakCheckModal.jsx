import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, CheckCircle2, AlertTriangle, XCircle, X, Loader2, RefreshCcw, Radio } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const STATUS = {
  pass: { color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/20', Icon: CheckCircle2 },
  warn: { color: 'text-amber-400', bg: 'bg-amber-500/5 border-amber-500/20', Icon: AlertTriangle },
  fail: { color: 'text-red-400', bg: 'bg-red-500/5 border-red-500/20', Icon: XCircle }
};

const GRADE_STYLE = {
  A: { ring: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400' },
  B: { ring: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400' },
  C: { ring: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-400' },
  D: { ring: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30', text: 'text-orange-400' },
  F: { ring: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-400' }
};

// Circular 0-100 trust score with letter grade. The ring fills proportionally
// to the score and is coloured by grade band.
function ScoreBadge({ score }) {
  const { t } = useTranslation('cmpModalsA');
  if (!score) return null;
  const style = GRADE_STYLE[score.grade] || GRADE_STYLE.F;
  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = (Math.max(0, Math.min(100, score.score)) / 100) * C;
  return (
    <div className={`flex items-center gap-4 rounded border px-4 py-3 ${style.bg}`}>
      <div className="relative w-[68px] h-[68px] shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 68 68">
          <circle cx="34" cy="34" r={R} fill="none" stroke="currentColor" strokeWidth="6" className="text-border" />
          <circle
            cx="34" cy="34" r={R} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${dash} ${C}`} className={style.ring}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-bold leading-none ${style.text}`}>{score.score}</span>
          <span className="text-[9px] text-muted uppercase tracking-wider">{t('leakCheck.outOf100')}</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xl font-bold ${style.text}`}>{score.grade}</span>
          <span className={`text-sm font-semibold ${style.text}`}>{score.label}</span>
        </div>
        <p className="text-xs text-muted mt-1">
          {t('leakCheck.trustScoreFrom', { pass: score.summary.pass, warn: score.summary.warn, fail: score.summary.fail })}
        </p>
      </div>
    </div>
  );
}

function CheckRow({ c }) {
  const cfg = STATUS[c.status] || STATUS.warn;
  const Icon = cfg.Icon;
  return (
    <div className={`flex items-start gap-4 rounded border px-4 py-3 shadow-sm ${cfg.bg}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{c.label}</span>
          <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border border-current ${cfg.color}`}>{c.status}</span>
        </div>
        <p className="text-xs text-muted mt-1 break-words leading-relaxed">{c.detail}</p>
      </div>
    </div>
  );
}

export default function LeakCheckModal({ profileId, profileName, onClose }) {
  const { t } = useTranslation('cmpModalsA');
  const { dialogRef } = useDialog({ onClose });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');
  const [live, setLive] = useState(null);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setReport(null);
    try { setReport(await softglazeApi.profiles.analyzeLeaks(profileId)); }
    catch (err) { setError(err.message || t('leakCheck.staticFailed')); }
    finally { setLoading(false); }
  }, [profileId]);

  useEffect(() => { run(); }, [run]);

  const runLive = async () => {
    setLiveLoading(true); setLiveError(''); setLive(null);
    try { setLive(await softglazeApi.profiles.liveLeak(profileId)); }
    catch (err) { setLiveError(err.message || t('leakCheck.liveFailed')); }
    finally { setLiveLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('leakCheck.ariaLabel')} tabIndex={-1} className="w-full max-w-xl max-h-[88vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-1.5 rounded border border-primary/20">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-foreground font-bold text-sm leading-tight tracking-wide uppercase">{t('leakCheck.title')}</h2>
              <p className="text-xs text-muted leading-tight mt-0.5">{profileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground rounded hover:bg-muted-dark transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Static analysis */}
          <div>
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">{t('leakCheck.configAnalysis')}</h3>
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 bg-background border border-border rounded shadow-inner">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-xs text-muted font-medium">{t('leakCheck.testingProxy')}</span>
              </div>
            ) : error ? (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
            ) : report ? (
              <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4">
                <ScoreBadge score={report.score} />
                <div className="flex items-center gap-2 text-xs font-semibold tracking-wide bg-surface p-2 rounded border border-border w-fit">
                  <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{t('leakCheck.passCount', { count: report.summary.pass })}</span>
                  <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">{t('leakCheck.warnCount', { count: report.summary.warn })}</span>
                  <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded">{t('leakCheck.failCount', { count: report.summary.fail })}</span>
                </div>
                <div className="space-y-3">{report.checks.map((c) => <CheckRow key={c.key} c={c} />)}</div>
              </div>
            ) : null}
          </div>

          {/* Live test */}
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary animate-pulse" /> {t('leakCheck.liveTestHeader')}
              </h3>
              <Button size="sm" variant="primary" disabled={liveLoading} onClick={runLive}>
                {liveLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null} {t('leakCheck.executeTest')}
              </Button>
            </div>
            <p className="text-xs text-muted mb-4 bg-surface p-3 rounded border border-border">
              {t('leakCheck.liveTestHint')}
            </p>
            {liveError && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 mb-4">{liveError}</div>}
            {live && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                <ScoreBadge score={live.score} />
                <div className="space-y-3">{live.checks.map((c) => <CheckRow key={c.key} c={c} />)}</div>
                
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mt-6 mb-2">{t('leakCheck.rawData')}</h4>
                <div className="rounded border border-border bg-background p-4 text-xs font-mono text-muted-foreground space-y-2 shadow-inner">
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">exit ip:</span> <span className="text-primary">{live.exit?.ip || '—'}{live.exit?.country ? ` (${live.exit.country})` : ''}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">webrtc:</span> <span className="text-foreground">{live.webrtcIps.length ? live.webrtcIps.join(', ') : t('leakCheck.none')}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">timezone:</span> <span className="text-foreground">{live.env?.timezone || '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">languages:</span> <span className="text-foreground">{(live.env?.languages || []).join(', ') || '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">ua:</span> <span className="text-foreground break-all">{live.env?.userAgent || '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">cores/mem:</span> <span className="text-foreground">{live.env?.hardwareConcurrency ?? '—'} / {live.env?.deviceMemory ?? '—'}</span></div>
                  <div className="flex gap-2"><span className="text-muted w-20 shrink-0">screen:</span> <span className="text-foreground">{live.env?.screen ? `${live.env.screen.width}x${live.env.screen.height}` : '—'}</span></div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-surface">
          <Button size="sm" variant="secondary" disabled={loading} onClick={run}>
            <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> {t('leakCheck.rerunStatic')}
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>{t('leakCheck.done')}</Button>
        </div>
      </div>
    </div>
  );
}