import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ExternalLink, Gift, Lock, Sparkles, X } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';
import { comparisonRows, counterOf, proMonthlyPrice, promptFor } from '@/lib/freePlanUi.mjs';

// Free forever plan (1.0.27): the upgrade prompt that opens at every limit, the day 8 screen, the "choose which
// profiles open" list, the counters, the Billing comparison table and the partner deals card. Main enforces every
// limit (src/main/freePlan.js); these only explain them and offer Pro with its price.

// Pro's monthly price from the server's plans ("US$5"), or null while loading / offline.
export function useProPrice() {
  const [price, setPrice] = useState(null);
  useEffect(() => {
    let live = true;
    softglazeApi.billing.getPlans().then((info) => { if (live) setPrice(proMonthlyPrice(info && info.plans)); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return price;
}

function Modal({ label, onClose, children, wide = false }) {
  const { dialogRef } = useDialog({ onClose });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} max-h-[90vh] flex flex-col rounded-2xl bg-card border border-border shadow-2xl overflow-hidden`}
        onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const primaryBtn = 'h-10 px-4 rounded-lg text-[13px] font-semibold text-white bg-primary hover:bg-primary-hover disabled:opacity-50 inline-flex items-center justify-center gap-2';
const secondaryBtn = 'h-10 px-4 rounded-lg text-[13px] font-semibold border border-border text-foreground hover:bg-secondary inline-flex items-center justify-center';

function PriceLine({ price }) {
  const { t } = useTranslation('plan');
  return <p className="text-[12.5px] font-semibold text-foreground">{price ? t('upgrade.price', { price }) : t('upgrade.priceFallback')}</p>;
}

// The upgrade prompt: opens on every plan:limit-hit push from main, with the price.
export function PlanLimitPrompt({ onChooseProfiles }) {
  const { t } = useTranslation('plan');
  const navigate = useNavigate();
  const price = useProPrice();
  const [info, setInfo] = useState(null);
  useEffect(() => softglazeApi.plan.onLimit((d) => setInfo(promptFor(d))), []);
  if (!info) return null;
  const close = () => setInfo(null);
  const vars = { limit: info.limit ?? '', used: info.used ?? '' };
  return (
    <Modal label={t(`upgrade.title.${info.kind}`, vars)} onClose={close}>
      <div className="px-5 pt-5 pb-4 flex items-start gap-3">
        <span className="shrink-0 w-10 h-10 rounded-xl grid place-items-center bg-primary/10 text-primary"><Lock className="w-5 h-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-foreground">{t(`upgrade.title.${info.kind}`, vars)}</h3>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">{t(`upgrade.body.${info.kind}`, vars)}</p>
          <div className="mt-3"><PriceLine price={price} /></div>
        </div>
        <button type="button" onClick={close} aria-label={t('upgrade.notNow')} className="shrink-0 w-11 h-11 -mt-2 -mr-2 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 border-t border-border">
        <button type="button" onClick={close} className={secondaryBtn}>{t('upgrade.notNow')}</button>
        {info.chooseProfiles && onChooseProfiles && (
          <button type="button" onClick={() => { close(); onChooseProfiles(); }} className={secondaryBtn}>{t('upgrade.chooseProfiles')}</button>
        )}
        <button type="button" autoFocus onClick={() => { close(); navigate('/billing'); }} className={primaryBtn}><Sparkles className="w-4 h-4" aria-hidden="true" />{t('upgrade.upgradeButton')}</button>
      </div>
    </Modal>
  );
}

// Day 8: shown once after the trial ends into Free (main decides: plan:usage showFreeWelcome).
export function FreeWelcomeDialog({ usage, onDone }) {
  const { t } = useTranslation('plan');
  const navigate = useNavigate();
  const price = useProPrice() || 'US$5';
  const finish = async (upgrade) => {
    try { await softglazeApi.plan.ackFreeWelcome(); } catch (e) { /* shown again next time */ }
    onDone();
    if (upgrade) navigate('/billing');
  };
  const limit = (usage && usage.profiles && usage.profiles.limit) || 25;
  return (
    <Modal label={t('welcome.title')} onClose={() => finish(false)}>
      <div className="px-5 pt-5 pb-4 overflow-y-auto">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-primary/10 text-primary"><Gift className="w-5 h-5" aria-hidden="true" /></span>
        <h3 className="mt-3 text-[16px] font-semibold text-foreground leading-snug">{t('welcome.title')}</h3>
        <div className="mt-4 rounded-xl border border-border bg-background p-3.5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{t('welcome.keepTitle')}</p>
          <p className="mt-1 text-[13px] text-foreground leading-relaxed">{t('welcome.keep', { limit })}</p>
        </div>
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-primary">{t('welcome.proTitle')}</p>
          <p className="mt-1 text-[13px] text-foreground leading-relaxed">{t('welcome.pro', { price })}</p>
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 border-t border-border">
        <button type="button" onClick={() => finish(false)} className={secondaryBtn}>{t('welcome.stay')}</button>
        <button type="button" autoFocus onClick={() => finish(true)} className={primaryBtn}><Sparkles className="w-4 h-4" aria-hidden="true" />{t('welcome.upgrade')}</button>
      </div>
    </Modal>
  );
}

// Coming down from Pro with more profiles than Free opens: the owner picks which ones open. Nothing is deleted.
export function ChooseOpenableDialog({ onClose }) {
  const { t } = useTranslation('plan');
  const [rows, setRows] = useState([]);
  const [picked, setPicked] = useState([]);
  const [limit, setLimit] = useState(25);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([softglazeApi.profiles.list({}).catch(() => []), softglazeApi.plan.usage().catch(() => null)]).then(([list, usage]) => {
      if (!live) return;
      setRows(Array.isArray(list) ? list.map((p) => ({ id: p.id, title: p.title })) : []);
      if (usage && usage.openable) { setLimit(usage.openable.limit); setPicked(usage.openable.chosen || []); }
      else if (usage && usage.profiles && usage.profiles.limit) setLimit(usage.profiles.limit);
    });
    return () => { live = false; };
  }, []);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => String(r.title || '').toLowerCase().includes(needle)) : rows;
  }, [rows, q]);
  const toggle = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : (cur.length >= limit ? cur : [...cur, id])));
  const save = async () => {
    setBusy(true); setErr('');
    try { await softglazeApi.plan.setOpenable(picked); onClose(true); }
    catch (e) { setErr(e.message || ''); setBusy(false); }
  };
  return (
    <Modal label={t('choose.title')} onClose={() => onClose(false)} wide>
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-[15px] font-semibold text-foreground">{t('choose.title')}</h3>
        <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">{t('choose.body', { limit, total: rows.length })}</p>
        <div className="mt-3 flex items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('choose.search')} aria-label={t('choose.search')}
            className="flex-1 min-w-0 h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
          <span className="shrink-0 text-[12px] font-semibold text-muted-foreground" aria-live="polite">{t('choose.selected', { count: picked.length, limit })}</span>
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto px-3 pb-2 min-h-[160px]">
        {shown.map((r) => {
          const on = picked.includes(r.id);
          const full = !on && picked.length >= limit;
          return (
            <li key={r.id}>
              <label className={`flex items-center gap-3 min-h-[44px] px-2 rounded-lg ${full ? 'opacity-50' : 'hover:bg-secondary cursor-pointer'}`}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(r.id)} className="w-4 h-4 accent-[var(--primary)]" />
                <span className="text-[13px] text-foreground truncate">{r.title || `#${r.id}`}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {err && <p role="alert" className="px-5 text-[12px] text-destructive">{err}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 border-t border-border">
        <button type="button" onClick={() => onClose(false)} className={secondaryBtn}>{t('choose.cancel')}</button>
        <button type="button" onClick={save} disabled={busy || picked.length === 0} className={primaryBtn}><Check className="w-4 h-4" aria-hidden="true" />{t('choose.save')}</button>
      </div>
    </Modal>
  );
}

// "24 of 25 profiles · 1 of 1 running" for Free; nothing on Pro or Enterprise.
export function PlanCounters({ usage, compact = false }) {
  const { t } = useTranslation('plan');
  const navigate = useNavigate();
  if (!usage || !usage.isFree) return null;
  const parts = [
    ['profiles', counterOf(usage.profiles)],
    ['running', counterOf(usage.running)],
    ...(compact ? [] : [['ai', counterOf(usage.aiActions)]])
  ].filter(([, c]) => c);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="plan-counters">
      <span className="inline-flex items-center h-7 px-2.5 rounded-full text-[11.5px] font-semibold bg-primary/10 text-primary">{t('counter.freeBadge')}</span>
      {parts.map(([k, c]) => (
        <span key={k} className={`inline-flex items-center h-7 px-2.5 rounded-full text-[11.5px] font-medium border ${c.full ? 'border-warning/40 text-warning bg-warning/10' : 'border-border text-muted-foreground'}`}>
          {t(`counter.${k}`, { used: c.used, limit: c.limit })}
        </span>
      ))}
      <button type="button" onClick={() => navigate('/billing')} className="inline-flex items-center h-7 px-2.5 rounded-full text-[11.5px] font-semibold text-primary hover:bg-primary/10">{t('counter.upgrade')}</button>
    </div>
  );
}

// Live Free counters for a page (refreshed on an interval while it is open).
export function usePlanUsage(intervalMs = 10000) {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    let live = true;
    const tick = () => softglazeApi.plan.usage().then((u) => { if (live) setUsage(u); }).catch(() => {});
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { live = false; clearInterval(id); };
  }, [intervalMs]);
  return usage;
}

