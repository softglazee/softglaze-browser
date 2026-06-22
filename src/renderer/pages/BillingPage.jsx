import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CreditCard, ShieldCheck, Loader2, Check, ExternalLink, KeyRound, Wallet,
  AlertTriangle, Sparkles, Users, Crown, ArrowUpRight, Settings2, X, Landmark
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Format a plan price using the plan's own currency (USD gets a $ glyph).
function money(amount, currency) {
  const a = String(amount ?? '');
  return currency === 'USD' ? `$${a}` : `${a} ${currency || ''}`.trim();
}

function statusTone(license) {
  if (!license) return { color: '#9ca3af', label: 'Loading…' };
  if (license.isExempt) return { color: '#10b981', label: 'Source owner' };
  switch (license.state) {
    case 'paid': return { color: '#10b981', label: license.endsAt ? `Active · renews ${new Date(license.endsAt).toLocaleDateString()}` : 'Active' };
    case 'trialing': return { color: '#3b82f6', label: `Trial · ${license.daysLeftTrial}d left` };
    case 'grace': return { color: '#f59e0b', label: `Grace · ${license.daysLeftGrace}d left` };
    case 'banned': return { color: '#ef4444', label: 'Subscription ended' };
    default: return { color: license.isPaid ? '#10b981' : '#f59e0b', label: license.isPaid ? 'Active' : 'Trial' };
  }
}

