import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, XCircle, X, Loader2, RefreshCcw, Wand2, Radio } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import Button from '@/components/ui/Button.jsx';
import GuardedButton from '@/components/ui/GuardedButton.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

const LEVEL_STYLE = {
  low: 'text-success border-success/30 bg-success/10',
  some: 'text-warning border-warning/30 bg-warning/10',
  high: 'text-warning border-warning/40 bg-warning/15',
  veryHigh: 'text-destructive border-destructive/30 bg-destructive/10'
};

const STATUS = {
  pass: { Icon: CheckCircle2, text: 'text-success', box: 'border-border bg-card' },
  warn: { Icon: AlertTriangle, text: 'text-warning', box: 'border-warning/30 bg-warning/5' },
  fail: { Icon: XCircle, text: 'text-destructive', box: 'border-destructive/30 bg-destructive/5' }
};

// Fixes that run without asking: they change only this profile. Warm-up opens a browser and the
// cookie switch changes every profile, so those stay one click each.
const FIX_ALL_EXCLUDED = new Set(['warm-up', 'allow-3p-cookies']);

export function fixAllActions(score) {
  const actions = (score && score.fixes ? score.fixes : []).filter((a) => !FIX_ALL_EXCLUDED.has(a));
  // A new proxy is checked already; checking the old one first would be wasted time.
  return actions.includes('swap-proxy') || actions.includes('assign-proxy') ? actions.filter((a) => a !== 'check-proxy') : actions;
}

function factorMessage(t, f) {
  const p = f.params || {};
  if (f.key === 'proxyHealth' && f.status === 'warn') return t(p.never ? 'factor.proxyHealth.never' : 'factor.proxyHealth.stale', { days: p.days });
  if (f.key === 'language' && p.unverified) return t('factor.language.unverified', { lang: p.lang });
  if (f.key === 'sharedProxy') return t('factor.sharedProxy.msg', { count: p.count });
  if (f.key === 'history' && f.status === 'pass' && p.warmRuns) return t('factor.history.warmed', { count: p.warmRuns });
  if (f.key === 'ipType') return t(`factor.ipType.${f.status}`, { isp: p.isp ? ` (${p.isp})` : '' });
  return t(`factor.${f.key}.${f.status}`, p);
}

