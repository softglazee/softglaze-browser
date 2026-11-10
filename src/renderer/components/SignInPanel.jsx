import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Mail, ShieldCheck, ExternalLink, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { getStoredLang } from '@/lib/lang.js';
import { USE_CASES, LEAD_LIMITS } from '@/lib/signupLead.mjs';
import { signInErrorText, showGithub, sixDigits, canOfferMove, moveErrorKey } from '@/lib/signInFlow.mjs';

// One-click sign-in (1.0.26): "Continue with GitHub" (the system browser, then back to the app) and "Continue
// with email" (a 6-digit code). Used by the Gate for a new workspace (purpose 'signup') and for a one-click
// workspace after Sign out ('unlock'), and by Settings > Account ('link'). Main does the work and keeps the
// session token; this only draws the steps.

const inputCls = 'w-full h-10 bg-background/60 border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all placeholder:text-muted-dark disabled:opacity-70';
const labelCls = 'block text-[11px] font-medium text-muted mb-1.5';
const bigBtn = 'w-full h-11 rounded-xl font-semibold text-[13.5px] flex items-center justify-center gap-2.5 transition-all duration-200 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
// GitHub's own colours follow the theme: dark button on the light theme, light button on the dark one.
const githubBtn = `${bigBtn} bg-foreground text-background hover:opacity-90 shadow-sm`;
const emailBtn = `${bigBtn} border border-border bg-background/60 text-foreground hover:bg-secondary`;
const primaryBtn = 'mt-5 w-full h-11 rounded-xl bg-gradient-to-b from-primary to-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-all duration-200';
const linkBtn = 'text-[12px] text-muted-dark hover:text-primary transition-colors disabled:opacity-60';

