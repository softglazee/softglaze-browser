import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CreditCard, ShieldCheck, Loader2, Check, ExternalLink, KeyRound, Wallet,
  AlertTriangle, Sparkles, Users, Crown, ArrowUpRight, Settings2, X, Landmark,
  FileText, Plus, Pencil, Trash2, Package, UserPlus, Power, Star, Gift
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';

// Format a plan price using the plan's own currency (USD gets a $ glyph).
function money(amount, currency) {
  const a = String(amount ?? '');
  return currency === 'USD' ? `$${a}` : `${a} ${currency || ''}`.trim();
}

function statusTone(license, t) {
  if (!license) return { color: '#9ca3af', label: t('status.loading') };
  if (license.isExempt) return { color: '#10b981', label: t('status.sourceOwner') };
  switch (license.state) {
    case 'paid': return { color: '#10b981', label: license.endsAt ? t('status.activeRenews', { date: new Date(license.endsAt).toLocaleDateString() }) : t('status.active') };
    case 'trialing': return { color: '#3b82f6', label: t('status.trialDaysLeft', { days: license.daysLeftTrial }) };
    case 'grace': return { color: '#f59e0b', label: t('status.graceDaysLeft', { days: license.daysLeftGrace }) };
    case 'banned': return { color: '#ef4444', label: t('status.subscriptionEnded') };
    default: return { color: license.isPaid ? '#10b981' : '#f59e0b', label: license.isPaid ? t('status.active') : t('status.trial') };
  }
}

