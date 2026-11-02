import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Gauge, RefreshCw } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { cn, formatDateTime } from '@/lib/utils.js';
import {
  TONE_CLASS, accountRows, daysLeft, expiryTone, formatGb, formatMoney, parseExpiry, statusTone, trafficTone
} from '@/lib/providerAccountView.mjs';

const STATUS_KEY = { active: 'statusActive', expired: 'statusExpired', suspended: 'statusSuspended', unknown: 'statusUnknown' };

function Item({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-foreground break-words">{children}</dd>
    </div>
  );
}

function expiryText(t, value, lang) {
  const day = parseExpiry(value);
  if (!day) return '';
  let date;
  try { date = day.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { date = day.toDateString(); }
  const left = daysLeft(value);
  const rel = left < 0 ? t('providerAccount.endedAgo', { count: -left }) : left === 0 ? t('providerAccount.endsToday') : t('providerAccount.daysLeft', { count: left });
  return `${date} · ${rel}`;
}

function TrafficLine({ t, a, lang }) {
  const left = a.trafficLeftGb;
  const used = a.trafficUsedGb;
  const total = a.trafficTotalGb;
  const pct = used != null && total ? Math.min(100, Math.max(0, (used / total) * 100)) : null;
  const leftTone = trafficTone(left);
  const parts = [];
  if (used != null && total != null) parts.push(t('providerAccount.trafficUsedOf', { used: formatGb(used, lang), total: formatGb(total, lang) }));
  else if (used != null) parts.push(t('providerAccount.trafficUsed', { used: formatGb(used, lang) }));
  else if (total != null) parts.push(t('providerAccount.trafficTotal', { total: formatGb(total, lang) }));
  return (
    <span className="flex flex-col gap-1.5">
      <span>
        {left != null && <span className={cn('font-medium', leftTone && TONE_CLASS[leftTone])}>{t('providerAccount.trafficLeft', { left: formatGb(left, lang) })}</span>}
        {left != null && parts.length > 0 && <span className="text-muted-foreground" aria-hidden="true"> · </span>}
        {parts.length > 0 && <span className="text-muted-foreground">{parts[0]}</span>}
      </span>
      {pct != null && (
        <span className="flex h-1.5 w-full max-w-[220px] rounded-full overflow-hidden bg-secondary" aria-hidden="true">
          <span className={leftTone ? 'bg-destructive' : 'bg-primary'} style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

// Account section of the provider card: status, plan, expiry, traffic and balance from the vendor's
// account endpoint. The last result (kept in main) shows at once; Check account asks the vendor again.
export default function ProviderAccount({ providerKey }) {
  const { t, i18n } = useTranslation('proxies');
  const lang = i18n.language || 'en';
  const [info, setInfo] = useState(null); // { supported, dashboardUrl, account }
  const [hidden, setHidden] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');
  // A late answer for the previous provider must not land on this one.
  const keyRef = useRef(providerKey);
  keyRef.current = providerKey;

  useEffect(() => {
    let live = true;
    setInfo(null); setErr(''); setHidden(false); setChecking(false);
    softglazeApi.proxies.providerAccount({ provider: providerKey, cachedOnly: true })
      .then((r) => { if (live) setInfo(r || null); })
      .catch((e) => {
        if (!live) return;
        // Members without proxies.manage do not see the section at all.
        if (e && e.code === 'FORBIDDEN') setHidden(true); else setErr(e && e.message ? e.message : String(e));
      });
    return () => { live = false; };
  }, [providerKey]);

  async function check() {
    const key = providerKey;
    setChecking(true); setErr('');
    try {
      const r = await softglazeApi.proxies.providerAccount({ provider: key });
      if (keyRef.current === key) setInfo(r || null);
    } catch (e) {
      if (keyRef.current === key) setErr(e && e.message ? e.message : String(e));
    } finally {
      if (keyRef.current === key) setChecking(false);
    }
  }

  if (hidden) return null;
  const supported = Boolean(info && info.supported);
  const dashboardUrl = info && info.dashboardUrl;
  const a = info && info.account;
  const rows = accountRows(a);
  const sTone = a ? statusTone(a.status) : 'muted';
  const eTone = a && a.expiresAt ? expiryTone(a.expiresAt) : null;
  const titleId = `provider-account-${providerKey}`;

  return (
    <section className="px-5 py-3.5 border-b border-border" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={titleId} className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" /> {t('providerAccount.title')}
        </h3>
        {a && a.checkedAt && <span className="text-[12px] text-muted-foreground">{t('providerAccount.checkedAt', { time: formatDateTime(a.checkedAt) })}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {dashboardUrl && (
            <a href={dashboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">
              {t('providerAccount.openDashboard')} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
          {supported && (
            <Button variant="secondary" size="sm" onClick={check} isLoading={checking} aria-busy={checking}>
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {t('providerAccount.check')}
            </Button>
          )}
        </span>
      </div>

      {info && !supported && <p className="mt-2 text-[12.5px] text-muted-foreground">{t('providerAccount.notSupported')}</p>}
      {supported && !a && !err && <p className="mt-2 text-[12.5px] text-muted-foreground">{t('providerAccount.notChecked')}</p>}

      {a && (
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <Item label={t('providerAccount.status')}>
            <span className={cn('inline-flex items-center gap-1.5 font-medium', TONE_CLASS[sTone])}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
              {t(`providerAccount.${STATUS_KEY[a.status] || 'statusUnknown'}`)}
            </span>
          </Item>
          {rows.includes('plan') && <Item label={t('providerAccount.plan')}>{a.plan}</Item>}
          {rows.includes('expires') && (
            <Item label={t('providerAccount.expires')}>
              <span className={cn(eTone && cn('font-medium', TONE_CLASS[eTone]))}>{expiryText(t, a.expiresAt, lang)}</span>
            </Item>
          )}
          {rows.includes('traffic') && <Item label={t('providerAccount.traffic')}><TrafficLine t={t} a={a} lang={lang} /></Item>}
          {rows.includes('balance') && <Item label={t('providerAccount.balance')}>{formatMoney(a.balance, a.currency, lang)}</Item>}
        </dl>
      )}
      {a && !rows.length && a.status === 'unknown' && !a.note && <p className="mt-2 text-[12.5px] text-muted-foreground">{t('providerAccount.noDetails')}</p>}
      {a && a.note && <p className="mt-2 text-[12px] text-muted-foreground">{t(`providerAccount.note.${a.note}`)}</p>}
      {err && <p role="alert" className="mt-2 text-[12.5px] text-destructive break-words">{t('providerAccount.error', { message: err })}</p>}
    </section>
  );
}