export function GithubMark({ className = 'w-[18px] h-[18px]' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// purpose: 'signup' | 'unlock' | 'link'. info: signin.info() ({ tenant, providers, account }). lockedEmail: the
// workspace's own address (unlock). onDone(result) after a successful sign-in. onMoreOptions: the old form.
export default function SignInPanel({ purpose, info, lockedEmail = '', onDone, onMoreOptions, compact = false, heading = true }) {
  const { t } = useTranslation('signin');
  const { t: tg } = useTranslation('gate');
  const [step, setStep] = useState('choose'); // choose | email | code | waiting
  const [email, setEmail] = useState(lockedEmail || '');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const attempt = useRef(0); // only the newest GitHub attempt may change the screen
  const live = useRef(true);
  const github = showGithub(info);

  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => { if (lockedEmail) setEmail(lockedEmail); }, [lockedEmail]);
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const id = setInterval(() => setResendIn((x) => x - 1), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  async function startGithub(mode) {
    const mine = ++attempt.current;
    setErr(''); setStep('waiting');
    try {
      const r = await softglazeApi.signin.start('github', purpose, mode);
      if (!live.current || mine !== attempt.current) return;
      onDone(r);
    } catch (e) {
      if (!live.current || mine !== attempt.current) return;
      const text = signInErrorText(t, tg, e);
      setErr(text || ''); setStep('choose');
    }
  }

  async function cancelGithub() {
    attempt.current += 1;
    setStep('choose'); setErr('');
    try { await softglazeApi.signin.cancel(); } catch (_) { /* nothing pending */ }
  }

  async function sendCode(e) {
    if (e) e.preventDefault();
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const r = await softglazeApi.signin.emailStart(email.trim().toLowerCase(), purpose, getStoredLang());
      if (!live.current) return;
      setDevCode(r && r.devCode ? String(r.devCode) : '');
      setCode(''); setResendIn(60); setStep('code');
    } catch (ex) { if (live.current) setErr(signInErrorText(t, tg, ex) || ''); }
    finally { if (live.current) setBusy(false); }
  }

  async function verify(e, value) {
    if (e) e.preventDefault();
    const c = sixDigits(value ?? code);
    if (busy || c.length !== 6) return;
    setErr(''); setBusy(true);
    try {
      const r = await softglazeApi.signin.emailVerify(email.trim().toLowerCase(), c, purpose);
      if (!live.current) return;
      setBusy(false);
      onDone(r);
    } catch (ex) {
      if (!live.current) return;
      setErr(signInErrorText(t, tg, ex) || ''); setBusy(false);
    }
  }

  const titleCls = compact ? 'font-display text-[16px] font-semibold tracking-tight' : 'font-display text-[20px] font-semibold tracking-tight';
  const errBox = err ? <p role="alert" className="text-[12px] text-red-400 mt-3 leading-relaxed">{err}</p> : null;

  if (step === 'waiting') {
    return (
      <div aria-live="polite">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><GithubMark className="w-5 h-5" /></div>
        <h2 className={titleCls}>{t('waiting.title')}</h2>
        <p className="text-[12.5px] text-muted mt-1 leading-relaxed">{t('waiting.body', { provider: 'GitHub' })}</p>
        <div className="mt-5 flex items-center gap-2.5 text-[12.5px] text-muted"><Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" /> <span className="min-w-0">{t('waiting.status', { provider: 'GitHub' })}</span></div>
        <div className="mt-5 flex flex-col gap-2.5">
          <button type="button" onClick={() => startGithub('auto')} className={emailBtn}><ExternalLink className="w-4 h-4" /> {t('waiting.reopen')}</button>
          <button type="button" onClick={() => startGithub('loopback')} className={linkBtn}>{t('waiting.anotherWay')}</button>
          <button type="button" onClick={cancelGithub} className={linkBtn}>{t('waiting.cancel')}</button>
        </div>
      </div>
    );
  }

  if (step === 'email' || step === 'code') {
    return (
      <div>
        <button type="button" onClick={() => { setStep(step === 'code' && !lockedEmail ? 'email' : 'choose'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5">
          <ArrowLeft className="w-3.5 h-3.5" /> {step === 'code' && !lockedEmail ? t('email.change') : t('back')}
        </button>
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
        {step === 'email' ? (
          <form noValidate onSubmit={sendCode}>
            <h2 className={titleCls}>{t('email.title')}</h2>
            <p className="text-[12.5px] text-muted mt-1 mb-5">{t('email.subtitle')}</p>
            <label htmlFor={`si-${purpose}-email`} className={labelCls}>{t('email.label')}</label>
            <input id={`si-${purpose}-email`} type="email" autoComplete="email" autoFocus={!lockedEmail} disabled={Boolean(lockedEmail)}
              className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email.placeholder')} />
            {errBox}
            <button type="submit" disabled={busy || !email.trim()} className={primaryBtn}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('email.send')} <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        ) : (
          <form noValidate onSubmit={verify}>
            <h2 className={titleCls}>{t('email.codeTitle')}</h2>
            <p className="text-[12.5px] text-muted mt-1 mb-5 break-words">{t('email.codeBody', { email: email.trim().toLowerCase() })}</p>
            <label htmlFor={`si-${purpose}-code`} className={labelCls}>{t('email.codeLabel')}</label>
            <input id={`si-${purpose}-code`} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
              className={`${inputCls} h-12 text-center font-mono text-[20px] tracking-[0.5em]`}
              value={code} onChange={(e) => { const v = sixDigits(e.target.value); setCode(v); if (v.length === 6) verify(null, v); }} />
            {devCode && <p className="mt-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-[12px] text-primary">{t('email.devCode', { code: devCode })}</p>}
            {!devCode && <p className="mt-3 text-[11.5px] text-muted-dark leading-relaxed">{t('email.checkSpam')}</p>}
            {errBox}
            <button type="submit" disabled={busy || code.length !== 6} className={primaryBtn}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('email.verify')} <Check className="w-4 h-4" /></>}
            </button>
            <button type="button" onClick={() => sendCode()} disabled={resendIn > 0 || busy} className={`mt-3 w-full ${linkBtn}`}>
              {resendIn > 0 ? t('email.resendIn', { count: resendIn }) : t('email.resend')}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div>
      {heading && purpose === 'signup' && (
        <>
          <h1 className={titleCls}>{t('choose.title')}</h1>
          <p className="text-[12.5px] text-muted mt-1 mb-6">{t('choose.subtitle')}</p>
        </>
      )}
      <div className="flex flex-col gap-3">
        {github && (
          <button type="button" onClick={() => startGithub('auto')} className={githubBtn}>
            <GithubMark /> {t('choose.github')}
          </button>
        )}
        <button type="button" onClick={() => { setErr(''); setStep('email'); }} className={emailBtn}>
          <Mail className="w-[18px] h-[18px]" /> {t('choose.email')}
        </button>
      </div>
      {errBox}
      {onMoreOptions && (
        <>
          <div className="flex items-center gap-3 my-5" aria-hidden="true">
            <span className="h-px flex-1 bg-border" /><span className="text-[11px] uppercase tracking-wider text-muted-dark">{t('choose.or')}</span><span className="h-px flex-1 bg-border" />
          </div>
          <button type="button" onClick={onMoreOptions} className="w-full text-center group">
            <span className="block text-[12.5px] font-semibold text-primary group-hover:text-primary-hover">{t('choose.moreOptions')}</span>
            <span className="block text-[11px] text-muted-dark mt-0.5">{t('choose.moreOptionsHint')}</span>
          </button>
        </>
      )}
      {!compact && purpose === 'signup' && (
        <p className="text-[11px] text-muted-dark mt-5 flex items-center justify-center gap-1.5 text-center"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {t('choose.privacy')}</p>
      )}
    </div>
  );
}

// "What will you use SoftGlaze for?": optional, once after a one-click sign-up.
export function UseCaseStep({ onDone }) {
  const { t } = useTranslation('signin');
  const { t: tg } = useTranslation('gate');
  const [useCase, setUseCase] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault();
    if (!useCase || busy) return;
    if (useCase === 'other' && !other.trim()) { setErr(tg('serverErrors.SIGNUP_USE_CASE_OTHER')); return; }
    setBusy(true); setErr('');
    try { await softglazeApi.signin.saveUseCase({ useCase, useCaseOther: useCase === 'other' ? other.trim() : undefined }); onDone(); }
    catch (ex) { setErr(signInErrorText(t, tg, ex) || ''); setBusy(false); }
  }

  return (
    <form noValidate onSubmit={save}>
      <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('useCase.title')}</h1>
      <p className="text-[12.5px] text-muted mt-1 mb-5">{t('useCase.subtitle')}</p>
      <fieldset>
        <legend className="sr-only">{t('useCase.title')}</legend>
        <div className="grid gap-2">
          {USE_CASES.map((k) => (
            <label key={k} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer text-[12.5px] transition-colors ${useCase === k ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:bg-secondary text-foreground'}`}>
              <input type="radio" name="usecase" value={k} checked={useCase === k} onChange={() => setUseCase(k)} className="accent-[var(--primary)]" />
              <span className="min-w-0">{tg(`lead.useCases.${k}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {useCase === 'other' && (
        <div className="mt-3">
          <label htmlFor="uc-other" className={labelCls}>{tg('lead.useCaseOther')}</label>
          <input id="uc-other" maxLength={LEAD_LIMITS.useCaseOther} className={inputCls} value={other} onChange={(e) => setOther(e.target.value)} placeholder={tg('lead.useCaseOtherPlaceholder')} />
        </div>
      )}
      {err && <p role="alert" className="text-[12px] text-red-400 mt-3">{err}</p>}
      <button type="submit" disabled={busy || !useCase} className={primaryBtn}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('useCase.continue')} <ArrowRight className="w-4 h-4" /></>}
      </button>
      <button type="button" onClick={onDone} disabled={busy} className={`mt-3 w-full ${linkBtn}`}>{t('useCase.skip')}</button>
    </form>
  );
}

// Sign-in on another computer: the account's licence is on another PC, and the plan step offers to move it here
// (the same texts and limit as moving a Microsoft Store subscription: billing.json store.result.inUse /
// moveLimit). Shows nothing when there is nothing to move or the server cannot be asked.
export function MoveLicenceCard({ onMoved }) {
  const { t } = useTranslation('signin');
  const { t: tg } = useTranslation('gate');
  const { t: tb } = useTranslation('billing');
  const [licence, setLicence] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    softglazeApi.signin.licenceState().then((l) => { if (on) setLicence(l); }).catch(() => {});
    return () => { on = false; };
  }, []);
  if (!canOfferMove(licence)) return null;

  async function move() {
    if (busy) return;
    setBusy(true); setErr('');
    try { await softglazeApi.signin.moveLicence(); setBusy(false); onMoved(); }
    catch (e) {
      const key = moveErrorKey(e);
      setErr(key ? tb(key) : (signInErrorText(t, tg, e, 'errors.MOVE_FAILED') || ''));
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-primary/40 bg-primary/5 p-3.5">
      <span className="block text-[13px] font-semibold">{t('move.title')}</span>
      <p className="text-[11.5px] text-muted mt-0.5 leading-relaxed">{tb('store.result.inUse')}</p>
      {err && <p role="alert" className="text-[12px] text-red-400 mt-2 leading-relaxed">{err}</p>}
      <button type="button" onClick={move} disabled={busy} className="mt-3 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : tb('store.moveHere')}
      </button>
    </div>
  );
}
