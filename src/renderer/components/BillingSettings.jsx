import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CreditCard, ShieldCheck, Loader2, Check, ExternalLink, KeyRound, Wallet,
  AlertTriangle, Sparkles, Copy, Users
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

const PLANNED = { stripe: 'Stripe', paypal: 'PayPal', wise: 'Wise' };

function statusTone(license) {
  if (!license) return { color: '#9ca3af', label: 'Loading…' };
  if (license.isPaid) return { color: '#10b981', label: `Active · ${license.daysLeft}d left` };
  if (license.isExpired) return { color: '#ef4444', label: 'Expired' };
  return { color: '#f59e0b', label: `Trial · ${license.daysLeft}d left` };
}

export default function BillingSettings() {
  const [me, setMe] = useState(null);
  const [license, setLicense] = useState(null);
  const [seats, setSeats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cur, lic, seatUsage] = await Promise.all([
        softglazeApi.members.current().catch(() => null),
        softglazeApi.license.get().catch(() => null),
        softglazeApi.team.seatUsage().catch(() => null)
      ]);
      setMe(cur); setLicense(lic); setSeats(seatUsage);
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  const role = me?.role;
  // The Super Admin is the source owner — exempt from the trial/subscription
  // system, so they never see the Subscription card (only the gateway config).
  const showSubscription = role === 'OWNER' || !me;
  const showGateway = role === 'SUPER_ADMIN';
  if (!showSubscription && !showGateway) return null;

  return (
    <div className="space-y-4">
      {showSubscription && <SubscriptionCard license={license} seats={seats} reload={load} />}
      {showGateway && <PaymentGatewayCard />}
    </div>
  );
}