// The Profiles table's CAPTCHA risk cell: score and level in words, coloured by level. Opens the
// score window, which also leads to the detailed leak check.
export function CaptchaBadge({ score, onClick }) {
  const { t } = useTranslation('captcha');
  const label = score ? t('badgeTitle', { score: score.score }) : t('title');
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition hover:brightness-110 ${score ? LEVEL_STYLE[score.level] : 'border-border text-muted-foreground'}`}
    >
      {score ? `${score.score} · ${t(`levelShort.${score.level}`)}` : '…'}
    </button>
  );
}

function ScoreRing({ score }) {
  const { t } = useTranslation('captcha');
  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = (Math.max(0, Math.min(100, score.score)) / 100) * C;
  const style = LEVEL_STYLE[score.level] || LEVEL_STYLE.high;
  const issues = score.factors.filter((f) => f.status !== 'pass').length;
  const fixable = fixAllActions(score).length;
  return (
    <div className={`flex items-center gap-4 rounded border px-4 py-3 ${style}`}>
      <div className="relative h-[68px] w-[68px] shrink-0">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 68 68" aria-hidden="true">
          <circle cx="34" cy="34" r={R} fill="none" stroke="currentColor" strokeWidth="6" className="text-border" />
          <circle cx="34" cy="34" r={R} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold leading-none">{score.score}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{t('outOf100')}</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-base font-bold">{t(`level.${score.level}`)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('issues', { count: issues })}
          {fixable > 0 ? ` · ${t('fixable', { count: fixable })}` : ''}
        </p>
      </div>
    </div>
  );
}

// Why this member may not apply a fix (usePermissions), or null: `denyProfileFix` for the fixes that
// change this profile (edit access, so never on a "use only" share), `denyWorkspace` for the
// third-party cookie switch (a workspace setting: settings.manage, as in Settings), `denyWarmUp` for a
// warm-up (automation.run). Main refuses the same calls (captchaFix, startWarmer).
export default function CaptchaScoreModal({ profile, running, onClose, onChanged, onLeakCheck, denyProfileFix = null, denyWorkspace = null, denyWarmUp = null }) {
  const { t } = useTranslation('captcha');
  const { dialogRef } = useDialog({ onClose });
  const [score, setScore] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await softglazeApi.profiles.captchaScores([profile.id]);
      const s = res && res.scores ? res.scores[profile.id] : null;
      if (!s) throw new Error(t('loadFailed'));
      setScore(s);
      return s;
    } catch (err) { setError(err.message || t('loadFailed')); return null; }
  }, [profile.id, t]);

  useEffect(() => { load(); }, [load]);

  const runFix = async (action) => {
    if (action === 'warm-up') {
      await softglazeApi.automation.startWarmer({ profileIds: [profile.id] });
      return t('result.warming');
    }
    const res = await softglazeApi.profiles.captchaFix(profile.id, action);
    if (action === 'swap-proxy' || action === 'assign-proxy') return t('result.swapped', { name: res.proxyName });
    if (action === 'check-proxy') return res.ok ? t('result.checked') : t('result.checkFailed', { error: res.error });
    if (action === 'allow-3p-cookies') return t('result.cookies');
    return t('result.applied');
  };

  const apply = async (actions) => {
    setBusy(actions.length > 1 ? 'all' : actions[0]);
    const next = [];
    for (const action of actions) {
      try { next.push({ action, ok: true, text: await runFix(action) }); }
      catch (err) { next.push({ action, ok: false, text: err.message }); }
    }
    setNotes(next);
    const fresh = await load();
    setBusy('');
    if (onChanged) onChanged(profile.id, fresh);
  };

  const fixable = score ? fixAllActions(score) : [];
  const denyFix = (action) => (action === 'allow-3p-cookies' ? denyWorkspace : action === 'warm-up' ? denyWarmUp : denyProfileFix);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="captcha-score-title"
        tabIndex={-1}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded border border-border bg-card shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 id="captcha-score-title" className="text-sm font-bold uppercase tracking-wide text-foreground">{t('title')}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{profile.title} · {t('subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('done')} className="rounded p-1.5 text-muted-foreground transition hover:bg-muted-dark hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <div role="alert" className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
          {!score && !error && (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" /></div>
          )}
          {score && (
            <>
              <ScoreRing score={score} />
              {running && <p className="rounded border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">{t('runningNote')}</p>}
              {notes.length > 0 && (
                <ul aria-live="polite" className="space-y-1 rounded border border-border bg-surface px-3 py-2">
                  {notes.map((n) => (
                    <li key={n.action} className={`text-xs ${n.ok ? 'text-success' : 'text-destructive'}`}>
                      <span className="font-semibold">{t(`fix.${n.action}`)}:</span> {n.text}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="space-y-2">
                {score.factors.map((f, i) => {
                  const cfg = STATUS[f.status] || STATUS.warn;
                  // Several factors can share one fix (a spare proxy cures a blocklisted, shared or
                  // datacenter IP); the button sits on the worst of them only.
                  const showFix = f.fix && score.factors.findIndex((o) => o.fix === f.fix) === i;
                  return (
                    <li key={f.key} className={`flex items-start gap-3 rounded border px-4 py-3 ${cfg.box}`}>
                      <cfg.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.text}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{t(`label.${f.key}`)}</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.text}`}>{t(`status.${f.status}`)}</span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{factorMessage(t, f)}</p>
                        {f.status !== 'pass' && !f.fix && (f.key === 'device' || f.key === 'osMismatch') && (
                          <p className="mt-1 text-[11px] text-muted-foreground">{t('adviceOnly')}</p>
                        )}
                      </div>
                      {showFix && (
                        <GuardedButton deny={denyFix(f.fix)} wrapperClassName="inline-flex shrink-0" size="sm" variant="secondary" className="shrink-0" disabled={Boolean(busy)} onClick={() => apply([f.fix])}>
                          {busy === f.fix ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                          {t(`fix.${f.fix}`)}
                        </GuardedButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-surface px-5 py-4">
          {onLeakCheck && (
            <Button size="sm" variant="ghost" className="mr-auto" disabled={Boolean(busy)} onClick={onLeakCheck} title={t('leakTestTitle')}>
              <Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t('leakTest')}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => { setNotes([]); setScore(null); load(); }}>
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t('rescore')}
          </Button>
          {fixable.length > 0 && (
            <GuardedButton deny={denyProfileFix} size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => apply(fixable)} title={t('fixAllTitle')}>
              {busy === 'all' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {t('fixAll')} ({fixable.length})
            </GuardedButton>
          )}
          <Button size="sm" variant="primary" onClick={onClose}>{t('done')}</Button>
        </footer>
      </div>
    </div>
  );
}