// Billing page: Free as the current plan, then the comparison table.
export function FreePlanBillingSection({ freeLimits, isFree }) {
  const { t } = useTranslation('plan');
  const rows = comparisonRows(freeLimits);
  const val = (v) => {
    if (typeof v === 'number') return String(v);
    if (v && typeof v === 'object' && v.count != null) return t('billing.values.aiPerDay', { count: v.count });
    return t(`billing.values.${v}`);
  };
  return (
    <section className="space-y-4" aria-labelledby="sg-free-plan-title">
      {isFree && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5 flex items-start gap-3">
          <span className="shrink-0 w-10 h-10 rounded-xl grid place-items-center bg-primary/10 text-primary"><Gift className="w-5 h-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sg-free-plan-title" className="text-[15px] font-semibold text-foreground">{t('billing.currentFree')}</h2>
              <span className="inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold bg-primary text-white">{t('billing.currentBadge')}</span>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">{t('billing.currentFreeBody')}</p>
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <h3 {...(isFree ? {} : { id: 'sg-free-plan-title' })} className="px-4 sm:px-5 py-3 text-[14px] font-semibold text-foreground border-b border-border">{t('billing.compareTitle')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="px-4 sm:px-5 py-2.5 font-medium">{t('billing.colFeature')}</th>
                <th scope="col" className={`px-3 py-2.5 font-semibold ${isFree ? 'text-primary' : ''}`}>{t('billing.colFree')}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{t('billing.colPro')}</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">{t('billing.colEnterprise')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border">
                  <th scope="row" className="px-4 sm:px-5 py-2.5 text-left font-medium text-foreground">{t(`billing.rows.${r.key}`)}</th>
                  <td className={`px-3 py-2.5 ${isFree ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{val(r.free)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{val(r.pro)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{val(r.enterprise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// The partner deals card (Free only, never inside a running profile, never a pop-up). The list comes from our own
// server through main; the card hides itself when there is nothing to show.
export function PartnerDealsCard({ className = '' }) {
  const { t } = useTranslation('plan');
  const [deals, setDeals] = useState([]);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    let live = true;
    softglazeApi.plan.partnerDeals().then((r) => { if (live) setDeals(r && r.shown && Array.isArray(r.deals) ? r.deals : []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!deals.length) return null;
  const copy = async (d) => {
    try { await navigator.clipboard.writeText(d.code); setCopied(d.id); setTimeout(() => setCopied(''), 1500); } catch (e) { /* clipboard blocked */ }
  };
  return (
    <aside className={`rounded-2xl border border-border bg-card p-4 ${className}`} aria-labelledby="sg-partner-deals-title" data-testid="partner-deals">
      <h3 id="sg-partner-deals-title" className="text-[13.5px] font-semibold text-foreground">{t('deals.title')}</h3>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{t('deals.disclosure')}</p>
      <ul className="mt-3 space-y-2.5">
        {deals.map((d) => (
          <li key={d.id} className="rounded-xl border border-border bg-background p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground truncate">{d.title}</p>
                {d.vendor && <p className="text-[11.5px] text-muted-foreground truncate">{d.vendor}</p>}
              </div>
              {d.badge && <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold bg-success/15 text-success">{d.badge}</span>}
            </div>
            {d.description && <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed">{d.description}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {d.code && (
                <button type="button" onClick={() => copy(d)} className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-dashed border-border text-[12px] font-mono text-foreground hover:bg-secondary" aria-label={t('deals.copyCode')}>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />{copied === d.id ? t('deals.copied') : t('deals.code', { code: d.code })}
                </button>
              )}
              <button type="button" onClick={() => softglazeApi.plan.openPartnerDeal(d.id).catch(() => {})} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold text-primary hover:bg-primary/10">
                {t('deals.open')}<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
