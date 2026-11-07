import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { BellRing, ChevronDown, ChevronRight, Clock, ShieldAlert, X } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import { useAiApprovals } from '@/components/ai/AiApprovalsProvider.jsx';
import { AI_TONE, PrimaryButton, clientLabel, toneSurface, toneText } from '@/components/ai/AiShared.jsx';
import { crossedThreshold, currentApproval, formatCountdown, fractionLeft, secondsLeft, urgency } from '@/lib/aiApprovals.mjs';
import { canAllowHour, prettyArgs } from '@/lib/aiCore.mjs';
import { cn } from '@/lib/utils.js';

const URGENCY_TONE = { calm: 'info', soon: 'warning', urgent: 'danger' };
// Buttons wake up a moment after a request appears, so a click or Enter meant for something else
// (or a double click on the previous request) can never approve it.
const ARM_DELAY_MS = 700;

export function Countdown({ approval, now, compact = false }) {
  const { t } = useTranslation('ai');
  const sec = secondsLeft(approval, now);
  const tone = URGENCY_TONE[urgency(sec)];
  const frac = fractionLeft(approval, now);
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[12px] tabular-nums" style={toneText(tone)} title={t('approval.timeLeftHint')}>
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">{t('approval.timeLeftSr', { time: formatCountdown(sec) })}</span>
        <span aria-hidden="true">{formatCountdown(sec)}</span>
      </span>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div className="h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${frac * 100}%`, background: AI_TONE[tone] }} />
      </div>
      <p className="text-[12px] text-muted-foreground">
        <span className="font-mono font-semibold tabular-nums" style={toneText(tone)}>{formatCountdown(sec)}</span>{' '}
        {t('approval.timeLeft')}
      </p>
    </div>
  );
}

export function ApprovalDetails({ approval, defaultOpen = false }) {
  const { t } = useTranslation('ai');
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const text = prettyArgs(approval.args);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded text-[12.5px] font-medium text-primary hover:underline"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? t('approval.hideDetails') : t('approval.showDetails')}
      </button>
      {open && (
        <div id={id} className="mt-2 space-y-2">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-muted-foreground">{t('approval.tool')}</dt>
            <dd className="font-mono text-foreground break-all">{approval.tool || '-'}</dd>
            <dt className="text-muted-foreground">{t('approval.token')}</dt>
            <dd className="text-foreground break-words">{approval.tokenName || '-'}</dd>
          </dl>
          {text
            ? <pre tabIndex={0} aria-label={t('approval.argsLabel')} className="max-h-56 overflow-auto rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">{text}</pre>
            : <p className="text-[12px] text-muted-foreground">{t('approval.noArgs')}</p>}
          <p className="text-[11.5px] text-muted-foreground">{t('approval.redactedNote')}</p>
        </div>
      )}
    </div>
  );
}

// The three answers, Deny first. `armed` keeps them disabled for a moment after a new request.
export function DecisionButtons({ approval, busy, armed = true, onDecide, denyRef, size = 'md', layout = 'dialog' }) {
  const { t } = useTranslation('ai');
  const disabled = busy || !armed;
  const deny = (
    <Button ref={denyRef} variant="secondary" size={size} disabled={disabled} onClick={() => onDecide('deny')} className="min-w-[5.5rem]">
      {t('approval.deny')}
    </Button>
  );
  const allows = (
    <>
      {canAllowHour(approval) && (
        <Button variant="secondary" size={size} disabled={disabled} onClick={() => onDecide('allow-hour')} title={t('approval.allowHourHint', { token: approval.tokenName || approval.clientName || '' })}>
          {t('approval.allowHour')}
        </Button>
      )}
      <PrimaryButton size={size} disabled={disabled} onClick={() => onDecide('allow-once')} isLoading={busy}>
        {t('approval.allowOnce')}
      </PrimaryButton>
    </>
  );
  if (layout === 'row') return <div className="flex flex-wrap items-center justify-end gap-2">{deny}{allows}</div>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {deny}
      <div className="flex flex-wrap items-center gap-2">{allows}</div>
    </div>
  );
}

