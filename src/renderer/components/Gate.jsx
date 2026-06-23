import { useEffect, useRef, useState } from 'react';
import {
  Lock, ArrowRight, ArrowLeft, Loader2, ShieldCheck, Eye, EyeOff,
  Fingerprint, Globe, Mail, Clock, KeyRound, LogOut, Sparkles, CreditCard, Crown, AlertTriangle, Check,
  Landmark, ExternalLink
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

const inputCls = 'w-full h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-dark';
const labelCls = 'block text-[11px] font-medium text-muted mb-1.5';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function PasswordInput({ value, onChange, placeholder, onKeyDown, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} className={inputCls + ' pr-10'} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} autoFocus={autoFocus} />
      <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-dark hover:text-muted">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function OtpInput({ value, onChange, onComplete }) {
  const refs = useRef([]);
  function setAt(i, ch) {
    const arr = value.padEnd(6, ' ').split('');
    arr[i] = ch || ' ';
    const next = arr.join('').replace(/\s/g, ch ? '' : ' ').slice(0, 6).trimEnd();
    onChange(next);
    if (ch && refs.current[i + 1]) refs.current[i + 1].focus();
    if (next.length === 6 && onComplete) onComplete(next);
  }
  return (
    <div className="flex gap-2 justify-between">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => setAt(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !value[i] && refs.current[i - 1]) refs.current[i - 1].focus(); }}
          onPaste={(e) => {
            const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
            if (t) { e.preventDefault(); onChange(t); if (t.length === 6 && onComplete) onComplete(t); refs.current[Math.min(t.length, 5)]?.focus(); }
          }}
          className="w-11 h-12 text-center text-lg font-semibold bg-background border border-border rounded-lg text-foreground outline-none focus:border-primary transition-colors"
        />
      ))}
    </div>
  );
}

