import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';

import { useAiApprovals } from '@/components/ai/AiApprovalsProvider.jsx';
import { ApprovalDetails, Countdown, DecisionButtons } from '@/components/ai/AiApprovalDialog.jsx';
import { AI_TONE, SUBTLE_TEXT, clientLabel, toneSurface, toneText } from '@/components/ai/AiShared.jsx';
import { relativeTime } from '@/lib/aiCore.mjs';

// The same queue as the pop-up dialog, as a list. Answering here clears the dialog too.
export default function AiApprovalsTab({ lang, onOpenSettings }) {
  const { t } = useTranslation('ai');
  const { queue, now, busy, respond } = useAiApprovals();
  const [errors, setErrors] = useState({});

  async function decide(a, decision) {
    setErrors((e) => ({ ...e, [a._key]: '' }));
    const r = await respond(a, decision);
    if (!r.ok && r.error) setErrors((e) => ({ ...e, [a._key]: r.error }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`max-w-3xl text-[12.5px] leading-relaxed ${SUBTLE_TEXT}`}>{t('approvals.intro')}</p>
        <button type="button" onClick={onOpenSettings} className="text-[12.5px] font-medium text-primary hover:underline">{t('approvals.changeRules')}</button>
      </div>

      {queue.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 p-10 text-center">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-full" style={{ ...toneSurface('success', 14, 0), color: AI_TONE.success }}>
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h3 className="text-sm font-semibold text-foreground">{t('approvals.emptyTitle')}</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('approvals.emptyBody')}</p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t('approvals.listLabel')}>
          {queue.map((a) => (
            <li key={a._key} className="rounded-xl border border-border bg-card px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold leading-snug text-foreground break-words">{a.summary || t('approval.noSummary', { tool: a.tool || '' })}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground break-words">
                    {t('approvals.meta', {
                      app: clientLabel(t, a.clientName) || t('approval.unknownApp'),
                      token: a.tokenName || '-',
                      when: relativeTime(a._createdMs, now, lang)
                    })}
                    {a.memberName ? ` · ${t('approvals.actsAs', { member: a.memberName })}` : ''}
                  </p>
                </div>
                <Countdown approval={a} now={now} compact />
              </div>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <ApprovalDetails approval={a} />
                <DecisionButtons approval={a} busy={busy.has(a._key)} onDecide={(d) => decide(a, d)} size="sm" layout="row" />
              </div>
              {errors[a._key] && <p role="alert" className="mt-2 text-[12.5px]" style={toneText('danger')}>{t('approval.respondError', { message: errors[a._key] })}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
