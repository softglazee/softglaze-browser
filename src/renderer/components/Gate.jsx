import { useEffect, useRef, useState } from 'react';
import {
  Lock, ArrowRight, ArrowLeft, Loader2, ShieldCheck, Eye, EyeOff,
  Fingerprint, Globe, Mail, Clock, KeyRound, LogOut, Sparkles, CreditCard, AlertTriangle, Check,
  Landmark, ExternalLink, Sun, Moon, ChevronDown, Zap, Store, RotateCcw
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { getStoredTheme, setTheme } from '@/lib/theme.js';
import { getStoredLang, setLang, SUPPORTED_LANGS } from '@/lib/lang.js';
import { errorText, otpExtras, phaseForLicense, trialNeedsCode, trialPayload, paidPlans, defaultPlanId, formatPrice, confirmPhase, isOurSideError } from '@/lib/signupFlow.mjs';
import { USE_CASES, leadError, leadPayload, LEAD_LIMITS } from '@/lib/signupLead.mjs';
import billingEn from '@/i18n/locales/en/billing.json';
import { isStoreMethod, storeOutcome, storePrice, methodsForPlan, sellablePlans, STORE_POLL } from '@/lib/storePurchase.mjs';
import { BILLING_PERIODS, billingPeriodOf, hasBothPeriods, plansForPeriod, counterpartPlan, yearlyDeal } from '@/lib/planPeriods.mjs';
import { noteGatePhase } from '@/lib/storeRating.mjs';

const inputCls = 'w-full h-10 bg-background/60 border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all placeholder:text-muted-dark';
const labelCls = 'block text-[11px] font-medium text-muted mb-1.5';
// Shared primary CTA for every continue / sign in / create button.
const primaryBtn = 'mt-6 w-full h-11 rounded-xl bg-gradient-to-b from-primary to-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow transition-all duration-200 hover:shadow-[0_10px_28px_-8px_rgba(59,130,246,0.65)] hover:-translate-y-px active:translate-y-0';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Decorative background behind the form column.
function AuthAura() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-24 left-1/4 w-[26rem] h-[26rem] rounded-full bg-primary/10 blur-[130px] animate-float-slow" />
      <div className="absolute -bottom-24 -right-16 w-96 h-96 rounded-full bg-accent/10 blur-[130px] animate-float-slower" />
    </div>
  );
}

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

// When ticked, the login secret is sealed with the OS keychain (DPAPI) and replayed at the next
// start, so the password is not asked again. See rememberStore.js (main).
function RememberToggle({ checked, onChange }) {
  const { t } = useTranslation('gate');
  // rememberStore refuses to persist a login secret without an OS keychain (it must never hit disk
  // in the clear), so say why "keep me signed in" is unavailable instead of failing silently.
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let live = true;
    if (softglazeApi.auth && softglazeApi.auth.rememberStatus) {
      softglazeApi.auth.rememberStatus()
        .then((s) => { if (live && s) setAvailable(s.available !== false); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, []);
  return (
    <div className="mt-4">
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className="w-[18px] h-[18px] rounded-[5px] border grid place-items-center transition-colors shrink-0"
          style={{ borderColor: checked ? 'var(--primary)' : 'var(--border)', background: checked ? 'var(--primary)' : 'transparent' }}
        >
          {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
        <span className="text-[12px] text-muted">{t('remember.label')}</span>
      </label>
      {checked && !available && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          {t('remember.unavailable', "This device can't securely store a login (OS encryption is unavailable), so you'll be asked to sign in again next launch.")}
        </p>
      )}
    </div>
  );
}

// Tenant sign-up: marketing emails only with this box ticked (unticked by default). Account and trial
// emails are transactional and always sent, which the note says.
function ConsentToggle({ checked, onChange }) {
  const { t } = useTranslation('gate');
  return (
    <div className="mt-4">
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0 accent-primary cursor-pointer" />
        <span className="text-[12px] text-muted">{t('register.consent')}</span>
      </label>
      <p className="mt-1.5 text-[11px] text-muted-dark leading-relaxed">{t('register.consentNote')}</p>
    </div>
  );
}

// Tenant sign-up and "Confirm your email": phone (optional, with the country code), what they will use
// SoftGlaze for (required), and company or website (optional). Rules: src/renderer/lib/signupLead.mjs.
function LeadFields({ idPrefix, phone, setPhone, useCase, setUseCase, useCaseOther, setUseCaseOther, company, setCompany }) {
  const { t } = useTranslation('gate');
  const id = (k) => `${idPrefix}-${k}`;
  return (
    <>
      <div>
        <label htmlFor={id('phone')} className={labelCls}>{t('register.phoneOptional')}</label>
        <input id={id('phone')} type="tel" inputMode="tel" autoComplete="tel" maxLength={LEAD_LIMITS.phone} className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('register.phoneIntlPlaceholder')} aria-describedby={id('phone-hint')} />
        <p id={id('phone-hint')} className="mt-1 text-[10.5px] text-muted-dark">{t('register.phoneHint')}</p>
      </div>
      <div>
        <label htmlFor={id('usecase')} className={labelCls}>{t('lead.useCase')}</label>
        <div className="relative">
          <select id={id('usecase')} required aria-required="true" className={inputCls + ' appearance-none pr-9 cursor-pointer' + (useCase ? '' : ' text-muted-dark')} value={useCase} onChange={(e) => setUseCase(e.target.value)}>
            <option value="" disabled className="bg-background text-muted-dark">{t('lead.useCasePlaceholder')}</option>
            {USE_CASES.map((k) => <option key={k} value={k} className="bg-background text-foreground">{t(`lead.useCases.${k}`)}</option>)}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-dark" />
        </div>
      </div>
      {useCase === 'other' && (
        <div>
          <label htmlFor={id('usecase-other')} className={labelCls}>{t('lead.useCaseOther')}</label>
          <input id={id('usecase-other')} maxLength={LEAD_LIMITS.useCaseOther} className={inputCls} value={useCaseOther} onChange={(e) => setUseCaseOther(e.target.value)} placeholder={t('lead.useCaseOtherPlaceholder')} />
        </div>
      )}
      <div>
        <label htmlFor={id('company')} className={labelCls}>{t('lead.company')}</label>
        <input id={id('company')} autoComplete="organization" maxLength={LEAD_LIMITS.company} className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t('lead.companyPlaceholder')} />
      </div>
    </>
  );
}

// The built-in plan texts are English data; show them in the UI language (as the Billing page does).
const PLAN_TEXT_KEY = new Map(Object.entries(billingEn.planText || {}).map(([key, text]) => [text, key]));