function BrandPanel() {
  const bullets = [
    [Fingerprint, 'Unique, consistent fingerprints per profile'],
    [Globe, 'A dedicated proxy for every identity'],
    [ShieldCheck, 'Local-first — your data never leaves this device']
  ];
  return (
    <div className="relative hidden md:flex flex-col justify-between overflow-hidden bg-surface p-10 border-r border-border">
      <div className="absolute -top-28 -left-28 w-96 h-96 rounded-full bg-primary/20 blur-[120px]" />
      <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full bg-primary/10 blur-[120px]" />
      <div className="relative flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-primary text-white grid place-items-center font-display font-bold text-lg shadow-glow">S</div>
        <span className="font-display font-semibold text-lg tracking-tight">SoftGlaze</span>
      </div>
      <div className="relative">
        <h2 className="font-display text-[28px] font-semibold leading-[1.15] tracking-tight">Run hundreds of identities.<br />Leave zero trace.</h2>
        <p className="text-[13px] text-muted mt-3 max-w-sm leading-relaxed">A local-first anti-detect browser. Every profile gets a unique, consistent fingerprint and its own network identity.</p>
        <ul className="mt-8 space-y-3.5">
          {bullets.map(([Icon, t], i) => (
            <li key={i} className="flex items-center gap-3 text-[13px] text-foreground">
              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Icon className="w-4 h-4" /></span>{t}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative text-[11px] text-muted-dark">© {new Date().getFullYear()} SoftGlaze · Local workspace</div>
    </div>
  );
}

// Non-blocking overlay shown over the app: a persistent grace banner (with a
// renew CTA + countdown) or an unobtrusive trial-days chip. Module-scope so it
// isn't remounted on every Gate render.
function LicenseBanner({ license, busy, onPay }) {
  if (!license || license.isExempt) return null;
  if (license.isGrace) {
    return (
      <div className="fixed top-0 inset-x-0 z-[90] bg-amber-500/95 text-black px-4 py-2 flex items-center justify-center gap-3 text-[12.5px] font-medium shadow">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Your subscription has ended — {license.daysLeftGrace} day{license.daysLeftGrace === 1 ? '' : 's'} of grace left. Renew to keep access.</span>
        <button onClick={onPay} disabled={busy} className="ml-2 shrink-0 inline-flex items-center gap-1.5 rounded-md bg-black/85 text-white px-3 py-1 font-semibold disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />} Renew
        </button>
      </div>
    );
  }
  if (license.isTrial && license.daysLeftTrial != null) {
    return (
      <div className="fixed bottom-4 right-4 z-[90] inline-flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 text-[11.5px] text-muted-foreground shadow pointer-events-none">
        <Clock className="w-3.5 h-3.5 text-primary" />
        Trial · {license.daysLeftTrial} day{license.daysLeftTrial === 1 ? '' : 's'} left
      </div>
    );
  }
  return null;
}

// Compact payment-method chooser used on the banned screen and the register
// plan step. Shows only the methods the admin enabled; automated → hosted
// checkout (caller polls), manual → submit a reference for admin approval.
function PayMethods({ methods, busy, onAutomated, onManual }) {
  const [sel, setSel] = useState(() => (methods[0] ? methods[0].id : null));
  const [reference, setReference] = useState('');
  const [done, setDone] = useState(false);
  const cur = methods.find((m) => m.id === sel) || null;

  if (!methods.length) {
    return <p className="text-[12px] text-muted-dark">No payment methods are enabled yet — use a purchase code or contact your administrator.</p>;
  }
  if (done) {
    return (
      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-[12px] text-emerald-400">
        <Check className="w-4 h-4 inline mr-1.5" /> Payment submitted — an administrator will review it and activate your plan shortly.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {methods.map((m) => {
          const active = m.id === sel;
          const Icon = m.kind === 'manual' ? Landmark : CreditCard;
          return (
            <button
              key={m.id}
              onClick={() => setSel(m.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors"
              style={active
                ? { borderColor: 'color-mix(in srgb, var(--primary) 50%, transparent)', background: 'color-mix(in srgb, var(--primary) 8%, transparent)' }
                : { borderColor: 'var(--border)' }}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-primary' : 'text-muted-dark'}`} />
              <span className="flex-1 text-[12.5px] text-foreground">{m.label}</span>
              {m.kind === 'manual' && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Manual</span>}
              {active && <Check className="w-4 h-4 text-primary" />}
            </button>
          );
        })}
      </div>

      {cur && cur.kind === 'automated' && (
        <button onClick={() => onAutomated(cur)} disabled={busy} className="w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Continue to {cur.label}
        </button>
      )}

      {cur && cur.kind === 'manual' && (
        <div className="space-y-2">
          {cur.instructions && <div className="rounded-lg bg-secondary/40 border border-border p-2.5 text-[11.5px] text-foreground/90 whitespace-pre-wrap">{cur.instructions}</div>}
          {cur.payLink && <a href={cur.payLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary"><ExternalLink className="w-3.5 h-3.5" /> Open payment link</a>}
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Payment reference / transaction ID" className="w-full h-9 bg-background border border-border rounded-lg px-3 text-[12.5px] text-foreground outline-none focus:border-primary" />
          <button
            onClick={async () => { const ok = await onManual(cur, { reference: reference.trim(), note: '' }); if (ok) setDone(true); }}
            disabled={busy}
            className="w-full h-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} I&rsquo;ve paid — submit for approval
          </button>
        </div>
      )}
    </div>
  );
}

// Full-screen blocking gate when the owner tree is banned (trial + grace lapsed).
// No workspace access — only renew / redeem / contact / sign out.
function BannedScreen({ account, license, methods, planCode, setPlanCode, busy, err, onRedeem, onAutomated, onManual, onSignOut }) {
  const adminBlocked = Boolean(license?.adminBlocked);
  return (
    <div className="h-screen w-full bg-background text-foreground font-sans grid place-items-center p-6">
      <div className="w-full max-w-[440px]">
        <div className="w-12 h-12 rounded-xl grid place-items-center mb-4" style={{ background: 'color-mix(in srgb, #ef4444 14%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 28%, transparent)' }}><Lock className="w-6 h-6 text-red-400" /></div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight">{adminBlocked ? 'Your account is blocked' : 'Your subscription has ended'}</h1>
        <p className="text-[13px] text-muted mt-1.5 mb-6">
          {adminBlocked
            ? `${account?.firstName ? `${account.firstName}, your` : 'Your'} account has been blocked by an administrator. Please contact them to restore access — your data is safe.`
            : `${account?.firstName ? `${account.firstName}, your` : 'Your'} free trial and grace period are over. Renew to unlock your workspace — your profiles and data are safe and waiting.`}
        </p>

        {!adminBlocked && (
          <>
            <PayMethods methods={methods} busy={busy} onAutomated={onAutomated} onManual={onManual} />
            <div className="mt-5">
              <label className="block text-[11px] font-medium text-muted mb-1.5"><KeyRound className="w-3 h-3 inline mr-1" />Have a purchase code?</label>
              <div className="flex items-center gap-2">
                <input value={planCode} onChange={(e) => setPlanCode(e.target.value.toUpperCase())} placeholder="SG-XXXX-XXXX" className="flex-1 h-10 bg-background border border-border rounded-lg px-3 text-[13px] font-mono tracking-widest text-foreground outline-none focus:border-primary" onKeyDown={(e) => { if (e.key === 'Enter') onRedeem(); }} />
                <button onClick={onRedeem} disabled={busy || !planCode.trim()} className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] disabled:opacity-60">Redeem</button>
              </div>
            </div>
          </>
        )}

        {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}

        <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-[12px] text-muted-dark">
          <span>Need help? Contact your administrator.</span>
          <button onClick={onSignOut} className="inline-flex items-center gap-1.5 hover:text-foreground"><LogOut className="w-3.5 h-3.5" /> Sign out</button>
        </div>
      </div>
    </div>
  );
}

export default function Gate({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | register | login | pick | plan | licensing | banned | ready
  const [members, setMembers] = useState([]);
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [license, setLicense] = useState(null); // resolved after auth (drives banned/grace/trial)
  const [planCode, setPlanCode] = useState(''); // register plan step: purchase-code entry
  const [methods, setMethods] = useState([]); // enabled payment methods (banned screen + plan step)

  // register
  const [step, setStep] = useState('details'); // details | verify
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  // login / pick
  const [loginPass, setLoginPass] = useState('');
  const [forgot, setForgot] = useState(false);
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState('');

  // super admin (per-install source-owner credential)
  const [superId, setSuperId] = useState('');
  const [superPass, setSuperPass] = useState('');
  const [superPass2, setSuperPass2] = useState('');
  const [superNeedsSetup, setSuperNeedsSetup] = useState(false); // first-run: show create form

  // invite redemption + team-member login
  const [inviteCode, setInviteCode] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePass, setInvitePass] = useState('');
  const [memberIdf, setMemberIdf] = useState('');
  const [memberPass, setMemberPass] = useState('');

  async function evaluate() {
    try {
      const [vs, acct, cur, list] = await Promise.all([
        softglazeApi.vault.status().catch(() => ({ enabled: false, locked: false })),
        softglazeApi.account.get().catch(() => null),
        softglazeApi.members.current().catch(() => null),
        softglazeApi.members.list().catch(() => [])
      ]);
      const ms = Array.isArray(list) ? list : [];
      setMembers(ms); setAccount(acct);
      if (acct?.email) setEmail(acct.email);
      if (vs && vs.locked) { setPhase('login'); return; }
      if (ms.length === 0) { setPhase('register'); setStep('details'); return; }
      if (!cur) { setPhase('pick'); return; }
      setPhase('licensing');
    } catch (e) { setPhase('licensing'); }
  }
  useEffect(() => { evaluate(); }, []);
  useEffect(() => {
    softglazeApi.payments.listMethods()
      .then((r) => setMethods(r && Array.isArray(r.methods) ? r.methods : []))
      .catch(() => setMethods([]));
  }, []);
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setInterval(() => setResendIn((x) => x - 1), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  async function sendCode() {
    setErr('');
    if (!firstName.trim() || !lastName.trim()) return setErr('Enter your first and last name.');
    if (!EMAIL_RE.test(email.trim())) return setErr('Enter a valid email address.');
    if (phone.replace(/\D/g, '').length < 6) return setErr('Enter a valid phone number.');
    if (password.length < 8) return setErr('Password must be at least 8 characters.');
    if (password !== confirm) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      const res = await softglazeApi.account.sendOtp(email.trim().toLowerCase());
      setDevCode(res?.devCode || ''); setResendIn(30); setOtp(''); setStep('verify');
    } catch (e) { setErr(e.message || 'Could not send the verification code.'); }
    finally { setBusy(false); }
  }

  async function resend() {
    if (resendIn > 0) return;
    setBusy(true); setErr('');
    try { const res = await softglazeApi.account.sendOtp(email.trim().toLowerCase()); setDevCode(res?.devCode || ''); setResendIn(30); }
    catch (e) { setErr(e.message || 'Could not resend the code.'); }
    finally { setBusy(false); }
  }

  async function verifyAndCreate(code) {
    const c = (code || otp).replace(/\D/g, '');
    if (c.length !== 6) return setErr('Enter the 6-digit code.');
    setErr(''); setBusy(true);
    try {
      // Single atomic step: verifies OTP, creates the OWNER, sets the vault
      // password and saves the account server-side. The OTP is only consumed
      // once everything succeeds, so a failure here is safely retryable.
      await softglazeApi.account.register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        code: c
      });
      // Account + 7-day trial now exist. Offer the plan step (trial / redeem / buy)
      // before entering the workspace.
      setBusy(false); setErr(''); setPlanCode(''); setPhase('plan');
    } catch (e) { setErr(e.message || 'Verification failed.'); setBusy(false); }
  }

  async function login() {
    setErr(''); setBusy(true);
    try {
      await softglazeApi.vault.unlock(loginPass);
      const list = await softglazeApi.members.list().catch(() => []);
      if (!list.length) { setPhase('register'); setStep('details'); setErr(''); setBusy(false); return; }
      const owner = list.find((x) => account?.email && x.email && x.email.toLowerCase() === account.email.toLowerCase())
        || list.find((x) => x.role === 'OWNER') || list[0];
      if (owner && !owner.isCurrent) { try { await softglazeApi.members.switch(owner.id); } catch (_) { /* owner may have a PIN */ } }
      const cur = await softglazeApi.members.current().catch(() => null);
      setLoginPass('');
      if (!cur && list.length) { setPhase('pick'); setBusy(false); return; }
      setPhase('licensing');
    } catch (e) { setErr(e.message || 'Incorrect password.'); setBusy(false); }
  }

  async function pick(m) {
    setErr('');
    if (m.hasPin && pinFor !== m.id) { setPinFor(m.id); setPin(''); return; }
    setBusy(true);
    try { await softglazeApi.members.switch(m.id, m.hasPin ? pin : undefined); setPhase('licensing'); }
    catch (e) { setErr(e.message || 'Could not sign in.'); setBusy(false); }
  }

  async function doSuperLogin() {
    setErr(''); setBusy(true);
    try {
      await softglazeApi.members.superLogin(superId.trim(), superPass);
      setSuperPass('');
      setPhase('licensing');
    } catch (e) {
      if (e.code === 'SUPER_SETUP_REQUIRED') { setSuperNeedsSetup(true); setErr('No Super Admin credential is set yet — create one below.'); setBusy(false); return; }
      setErr(e.message || 'Invalid Super Admin credentials.'); setBusy(false);
    }
  }

  // First-run (or change): create the per-install Super Admin credential.
  async function doSuperSetup() {
    setErr('');
    if (superPass.length < 8) return setErr('Password must be at least 8 characters.');
    if (superPass !== superPass2) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      await softglazeApi.members.superSetup({ identifier: superId.trim() || 'superadmin', password: superPass });
      setSuperPass(''); setSuperPass2('');
      setPhase('licensing');
    } catch (e) { setErr(e.message || 'Could not create Super Admin credentials.'); setBusy(false); }
  }

  async function doAcceptInvite() {
    setErr('');
    if (!inviteCode.trim()) return setErr('Enter your invite code.');
    if (invitePass.length < 6) return setErr('Password must be at least 6 characters.');
    setBusy(true);
    try {
      await softglazeApi.members.acceptInvite({ code: inviteCode.trim(), name: inviteName.trim() || undefined, password: invitePass });
      setInvitePass('');
      setPhase('licensing');
    } catch (e) { setErr(e.message || 'Could not redeem that invite code.'); setBusy(false); }
  }

  async function doMemberLogin() {
    setErr('');
    if (!memberIdf.trim() || !memberPass) return setErr('Enter your email/name and password.');
    setBusy(true);
    try {
      await softglazeApi.members.login(memberIdf.trim(), memberPass);
      setMemberPass('');
      setPhase('licensing');
    } catch (e) { setErr(e.message || 'Could not sign in.'); setBusy(false); }
  }

  // After any successful auth we pass through 'licensing': resolve the license and
  // either enter the app, or show the blocking 'banned' screen. A read error never
  // hard-blocks (fail open to the app, consistent with local-first).
  useEffect(() => {
    if (phase !== 'licensing') return undefined;
    let live = true;
    (async () => {
      try {
        const lic = await softglazeApi.license.get();
        if (!live) return;
        setLicense(lic);
        setPhase(lic && lic.isBanned ? 'banned' : 'ready');
      } catch (e) { if (live) setPhase('ready'); }
    })();
    return () => { live = false; };
  }, [phase]);

  function startTrial() { setErr(''); setPhase('licensing'); } // trial already created at registration

  async function redeemPlan() {
    setErr('');
    if (!planCode.trim()) return setErr('Enter your purchase code.');
    setBusy(true);
    try { await softglazeApi.license.redeem(planCode.trim()); setPlanCode(''); setBusy(false); setPhase('licensing'); }
    catch (e) { setErr(e.message || 'That purchase code is not valid.'); setBusy(false); }
  }

  function pollPurchase(inv) {
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const r = await softglazeApi.payments.pollCheckout({ uuid: inv.uuid, orderId: inv.orderId });
        if (r && r.paid) { clearInterval(timer); setBusy(false); setPhase('licensing'); return; }
      } catch (e) { /* keep polling */ }
      if (tries > 120) { clearInterval(timer); setBusy(false); } // ~10-minute cap
    }, 5000);
  }

  async function buyPlan() {
    setErr(''); setBusy(true);
    try {
      const inv = await softglazeApi.payments.startCheckout();
      if (inv && inv.url) window.open(inv.url, '_blank');
      pollPurchase(inv);
    } catch (e) { setErr(e.message || 'No payment method is available yet.'); setBusy(false); }
  }

  // Method-aware variants used by the <PayMethods> chooser (banned screen + plan step).
  async function buyWith(method) {
    setErr(''); setBusy(true);
    try {
      const inv = await softglazeApi.payments.startCheckout({ provider: method.id });
      if (inv && inv.url) window.open(inv.url, '_blank');
      pollPurchase(inv);
    } catch (e) { setErr(e.message || 'Payment could not be started.'); setBusy(false); }
  }

  async function submitManualPay(method, { reference, note }) {
    setErr(''); setBusy(true);
    try {
      await softglazeApi.payments.submitManual({ provider: method.id, reference, note });
      setBusy(false);
      return true;
    } catch (e) { setErr(e.message || 'Could not submit your payment.'); setBusy(false); return false; }
  }

  async function signOut() {
    try { await softglazeApi.members.logout(); } catch (e) { /* ignore */ }
    setLicense(null); setPhase('loading'); evaluate();
  }

  const SuperLink = () => (
    <p className="text-center text-[11px] text-muted-dark mt-5 pt-4 border-t border-border">
      <button onClick={async () => { setPhase('super'); setErr(''); setSuperPass(''); setSuperPass2(''); try { const s = await softglazeApi.members.superStatus(); setSuperNeedsSetup(!(s && s.configured)); } catch (_) { setSuperNeedsSetup(false); } }} className="inline-flex items-center gap-1 text-muted-dark hover:text-primary transition-colors">
        <ShieldCheck className="w-3.5 h-3.5" /> Super Admin access
      </button>
    </p>
  );

  if (phase === 'ready') return <>{children}<LicenseBanner license={license} busy={busy} onPay={buyPlan} /></>;
  if (phase === 'loading' || phase === 'licensing') {
    return <div className="h-screen w-full bg-background grid place-items-center"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>;
  }
  if (phase === 'banned') {
    return (
      <BannedScreen
        account={account}
        license={license}
        methods={methods}
        planCode={planCode}
        setPlanCode={setPlanCode}
        busy={busy}
        err={err}
        onRedeem={redeemPlan}
        onAutomated={buyWith}
        onManual={submitManualPay}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="h-screen w-full bg-background text-foreground font-sans grid md:grid-cols-2">
      <BrandPanel />
      <div className="grid place-items-center p-6 overflow-y-auto">
        <div className="w-full max-w-[400px]">
          <div className="flex items-center gap-2.5 mb-7 md:hidden">
            <div className="w-8 h-8 rounded-xl bg-primary text-white grid place-items-center font-display font-bold shadow-glow">S</div>
            <span className="font-display font-semibold tracking-tight">SoftGlaze</span>
          </div>

          {/* REGISTER — details */}
          {phase === 'register' && step === 'details' && (
            <>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">Create your account</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">This is your master account — the owner of the workspace.</p>
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls}>First name</label><input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus /></div>
                  <div><label className={labelCls}>Last name</label><input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
                </div>
                <div><label className={labelCls}>Email</label><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@workspace.com" /></div>
                <div><label className={labelCls}>Phone number</label><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+31 6 12345678" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls}>Password</label><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters" /></div>
                  <div><label className={labelCls}>Confirm</label><PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat" onKeyDown={(e) => { if (e.key === 'Enter') sendCode(); }} /></div>
                </div>
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={sendCode} className="mt-6 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-[11px] text-muted-dark mt-4 flex items-center justify-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Stored locally and encrypted on this device</p>
              <p className="text-center text-[12px] text-muted-dark mt-3">Already have an account? <button onClick={() => { setPhase('login'); setErr(''); }} className="text-primary hover:text-primary-hover font-medium">Log in</button></p>
              <SuperLink />
            </>
          )}

          {/* REGISTER — verify */}
          {phase === 'register' && step === 'verify' && (
            <>
              <button onClick={() => { setStep('details'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">Verify your email</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">Enter the 6-digit code sent to <span className="text-foreground">{email}</span>.</p>
              <OtpInput value={otp} onChange={setOtp} onComplete={(c) => verifyAndCreate(c)} />
              {devCode && (
                <div className="mt-4 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-[12px] text-primary">
                  Dev mode — no email is actually sent yet. Your code is <span className="font-mono font-semibold">{devCode}</span>.
                </div>
              )}
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={() => verifyAndCreate()} className="mt-6 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify & create account'}
              </button>
              <button onClick={resend} disabled={resendIn > 0 || busy} className="mt-3 w-full text-[12px] text-muted-dark hover:text-muted disabled:hover:text-muted-dark">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>
            </>
          )}

          {/* PLAN — choose how to start (after account creation) */}
          {phase === 'plan' && (
            <>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Sparkles className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">You're all set</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">Your account is ready with a <span className="text-foreground">7-day free trial</span>. Start now, or activate a paid plan.</p>
              <div className="space-y-2.5">
                <button onClick={startTrial} className="w-full flex items-center gap-3 p-3.5 rounded-lg border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors text-left">
                  <Clock className="w-5 h-5 text-primary shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">Start 7-day free trial</span><span className="block text-[11.5px] text-muted-dark">No payment now — explore everything.</span></span>
                  <ArrowRight className="w-4 h-4 text-muted-dark" />
                </button>
                {methods.length > 0 && (
                  <div className="rounded-lg border border-border p-3 space-y-2.5">
                    <span className="block text-[12px] font-semibold text-foreground flex items-center gap-1.5"><CreditCard className="w-4 h-4 text-primary" /> Activate a paid plan now</span>
                    <PayMethods methods={methods} busy={busy} onAutomated={buyWith} onManual={submitManualPay} />
                  </div>
                )}
              </div>
              <div className="mt-4">
                <label className="block text-[11px] font-medium text-muted mb-1.5"><KeyRound className="w-3 h-3 inline mr-1" />Have a purchase code?</label>
                <div className="flex items-center gap-2">
                  <input value={planCode} onChange={(e) => setPlanCode(e.target.value.toUpperCase())} placeholder="SG-XXXX-XXXX" className={inputCls + ' font-mono tracking-widest'} onKeyDown={(e) => { if (e.key === 'Enter') redeemPlan(); }} />
                  <button onClick={redeemPlan} disabled={busy || !planCode.trim()} className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] disabled:opacity-60">Redeem</button>
                </div>
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button onClick={startTrial} className="mt-5 w-full text-[12px] text-muted-dark hover:text-muted">Skip — start the trial</button>
            </>
          )}

          {/* LOGIN */}
          {phase === 'login' && (
            <>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{account?.firstName ? `Welcome back, ${account.firstName}` : 'Welcome back'}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">Sign in to unlock your workspace.</p>
              <div className="space-y-3.5">
                <div><label className={labelCls}>Email</label><input className={inputCls + ' disabled:opacity-70'} value={email} onChange={(e) => setEmail(e.target.value)} disabled={Boolean(account?.email)} /></div>
                <div>
                  <div className="flex items-center justify-between mb-1.5"><label className="text-[11px] font-medium text-muted">Password</label><button type="button" onClick={() => setForgot((f) => !f)} className="text-[11px] text-muted-dark hover:text-primary">Forgot?</button></div>
                  <PasswordInput value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="Master password" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') login(); }} />
                </div>
              </div>
              {forgot && <p className="text-[11.5px] text-muted mt-3 leading-relaxed">Your master password isn't recoverable on a local install — it never leaves this device. If it's lost, the workspace has to be reset from Settings.</p>}
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={login} className="mt-6 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Sign in <Lock className="w-4 h-4" /></>}
              </button>
              <p className="text-center text-[12px] text-muted-dark mt-4">Don't have an account? <button onClick={() => { setPhase('register'); setStep('details'); setErr(''); }} className="text-primary hover:text-primary-hover font-medium">Create one</button></p>
              <div className="flex items-center justify-center gap-4 mt-3 text-[11.5px]">
                <button onClick={() => { setPhase('invite'); setErr(''); }} className="text-muted-dark hover:text-primary">Have an invite code?</button>
                <span className="text-border">·</span>
                <button onClick={() => { setPhase('memberlogin'); setErr(''); }} className="text-muted-dark hover:text-primary">Team member sign in</button>
              </div>
              <SuperLink />
            </>
          )}

          {/* INVITE REDEMPTION */}
          {phase === 'invite' && (
            <>
              <button onClick={() => { setPhase(members.length ? 'login' : 'register'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">Redeem your invite</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">Enter the code you were given and set a password for your account.</p>
              <div className="space-y-3.5">
                <div><label className={labelCls}>Invite code</label><input className={inputCls + ' font-mono tracking-widest uppercase'} value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder="SG-XXXX-XXXX" autoFocus /></div>
                <div><label className={labelCls}>Your name <span className="text-muted-dark normal-case">(optional)</span></label><input className={inputCls} value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" /></div>
                <div><label className={labelCls}>Set a password</label><PasswordInput value={invitePass} onChange={(e) => setInvitePass(e.target.value)} placeholder="6+ characters" onKeyDown={(e) => { if (e.key === 'Enter') doAcceptInvite(); }} /></div>
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={doAcceptInvite} className="mt-6 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Join workspace <ArrowRight className="w-4 h-4" /></>}
              </button>
            </>
          )}

          {/* TEAM MEMBER LOGIN */}
          {phase === 'memberlogin' && (
            <>
              <button onClick={() => { setPhase(members.length ? 'login' : 'register'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Lock className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">Team member sign in</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">Use the email/name and password set when you redeemed your invite.</p>
              <div className="space-y-3.5">
                <div><label className={labelCls}>Email or name</label><input className={inputCls} value={memberIdf} onChange={(e) => setMemberIdf(e.target.value)} placeholder="you@workspace.com" autoFocus /></div>
                <div><label className={labelCls}>Password</label><PasswordInput value={memberPass} onChange={(e) => setMemberPass(e.target.value)} placeholder="Your password" onKeyDown={(e) => { if (e.key === 'Enter') doMemberLogin(); }} /></div>
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={doMemberLogin} className="mt-6 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Sign in <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-center text-[12px] text-muted-dark mt-4">Have an invite code instead? <button onClick={() => { setPhase('invite'); setErr(''); }} className="text-primary hover:text-primary-hover font-medium">Redeem it</button></p>
            </>
          )}

          {/* SUPER ADMIN */}
          {phase === 'super' && (
            <>
              <button onClick={() => { setPhase(members.length ? 'login' : 'register'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
              <div className="w-11 h-11 rounded-xl grid place-items-center mb-4" style={{ background: 'color-mix(in srgb, #f59e0b 14%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 28%, transparent)' }}><ShieldCheck className="w-5 h-5 text-amber-400" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">Super Admin</h1>
              {superNeedsSetup ? (
                <>
                  <p className="text-[12.5px] text-muted mt-1 mb-6">First-run setup. Create the Super Admin credential for <span className="text-foreground">this installation</span> — it's stored hashed on this device and is the only way in, so keep it safe.</p>
                  <div className="space-y-3.5">
                    <div><label className={labelCls}>Username</label><input className={inputCls} value={superId} onChange={(e) => setSuperId(e.target.value)} placeholder="superadmin" autoFocus /></div>
                    <div><label className={labelCls}>Password</label><PasswordInput value={superPass} onChange={(e) => setSuperPass(e.target.value)} placeholder="At least 8 characters" /></div>
                    <div><label className={labelCls}>Confirm password</label><PasswordInput value={superPass2} onChange={(e) => setSuperPass2(e.target.value)} placeholder="Re-enter password" onKeyDown={(e) => { if (e.key === 'Enter') doSuperSetup(); }} /></div>
                  </div>
                  {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
                  <button disabled={busy} onClick={doSuperSetup} className="mt-6 w-full h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-amber-500/25 transition-colors">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create credentials <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[12.5px] text-muted mt-1 mb-6">Source-owner access. Bypasses registration and unlocks the full workspace.</p>
                  <div className="space-y-3.5">
                    <div><label className={labelCls}>Username or email</label><input className={inputCls} value={superId} onChange={(e) => setSuperId(e.target.value)} placeholder="superadmin" autoFocus /></div>
                    <div><label className={labelCls}>Password</label><PasswordInput value={superPass} onChange={(e) => setSuperPass(e.target.value)} placeholder="Password" onKeyDown={(e) => { if (e.key === 'Enter') doSuperLogin(); }} /></div>
                  </div>
                  {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
                  <button disabled={busy} onClick={doSuperLogin} className="mt-6 w-full h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-amber-500/25 transition-colors">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Enter workspace <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </>
              )}
            </>
          )}

          {/* PICK */}
          {phase === 'pick' && (
            <>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">Who's working?</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">Select your member profile to continue.</p>
              <div className="space-y-1.5">
                {members.map((m) => (
                  <div key={m.id}>
                    <button onClick={() => pick(m)} className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-muted-dark hover:bg-secondary transition-colors text-left">
                      <span className="w-9 h-9 rounded-full grid place-items-center text-[12px] font-semibold" style={{ background: (m.color || '#6366f1') + '22', color: m.color || '#6366f1' }}>{m.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate">{m.name}</span>
                        <span className="block text-[11px] text-muted-dark capitalize">{String(m.role || '').toLowerCase()}{m.hasPin ? ' · PIN' : ''}</span>
                      </span>
                      {m.status === 'suspended' && <span className="text-[10.5px] text-red-400">Suspended</span>}
                    </button>
                    {pinFor === m.id && (
                      <div className="flex items-center gap-2 mt-1.5 mb-1">
                        <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') pick(m); }} placeholder="Enter PIN" className={inputCls} />
                        <button disabled={busy} onClick={() => pick(m)} className="h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px]">Go</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <div className="flex items-center justify-center gap-4 mt-5 text-[11.5px]">
                <button onClick={() => { setPhase('invite'); setErr(''); }} className="text-muted-dark hover:text-primary">Have an invite code?</button>
                <span className="text-border">·</span>
                <button onClick={() => { setPhase('memberlogin'); setErr(''); }} className="text-muted-dark hover:text-primary">Team member sign in</button>
              </div>
              <SuperLink />
            </>
          )}
        </div>
      </div>
    </div>
  );
}