export default function AiApprovalDialog() {
  const { t } = useTranslation('ai');
  const { queue, now, hidden, busy, respond, hide, showAll, notices, dismissNotice } = useAiApprovals();
  const current = currentApproval(queue, hidden);
  const key = current ? current._key : null;
  const [error, setError] = useState('');
  const [armed, setArmed] = useState(false);
  const [announce, setAnnounce] = useState('');
  const denyRef = useRef(null);
  const prevSec = useRef(null);
  const summaryId = useId();
  const location = useLocation();
  const onApprovalsTab = location.pathname === '/ai' && new URLSearchParams(location.search).get('tab') === 'approvals';

  // New request on screen: clear the old error, disarm, then arm and focus Deny (the safe default).
  useEffect(() => {
    setError('');
    setArmed(false);
    prevSec.current = null;
    if (!key) return undefined;
    const id = setTimeout(() => {
      setArmed(true);
      requestAnimationFrame(() => { if (denyRef.current) denyRef.current.focus(); });
    }, ARM_DELAY_MS);
    return () => clearTimeout(id);
  }, [key]);

  const sec = current ? secondsLeft(current, now) : 0;
  useEffect(() => {
    if (!current) return;
    const mark = prevSec.current == null ? null : crossedThreshold(prevSec.current, sec);
    prevSec.current = sec;
    if (mark) setAnnounce(t('approval.secondsLeftAnnounce', { seconds: mark }));
  }, [current, sec, t]);

  async function decide(decision) {
    if (!current) return;
    setError('');
    const r = await respond(current, decision);
    if (!r.ok && r.error) setError(r.error);
  }

  const position = current ? queue.findIndex((a) => a._key === current._key) + 1 : 0;
  const hiddenCount = queue.filter((a) => hidden.has(a._key)).length;
  const isBusy = current ? busy.has(current._key) : false;
  const client = current ? (clientLabel(t, current.clientName) || t('approval.unknownApp')) : '';

  return (
    <>
      <DialogPrimitive.Root open={Boolean(current)} onOpenChange={(o) => { if (!o && current) hide(current._key); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm" />
          <DialogPrimitive.Content
            role="alertdialog"
            aria-describedby={summaryId}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            className="fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl shadow-black/40 outline-none animate-scale-in"
          >
            {current && (
              <>
                <div className="flex items-start gap-3 border-b border-border px-5 py-4 pr-14">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ ...toneSurface('warning', 16, 0), color: AI_TONE.warning }}>
                    <ShieldAlert className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {queue.length > 1 ? t('approval.eyebrowMany', { position, total: queue.length }) : t('approval.eyebrow')}
                    </p>
                    <DialogPrimitive.Title className="mt-0.5 text-[16px] font-semibold leading-snug text-foreground break-words">
                      {t('approval.title', { app: client })}
                    </DialogPrimitive.Title>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground break-words">
                      {current.memberName
                        ? t('approval.tokenAndMember', { token: current.tokenName || '-', member: current.memberName })
                        : t('approval.tokenOnly', { token: current.tokenName || '-' })}
                    </p>
                  </div>
                </div>

                <div className="space-y-4 px-5 py-4">
                  <p id={summaryId} className="text-[15.5px] font-semibold leading-snug text-foreground break-words">
                    {current.summary || t('approval.noSummary', { tool: current.tool || '' })}
                  </p>
                  <ApprovalDetails key={current._key} approval={current} />
                  <Countdown approval={current} now={now} />
                  {error && <p role="alert" className="text-[12.5px]" style={toneText('danger')}>{t('approval.respondError', { message: error })}</p>}
                </div>

                <div className="border-t border-border px-5 py-4">
                  <DecisionButtons approval={current} busy={isBusy} armed={armed} onDecide={decide} denyRef={denyRef} />
                  <p className="mt-2.5 text-[11.5px] text-muted-foreground">{t('approval.footnote')}</p>
                </div>

                <DialogPrimitive.Close
                  className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  title={t('approval.later')}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">{t('approval.later')}</span>
                </DialogPrimitive.Close>
                <span className="sr-only" role="status" aria-live="polite">{announce}</span>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
        {!current && hiddenCount > 0 && !onApprovalsTab && (
          <button
            type="button"
            onClick={showAll}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[12.5px] font-semibold shadow-lg animate-fade-up"
            style={{ background: 'var(--card)', ...toneSurface('warning', 0, 45), ...toneText('warning') }}
          >
            <BellRing className="h-4 w-4" />
            {t('approval.waitingChip', { count: hiddenCount })}
          </button>
        )}
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
          {notices.map((n) => (
            <div key={n.id} className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg animate-fade-up">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: AI_TONE.warning }} aria-hidden="true" />
              <p className="text-[12.5px] text-foreground">
                {n.kind === 'timeout'
                  ? t('approval.timedOut', { app: clientLabel(t, n.clientName) || t('approval.unknownApp') })
                  : t('approval.gone')}
              </p>
              <button type="button" onClick={() => dismissNotice(n.id)} className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={t('close')}>
                <X className={cn('h-3.5 w-3.5')} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