export default function BillingPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [license, setLicense] = useState(null);
  const [plansInfo, setPlansInfo] = useState(null);
  const [seats, setSeats] = useState(null);
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
      const [cur, lic, plans, seatUsage, methodList] = await Promise.all([
        softglazeApi.members.current().catch(() => null),
        softglazeApi.license.get().catch(() => null),
        softglazeApi.billing.getPlans().catch(() => null),
        softglazeApi.team.seatUsage().catch(() => null),
        softglazeApi.payments.listMethods().catch(() => ({ methods: [] }))
      ]);
      setMe(cur); setLicense(lic); setPlansInfo(plans); setSeats(seatUsage);
      setMethods(methodList && Array.isArray(methodList.methods) ? methodList.methods : []);
    } catch (e) { /* ignore — best-effort */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function redeem() {
    setErr(''); setMsg('');
    if (!code.trim()) return setErr('Enter your purchase code.');
    setBusy('redeem');
    try {
      await softglazeApi.license.redeem(code.trim());
      setCode(''); setMsg('Purchase code applied — thank you!');
      load();
    } catch (e) { setErr(e.message || 'Could not apply that code.'); }
    finally { setBusy(''); }
  }

  // Open the method picker for a plan. If exactly one automated method is
  // enabled, start it immediately (no extra click).
  function openPay(plan) {
    setErr(''); setMsg(''); setManualRef(''); setManualNote(''); setManualDone(false);
    const autos = methods.filter((m) => m.kind === 'automated');
    if (methods.length === 0) {
      setErr('No payment methods are enabled yet — please contact your administrator.');
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
            setCheckout(null); setMsg('Payment received — your plan is now active!');
            load();
          }
        } catch (e) { /* keep polling */ }
      }, 6000);
    } catch (e) { setErr(e.message || 'Could not start checkout.'); }
    finally { setBusy(''); }
  }

  async function submitManual(plan, method) {
    setErr(''); setMsg(''); setBusy(`${plan.id}:${method.id}`);
    try {
      await softglazeApi.payments.submitManual({ provider: method.id, planId: plan.id, reference: manualRef.trim(), note: manualNote.trim() });
      setManualDone(true);
    } catch (e) { setErr(e.message || 'Could not submit your payment.'); }
    finally { setBusy(''); }
  }

  function cancelCheckout() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setCheckout(null);
  }

  if (loading) return <div className="grid place-items-center py-24"><Loader2 className="w-6 h-6 text-muted-foreground animate-spin" /></div>;

  const tone = statusTone(license);
  const isExempt = Boolean(license?.isExempt);
  const currentTier = plansInfo?.currentTier || license?.tier || 'pro';
  const isPaid = Boolean(license?.isPaid);
  const plans = (plansInfo && Array.isArray(plansInfo.plans)) ? plansInfo.plans : [];

  // CTA label/state for a given plan card given the viewer's current license.
  function planCta(plan) {
    if (isExempt) return { label: 'Included', disabled: true, icon: Crown };
    if (isPaid && plan.tier === currentTier) return { label: 'Current plan', disabled: true, icon: Check };
    if (plan.tier === 'enterprise' && currentTier === 'pro') return { label: 'Upgrade to Enterprise', disabled: false, icon: ArrowUpRight };
    if (plan.tier === 'pro' && currentTier === 'enterprise' && isPaid) return { label: 'Downgrade to Pro', disabled: false, icon: Wallet };
    return { label: `Choose ${plan.name}`, disabled: false, icon: Wallet };
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-foreground flex items-center gap-2.5">
          <CreditCard className="w-5 h-5 text-primary" /> Billing &amp; Plans
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">Manage your subscription, compare plans, and upgrade — all in one place.</p>
      </div>

      {/* Current subscription */}
      <div className="rounded-xl bg-card border border-border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}>
              <CreditCard className="w-5 h-5 text-blue-400" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Current plan</h3>
              <p className="text-xs text-muted-foreground capitalize">
                {isExempt ? 'Source owner · all features' : `${currentTier} · ${isPaid ? 'paid' : (license?.isTrial ? 'free trial' : license?.state || '')}`}
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
            <span>Your {license.type === 'trial' ? 'free trial' : 'subscription'} has ended — {license.daysLeftGrace} grace day{license.daysLeftGrace === 1 ? '' : 's'} left. Renew below to avoid losing access.</span>
          </div>
        )}
        {license?.isBanned && (
          <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Your subscription has ended and profile launching is locked. Subscribe or enter a purchase code to restore access.</span>
          </div>
        )}
        {license?.isTrial && !license?.isGrace && (
          <p className="mt-4 text-[12px] text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-400" /> Free trial — {license.daysLeftTrial} day{license.daysLeftTrial === 1 ? '' : 's'} remaining.</p>
        )}

        {seats && seats.total >= 0 && (
          <div className="mt-4 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-elevated/50 border border-border">
            <div className="flex items-center gap-2 text-[12.5px] text-foreground"><Users className="w-4 h-4 text-muted-foreground" /><span>Team seats</span></div>
            <div className="flex items-center gap-2">
              <span className={`text-[12.5px] font-semibold ${seats.full ? 'text-amber-400' : 'text-foreground'}`}>{seats.used} / {seats.total} used</span>
              {seats.full && <span className="text-[11px] text-amber-400">· upgrade to add more</span>}
            </div>
          </div>
        )}

        {isExempt && (
          <p className="mt-4 text-[12px] text-emerald-400/90 flex items-center gap-1.5"><Crown className="w-3.5 h-3.5" /> You are the source owner — exempt from the subscription system. All features are included.</p>
        )}
      </div>

      {/* Active checkout panel */}
      {checkout && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center gap-2 text-[13px] text-foreground"><Loader2 className="w-4 h-4 animate-spin text-primary" /> Waiting for your payment{checkout.planName ? ` · ${checkout.planName}` : ''}…</div>
          <p className="text-[12px] text-muted-foreground mt-1.5">A payment page opened in your browser. After paying, this updates automatically.</p>
          <div className="flex items-center gap-2 mt-3">
            <a href={checkout.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600"><ExternalLink className="w-3.5 h-3.5" /> Reopen payment page</a>
            <button onClick={cancelCheckout} className="px-3 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:bg-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Plan comparison */}
      {!isExempt && plans.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Choose a plan</h2>
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
                    <span className="absolute -top-2.5 right-4 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 text-white shadow">Best value</span>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-1.5">
                      {plan.tier === 'enterprise' ? <Crown className="w-4 h-4 text-violet-400" /> : <ShieldCheck className="w-4 h-4 text-blue-400" />}
                      {plan.name}
                    </h3>
                    {isCurrent && <span className="text-[10.5px] font-semibold text-primary inline-flex items-center gap-1"><Check className="w-3 h-3" /> Current</span>}
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
                    onClick={() => openPay(plan)}
                    disabled={cta.disabled}
                    className={`mt-5 inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-semibold disabled:opacity-60 ${
                      cta.disabled
                        ? 'bg-secondary text-muted-foreground cursor-default'
                        : 'text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow-lg shadow-blue-500/25'
                    }`}
                  >
                    <CtaIcon className="w-4 h-4" /> {cta.label}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Payments are processed by the methods your administrator has enabled. After paying in your browser, this page activates your plan automatically.</p>
        </div>
      )}

      {/* Redeem code */}
      {!isExempt && (
        <div className="rounded-xl bg-card border border-border p-5">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Have a purchase code?</label>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SGP-XX-XXXXXXXX-XXXXXXXX" className="flex-1 min-w-[220px] h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] font-mono text-foreground outline-none focus:border-primary" onKeyDown={(e) => { if (e.key === 'Enter') redeem(); }} />
            <button onClick={redeem} disabled={busy === 'redeem'} className="h-10 px-4 rounded-lg text-[12.5px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
              {busy === 'redeem' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Apply
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="text-[12px] text-red-400">{err}</p>}

      {/* Payment-method picker */}
      {payFor && (() => {
        const sel = methods.find((m) => m.id === selMethod) || null;
        return (
          <div className="fixed inset-0 z-[100] bg-black/50 grid place-items-center p-4" onClick={() => setPayFor(null)}>
            <div className="w-full max-w-[460px] rounded-xl bg-card border border-border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Pay for {payFor.name}</h3>
                  <p className="text-[12px] text-muted-foreground">{money(payFor.amount, payFor.currency)} / {payFor.period}</p>
                </div>
                <button onClick={() => setPayFor(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              {manualDone ? (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-[12.5px] text-emerald-400">
                  <Check className="w-4 h-4 inline mr-1.5" /> Payment submitted. An administrator will review it and activate your plan shortly.
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
                          {m.kind === 'manual' && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Manual</span>}
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
                      {busy === `${payFor.id}:${sel.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Continue to {sel.label}
                    </button>
                  )}

                  {sel && sel.kind === 'manual' && (
                    <div className="mt-4 space-y-3">
                      {sel.instructions && <div className="rounded-lg bg-elevated/60 border border-border p-3 text-[12px] text-foreground/90 whitespace-pre-wrap">{sel.instructions}</div>}
                      {sel.payLink && (
                        <a href={sel.payLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:text-primary-hover"><ExternalLink className="w-3.5 h-3.5" /> Open payment link</a>
                      )}
                      <input value={manualRef} onChange={(e) => setManualRef(e.target.value)} placeholder="Payment reference / transaction ID" className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
                      <input value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="Note (optional)" className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
                      <button
                        onClick={() => submitManual(payFor, sel)}
                        disabled={busy === `${payFor.id}:${sel.id}`}
                        className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-60"
                      >
                        {busy === `${payFor.id}:${sel.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} I&rsquo;ve paid — submit for approval
                      </button>
                      <p className="text-[11px] text-muted-foreground">Your plan activates once an administrator confirms the payment.</p>
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
          <Settings2 className="w-3.5 h-3.5" /> Configure payment methods in Settings
        </button>
      )}
    </div>
  );
}