export default function BillingPage() {
  const { t } = useTranslation('billing');
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [license, setLicense] = useState(null);
  const [plansInfo, setPlansInfo] = useState(null);
  const [seats, setSeats] = useState(null);
  const [backend, setBackend] = useState(null); // licensing-backend status (when a tenant build)
  const [loading, setLoading] = useState(true);

  // Checkout + redeem state lives at page level so the panel persists across cards.
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'redeem' | planId
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [checkout, setCheckout] = useState(null); // { url, uuid, orderId, planName }
  const [methods, setMethods] = useState([]); // enabled payment methods
  const [payFor, setPayFor] = useState(null); // the plan whose method picker is open
  const [selMethod, setSelMethod] = useState(null); // chosen method id in the picker
  const [manualRef, setManualRef] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualDone, setManualDone] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [cur, lic, plans, seatUsage, methodList, backendInfo] = await Promise.all([
        softglazeApi.members.current().catch(() => null),
        softglazeApi.license.get().catch(() => null),
        softglazeApi.billing.getPlans().catch(() => null),
        softglazeApi.team.seatUsage().catch(() => null),
        softglazeApi.payments.listMethods().catch(() => ({ methods: [] })),
        softglazeApi.license.backendInfo().catch(() => null)
      ]);
      setMe(cur); setLicense(lic); setPlansInfo(plans); setSeats(seatUsage); setBackend(backendInfo);
      setMethods(methodList && Array.isArray(methodList.methods) ? methodList.methods : []);
    } catch (e) { /* ignore — best-effort */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  // a11y: close the inline payment-method picker on Escape while it's open.
  useEffect(() => {
    if (!payFor) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setPayFor(null); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [payFor]);

  async function redeem() {
    setErr(''); setMsg('');
    if (!code.trim()) return setErr(t('redeem.errors.empty'));
    setBusy('redeem');
    try {
      await softglazeApi.license.redeem(code.trim());
      setCode(''); setMsg(t('redeem.success'));
      load();
    } catch (e) { setErr(e.message || t('redeem.errors.failed')); }
    finally { setBusy(''); }
  }

  // Start the full-access free trial for this workspace.
  async function startTrial() {
    setErr(''); setMsg(''); setBusy('trial');
    try {
      const lic = await softglazeApi.license.startTrial();
      const d = lic?.daysLeftTrial ?? '';
      setMsg(d ? t('trial.startedWithDays', { days: d }) : t('trial.started'));
      load();
    } catch (e) { setErr(e.message || t('trial.errors.failed')); }
    finally { setBusy(''); }
  }

  // Open the method picker for a plan. If exactly one automated method is
  // enabled, start it immediately (no extra click).
  function openPay(plan) {
    setErr(''); setMsg(''); setManualRef(''); setManualNote(''); setManualDone(false);
    const autos = methods.filter((m) => m.kind === 'automated');
    if (methods.length === 0) {
      setErr(t('pay.errors.noMethods'));
      return;
    }
    if (methods.length === 1 && autos.length === 1) { payAutomated(plan, autos[0]); return; }
    setSelMethod(methods[0] ? methods[0].id : null);
    setPayFor(plan);
  }

  async function payAutomated(plan, method) {
    setErr(''); setMsg(''); setBusy(`${plan.id}:${method.id}`);
    try {
      const c = await softglazeApi.payments.startCheckout({ planId: plan.id, provider: method.id });
      setPayFor(null);
      setCheckout({ ...c, planName: c.planName || plan.name });
      try { window.open(c.url, '_blank'); } catch (e) { /* user can click the link */ }
      // Desktop apps can't receive webhooks — poll for completion.
      pollRef.current = setInterval(async () => {
        try {
          const r = await softglazeApi.payments.pollCheckout({ uuid: c.uuid, orderId: c.orderId, provider: method.id });
          if (r.paid) {
            clearInterval(pollRef.current); pollRef.current = null;
            setCheckout(null); setMsg(t('pay.received'));
            load();
          }
        } catch (e) { /* keep polling */ }
      }, 6000);
    } catch (e) { setErr(e.message || t('pay.errors.checkoutFailed')); }
    finally { setBusy(''); }
  }

  async function submitManual(plan, method) {
    setErr(''); setMsg(''); setBusy(`${plan.id}:${method.id}`);
    try {
      await softglazeApi.payments.submitManual({ provider: method.id, planId: plan.id, reference: manualRef.trim(), note: manualNote.trim() });
      setManualDone(true);
    } catch (e) { setErr(e.message || t('pay.errors.submitFailed')); }
    finally { setBusy(''); }
  }

  function cancelCheckout() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setCheckout(null);
  }

  if (loading) return <div className="grid place-items-center py-24"><Loader2 className="w-6 h-6 text-muted-foreground animate-spin" /></div>;

  const tone = statusTone(license, t);
  const isExempt = Boolean(license?.isExempt);
  const currentTier = plansInfo?.currentTier || license?.tier || 'pro';
  const isPaid = Boolean(license?.isPaid);
  const plans = (plansInfo && Array.isArray(plansInfo.plans)) ? plansInfo.plans : [];

  // CTA label/state for a given plan card given the viewer's current license.
  function planCta(plan) {
    if (plan.kind === 'trial') {
      if (isExempt) return { label: t('cta.included'), disabled: true, icon: Crown, trial: true };
      if (isPaid) return { label: t('cta.onPaidPlan'), disabled: true, icon: Check, trial: true };
      if (license?.isTrial) return { label: t('cta.trialActiveDaysLeft', { days: license.daysLeftTrial ?? '' }), disabled: true, icon: Sparkles, trial: true };
      return { label: t('cta.startFreeTrial'), disabled: false, icon: Sparkles, trial: true };
    }
    if (isExempt) return { label: t('cta.included'), disabled: true, icon: Crown };
    if (isPaid && plan.tier === currentTier) return { label: t('cta.currentPlan'), disabled: true, icon: Check };
    if (plan.tier === 'enterprise' && currentTier === 'pro') return { label: t('cta.upgradeEnterprise'), disabled: false, icon: ArrowUpRight };
    if (plan.tier === 'pro' && currentTier === 'enterprise' && isPaid) return { label: t('cta.downgradePro'), disabled: false, icon: Wallet };
    return { label: t('cta.choosePlan', { name: plan.name }), disabled: false, icon: Wallet };
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-foreground flex items-center gap-2.5">
          <CreditCard className="w-5 h-5 text-primary" /> {t('header.title')}
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">{t('header.description')}</p>
      </div>

      {/* Backend-licensed build: show the verified-license status */}
      {backend?.enabled && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg" style={{ background: 'color-mix(in srgb, #10b981 8%, transparent)', border: '1px solid color-mix(in srgb, #10b981 22%, transparent)' }}>
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-[12.5px] text-foreground">
            {backend.lease
              ? <>{t('backend.licensedVerified')} · <span className="capitalize">{backend.lease.tier}</span>{backend.lease.currentPeriodEnd ? ` · ${t('backend.renews', { date: new Date(backend.lease.currentPeriodEnd).toLocaleDateString() })}` : ''}</>
              : <>{t('backend.noLicense')}</>}
          </span>
          <span className="ml-auto text-[10.5px] text-muted-foreground font-mono">{backend.tenantId}</span>
        </div>
      )}

      {/* Current subscription */}
      <div className="rounded-xl bg-card border border-border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}>
              <CreditCard className="w-5 h-5 text-blue-400" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('current.title')}</h3>
              <p className="text-xs text-muted-foreground capitalize">
                {isExempt ? t('current.sourceOwnerAllFeatures') : `${currentTier} · ${isPaid ? t('current.paid') : (license?.isTrial ? t('current.freeTrial') : license?.state || '')}`}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0" style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)`, color: tone.color, border: `1px solid color-mix(in srgb, ${tone.color} 26%, transparent)` }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} />{tone.label}
          </span>
        </div>

        {license?.isGrace && (
          <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t('grace.message', { count: license.daysLeftGrace, kind: license.type === 'trial' ? t('grace.kindTrial') : t('grace.kindSubscription') })}</span>
          </div>
        )}
        {license?.isBanned && (
          <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t('banned.message')}</span>
          </div>
        )}
        {license?.isTrial && !license?.isGrace && (
          <p className="mt-4 text-[12px] text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-400" /> {t('trialRemaining.message', { count: license.daysLeftTrial })}</p>
        )}

        {seats && seats.total >= 0 && (
          <div className="mt-4 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-elevated/50 border border-border">
            <div className="flex items-center gap-2 text-[12.5px] text-foreground"><Users className="w-4 h-4 text-muted-foreground" /><span>{t('seats.label')}</span></div>
            <div className="flex items-center gap-2">
              <span className={`text-[12.5px] font-semibold ${seats.full ? 'text-amber-400' : 'text-foreground'}`}>{t('seats.usage', { used: seats.used, total: seats.total })}</span>
              {seats.full && <span className="text-[11px] text-amber-400">{t('seats.upgradeToAddMore')}</span>}
            </div>
          </div>
        )}

        {isExempt && (
          <p className="mt-4 text-[12px] text-emerald-400/90 flex items-center gap-1.5"><Crown className="w-3.5 h-3.5" /> {t('exempt.note')}</p>
        )}
      </div>

      {/* Active checkout panel */}
      {checkout && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center gap-2 text-[13px] text-foreground"><Loader2 className="w-4 h-4 animate-spin text-primary" /> {checkout.planName ? t('checkout.waitingForPlan', { plan: checkout.planName }) : t('checkout.waiting')}</div>
          <p className="text-[12px] text-muted-foreground mt-1.5">{t('checkout.opened')}</p>
          <div className="flex items-center gap-2 mt-3">
            <a href={checkout.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600"><ExternalLink className="w-3.5 h-3.5" /> {t('checkout.reopen')}</a>
            <button onClick={cancelCheckout} className="px-3 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:bg-secondary">{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {/* Plan comparison */}
      {!isExempt && plans.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('plans.chooseHeading')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.map((plan) => {
              const cta = planCta(plan);
              const isCurrent = isPaid && plan.tier === currentTier;
              const CtaIcon = cta.icon;
              return (
                <div
                  key={plan.id}
                  className="relative rounded-xl border bg-card p-5 flex flex-col"
                  style={isCurrent
                    ? { borderColor: 'color-mix(in srgb, var(--primary) 50%, transparent)', boxShadow: '0 0 0 1px color-mix(in srgb, var(--primary) 30%, transparent)' }
                    : { borderColor: 'var(--border)' }}
                >
                  {plan.highlight && (
                    <span className="absolute -top-2.5 right-4 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow">{t('plans.bestValue')}</span>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-1.5">
                      {plan.tier === 'enterprise' ? <Crown className="w-4 h-4 text-violet-400" /> : <ShieldCheck className="w-4 h-4 text-blue-400" />}
                      {plan.name}
                    </h3>
                    {isCurrent && <span className="text-[10.5px] font-semibold text-primary inline-flex items-center gap-1"><Check className="w-3 h-3" /> {t('plans.current')}</span>}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-[26px] font-display font-semibold text-foreground">{money(plan.amount, plan.currency)}</span>
                    <span className="text-[12px] text-muted-foreground">/ {plan.period}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">{plan.tagline}</p>

                  <ul className="mt-4 space-y-1.5 flex-1">
                    {(plan.features || []).map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12.5px] text-foreground/90">
                        <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => cta.trial ? startTrial() : openPay(plan)}
                    disabled={cta.disabled || (cta.trial && busy === 'trial')}
                    className={`mt-5 inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-semibold disabled:opacity-60 ${
                      cta.disabled
                        ? 'bg-secondary text-muted-foreground cursor-default'
                        : cta.trial
                          ? 'text-white bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 shadow-lg shadow-emerald-500/25'
                          : 'text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow-lg shadow-blue-500/25'
                    }`}
                  >
                    {cta.trial && busy === 'trial' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CtaIcon className="w-4 h-4" />} {cta.label}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">{t('plans.footerNote')}</p>
        </div>
      )}

      {/* Redeem code */}
      {!isExempt && (
        <div className="rounded-xl bg-card border border-border p-5">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{t('redeem.label')}</label>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SGP-XX-XXXXXXXX-XXXXXXXX" className="flex-1 min-w-[220px] h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] font-mono text-foreground outline-none focus:border-primary" onKeyDown={(e) => { if (e.key === 'Enter') redeem(); }} />
            <button onClick={redeem} disabled={busy === 'redeem'} className="h-10 px-4 rounded-lg text-[12.5px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
              {busy === 'redeem' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} {t('redeem.apply')}
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="text-[12px] text-red-400">{err}</p>}

      {/* Super-Admin console — plan editor + subscribers + assign */}
      {me?.role === 'SUPER_ADMIN' && <PlanManager onChange={load} />}
      {me?.role === 'SUPER_ADMIN' && <SubscribersSection />}

      {/* Invoices */}
      <InvoicesSection />

      {/* Payment-method picker */}
      {payFor && (() => {
        const sel = methods.find((m) => m.id === selMethod) || null;
        return (
          <div className="fixed inset-0 z-[100] bg-black/50 grid place-items-center p-4" onClick={() => setPayFor(null)}>
            <div role="dialog" aria-modal="true" aria-label={t('payModal.title', { name: payFor.name })} tabIndex={-1} className="w-full max-w-[460px] rounded-xl bg-card border border-border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{t('payModal.title', { name: payFor.name })}</h3>
                  <p className="text-[12px] text-muted-foreground">{money(payFor.amount, payFor.currency)} / {payFor.period}</p>
                </div>
                <button onClick={() => setPayFor(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              {manualDone ? (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-[12.5px] text-emerald-400">
                  <Check className="w-4 h-4 inline mr-1.5" /> {t('payModal.manualSubmitted')}
                </div>
              ) : (
                <>
                  {/* Method chooser */}
                  <div className="space-y-1.5">
                    {methods.map((m) => {
                      const active = m.id === selMethod;
                      const Icon = m.kind === 'manual' ? Landmark : (m.id === 'cryptomus' ? Wallet : CreditCard);
                      return (
                        <button
                          key={m.id}
                          onClick={() => setSelMethod(m.id)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors"
                          style={active
                            ? { borderColor: 'color-mix(in srgb, var(--primary) 50%, transparent)', background: 'color-mix(in srgb, var(--primary) 8%, transparent)' }
                            : { borderColor: 'var(--border)' }}
                        >
                          <Icon className={`w-4 h-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                          <span className="flex-1 text-[12.5px] text-foreground">{m.label}</span>
                          {m.kind === 'manual' && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{t('payModal.manualBadge')}</span>}
                          {active && <Check className="w-4 h-4 text-primary" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Action for the selected method */}
                  {sel && sel.kind === 'automated' && (
                    <button
                      onClick={() => payAutomated(payFor, sel)}
                      disabled={busy === `${payFor.id}:${sel.id}`}
                      className="mt-4 w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow-lg shadow-blue-500/25 disabled:opacity-60"
                    >
                      {busy === `${payFor.id}:${sel.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} {t('payModal.continueTo', { method: sel.label })}
                    </button>
                  )}

                  {sel && sel.kind === 'manual' && (
                    <div className="mt-4 space-y-3">
                      {sel.instructions && <div className="rounded-lg bg-elevated/60 border border-border p-3 text-[12px] text-foreground/90 whitespace-pre-wrap">{sel.instructions}</div>}
                      {sel.payLink && (
                        <a href={sel.payLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:text-primary-hover"><ExternalLink className="w-3.5 h-3.5" /> {t('payModal.openPayLink')}</a>
                      )}
                      <input value={manualRef} onChange={(e) => setManualRef(e.target.value)} placeholder={t('payModal.referencePlaceholder')} className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
                      <input value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder={t('payModal.notePlaceholder')} className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
                      <button
                        onClick={() => submitManual(payFor, sel)}
                        disabled={busy === `${payFor.id}:${sel.id}`}
                        className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-60"
                      >
                        {busy === `${payFor.id}:${sel.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('payModal.submitForApproval')}
                      </button>
                      <p className="text-[11px] text-muted-foreground">{t('payModal.manualActivationNote')}</p>
                    </div>
                  )}
                </>
              )}
              {err && <p className="mt-3 text-[12px] text-red-400">{err}</p>}
            </div>
          </div>
        );
      })()}

      {/* Gateway config shortcut for admins */}
      {me?.role === 'SUPER_ADMIN' && (
        <button onClick={() => navigate('/settings')} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
          <Settings2 className="w-3.5 h-3.5" /> {t('admin.configureMethods')}
        </button>
      )}
    </div>
  );
}

// Invoices — auto-captured payment receipts + manual entries. Owners see their own
// tree's invoices read-only; the Super Admin sees all and can add/edit/delete.
function InvoicesSection() {
  const { t } = useTranslation('billing');
  const [data, setData] = useState(null); // { invoices, canEdit }
  const [editing, setEditing] = useState(null); // null | 'new' | invoice
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setData(await softglazeApi.invoices.list()); }
    catch (e) { setErr(e.message || t('invoices.errors.loadFailed')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function remove(id) {
    if (!window.confirm(t('invoices.confirmDelete'))) return;
    setBusy(`del:${id}`); setErr('');
    try { await softglazeApi.invoices.remove({ id }); await load(); }
    catch (e) { setErr(e.message || t('invoices.errors.deleteFailed')); }
    finally { setBusy(''); }
  }

  if (!data) return null;
  const { invoices, canEdit } = data;
  const statusCls = (s) => s === 'paid' ? 'text-emerald-400' : s === 'refunded' ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}><FileText className="w-5 h-5 text-blue-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('invoices.title')}</h3>
            <p className="text-xs text-muted-foreground">{canEdit ? t('invoices.subtitleAdmin') : t('invoices.subtitleUser')}</p>
          </div>
        </div>
        {canEdit && <button onClick={() => setEditing('new')} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> {t('invoices.add')}</button>}
      </div>

      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      {invoices.length === 0 ? (
        <div className="py-8 grid place-items-center text-center text-[12.5px] text-muted-foreground">{t('invoices.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-border/60">
                <th className="py-2 pr-3 font-semibold">{t('invoices.cols.date')}</th>
                {canEdit && <th className="py-2 pr-3 font-semibold">{t('invoices.cols.owner')}</th>}
                <th className="py-2 pr-3 font-semibold">{t('invoices.cols.amount')}</th>
                <th className="py-2 pr-3 font-semibold">{t('invoices.cols.method')}</th>
                <th className="py-2 pr-3 font-semibold">{t('invoices.cols.status')}</th>
                <th className="py-2 pr-3 font-semibold">{t('invoices.cols.reference')}</th>
                {canEdit && <th className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {invoices.map((inv) => (
                <tr key={inv.id} className="text-foreground/90">
                  <td className="py-2 pr-3 whitespace-nowrap">{inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : '—'}</td>
                  {canEdit && <td className="py-2 pr-3">{inv.ownerName || (inv.ownerMemberId != null ? `#${inv.ownerMemberId}` : '—')}</td>}
                  <td className="py-2 pr-3 whitespace-nowrap">{money(inv.amount, inv.currency)}</td>
                  <td className="py-2 pr-3 capitalize">{inv.provider || '—'}{inv.source === 'manual' ? ` · ${t('invoices.manualSuffix')}` : ''}</td>
                  <td className="py-2 pr-3"><span className={`capitalize ${statusCls(inv.status)}`}>{inv.status}</span></td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground truncate max-w-[140px]">{inv.reference || '—'}</td>
                  {canEdit && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(inv)} title={t('common.edit')} className="text-muted-foreground hover:text-foreground p-1"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(inv.id)} disabled={busy === `del:${inv.id}`} title={t('common.delete')} className="text-muted-foreground hover:text-red-400 p-1">{busy === `del:${inv.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <InvoiceForm invoice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function InvoiceForm({ invoice, onClose, onSaved }) {
  const [ownerId, setOwnerId] = useState(invoice?.ownerMemberId ?? '');
  const [amount, setAmount] = useState(invoice?.amount ?? '');
  const [currency, setCurrency] = useState(invoice?.currency ?? 'USD');
  const [provider, setProvider] = useState(invoice?.provider ?? 'manual');
  const [status, setStatus] = useState(invoice?.status ?? 'paid');
  const [reference, setReference] = useState(invoice?.reference ?? '');
  const [tier, setTier] = useState(invoice?.tier ?? '');
  const [months, setMonths] = useState(invoice?.months ?? '');
  const [note, setNote] = useState(invoice?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { t } = useTranslation('billing');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  async function save() {
    setErr('');
    if (amount === '' || Number(amount) < 0) { setErr(t('invoiceForm.errors.invalidAmount')); return; }
    setBusy(true);
    try {
      const payload = {
        ownerId: ownerId === '' ? null : Number(ownerId),
        amount: String(amount), currency, provider, status, reference,
        tier: tier || null, months: months === '' ? null : Number(months), note
      };
      if (invoice) await softglazeApi.invoices.update({ id: invoice.id, ...payload });
      else await softglazeApi.invoices.create(payload);
      onSaved();
    } catch (e) { setErr(e.message || t('invoiceForm.errors.saveFailed')); setBusy(false); }
  }

  const inputCls = 'w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[12.5px] text-foreground outline-none focus:border-primary';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1';

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={invoice ? t('invoiceForm.editTitle') : t('invoiceForm.addTitle')} tabIndex={-1} className="w-full max-w-md rounded-xl bg-card border border-border shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{invoice ? t('invoiceForm.editTitle') : t('invoiceForm.addTitle')}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <div><label className={labelCls}>{t('invoiceForm.ownerMemberId')}</label><input className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder={t('invoiceForm.optionalPlaceholder')} /></div>
          <div><label className={labelCls}>{t('invoiceForm.amount')}</label><input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5" /></div>
          <div><label className={labelCls}>{t('invoiceForm.currency')}</label><input className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
          <div><label className={labelCls}>{t('invoiceForm.method')}</label>
            <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {['manual', 'cryptomus', 'stripe', 'paypal', 'wise'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>{t('invoiceForm.status')}</label>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {['paid', 'pending', 'refunded'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>{t('invoiceForm.tier')}</label>
            <select className={inputCls} value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">—</option><option value="pro">pro</option><option value="enterprise">enterprise</option>
            </select>
          </div>
          <div><label className={labelCls}>{t('invoiceForm.months')}</label><input className={inputCls} value={months} onChange={(e) => setMonths(e.target.value)} placeholder="1" /></div>
          <div><label className={labelCls}>{t('invoiceForm.reference')}</label><input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('invoiceForm.referencePlaceholder')} /></div>
          <div className="col-span-2"><label className={labelCls}>{t('invoiceForm.note')}</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {err && <p className="col-span-2 text-[12px] text-red-400">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">{t('common.cancel')}</button>
          <button onClick={save} disabled={busy} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 disabled:opacity-60 inline-flex items-center gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Super-Admin: plan editor ──────────────────────────────────────────────────
// Edit prices/details of existing packages, toggle active/highlight, create new
// packages, delete. Writes the live catalog that drives checkout + the cards above.
function PlanManager({ onChange }) {
  const { t } = useTranslation('billing');
  const [plans, setPlans] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | plan
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { const r = await softglazeApi.billing.plansAdmin(); setPlans(Array.isArray(r?.plans) ? r.plans : []); }
    catch (e) { setErr(e.message || t('planManager.errors.loadFailed')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function toggleActive(p) {
    setBusy(`act:${p.id}`); setErr('');
    try { await softglazeApi.billing.savePlan({ ...p, active: !p.active }); await load(); if (onChange) onChange(); }
    catch (e) { setErr(e.message || t('planManager.errors.updateFailed')); }
    finally { setBusy(''); }
  }
  async function remove(p) {
    if (!window.confirm(t('planManager.confirmDelete', { name: p.name }))) return;
    setBusy(`del:${p.id}`); setErr('');
    try { await softglazeApi.billing.deletePlan({ id: p.id }); await load(); if (onChange) onChange(); }
    catch (e) { setErr(e.message || t('planManager.errors.deleteFailed')); }
    finally { setBusy(''); }
  }

  if (!plans) return null;

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #8b5cf6 14%, transparent)', border: '1px solid color-mix(in srgb, #8b5cf6 24%, transparent)' }}><Package className="w-5 h-5 text-violet-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('planManager.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('planManager.subtitle')}</p>
          </div>
        </div>
        <button onClick={() => setEditing('new')} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-violet-500 to-violet-600 inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> {t('planManager.newPackage')}</button>
      </div>

      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {plans.map((p) => (
          <div key={p.id} className="rounded-lg border border-border bg-elevated/40 p-4 flex flex-col" style={p.active ? {} : { opacity: 0.62 }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {p.tier === 'enterprise' ? <Crown className="w-4 h-4 text-violet-400 shrink-0" /> : <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />}
                <h4 className="text-[13.5px] font-semibold text-foreground truncate">{p.name}</h4>
                {p.highlight && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />}
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${p.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>{p.active ? t('planManager.activeBadge') : t('planManager.hiddenBadge')}</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="text-[20px] font-display font-semibold text-foreground">{money(p.amount, p.currency)}</span>
              <span className="text-[11px] text-muted-foreground">/ {p.period} · {t('planManager.termMeta', { months: p.months, tier: p.tier })}</span>
            </div>
            {p.tagline && <p className="mt-1 text-[11.5px] text-muted-foreground line-clamp-2">{p.tagline}</p>}
            <div className="mt-3 flex items-center gap-1.5">
              <button onClick={() => setEditing(p)} className="h-8 px-2.5 rounded-lg text-[12px] font-medium bg-secondary hover:bg-secondary/70 text-foreground inline-flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> {t('common.edit')}</button>
              <button onClick={() => toggleActive(p)} disabled={busy === `act:${p.id}`} title={p.active ? t('planManager.hideTitle') : t('planManager.showTitle')} className="h-8 px-2.5 rounded-lg text-[12px] font-medium bg-secondary hover:bg-secondary/70 text-foreground inline-flex items-center gap-1.5">{busy === `act:${p.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />} {p.active ? t('planManager.hide') : t('planManager.show')}</button>
              <button onClick={() => remove(p)} disabled={busy === `del:${p.id}`} title={t('planManager.deleteTitle')} className="h-8 px-2 ml-auto rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 inline-flex items-center">{busy === `del:${p.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); if (onChange) onChange(); }} />}
    </div>
  );
}

function PlanForm({ plan, onClose, onSaved }) {
  const [name, setName] = useState(plan?.name ?? '');
  const [tier, setTier] = useState(plan?.tier ?? 'pro');
  const [kind, setKind] = useState(plan?.kind === 'trial' ? 'trial' : 'paid');
  const [trialDays, setTrialDays] = useState(plan?.trialDays ?? 7);
  const [amount, setAmount] = useState(plan?.amount ?? '');
  const [currency, setCurrency] = useState(plan?.currency ?? 'USD');
  const [months, setMonths] = useState(plan?.months ?? 1);
  const [period, setPeriod] = useState(plan?.period ?? 'month');
  const [tagline, setTagline] = useState(plan?.tagline ?? '');
  const [highlight, setHighlight] = useState(Boolean(plan?.highlight));
  const [active, setActive] = useState(plan?.active === undefined ? true : Boolean(plan.active));
  const [features, setFeatures] = useState((plan?.features || []).join('\n'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { t } = useTranslation('billing');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  async function save() {
    setErr('');
    if (!name.trim()) { setErr(t('planForm.errors.nameRequired')); return; }
    if (kind === 'paid' && (amount === '' || Number(amount) < 0 || Number.isNaN(Number(amount)))) { setErr(t('planForm.errors.invalidPrice')); return; }
    setBusy(true);
    try {
      await softglazeApi.billing.savePlan({
        id: plan?.id, name: name.trim(), tier, kind, trialDays: Number(trialDays) || 7,
        amount: kind === 'trial' ? '0' : String(amount), currency: currency.trim() || 'USD',
        months: Number(months) || 1, period: kind === 'trial' ? `${Number(trialDays) || 7} days` : (period.trim() || 'month'),
        tagline: tagline.trim(), highlight, active, features: features.split('\n').map((f) => f.trim()).filter(Boolean)
      });
      onSaved();
    } catch (e) { setErr(e.message || t('planForm.errors.saveFailed')); setBusy(false); }
  }

  const inputCls = 'w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[12.5px] text-foreground outline-none focus:border-primary';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1';

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={plan ? t('planForm.editTitleAria') : t('planForm.newTitle')} tabIndex={-1} className="w-full max-w-lg rounded-xl bg-card border border-border shadow-2xl max-h-[90vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
          <h3 className="text-sm font-semibold text-foreground">{plan ? t('planForm.editTitle', { name: plan.name }) : t('planForm.newTitle')}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={labelCls}>{t('planForm.packageName')}</label><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pro" /></div>
          <div><label className={labelCls}>{t('planForm.planType')}</label>
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="paid">{t('planForm.typePaid')}</option><option value="trial">{t('planForm.typeTrial')}</option>
            </select>
          </div>
          {kind === 'trial'
            ? <div><label className={labelCls}>{t('planForm.trialLength')}</label><input className={inputCls} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="7" /></div>
            : <div><label className={labelCls}>{t('planForm.price')}</label><input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5" /></div>}
          <div><label className={labelCls}>{t('planForm.currency')}</label><input className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} disabled={kind === 'trial'} /></div>
          {kind === 'trial'
            ? <div><label className={labelCls}>{t('planForm.shownAs')}</label><input className={inputCls} value={t('planForm.trialShownValue', { days: Number(trialDays) || 7 })} disabled /></div>
            : (<>
                <div><label className={labelCls}>{t('planForm.billedPer')}</label>
                  <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)}>
                    {['month', 'year', 'quarter', 'week'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>{t('planForm.term')}</label><input className={inputCls} value={months} onChange={(e) => setMonths(e.target.value)} placeholder="1" /></div>
              </>)}
          <div><label className={labelCls}>{t('planForm.featureTier')}</label>
            <select className={inputCls} value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="pro">pro</option><option value="enterprise">enterprise</option>
            </select>
          </div>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-1.5 text-[12px] text-foreground cursor-pointer"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="accent-violet-500" /> {t('planForm.bestValue')}</label>
            <label className="flex items-center gap-1.5 text-[12px] text-foreground cursor-pointer"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-emerald-500" /> {t('planForm.active')}</label>
          </div>
          <div className="col-span-2"><label className={labelCls}>{t('planForm.tagline')}</label><input className={inputCls} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={t('planForm.taglinePlaceholder')} /></div>
          <div className="col-span-2"><label className={labelCls}>{t('planForm.features')}</label><textarea className="w-full min-h-[120px] bg-input-background border border-border rounded-lg px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-primary resize-y" value={features} onChange={(e) => setFeatures(e.target.value)} placeholder={t('planForm.featuresPlaceholder')} /></div>
          {err && <p className="col-span-2 text-[12px] text-red-400">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">{t('common.cancel')}</button>
          <button onClick={save} disabled={busy} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-violet-500 to-violet-600 disabled:opacity-60 inline-flex items-center gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('planForm.savePackage')}</button>
        </div>
      </div>
    </div>
  );
}

// ── Super-Admin: subscribers ──────────────────────────────────────────────────
// Every owner tree with join date, plan, expiry + a one-click "assign plan" action.
function SubscribersSection() {
  const { t } = useTranslation('billing');
  const [rows, setRows] = useState(null);
  const [plans, setPlans] = useState([]);
  const [assigning, setAssigning] = useState(null); // null | subscriber | 'pick'
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const [subs, pl] = await Promise.all([
        softglazeApi.billing.subscribers(),
        softglazeApi.billing.plansAdmin().catch(() => ({ plans: [] }))
      ]);
      setRows(Array.isArray(subs?.subscribers) ? subs.subscribers : []);
      setPlans(Array.isArray(pl?.plans) ? pl.plans : []);
    } catch (e) { setErr(e.message || t('subscribers.errors.loadFailed')); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return null;

  const stateTone = (r) => r.isBanned ? 'text-red-400' : r.isGrace ? 'text-amber-400' : r.isPaid ? 'text-emerald-400' : r.isTrial ? 'text-blue-400' : 'text-muted-foreground';
  const stateLabel = (r) => r.isBanned ? t('subscribers.state.ended') : r.isGrace ? t('subscribers.state.grace') : r.isPaid ? t('subscribers.state.active') : r.isTrial ? t('subscribers.state.trial') : (r.state || '—');

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #10b981 14%, transparent)', border: '1px solid color-mix(in srgb, #10b981 24%, transparent)' }}><Users className="w-5 h-5 text-emerald-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('subscribers.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('subscribers.subtitle', { count: rows.length })}</p>
          </div>
        </div>
        <button onClick={() => setAssigning('pick')} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-emerald-600 inline-flex items-center gap-1.5"><Gift className="w-4 h-4" /> {t('subscribers.assignPlan')}</button>
      </div>

      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
      {msg && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[12px] text-emerald-400">{msg}</div>}

      {rows.length === 0 ? (
        <div className="py-8 grid place-items-center text-center text-[12.5px] text-muted-foreground">{t('subscribers.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b border-border/60">
                <th className="py-2 pr-3 font-semibold">{t('subscribers.cols.account')}</th>
                <th className="py-2 pr-3 font-semibold">{t('subscribers.cols.joined')}</th>
                <th className="py-2 pr-3 font-semibold">{t('subscribers.cols.plan')}</th>
                <th className="py-2 pr-3 font-semibold">{t('subscribers.cols.state')}</th>
                <th className="py-2 pr-3 font-semibold">{t('subscribers.cols.expires')}</th>
                <th className="py-2 pr-3 font-semibold">{t('subscribers.cols.team')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.ownerId} className="text-foreground/90">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-foreground">{r.ownerName}</div>
                    {r.ownerEmail && <div className="text-[11px] text-muted-foreground">{r.ownerEmail}</div>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.joinedAt ? new Date(r.joinedAt).toLocaleDateString() : '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap"><span className="capitalize">{r.planName || r.tier}</span>{!r.isPaid && r.isTrial ? <span className="text-[10px] text-blue-400"> · {t('subscribers.trialSuffix')}</span> : ''}</td>
                  <td className="py-2 pr-3"><span className={`font-semibold ${stateTone(r)}`}>{stateLabel(r)}</span>{r.isPaid && r.daysLeft != null ? '' : (r.daysLeft != null ? <span className="text-muted-foreground"> · {t('subscribers.daysLeftShort', { days: r.daysLeft })}</span> : '')}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.endsAt ? new Date(r.endsAt).toLocaleDateString() : '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.teamSize}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => setAssigning(r)} title={t('subscribers.assignTitle')} className="h-8 px-2.5 rounded-lg text-[12px] font-medium bg-secondary hover:bg-secondary/70 text-foreground inline-flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> {t('subscribers.assign')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <AssignForm
          owner={assigning === 'pick' ? null : assigning}
          owners={rows}
          plans={plans.filter((p) => p.active)}
          onClose={() => setAssigning(null)}
          onDone={(text) => { setAssigning(null); setMsg(text); load(); setTimeout(() => setMsg(''), 5000); }}
        />
      )}
    </div>
  );
}

function AssignForm({ owner, owners, plans, onClose, onDone }) {
  const [ownerId, setOwnerId] = useState(owner?.ownerId ?? (owners[0] ? owners[0].ownerId : ''));
  const [planId, setPlanId] = useState(plans[0] ? plans[0].id : '');
  const [months, setMonths] = useState('');
  const [charge, setCharge] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { t } = useTranslation('billing');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  const plan = plans.find((p) => p.id === planId) || null;

  async function save() {
    setErr('');
    if (ownerId === '' || ownerId == null) { setErr(t('assignForm.errors.chooseAccount')); return; }
    if (!planId) { setErr(t('assignForm.errors.choosePlan')); return; }
    setBusy(true);
    try {
      const r = await softglazeApi.billing.assignPlan({
        ownerId: Number(ownerId), planId,
        months: months === '' ? undefined : Number(months),
        charge, note: note.trim()
      });
      const name = (owners.find((o) => o.ownerId === Number(ownerId)) || {}).ownerName || t('assignForm.fallbackAccount');
      onDone(t('assignForm.success', { count: r?.months || 0, plan: r?.plan?.name || t('assignForm.fallbackPlan'), name }));
    } catch (e) { setErr(e.message || t('assignForm.errors.assignFailed')); setBusy(false); }
  }

  const inputCls = 'w-full h-9 bg-input-background border border-border rounded-lg px-3 text-[12.5px] text-foreground outline-none focus:border-primary';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1';

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('assignForm.title')} tabIndex={-1} className="w-full max-w-md rounded-xl bg-card border border-border shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Gift className="w-4 h-4 text-emerald-400" /> {t('assignForm.title')}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className={labelCls}>{t('assignForm.account')}</label>
            <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {owners.map((o) => <option key={o.ownerId} value={o.ownerId}>{o.ownerName}{o.ownerEmail ? ` · ${o.ownerEmail}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t('assignForm.plan')}</label>
            <select className={inputCls} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.amount, p.currency)} / {p.period} ({p.tier})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>{plan ? t('assignForm.monthsWithDefault', { default: plan.months }) : t('assignForm.months')}</label><input className={inputCls} value={months} onChange={(e) => setMonths(e.target.value)} placeholder={plan ? String(plan.months) : '1'} /></div>
            <div className="flex items-end pb-1"><label className="flex items-center gap-1.5 text-[12px] text-foreground cursor-pointer"><input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} className="accent-blue-500" /> {t('assignForm.recordAsPaid')}</label></div>
          </div>
          <div><label className={labelCls}>{t('assignForm.noteOptional')}</label><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('assignForm.notePlaceholder')} /></div>
          <p className="text-[11px] text-muted-foreground">{t('assignForm.grantNote')} {charge ? t('assignForm.grantNotePaid') : t('assignForm.grantNoteFree')}</p>
          {err && <p className="text-[12px] text-red-400">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">{t('common.cancel')}</button>
          <button onClick={save} disabled={busy} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-emerald-600 disabled:opacity-60 inline-flex items-center gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('subscribers.assign')}</button>
        </div>
      </div>
    </div>
  );
}