// Tenant plan step: the paid plans with their prices and main features, from the licensing server
// (or the built-in list when it cannot be reached). With monthly and yearly plans for sale, a Monthly /
// Yearly switch shows one period at a time and keeps the chosen tier when it flips (planPeriods.mjs).
function PlanPicker({ plans, selected, onSelect, storeInfo = null }) {
  const { t } = useTranslation('gate');
  const { t: tb } = useTranslation('billing');
  const text = (s) => { const k = PLAN_TEXT_KEY.get(s); return k ? tb(`planText.${k}`) : s; };
  const [period, setPeriod] = useState(null);
  const selPlan = plans.find((p) => p.id === selected) || null;
  const activePeriod = period || billingPeriodOf(selPlan) || 'month';
  const shown = plansForPeriod(plans, activePeriod);
  function pickPeriod(next) {
    setPeriod(next);
    const to = counterpartPlan(selPlan, plans, next) || plansForPeriod(plans, next).find((p) => p.kind !== 'trial');
    if (to && to.id !== selected) onSelect(to.id);
  }
  return (
    <div className="space-y-2">
    {hasBothPeriods(plans) && (
      <div role="group" aria-label={tb('period.label')} className="inline-flex items-center rounded-lg border border-border p-0.5">
        {BILLING_PERIODS.map((p) => (
          <button key={p} type="button" aria-pressed={activePeriod === p} onClick={() => pickPeriod(p)} className={`h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors ${activePeriod === p ? 'bg-primary/15 text-foreground' : 'text-muted-dark hover:text-foreground'}`}>
            {p === 'year' ? tb('period.yearly') : tb('period.monthly')}
          </button>
        ))}
      </div>
    )}
    <div role="radiogroup" aria-label={t('plan.choosePlan')} className="grid grid-cols-2 gap-2">
      {shown.map((p) => {
        const active = p.id === selected;
        const deal = storePrice(storeInfo, p) ? null : yearlyDeal(p, plans);
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(p.id)}
            className="relative flex flex-col justify-start text-left rounded-lg border px-3 py-2.5 transition-colors"
            style={active
              ? { borderColor: 'color-mix(in srgb, var(--primary) 55%, transparent)', background: 'color-mix(in srgb, var(--primary) 8%, transparent)' }
              : { borderColor: 'var(--border)' }}
          >
            <span className="flex w-full items-center justify-between gap-2 min-h-[18px]">
              <span className="text-[12.5px] font-semibold text-foreground truncate">{p.name}</span>
              {active ? <Check className="w-3.5 h-3.5 text-primary shrink-0" /> : (p.highlight && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary shrink-0">{tb('plans.bestValue')}</span>)}
            </span>
            <span className="block mt-1">
              <span className="font-display text-[18px] font-semibold text-foreground">{storePrice(storeInfo, p) || formatPrice(p.amount, p.currency)}</span>
              <span className="text-[11px] text-muted-dark"> / {p.period}</span>
            </span>
            {deal && (
              <span className="block text-[10.5px] leading-snug text-muted-dark">
                {tb('period.billedYearly', { perMonth: formatPrice(deal.perMonth, p.currency) })}{deal.monthsFree ? ` · ${tb('period.monthsFreeShort', { count: deal.monthsFree })}` : ''}
              </span>
            )}
            {Array.isArray(p.features) && p.features.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {p.features.slice(0, 3).map((f, i) => (
                  <li key={i} className="flex items-start gap-1 text-[10.5px] leading-snug text-muted">
                    <Check className="w-3 h-3 mt-px text-emerald-500 shrink-0" /><span className="min-w-0">{text(f)}</span>
                  </li>
                ))}
              </ul>
            )}
          </button>
        );
      })}
    </div>
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

// Self-contained slides (gradient + icon): no bundled photos, so the screen works offline.
// Each key maps to a gate.brand.slides.<key> {title, body} i18n pair.
const SLIDES = [
  { key: 'security', Icon: ShieldCheck, from: '#0b3b8f', via: '#0a1730', accent: '#3b82f6' },
  { key: 'fingerprint', Icon: Fingerprint, from: '#3b1d6e', via: '#160b2c', accent: '#8b5cf6' },
  { key: 'proxy', Icon: Globe, from: '#065f46', via: '#062018', accent: '#10b981' },
  { key: 'automation', Icon: Zap, from: '#7c2d12', via: '#241006', accent: '#f59e0b' }
];

// Auto-rotating brand carousel with manual dot controls.
function CarouselPanel() {
  const { t } = useTranslation('gate');
  const [i, setI] = useState(0);
  const n = SLIDES.length;
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % n), 5500);
    return () => clearInterval(id);
  }, [n]);
  const slide = SLIDES[i];
  const Icon = slide.Icon;
  return (
    <div className="relative hidden md:flex flex-col overflow-hidden border-r border-border">
      {SLIDES.map((s, idx) => (
        <div
          key={s.key}
          aria-hidden
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: idx === i ? 1 : 0, background: `linear-gradient(150deg, ${s.from} 0%, ${s.via} 55%, #06070d 100%)` }}
        />
      ))}
      <div aria-hidden className="absolute inset-0 auth-grid opacity-40" />
      <div aria-hidden className="absolute -top-24 -left-20 w-96 h-96 rounded-full blur-[130px] animate-float-slow" style={{ background: `${slide.accent}40` }} />
      <div aria-hidden className="absolute bottom-16 -right-16 w-80 h-80 rounded-full blur-[130px] animate-float-slower" style={{ background: `${slide.accent}33` }} />

      <div className="relative flex items-center gap-3 p-9">
        <img src="/logos/app-source-512.png" alt="SoftGlaze" className="w-10 h-10 object-contain drop-shadow-[0_2px_16px_rgba(59,130,246,0.6)]" draggable={false} />
        <div className="flex flex-col leading-none">
          <span className="font-display font-semibold text-[17px] tracking-tight text-white">SoftGlaze</span>
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase mt-1" style={{ color: slide.accent }}>{t('brand.tagline')}</span>
        </div>
      </div>

      <div className="relative flex-1 grid place-items-center px-10">
        <div className="relative grid place-items-center">
          <div aria-hidden className="absolute w-60 h-60 rounded-full border animate-aurora" style={{ borderColor: `${slide.accent}3a` }} />
          <div aria-hidden className="absolute w-44 h-44 rounded-full border" style={{ borderColor: `${slide.accent}2a` }} />
          <div className="relative w-28 h-28 rounded-3xl grid place-items-center backdrop-blur-sm shadow-2xl" style={{ background: `${slide.accent}1f`, border: `1px solid ${slide.accent}55` }}>
            <Icon className="w-12 h-12" style={{ color: slide.accent }} strokeWidth={1.5} />
          </div>
        </div>
      </div>

      <div className="relative p-10">
        <h2 key={slide.key} className="font-display text-white text-[30px] font-semibold leading-tight tracking-tight animate-fade-up">
          {t(`brand.slides.${slide.key}.title`)}
        </h2>
        <p className="text-[13.5px] text-white/70 mt-3 max-w-md leading-relaxed">{t(`brand.slides.${slide.key}.body`)}</p>
        <div className="flex items-center gap-2 mt-7">
          {SLIDES.map((s, idx) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setI(idx)}
              aria-label={t(`brand.slides.${s.key}.title`)}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: idx === i ? 28 : 8, background: idx === i ? '#ffffff' : 'rgba(255,255,255,0.35)' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeLangControls() {
  const [theme, setThemeState] = useState(getStoredTheme());
  const [lang, setLangState] = useState(getStoredLang());
  const [open, setOpen] = useState(false);
  const isDark = theme === 'dark';
  const cur = SUPPORTED_LANGS.find((l) => l.code === lang) || SUPPORTED_LANGS[0];
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[12.5px] text-muted-foreground hover:text-foreground hover:border-muted-dark transition-colors"
        >
          <Globe className="w-4 h-4" /> {cur.native} <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-40 rounded-lg border border-border bg-popover shadow-xl py-1 z-50">
            {SUPPORTED_LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onMouseDown={() => { setLangState(setLang(l.code)); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-left hover:bg-secondary ${l.code === lang ? 'text-primary' : 'text-foreground'}`}
              >
                {l.native}{l.code === lang && <Check className="w-3.5 h-3.5 ml-auto" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setThemeState(setTheme(isDark ? 'light' : 'dark'))}
        title={isDark ? 'Switch to light' : 'Switch to dark'}
        className="h-9 w-9 grid place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-muted-dark transition-colors"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    </div>
  );
}

// Licence notices (machine mismatch, grace, trial ending, trial days) are drawn once, by AppShell
// (components/LicenseNotice.jsx), in the page flow. Gate draws none, so they never stack or cover
// the page; it only blocks the app with BannedScreen when the licence has fully ended.

// Shows only the methods the admin enabled: automated opens hosted checkout (caller polls),
// manual submits a reference for admin approval.
function PayMethods({ methods, busy, onAutomated, onManual, store = null }) {
  const { t } = useTranslation('gate');
  const { t: tb } = useTranslation('billing');
  const [sel, setSel] = useState(() => (methods[0] ? methods[0].id : null));
  const [reference, setReference] = useState('');
  const [done, setDone] = useState(false);
  // Methods load async: select the first once they arrive, or a banned user sees no pay button. The list
  // also changes with the chosen plan (the Microsoft Store only sells plans it has an add-on for).
  useEffect(() => { if (!methods.some((m) => m.id === sel)) setSel(methods[0] ? methods[0].id : null); }, [methods]);
  const cur = methods.find((m) => m.id === sel) || null;

  if (!methods.length) {
    return <p className="text-[12px] text-muted-dark">{t('pay.noMethods')}</p>;
  }
  if (done) {
    return (
      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-[12px] text-emerald-400">
        <Check className="w-4 h-4 inline mr-1.5" /> {t('pay.submitted')}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {methods.map((m) => {
          const active = m.id === sel;
          const Icon = m.kind === 'manual' ? Landmark : (isStoreMethod(m) ? Store : CreditCard);
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
              {m.kind === 'manual' && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{t('pay.manualBadge')}</span>}
              {active && <Check className="w-4 h-4 text-primary" />}
            </button>
          );
        })}
      </div>

      {cur && isStoreMethod(cur) && store && (
        <div className="space-y-2">
          <button onClick={() => store.onBuy(cur)} disabled={busy} className="w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />}
            {store.price ? tb('store.buyWithPrice', { price: store.price }) : tb('store.buyWith')}
          </button>
          <p className="text-[11px] text-muted-dark">{tb('store.processedBy')}</p>
          {store.message && <p role="status" className={`text-[12px] ${store.messageTone === 'error' ? 'text-red-400' : 'text-foreground'}`}>{store.message}</p>}
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => store.onRestore(false)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-muted-dark hover:text-foreground disabled:opacity-60"><RotateCcw className="w-3.5 h-3.5" /> {tb('store.restore')}</button>
            {store.canMove && <button type="button" onClick={() => store.onRestore(true)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary disabled:opacity-60">{tb('store.moveHere')}</button>}
          </div>
        </div>
      )}

      {cur && cur.kind === 'automated' && (
        <button onClick={() => onAutomated(cur)} disabled={busy} className="w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} {t('pay.continueTo', { label: cur.label })}
        </button>
      )}

      {cur && cur.kind === 'manual' && (
        <div className="space-y-2">
          {cur.instructions && <div className="rounded-lg bg-secondary/40 border border-border p-2.5 text-[11.5px] text-foreground/90 whitespace-pre-wrap">{cur.instructions}</div>}
          {cur.payLink && <a href={cur.payLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary"><ExternalLink className="w-3.5 h-3.5" /> {t('pay.openPaymentLink')}</a>}
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('pay.referencePlaceholder')} className="w-full h-9 bg-background border border-border rounded-lg px-3 text-[12.5px] text-foreground outline-none focus:border-primary" />
          <button
            onClick={async () => { const ok = await onManual(cur, { reference: reference.trim(), note: '' }); if (ok) setDone(true); }}
            disabled={busy}
            className="w-full h-10 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('pay.submitForApproval')}
          </button>
        </div>
      )}
    </div>
  );
}

// Full-screen blocking gate when the owner tree is banned (trial + grace lapsed).
// No workspace access - only renew / redeem / contact / sign out.
function BannedScreen({ account, license, methods, plans = [], selPlanId, onSelectPlan, planCode, setPlanCode, busy, err, onRedeem, onAutomated, onManual, onSignOut, store = null, storeInfo = null }) {
  const { t } = useTranslation('gate');
  const adminBlocked = Boolean(license?.adminBlocked);
  return (
    <div className="h-screen w-full bg-background text-foreground font-sans grid place-items-center p-6">
      <div className="w-full max-w-[440px]">
        <div className="w-12 h-12 rounded-xl grid place-items-center mb-4" style={{ background: 'color-mix(in srgb, #ef4444 14%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 28%, transparent)' }}><Lock className="w-6 h-6 text-red-400" /></div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight">{adminBlocked ? t('banned.blockedHeading') : t('banned.endedHeading')}</h1>
        <p className="text-[13px] text-muted mt-1.5 mb-6">
          {license?.reason === 'machine_mismatch'
            ? t('license.machineMismatch')
            : adminBlocked
              ? (account?.firstName ? t('banned.blockedBodyNamed', { name: account.firstName }) : t('banned.blockedBody'))
              : (account?.firstName ? t('banned.endedBodyNamed', { name: account.firstName }) : t('banned.endedBody'))}
        </p>

        {!adminBlocked && (
          <>
            {plans.length > 0 && <div className="mb-3"><PlanPicker plans={plans} selected={selPlanId} onSelect={onSelectPlan} storeInfo={storeInfo} /></div>}
            <PayMethods methods={methods} busy={busy} onAutomated={onAutomated} onManual={onManual} store={store} />
            <div className="mt-5">
              <label className="block text-[11px] font-medium text-muted mb-1.5"><KeyRound className="w-3 h-3 inline mr-1" />{t('banned.haveCode')}</label>
              <div className="flex items-center gap-2">
                <input value={planCode} onChange={(e) => setPlanCode(e.target.value.toUpperCase())} placeholder="SG-XXXX-XXXX" className="flex-1 h-10 bg-background border border-border rounded-lg px-3 text-[13px] font-mono tracking-widest text-foreground outline-none focus:border-primary" onKeyDown={(e) => { if (e.key === 'Enter') onRedeem(); }} />
                <button onClick={onRedeem} disabled={busy || !planCode.trim()} className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] disabled:opacity-60">{t('common.redeem')}</button>
              </div>
            </div>
          </>
        )}

        {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}

        <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-[12px] text-muted-dark">
          <span>{t('banned.needHelp')}</span>
          <button onClick={onSignOut} className="inline-flex items-center gap-1.5 hover:text-foreground"><LogOut className="w-3.5 h-3.5" /> {t('banned.signOut')}</button>
        </div>
      </div>
    </div>
  );
}

export default function Gate({ children }) {
  const { t } = useTranslation('gate');
  const { t: tb } = useTranslation('billing');
  const [phase, setPhase] = useState('loading'); // loading | register | login | pick | confirm | confirmMember | plan | licensing | banned | ready
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

  // Tenant (sellable) builds: our licensing server sends and checks the code and starts the trial.
  const [tenant, setTenant] = useState(false);
  const [consent, setConsent] = useState(false); // "Email me product news and tips": unticked by default
  const [plans, setPlans] = useState([]); // paid plans with server prices (built-in list when offline)
  const [selPlanId, setSelPlanId] = useState(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialErr, setTrialErr] = useState('');
  const [trialCodeFor, setTrialCodeFor] = useState(''); // email the server sent a confirmation code to
  // Microsoft Store build: Store prices and the result of the last Store purchase / restore.
  const [storeInfo, setStoreInfo] = useState(null);
  const [storeMsg, setStoreMsg] = useState(null); // { text, tone, canMove }
  const [trialCode, setTrialCode] = useState('');
  // Lead details (tenant sign-up and the confirm step): what they will use SoftGlaze for, company.
  const [useCase, setUseCase] = useState('');
  const [useCaseOther, setUseCaseOther] = useState('');
  const [company, setCompany] = useState('');
  // "Confirm your email" (tenant builds, workspaces made before server sign-up): details | code.
  const [confirmStep, setConfirmStep] = useState('details');
  const [canDefer, setCanDefer] = useState(false);

  // login / pick
  const [loginPass, setLoginPass] = useState('');
  const [remember, setRemember] = useState(true); // default on; DPAPI-sealed to this Windows account, cleared on opt-out or sign-out
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
      const [vs, acct, cur, list, backend] = await Promise.all([
        // Fail closed: an unreadable vault status counts as locked, so a read error never skips the gate.
        softglazeApi.vault.status().catch(() => ({ enabled: true, locked: true })),
        softglazeApi.account.get().catch(() => null),
        softglazeApi.members.current().catch(() => null),
        softglazeApi.members.list().catch(() => []),
        // Readable before sign-in only on a fresh workspace, which is when sign-up needs it.
        softglazeApi.license.backendInfo().catch(() => null)
      ]);
      const ms = Array.isArray(list) ? list : [];
      setMembers(ms); setAccount(acct);
      if (backend && backend.enabled) setTenant(true);
      if (acct?.email) setEmail(acct.email);
      if (vs && vs.locked) { setPhase('login'); return; }
      // Check the signed-in member before the empty-list branch: SUPER_ADMIN (id -1) is not in
      // members.list(), so a remembered super session would otherwise land on register every boot.
      if (cur) { setBusy(false); setPhase('licensing'); return; }
      if (ms.length === 0) { setPhase('register'); setStep('details'); return; }
      setPhase('pick');
    } catch (e) {
      // Fail closed to the login screen rather than into the app.
      setPhase('login');
    }
  }
  useEffect(() => { evaluate(); }, []);
  // Reflect the current "stay signed in" state so unlocking with the box left
  // checked preserves it (an unchecked submit clears the remembered credential).
  useEffect(() => {
    (softglazeApi.auth && softglazeApi.auth.rememberStatus ? softglazeApi.auth.rememberStatus() : Promise.resolve(null))
      .then((s) => { if (s && s.enabled) setRemember(true); })
      .catch(() => {});
  }, []);
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
    if (!firstName.trim() || !lastName.trim()) return setErr(t('errors.enterFirstLast'));
    if (!EMAIL_RE.test(email.trim())) return setErr(t('errors.validEmail'));
    if (tenant) {
      // Tenant builds: phone is optional (with the country code) and the use case is required.
      const le = leadError({ phone, useCase, useCaseOther });
      if (le) return setErr(t(`serverErrors.${le}`));
    } else if (phone.replace(/\D/g, '').length < 6) return setErr(t('errors.validPhone'));
    if (password.length < 8) return setErr(t('errors.password8'));
    if (password !== confirm) return setErr(t('errors.passwordsNoMatch'));
    setBusy(true);
    try {
      const res = await softglazeApi.account.sendOtp(email.trim().toLowerCase(), otpExtras({ tenant, firstName, lastName, consent, lang: getStoredLang(), lead: leadPayload({ phone, useCase, useCaseOther, company }) }));
      setDevCode(res?.devCode || ''); setResendIn(30); setOtp(''); setStep('verify');
    } catch (e) { setErr(errorText(t, e, 'errors.couldNotSendCode')); }
    finally { setBusy(false); }
  }

  async function resend() {
    if (resendIn > 0) return;
    setBusy(true); setErr('');
    try { const res = await softglazeApi.account.sendOtp(email.trim().toLowerCase(), otpExtras({ tenant, firstName, lastName, consent, lang: getStoredLang(), lead: leadPayload({ phone, useCase, useCaseOther, company }) })); setDevCode(res?.devCode || ''); setResendIn(30); }
    catch (e) { setErr(errorText(t, e, 'errors.couldNotResendCode')); }
    finally { setBusy(false); }
  }

  async function verifyAndCreate(code) {
    if (busy) return; // OtpInput.onComplete can fire alongside the button - guard the double register
    const c = (code || otp).replace(/\D/g, '');
    if (c.length !== 6) return setErr(t('errors.enter6Digit'));
    setErr(''); setBusy(true);
    try {
      // One atomic step (verify OTP, create OWNER, set vault password, save account); the OTP is
      // consumed only when all succeed, so a failure is retryable.
      await softglazeApi.account.register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        code: c
      });
      // Account and 7-day trial exist at this point; offer the plan step (trial / redeem / buy) first.
      // In tenant builds the trial is started from that step, on the licensing server.
      setBusy(false); setErr(''); setPlanCode(''); setPhase('plan');
    } catch (e) { setErr(errorText(t, e, 'errors.verificationFailed')); setBusy(false); }
  }

  async function login() {
    setErr(''); setBusy(true);
    try {
      await softglazeApi.vault.unlock(loginPass, remember);
      const list = await softglazeApi.members.list().catch(() => []);
      if (!list.length) { setPhase('register'); setStep('details'); setErr(''); setBusy(false); return; }
      const owner = list.find((x) => account?.email && x.email && x.email.toLowerCase() === account.email.toLowerCase())
        || list.find((x) => x.role === 'OWNER') || list[0];
      if (owner && !owner.isCurrent) { try { await softglazeApi.members.switch(owner.id); } catch (_) { /* owner may have a PIN */ } }
      const cur = await softglazeApi.members.current().catch(() => null);
      setLoginPass('');
      if (!cur && list.length) { setPhase('pick'); setBusy(false); return; }
      setPhase('licensing');
    } catch (e) { setErr(e.message || t('errors.incorrectPassword')); setBusy(false); }
  }

  async function pick(m) {
    setErr('');
    if (m.hasPin && pinFor !== m.id) { setPinFor(m.id); setPin(''); return; }
    setBusy(true);
    try { await softglazeApi.members.switch(m.id, m.hasPin ? pin : undefined); setPhase('licensing'); }
    catch (e) { setErr(e.message || t('errors.couldNotSignIn')); setBusy(false); }
  }

  async function doSuperLogin() {
    setErr(''); setBusy(true);
    try {
      await softglazeApi.members.superLogin(superId.trim(), superPass, remember);
      setSuperPass('');
      setPhase('licensing');
    } catch (e) {
      if (e.code === 'SUPER_SETUP_REQUIRED') { setSuperNeedsSetup(true); setErr(t('errors.superSetupRequired')); setBusy(false); return; }
      setErr(e.message || t('errors.invalidSuperCredentials')); setBusy(false);
    }
  }

  // First-run (or change): create the per-install Super Admin credential.
  async function doSuperSetup() {
    setErr('');
    if (superPass.length < 8) return setErr(t('errors.password8'));
    if (superPass !== superPass2) return setErr(t('errors.passwordsNoMatch'));
    setBusy(true);
    try {
      await softglazeApi.members.superSetup({ identifier: superId.trim() || 'superadmin', password: superPass });
      setSuperPass(''); setSuperPass2('');
      setPhase('licensing');
    } catch (e) { setErr(e.message || t('errors.couldNotCreateSuper')); setBusy(false); }
  }

  async function doAcceptInvite() {
    setErr('');
    if (!inviteCode.trim()) return setErr(t('errors.enterInviteCode'));
    if (invitePass.length < 6) return setErr(t('errors.password6'));
    setBusy(true);
    try {
      await softglazeApi.members.acceptInvite({ code: inviteCode.trim(), name: inviteName.trim() || undefined, password: invitePass });
      setInvitePass('');
      setPhase('licensing');
    } catch (e) { setErr(e.message || t('errors.couldNotRedeemInvite')); setBusy(false); }
  }

  async function doMemberLogin() {
    setErr('');
    if (!memberIdf.trim() || !memberPass) return setErr(t('errors.enterEmailNamePassword'));
    setBusy(true);
    try {
      await softglazeApi.members.login(memberIdf.trim(), memberPass, remember);
      setMemberPass('');
      setPhase('licensing');
    } catch (e) { setErr(e.message || t('errors.couldNotSignIn')); setBusy(false); }
  }

  // A run that showed sign-up, an email code, the plan step or the blocked screen never asks for a
  // Microsoft Store rating (lib/storeRating.mjs).
  useEffect(() => { noteGatePhase(phase); }, [phase]);

  // After any auth, 'licensing' resolves the license and enters the app or shows 'banned'.
  // A read error fails open to the app (local-first).
  useEffect(() => {
    if (phase !== 'licensing') return undefined;
    let live = true;
    (async () => {
      // Tenant builds: a workspace without an email confirmed by our server confirms it first. Main
      // decides (the server is the truth); a failed status goes on, and main still checks launches.
      const st = softglazeApi.account.signupStatus ? await softglazeApi.account.signupStatus().catch(() => null) : null;
      if (!live) return;
      const next = confirmPhase(st);
      if (next) { openConfirm(st); setBusy(false); setPhase(next); return; }
      try {
        const lic = await softglazeApi.license.get();
        if (!live) return;
        setLicense(lic);
        // No plan yet (tenant builds only): back to the plan step to start the trial, buy or redeem.
        if (lic && lic.needsPlan) { setTenant(true); setBusy(false); }
        setPhase(phaseForLicense(lic));
      } catch (e) { if (live) setPhase('ready'); }
    })();
    return () => { live = false; };
  }, [phase]);

  // Tenant builds: the plan step and the ended screen offer the paid plans at the server's prices.
  useEffect(() => {
    if (!tenant || (phase !== 'plan' && phase !== 'banned')) return undefined;
    let live = true;
    softglazeApi.billing.getPlans()
      .then((info) => {
        if (!live) return;
        const list = paidPlans(info);
        setPlans(list);
        setSelPlanId((cur) => (cur && list.some((p) => p.id === cur) ? cur : defaultPlanId(list)));
      })
      .catch(() => { if (live) setPlans([]); });
    softglazeApi.store.status()
      .then((s) => { if (live) setStoreInfo(s && s.available ? s : null); })
      .catch(() => { if (live) setStoreInfo(null); });
    return () => { live = false; };
  }, [tenant, phase]);

  // "Confirm your email": prefill the Owner's details (editable) once, on the details step.
  function openConfirm(st) {
    const p = (st && st.prefill) || {};
    if (p.firstName) setFirstName((v) => v || p.firstName);
    if (p.lastName) setLastName((v) => v || p.lastName);
    if (p.email) setEmail((v) => v || p.email);
    if (p.phone) setPhone((v) => v || p.phone);
    setCanDefer(Boolean(st && st.canDefer));
    setConfirmStep('details'); setOtp(''); setErr('');
  }

  // After our side failed (offline, server, email), main may allow "Continue for now".
  async function refreshDefer() {
    const st = await softglazeApi.account.signupStatus().catch(() => null);
    setCanDefer(Boolean(st && st.canDefer));
  }

  function confirmDetailsError() {
    if (!firstName.trim() || !lastName.trim()) return t('errors.enterFirstLast');
    if (!EMAIL_RE.test(email.trim())) return t('errors.validEmail');
    const le = leadError({ phone, useCase, useCaseOther });
    return le ? t(`serverErrors.${le}`) : '';
  }

  async function sendConfirmCode() {
    if (busy) return;
    setErr('');
    const bad = confirmDetailsError();
    if (bad) return setErr(bad);
    setBusy(true);
    try {
      await softglazeApi.account.confirmStart({
        email: email.trim().toLowerCase(), firstName: firstName.trim(), lastName: lastName.trim(),
        consentMarketing: consent === true, lang: getStoredLang(), ...leadPayload({ phone, useCase, useCaseOther, company })
      });
      setOtp(''); setResendIn(60); setConfirmStep('code');
    } catch (e) {
      setErr(errorText(t, e, 'errors.couldNotSendCode'));
      if (isOurSideError(e)) refreshDefer();
    } finally { setBusy(false); }
  }

  async function checkConfirmCode(code) {
    if (busy) return; // OtpInput.onComplete can fire alongside the button
    const c = (code || otp).replace(/\D/g, '');
    if (c.length !== 6) return setErr(t('errors.enter6Digit'));
    setErr(''); setBusy(true);
    try {
      await softglazeApi.account.confirmCheck({ email: email.trim().toLowerCase(), code: c, firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() });
      const acct = await softglazeApi.account.get().catch(() => null);
      if (acct) setAccount(acct);
      setOtp(''); setBusy(false); setPhase('licensing');
    } catch (e) {
      setErr(errorText(t, e, 'errors.verificationFailed'));
      if (isOurSideError(e)) refreshDefer();
      setBusy(false);
    }
  }

  async function confirmLater() {
    if (busy) return;
    setErr(''); setBusy(true);
    try { await softglazeApi.account.confirmLater(); setBusy(false); setPhase('licensing'); }
    catch (e) { setErr(e.message || t('errors.verificationFailed')); setCanDefer(false); setBusy(false); }
  }

  async function startTrial() {
    // Base builds: the trial was already created at registration.
    if (!tenant) { setErr(''); setPhase('licensing'); return; }
    // Tenant builds: the licensing server starts it (one trial per computer and email).
    if (trialBusy) return;
    setTrialErr(''); setErr(''); setTrialBusy(true);
    try {
      await softglazeApi.license.startTrial(trialPayload({ codeFor: trialCodeFor, code: trialCode }));
      setTrialCodeFor(''); setTrialCode(''); setTrialBusy(false); setPhase('licensing');
    } catch (e) {
      // The code box explains itself; only real failures show in red.
      if (trialNeedsCode(e)) { setTrialCodeFor(account?.email || email.trim().toLowerCase()); setTrialCode(''); setTrialBusy(false); return; }
      setTrialErr(errorText(t, e, 'errors.trialFailed')); setTrialBusy(false);
    }
  }

  // Asks the server for a fresh confirmation code: a trial start without a code sends one.
  async function resendTrialCode() {
    if (trialBusy) return;
    setTrialErr(''); setTrialBusy(true);
    try { await softglazeApi.license.startTrial(); setTrialCodeFor(''); setTrialBusy(false); setPhase('licensing'); }
    catch (e) { setTrialCode(''); setTrialErr(trialNeedsCode(e) ? '' : errorText(t, e, 'errors.trialFailed')); setTrialBusy(false); }
  }

  async function redeemPlan() {
    setErr('');
    if (!planCode.trim()) return setErr(t('errors.enterPurchaseCode'));
    setBusy(true);
    try { await softglazeApi.license.redeem(planCode.trim()); setPlanCode(''); setBusy(false); setPhase('licensing'); }
    catch (e) { setErr(e.message || t('errors.invalidPurchaseCode')); setBusy(false); }
  }

  const pollRef = useRef(null);
  function stopPoll() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }
  // The poll lives in a ref and is cleared on unmount and sign-out: a late paid result must never
  // re-enter the app with no current member.
  useEffect(() => () => stopPoll(), []);

  function pollPurchase(inv) {
    stopPoll(); // never run two polls at once (e.g. a second checkout)
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      try {
        const r = await softglazeApi.payments.pollCheckout({ uuid: inv.uuid, orderId: inv.orderId });
        // If the poll was stopped mid-flight (unmount or sign-out), never re-enter.
        if (r && r.paid && pollRef.current) { stopPoll(); setBusy(false); setPhase('licensing'); return; }
      } catch (e) { /* keep polling */ }
      if (tries > 120) { stopPoll(); setBusy(false); } // ~10-minute cap
    }, 5000);
  }

  // Method-aware variants used by the <PayMethods> chooser (banned screen + plan step).
  async function buyWith(method) {
    setErr(''); setBusy(true);
    try {
      // Tenant builds send the chosen plan; without one the server's first paid plan is used.
      const inv = await softglazeApi.payments.startCheckout(tenant && selPlanId ? { provider: method.id, planId: selPlanId } : { provider: method.id });
      if (inv && inv.url) window.open(inv.url, '_blank');
      pollPurchase(inv);
    } catch (e) { setErr(e.message || t('errors.paymentNotStarted')); setBusy(false); }
  }

  // Microsoft Store: Microsoft's purchase dialog, then our licensing server confirms the subscription.
  function applyStoreResult(r) {
    const o = storeOutcome(r);
    setStoreMsg({ text: tb(o.key, o.params || {}), tone: o.tone, canMove: Boolean(o.canMove) });
    if (o.done) { stopPoll(); setBusy(false); setPhase('licensing'); }
    return o;
  }

  function pollStore() {
    stopPoll();
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      try {
        const r = await softglazeApi.store.restore({});
        // If the poll was stopped mid-flight (unmount or sign-out), never re-enter.
        if (r && r.status === 'active' && pollRef.current) { applyStoreResult(r); return; }
      } catch (e) { /* keep trying */ }
      if (tries >= STORE_POLL.maxTries) { stopPoll(); setBusy(false); setStoreMsg({ text: tb('store.result.pendingLong'), tone: 'info', canMove: false }); }
    }, STORE_POLL.everyMs);
  }

  async function buyWithStore() {
    setErr(''); setStoreMsg(null); setBusy(true);
    try {
      const o = applyStoreResult(await softglazeApi.store.purchase(selPlanId ? { planId: selPlanId } : {}));
      if (o.poll) { pollStore(); return; }
      if (!o.done) setBusy(false);
    } catch (e) { setErr(e.message || tb('store.result.unavailable')); setBusy(false); }
  }

  async function restoreStore(move) {
    setErr(''); setStoreMsg(null); setBusy(true);
    try {
      const o = applyStoreResult(await softglazeApi.store.restore({ move: move === true }));
      if (o.poll) { pollStore(); return; }
      if (!o.done) setBusy(false);
    } catch (e) { setErr(e.message || tb('store.result.unavailable')); setBusy(false); }
  }

  // The plans to offer and the methods for the chosen one: when the Microsoft Store is the only way to
  // pay, only plans it sells; the Store method only for those plans.
  const storeOnly = methods.length > 0 && methods.every(isStoreMethod);
  const offerPlans = sellablePlans(plans, { storeOnly, storeInfo });
  const selPlan = offerPlans.find((p) => p.id === selPlanId) || null;
  const planMethods = methodsForPlan(methods, storeInfo, selPlan || selPlanId);
  useEffect(() => {
    if (offerPlans.length && !offerPlans.some((p) => p.id === selPlanId)) setSelPlanId(defaultPlanId(offerPlans));
  }, [offerPlans, selPlanId]);

  const storeControls = storeInfo ? {
    price: storePrice(storeInfo, selPlan || selPlanId),
    onBuy: buyWithStore,
    onRestore: restoreStore,
    message: storeMsg ? storeMsg.text : '',
    messageTone: storeMsg ? storeMsg.tone : 'info',
    canMove: Boolean(storeMsg && storeMsg.canMove)
  } : null;

  async function submitManualPay(method, { reference, note }) {
    setErr(''); setBusy(true);
    try {
      await softglazeApi.payments.submitManual({ provider: method.id, reference, note });
      setBusy(false);
      return true;
    } catch (e) { setErr(e.message || t('errors.couldNotSubmitPayment')); setBusy(false); return false; }
  }

  async function signOut() {
    stopPoll(); // don't let an in-flight purchase poll re-enter the app after logout
    try { await softglazeApi.members.logout(); } catch (e) { /* ignore */ }
    setLicense(null); setPhase('loading'); evaluate();
  }

  const SuperLink = () => (
    <p className="text-center text-[11px] text-muted-dark mt-5 pt-4 border-t border-border">
      <button onClick={async () => { setPhase('super'); setErr(''); setSuperPass(''); setSuperPass2(''); try { const s = await softglazeApi.members.superStatus(); setSuperNeedsSetup(!(s && s.configured)); } catch (_) { setSuperNeedsSetup(false); } }} className="inline-flex items-center gap-1 text-muted-dark hover:text-primary transition-colors">
        <ShieldCheck className="w-3.5 h-3.5" /> {t('super.access')}
      </button>
    </p>
  );

  if (phase === 'ready') return children;
  if (phase === 'loading' || phase === 'licensing') {
    return <div className="h-screen w-full bg-background grid place-items-center"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>;
  }
  if (phase === 'banned') {
    return (
      <BannedScreen
        account={account}
        license={license}
        methods={tenant ? planMethods : methods}
        plans={tenant ? offerPlans : []}
        selPlanId={selPlanId}
        onSelectPlan={setSelPlanId}
        planCode={planCode}
        setPlanCode={setPlanCode}
        busy={busy}
        err={err}
        onRedeem={redeemPlan}
        onAutomated={buyWith}
        onManual={submitManualPay}
        onSignOut={signOut}
        store={storeControls}
        storeInfo={storeInfo}
      />
    );
  }

  return (
    <div className="relative h-screen w-full bg-background text-foreground font-sans grid md:grid-cols-2 overflow-hidden">
      <CarouselPanel />
      <div className="relative flex flex-col overflow-y-auto">
        <AuthAura />
        <div className="relative flex items-center justify-between gap-3 px-6 pt-5">
          <div className="flex items-center gap-2.5 md:invisible">
            <img src="/logos/app-source-512.png" alt="SoftGlaze" className="w-8 h-8 object-contain drop-shadow-[0_2px_10px_rgba(59,130,246,0.45)]" draggable={false} />
            <span className="font-display font-semibold tracking-tight text-[15px]">SoftGlaze</span>
          </div>
          <ThemeLangControls />
        </div>
        <div className="relative flex-1 grid place-items-center p-6">
          <div className="w-full max-w-[420px] animate-fade-up">
            <div className="rounded-2xl border border-border/80 bg-card/70 backdrop-blur-xl shadow-2xl shadow-black/40 px-7 py-8">

          {phase === 'register' && step === 'details' && (
            <>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('register.title')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('register.subtitle')}</p>
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls}>{t('register.firstName')}</label><input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus /></div>
                  <div><label className={labelCls}>{t('register.lastName')}</label><input className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
                </div>
                <div><label className={labelCls}>{t('register.email')}</label><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('register.emailPlaceholder')} /></div>
                {tenant
                  ? <LeadFields idPrefix="reg" phone={phone} setPhone={setPhone} useCase={useCase} setUseCase={setUseCase} useCaseOther={useCaseOther} setUseCaseOther={setUseCaseOther} company={company} setCompany={setCompany} />
                  : <div><label className={labelCls}>{t('register.phone')}</label><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('register.phonePlaceholder')} /></div>}
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls}>{t('register.password')}</label><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('register.passwordPlaceholder')} /></div>
                  <div><label className={labelCls}>{t('register.confirm')}</label><PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t('register.confirmPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') sendCode(); }} /></div>
                </div>
              </div>
              {tenant && <ConsentToggle checked={consent} onChange={setConsent} />}
              {err && <p role="alert" className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={sendCode} className={primaryBtn}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('register.continue')} <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-[11px] text-muted-dark mt-4 flex items-center justify-center gap-1.5 text-center"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {tenant ? t('register.checkedByServer') : t('register.storedLocally')}</p>
              <div className="mt-6 pt-4 border-t border-border text-center text-[12.5px]">
                <span className="text-muted">{t('register.haveAccount')} </span>
                <button onClick={() => { setPhase('login'); setErr(''); }} className="font-semibold text-primary hover:text-primary-hover">{t('register.logIn')}</button>
              </div>
              <SuperLink />
            </>
          )}

          {phase === 'register' && step === 'verify' && (
            <>
              <button onClick={() => { setStep('details'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> {t('common.back')}</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('verify.title')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('verify.subtitlePrefix')} <span className="text-foreground">{email}</span>{t('verify.subtitleSuffix')}</p>
              <OtpInput value={otp} onChange={setOtp} onComplete={(c) => verifyAndCreate(c)} />
              {devCode && !tenant && (
                <div className="mt-4 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-[12px] text-primary">
                  {t('verify.devModePrefix')} <span className="font-mono font-semibold">{devCode}</span>{t('verify.devModeSuffix')}
                </div>
              )}
              {tenant && <p className="mt-4 text-[11.5px] text-muted-dark leading-relaxed">{t('verify.checkSpam')}</p>}
              {err && <p role="alert" className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={() => verifyAndCreate()} className={primaryBtn}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('verify.verifyCreate')}
              </button>
              <button onClick={resend} disabled={resendIn > 0 || busy} className="mt-3 w-full text-[12px] text-muted-dark hover:text-muted disabled:hover:text-muted-dark">
                {resendIn > 0 ? t('verify.resendIn', { count: resendIn }) : t('verify.resend')}
              </button>
            </>
          )}

          {phase === 'confirm' && confirmStep === 'details' && (
            <>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('confirm.title')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('confirm.subtitle')}</p>
              <form className="space-y-3.5" noValidate onSubmit={(e) => { e.preventDefault(); sendConfirmCode(); }}>
                <div className="grid grid-cols-2 gap-3">
                  <div><label htmlFor="cf-first" className={labelCls}>{t('register.firstName')}</label><input id="cf-first" autoComplete="given-name" className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
                  <div><label htmlFor="cf-last" className={labelCls}>{t('register.lastName')}</label><input id="cf-last" autoComplete="family-name" className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
                </div>
                <div><label htmlFor="cf-email" className={labelCls}>{t('register.email')}</label><input id="cf-email" type="email" autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('register.emailPlaceholder')} /></div>
                <LeadFields idPrefix="cf" phone={phone} setPhone={setPhone} useCase={useCase} setUseCase={setUseCase} useCaseOther={useCaseOther} setUseCaseOther={setUseCaseOther} company={company} setCompany={setCompany} />
                <ConsentToggle checked={consent} onChange={setConsent} />
                {err && <p role="alert" className="text-[12px] text-red-400">{err}</p>}
                <button type="submit" disabled={busy} className={primaryBtn}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('confirm.sendCode')} <ArrowRight className="w-4 h-4" /></>}
                </button>
              </form>
              {canDefer && (
                <div className="mt-4 rounded-lg border border-border p-3">
                  <p className="text-[11.5px] text-muted leading-relaxed">{t('confirm.laterNote')}</p>
                  <button type="button" onClick={confirmLater} disabled={busy} className="mt-2 w-full h-9 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] disabled:opacity-60">{t('confirm.later')}</button>
                </div>
              )}
              <p className="text-[11px] text-muted-dark mt-4 flex items-center justify-center gap-1.5 text-center"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {t('confirm.dataNote')}</p>
              <button type="button" onClick={signOut} className="mt-4 w-full text-[12px] text-muted-dark hover:text-muted inline-flex items-center justify-center gap-1.5"><LogOut className="w-3.5 h-3.5" /> {t('banned.signOut')}</button>
            </>
          )}

          {phase === 'confirm' && confirmStep === 'code' && (
            <>
              <button type="button" onClick={() => { setConfirmStep('details'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> {t('confirm.changeDetails')}</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('confirm.codeTitle')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('confirm.codeBody', { email: email.trim().toLowerCase() })}</p>
              <OtpInput value={otp} onChange={setOtp} onComplete={(c) => checkConfirmCode(c)} />
              <p className="mt-4 text-[11.5px] text-muted-dark leading-relaxed">{t('verify.checkSpam')}</p>
              {err && <p role="alert" className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button type="button" disabled={busy} onClick={() => checkConfirmCode()} className={primaryBtn}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('confirm.confirmContinue')}
              </button>
              <button type="button" onClick={sendConfirmCode} disabled={resendIn > 0 || busy} className="mt-3 w-full text-[12px] text-muted-dark hover:text-muted disabled:hover:text-muted-dark">
                {resendIn > 0 ? t('verify.resendIn', { count: resendIn }) : t('verify.resend')}
              </button>
              {canDefer && (
                <div className="mt-4 rounded-lg border border-border p-3">
                  <p className="text-[11.5px] text-muted leading-relaxed">{t('confirm.laterNote')}</p>
                  <button type="button" onClick={confirmLater} disabled={busy} className="mt-2 w-full h-9 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] disabled:opacity-60">{t('confirm.later')}</button>
                </div>
              )}
            </>
          )}

          {phase === 'confirmMember' && (
            <>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Lock className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('confirm.memberTitle')}</h1>
              <p className="text-[12.5px] text-muted mt-1 leading-relaxed">{t('confirm.memberBody')}</p>
              <button type="button" onClick={signOut} className={primaryBtn}>
                <LogOut className="w-4 h-4" /> {t('confirm.signInAsOwner')}
              </button>
            </>
          )}

          {phase === 'plan' && tenant && (
            <>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Sparkles className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('plan.tenantTitle')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('plan.tenantSubtitle')}</p>
              {trialCodeFor ? (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-3.5">
                  <span className="block text-[13px] font-semibold">{t('plan.verifyTitle')}</span>
                  <span className="block text-[11.5px] text-muted mt-0.5 mb-3">{t('plan.verifyBody', { email: trialCodeFor })}</span>
                  <OtpInput value={trialCode} onChange={setTrialCode} />
                  <button disabled={trialBusy || trialCode.replace(/\D/g, '').length !== 6} onClick={startTrial} className="mt-3 w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
                    {trialBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('plan.verifyStart')}
                  </button>
                  <button onClick={resendTrialCode} disabled={trialBusy} className="mt-2 w-full text-[12px] text-muted-dark hover:text-muted">{t('verify.resend')}</button>
                </div>
              ) : (
                <button onClick={startTrial} disabled={trialBusy} aria-busy={trialBusy} className="w-full flex items-center gap-3 p-3.5 rounded-lg border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors text-left disabled:opacity-70">
                  {trialBusy ? <Loader2 className="w-5 h-5 text-primary shrink-0 animate-spin" /> : <Clock className="w-5 h-5 text-primary shrink-0" />}
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{t('plan.startTrialTitle')}</span><span className="block text-[11.5px] text-muted-dark">{t('plan.tenantTrialSubtitle')}</span></span>
                  <ArrowRight className="w-4 h-4 text-muted-dark" />
                </button>
              )}
              {trialErr && <p role="alert" className="text-[12px] text-red-400 mt-2.5 leading-relaxed">{trialErr}</p>}
              {plans.length > 0 && (
                <div className="mt-4 rounded-lg border border-border p-3 space-y-2.5">
                  <span className="block text-[12px] font-semibold text-foreground flex items-center gap-1.5"><CreditCard className="w-4 h-4 text-primary" /> {t('plan.choosePlan')}</span>
                  <PlanPicker plans={offerPlans} selected={selPlanId} onSelect={setSelPlanId} storeInfo={storeInfo} />
                  <PayMethods methods={planMethods} busy={busy} onAutomated={buyWith} onManual={submitManualPay} store={storeControls} />
                </div>
              )}
              <div className="mt-4">
                <label className="block text-[11px] font-medium text-muted mb-1.5"><KeyRound className="w-3 h-3 inline mr-1" />{t('plan.haveCode')}</label>
                <div className="flex items-center gap-2">
                  <input value={planCode} onChange={(e) => setPlanCode(e.target.value.toUpperCase())} placeholder="SG-XXXX-XXXX" className={inputCls + ' font-mono tracking-widest'} onKeyDown={(e) => { if (e.key === 'Enter') redeemPlan(); }} />
                  <button onClick={redeemPlan} disabled={busy || !planCode.trim()} className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] disabled:opacity-60">{t('common.redeem')}</button>
                </div>
              </div>
              {err && <p role="alert" className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button onClick={signOut} className="mt-5 w-full text-[12px] text-muted-dark hover:text-muted inline-flex items-center justify-center gap-1.5"><LogOut className="w-3.5 h-3.5" /> {t('banned.signOut')}</button>
            </>
          )}

          {phase === 'plan' && !tenant && (
            <>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Sparkles className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('plan.title')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('plan.subtitlePrefix')} <span className="text-foreground">{t('plan.trialHighlight')}</span>{t('plan.subtitleSuffix')}</p>
              <div className="space-y-2.5">
                <button onClick={startTrial} className="w-full flex items-center gap-3 p-3.5 rounded-lg border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors text-left">
                  <Clock className="w-5 h-5 text-primary shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{t('plan.startTrialTitle')}</span><span className="block text-[11.5px] text-muted-dark">{t('plan.startTrialSubtitle')}</span></span>
                  <ArrowRight className="w-4 h-4 text-muted-dark" />
                </button>
                {methods.length > 0 && (
                  <div className="rounded-lg border border-border p-3 space-y-2.5">
                    <span className="block text-[12px] font-semibold text-foreground flex items-center gap-1.5"><CreditCard className="w-4 h-4 text-primary" /> {t('plan.activatePaid')}</span>
                    <PayMethods methods={methods} busy={busy} onAutomated={buyWith} onManual={submitManualPay} />
                  </div>
                )}
              </div>
              <div className="mt-4">
                <label className="block text-[11px] font-medium text-muted mb-1.5"><KeyRound className="w-3 h-3 inline mr-1" />{t('plan.haveCode')}</label>
                <div className="flex items-center gap-2">
                  <input value={planCode} onChange={(e) => setPlanCode(e.target.value.toUpperCase())} placeholder="SG-XXXX-XXXX" className={inputCls + ' font-mono tracking-widest'} onKeyDown={(e) => { if (e.key === 'Enter') redeemPlan(); }} />
                  <button onClick={redeemPlan} disabled={busy || !planCode.trim()} className="h-10 px-4 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold text-[12.5px] disabled:opacity-60">{t('common.redeem')}</button>
                </div>
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button onClick={startTrial} className="mt-5 w-full text-[12px] text-muted-dark hover:text-muted">{t('plan.skip')}</button>
            </>
          )}

          {phase === 'login' && (
            <>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{account?.firstName ? t('login.welcomeBackNamed', { name: account.firstName }) : t('login.welcomeBack')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('login.subtitle')}</p>
              <div className="space-y-3.5">
                <div><label className={labelCls}>{t('login.email')}</label><input className={inputCls + ' disabled:opacity-70'} value={email} onChange={(e) => setEmail(e.target.value)} disabled={Boolean(account?.email)} /></div>
                <div>
                  <div className="flex items-center justify-between mb-1.5"><label className="text-[11px] font-medium text-muted">{t('login.password')}</label><button type="button" onClick={() => setForgot((f) => !f)} className="text-[11px] text-muted-dark hover:text-primary">{t('login.forgot')}</button></div>
                  <PasswordInput value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder={t('login.passwordPlaceholder')} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') login(); }} />
                </div>
              </div>
              <RememberToggle checked={remember} onChange={setRemember} />
              {forgot && <p className="text-[11.5px] text-muted mt-3 leading-relaxed">{t('login.forgotBody')}</p>}
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={login} className={primaryBtn}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('login.signIn')} <Lock className="w-4 h-4" /></>}
              </button>
              <div className="mt-6 pt-4 border-t border-border">
                <p className="text-center text-[11px] text-muted-dark mb-2.5">{t('login.newHere')}</p>
                <button
                  onClick={() => { setPhase('register'); setStep('details'); setErr(''); }}
                  className="w-full h-10 rounded-xl border border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary font-semibold text-[13px] flex items-center justify-center gap-2 transition-colors"
                >
                  {t('login.createOne')} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-center gap-4 mt-3 text-[11.5px]">
                <button onClick={() => { setPhase('invite'); setErr(''); }} className="text-muted-dark hover:text-primary">{t('login.haveInvite')}</button>
                <span className="text-border">·</span>
                <button onClick={() => { setPhase('memberlogin'); setErr(''); }} className="text-muted-dark hover:text-primary">{t('login.teamSignIn')}</button>
              </div>
              <SuperLink />
            </>
          )}

          {phase === 'invite' && (
            <>
              <button onClick={() => { setPhase(members.length ? 'login' : 'register'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> {t('common.back')}</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Mail className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('invite.title')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('invite.subtitle')}</p>
              <div className="space-y-3.5">
                <div><label className={labelCls}>{t('invite.code')}</label><input className={inputCls + ' font-mono tracking-widest uppercase'} value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} placeholder={t('invite.codePlaceholder')} autoFocus /></div>
                <div><label className={labelCls}>{t('invite.yourName')} <span className="text-muted-dark normal-case">{t('invite.optional')}</span></label><input className={inputCls} value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder={t('invite.namePlaceholder')} /></div>
                <div><label className={labelCls}>{t('invite.setPassword')}</label><PasswordInput value={invitePass} onChange={(e) => setInvitePass(e.target.value)} placeholder={t('invite.passwordPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') doAcceptInvite(); }} /></div>
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={doAcceptInvite} className={primaryBtn}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('invite.join')} <ArrowRight className="w-4 h-4" /></>}
              </button>
            </>
          )}

          {phase === 'memberlogin' && (
            <>
              <button onClick={() => { setPhase(members.length ? 'login' : 'register'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> {t('common.back')}</button>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4"><Lock className="w-5 h-5" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('member.title')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('member.subtitle')}</p>
              <div className="space-y-3.5">
                <div><label className={labelCls}>{t('member.identifier')}</label><input className={inputCls} value={memberIdf} onChange={(e) => setMemberIdf(e.target.value)} placeholder={t('member.identifierPlaceholder')} autoFocus /></div>
                <div><label className={labelCls}>{t('member.password')}</label><PasswordInput value={memberPass} onChange={(e) => setMemberPass(e.target.value)} placeholder={t('member.passwordPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') doMemberLogin(); }} /></div>
              </div>
              <RememberToggle checked={remember} onChange={setRemember} />
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <button disabled={busy} onClick={doMemberLogin} className={primaryBtn}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('member.signIn')} <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-center text-[12px] text-muted-dark mt-4">{t('member.haveInviteInstead')} <button onClick={() => { setPhase('invite'); setErr(''); }} className="text-primary hover:text-primary-hover font-medium">{t('member.redeemIt')}</button></p>
            </>
          )}

          {phase === 'super' && (
            <>
              <button onClick={() => { setPhase(members.length ? 'login' : 'register'); setErr(''); }} className="text-[12px] text-muted hover:text-foreground flex items-center gap-1.5 mb-5"><ArrowLeft className="w-3.5 h-3.5" /> {t('common.back')}</button>
              <div className="w-11 h-11 rounded-xl grid place-items-center mb-4" style={{ background: 'color-mix(in srgb, #f59e0b 14%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 28%, transparent)' }}><ShieldCheck className="w-5 h-5 text-amber-400" /></div>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('super.title')}</h1>
              {superNeedsSetup ? (
                <>
                  <p className="text-[12.5px] text-muted mt-1 mb-6">{t('super.setupSubtitlePrefix')} <span className="text-foreground">{t('super.setupSubtitleHighlight')}</span> {t('super.setupSubtitleSuffix')}</p>
                  <div className="space-y-3.5">
                    <div><label className={labelCls}>{t('super.username')}</label><input className={inputCls} value={superId} onChange={(e) => setSuperId(e.target.value)} placeholder={t('super.usernamePlaceholder')} autoFocus /></div>
                    <div><label className={labelCls}>{t('super.password')}</label><PasswordInput value={superPass} onChange={(e) => setSuperPass(e.target.value)} placeholder={t('super.setupPasswordPlaceholder')} /></div>
                    <div><label className={labelCls}>{t('super.confirmPassword')}</label><PasswordInput value={superPass2} onChange={(e) => setSuperPass2(e.target.value)} placeholder={t('super.confirmPasswordPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') doSuperSetup(); }} /></div>
                  </div>
                  {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
                  <button disabled={busy} onClick={doSuperSetup} className="mt-6 w-full h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-amber-500/25 transition-colors">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('super.createCredentials')} <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[12.5px] text-muted mt-1 mb-6">{t('super.loginSubtitle')}</p>
                  <div className="space-y-3.5">
                    <div><label className={labelCls}>{t('super.usernameOrEmail')}</label><input className={inputCls} value={superId} onChange={(e) => setSuperId(e.target.value)} placeholder={t('super.usernamePlaceholder')} autoFocus /></div>
                    <div><label className={labelCls}>{t('super.password')}</label><PasswordInput value={superPass} onChange={(e) => setSuperPass(e.target.value)} placeholder={t('super.loginPasswordPlaceholder')} onKeyDown={(e) => { if (e.key === 'Enter') doSuperLogin(); }} /></div>
                  </div>
                  <RememberToggle checked={remember} onChange={setRemember} />
                  {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
                  <button disabled={busy} onClick={doSuperLogin} className="mt-6 w-full h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-amber-500/25 transition-colors">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t('super.enterWorkspace')} <ArrowRight className="w-4 h-4" /></>}
                  </button>
                </>
              )}
            </>
          )}

          {phase === 'pick' && (
            <>
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t('pick.title')}</h1>
              <p className="text-[12.5px] text-muted mt-1 mb-6">{t('pick.subtitle')}</p>
              <div className="space-y-1.5">
                {members.map((m) => (
                  <div key={m.id}>
                    <button onClick={() => pick(m)} className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-muted-dark hover:bg-secondary transition-colors text-left">
                      <span className="w-9 h-9 rounded-full grid place-items-center text-[12px] font-semibold" style={{ background: (m.color || '#6366f1') + '22', color: m.color || '#6366f1' }}>{m.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate">{m.name}</span>
                        <span className="block text-[11px] text-muted-dark capitalize">{String(m.role || '').toLowerCase()}{m.hasPin ? ` · ${t('pick.pin')}` : ''}</span>
                      </span>
                      {m.status === 'suspended' && <span className="text-[10.5px] text-red-400">{t('pick.suspended')}</span>}
                    </button>
                    {pinFor === m.id && (
                      <div className="flex items-center gap-2 mt-1.5 mb-1">
                        <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') pick(m); }} placeholder={t('pick.pinPlaceholder')} className={inputCls} />
                        <button disabled={busy} onClick={() => pick(m)} className="h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px]">{t('common.go')}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {err && <p className="text-[12px] text-red-400 mt-3">{err}</p>}
              <div className="flex items-center justify-center gap-4 mt-5 text-[11.5px]">
                <button onClick={() => { setPhase('invite'); setErr(''); }} className="text-muted-dark hover:text-primary">{t('pick.haveInvite')}</button>
                <span className="text-border">·</span>
                <button onClick={() => { setPhase('memberlogin'); setErr(''); }} className="text-muted-dark hover:text-primary">{t('pick.teamSignIn')}</button>
              </div>
              <SuperLink />
            </>
          )}
            </div>
            <p className="mt-4 text-center text-[10.5px] text-muted-dark">{t('brand.footer', { year: new Date().getFullYear() })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}