function SubscriptionCard({ license, seats, reload }) {
  const tone = statusTone(license);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [checkout, setCheckout] = useState(null); // { url, uuid, orderId }
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function redeem() {
    setErr(''); setMsg('');
    if (!code.trim()) return setErr('Enter your purchase code.');
    setBusy('redeem');
    try {
      const lic = await softglazeApi.license.redeem(code.trim());
      setCode(''); setMsg('Purchase code applied — thank you!');
      reload(lic);
    } catch (e) { setErr(e.message || 'Could not apply that code.'); }
    finally { setBusy(''); }
  }

  async function pay() {
    setErr(''); setMsg('');
    setBusy('checkout');
    try {
      const c = await softglazeApi.payments.startCheckout();
      setCheckout(c);
      try { window.open(c.url, '_blank'); } catch (e) { /* user can click the link */ }
      // Poll for completion (desktop apps can't receive webhooks).
      pollRef.current = setInterval(async () => {
        try {
          const r = await softglazeApi.payments.pollCheckout({ uuid: c.uuid, orderId: c.orderId });
          if (r.paid) {
            clearInterval(pollRef.current); pollRef.current = null;
            setCheckout(null); setMsg('Payment received — subscription activated!');
            reload(r.license);
          }
        } catch (e) { /* keep polling */ }
      }, 6000);
    } catch (e) { setErr(e.message || 'Could not start checkout.'); }
    finally { setBusy(''); }
  }

  function cancelCheckout() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setCheckout(null);
  }

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}><CreditCard className="w-5 h-5 text-blue-400" /></span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Subscription</h3>
            <p className="text-xs text-muted-foreground">SoftGlaze Browser · {license?.plan?.label || '$5 / month'}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0" style={{ background: `color-mix(in srgb, ${tone.color} 14%, transparent)`, color: tone.color, border: `1px solid color-mix(in srgb, ${tone.color} 26%, transparent)` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} />{tone.label}
        </span>
      </div>

      {license?.isExpired && (
        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Your {license.isTrial ? 'free trial' : 'subscription'} has ended. The app keeps working, but please subscribe for ${'5'}/month to keep supporting it.</span>
        </div>
      )}
      {license?.isTrial && !license?.isExpired && (
        <p className="mt-4 text-[12px] text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-amber-400" /> Free trial — {license.daysLeft} day{license.daysLeft === 1 ? '' : 's'} remaining.</p>
      )}

      {seats && seats.total >= 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-elevated/50 border border-border">
          <div className="flex items-center gap-2 text-[12.5px] text-foreground">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span>Team seats</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[12.5px] font-semibold ${seats.full ? 'text-amber-400' : 'text-foreground'}`}>
              {seats.used} / {seats.total} used
            </span>
            {seats.full && <span className="text-[11px] text-amber-400">· upgrade to add more</span>}
          </div>
        </div>
      )}

      {checkout ? (
        <div className="mt-4 rounded-lg border border-border bg-elevated p-4">
          <div className="flex items-center gap-2 text-[13px] text-foreground"><Loader2 className="w-4 h-4 animate-spin text-primary" /> Waiting for your crypto payment…</div>
          <p className="text-[12px] text-muted-foreground mt-1.5">A Cryptomus payment page opened in your browser. After paying, this updates automatically.</p>
          <div className="flex items-center gap-2 mt-3">
            <a href={checkout.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600"><ExternalLink className="w-3.5 h-3.5" /> Reopen payment page</a>
            <button onClick={cancelCheckout} className="px-3 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:bg-secondary">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button onClick={pay} disabled={busy === 'checkout'} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow-lg shadow-blue-500/25 disabled:opacity-60">
            {busy === 'checkout' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />} Pay with crypto (Cryptomus)
          </button>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-border">
        <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Have a purchase code?</label>
        <div className="flex items-center gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SGP-XX-XXXXXXXX-XXXXXXXX" className="flex-1 h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] font-mono text-foreground outline-none focus:border-primary" />
          <button onClick={redeem} disabled={busy === 'redeem'} className="h-10 px-4 rounded-lg text-[12.5px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
            {busy === 'redeem' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Apply
          </button>
        </div>
      </div>

      {msg && <p className="mt-3 text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="mt-3 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}

function PaymentGatewayCard() {
  const [cfg, setCfg] = useState(null);
  const [merchantId, setMerchantId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const c = await softglazeApi.payments.getConfig();
      setCfg(c); setMerchantId(c.merchantId || ''); setEnabled(Boolean(c.enabled));
    } catch (e) { setErr(e.message || 'Could not load payment settings.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setErr(''); setMsg(''); setBusy('save');
    try {
      const payload = { merchantId: merchantId.trim(), enabled };
      if (apiKey) payload.apiKey = apiKey;
      const c = await softglazeApi.payments.setConfig(payload);
      setCfg(c); setApiKey(''); setMsg('Saved.');
    } catch (e) { setErr(e.message || 'Could not save.'); }
    finally { setBusy(''); }
  }

  async function validate() {
    setErr(''); setMsg(''); setBusy('validate');
    try {
      const r = await softglazeApi.payments.validate();
      if (r.ok) setMsg('Cryptomus credentials look good ✓');
      else setErr(r.error || 'Validation failed — check the Merchant ID and API key.');
    } catch (e) { setErr(e.message || 'Validation failed.'); }
    finally { setBusy(''); }
  }

  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #f59e0b 14%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 24%, transparent)' }}><ShieldCheck className="w-5 h-5 text-amber-400" /></span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Payment gateway · Cryptomus</h3>
          <p className="text-xs text-muted-foreground">Super Admin only. These credentials receive all subscription payments.</p>
        </div>
      </div>

      <a href="https://doc.cryptomus.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:text-primary-hover mb-4 mt-1"><ExternalLink className="w-3 h-3" /> Cryptomus API documentation</a>

      <div className="space-y-3.5">
        <div>
          <label className={labelCls}>Merchant ID (UUID)</label>
          <input className={inputCls + ' font-mono'} value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="8b03432e-385b-…" />
        </div>
        <div>
          <label className={labelCls}>Payment API key</label>
          <input type="password" className={inputCls + ' font-mono'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cfg?.hasApiKey ? '•••••••• (leave blank to keep current)' : 'Paste your Cryptomus Payment API key'} />
        </div>
        <label className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-blue-500" />
          Enable crypto checkout for owners
        </label>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button onClick={save} disabled={busy === 'save'} className="h-9 px-5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-500/25">
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </button>
        <button onClick={validate} disabled={busy === 'validate' || !cfg?.hasApiKey} className="h-9 px-4 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary border border-border flex items-center gap-1.5 disabled:opacity-50">
          {busy === 'validate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Test connection
        </button>
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-[11px] text-muted-foreground">More gateways planned: {Object.values(PLANNED).join(', ')} (coming later behind the same settings).</p>
      </div>

      {msg && <p className="mt-3 text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</p>}
      {err && <p className="mt-3 text-[12px] text-red-400">{err}</p>}
    </div>
  );
}
