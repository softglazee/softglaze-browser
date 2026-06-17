import { useEffect, useRef, useState } from 'react';
import {
  Lock, ArrowRight, ArrowLeft, Loader2, ShieldCheck, Eye, EyeOff,
  Fingerprint, Globe, Mail
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

const inputCls = 'w-full h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-zinc-100 outline-none focus:border-primary transition-colors placeholder:text-muted-dark';
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
          className="w-11 h-12 text-center text-lg font-semibold bg-background border border-border rounded-lg text-zinc-100 outline-none focus:border-primary transition-colors"
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
            <li key={i} className="flex items-center gap-3 text-[13px] text-zinc-200">
              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Icon className="w-4 h-4" /></span>{t}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative text-[11px] text-muted-dark">© {new Date().getFullYear()} SoftGlaze · Local workspace</div>
    </div>
  );
}

export default function Gate({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | register | login | pick | ready
  const [members, setMembers] = useState([]);
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
      setPhase('ready');
    } catch (e) { setPhase('ready'); }
  }
  useEffect(() => { evaluate(); }, []);
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
      setPhase('ready');
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
      setPhase('ready');
    } catch (e) { setErr(e.message || 'Incorrect password.'); setBusy(false); }
  }

  async function pick(m) {
    setErr('');
    if (m.hasPin && pinFor !== m.id) { setPinFor(m.id); setPin(''); return; }
    setBusy(true);
    try { await softglazeApi.members.switch(m.id, m.hasPin ? pin : undefined); setPhase('ready'); }
    catch (e) { setErr(e.message || 'Could not sign in.'); setBusy(false); }
  }

  if (phase === 'ready') return children;
  if (phase === 'loading') {
    return <div className="h-screen w-full bg-background grid place-items-center"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>;
  }

  return (
    <div className="h-screen w-full bg-background text-zinc-100 font-sans grid md:grid-cols-2">
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
            </>
          )}

          {/* REGISTER — verify */}
          {phase === 'register' && step === 'verify' && (
            <>
              <button onClick={() => { setStep('details'); setErr(''); }} className="text-[12px] text-muted hover:text-zinc-100 flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">Verify your email</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">Enter the 6-digit code sent to <span className="text-zinc-200">{email}</span>.</p>
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
                    <button onClick={() => pick(m)} className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-muted-dark hover:bg-white/5 transition-colors text-left">
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}