import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import profilesDark from '@/assets/signin/profiles-dark.webp';
import profilesLight from '@/assets/signin/profiles-light.webp';
import fingerprintDark from '@/assets/signin/fingerprint-dark.webp';
import fingerprintLight from '@/assets/signin/fingerprint-light.webp';
import aiDark from '@/assets/signin/ai-dark.webp';
import aiLight from '@/assets/signin/ai-light.webp';
import phoneDark from '@/assets/signin/phone-dark.webp';
import phoneLight from '@/assets/signin/phone-light.webp';
import teamDark from '@/assets/signin/team-dark.webp';
import teamLight from '@/assets/signin/team-light.webp';

// The right side of the sign-in and sign-up screens (Gate): a product tour of real SoftGlaze screens.
// The images are screenshots of the real app pages (Profiles, a profile's Fingerprint tab, an AI approval,
// Members) and of the web app's Approvals screen on a phone, rendered from the real components with demo
// data (documentation IP ranges, example addresses). Light and dark sets follow the app theme.
// Every text is in gate.json `panel.*` (en + es) and must stay true for the release it ships in.
//
// Behaviour: one slide at a time with a cross-fade; advances every 6 s; stops while the pointer or focus
// is on the panel, while the window is in the background, after the person presses Pause, and never
// runs on its own with prefers-reduced-motion. Previous / next / dot buttons work by mouse and keyboard
// (arrow keys too). Images of slides not seen yet load only when their slide is next.

export const SLIDES = [
  { key: 'free', kind: 'window', bleed: true, dark: profilesDark, light: profilesLight, w: 1400, h: 868 },
  { key: 'fingerprint', kind: 'window', bleed: true, dark: fingerprintDark, light: fingerprintLight, w: 1400, h: 937 },
  { key: 'ai', kind: 'window', dark: aiDark, light: aiLight, w: 1200, h: 800 },
  { key: 'phone', kind: 'phone', dark: phoneDark, light: phoneLight, w: 375, h: 745 },
  { key: 'team', kind: 'window', bleed: true, dark: teamDark, light: teamLight, w: 1400, h: 892 }
];
export const SLIDE_MS = 6000;
const TITLE_BAR = 30;

// The app theme is a class on <html> (lib/theme.js); follow it live.
function useTheme() {
  const read = () => (typeof document !== 'undefined' && document.documentElement.classList.contains('light') ? 'light' : 'dark');
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => Boolean(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return reduced;
}

// A desktop window around an app screenshot: a thin title bar with the logo and the window buttons. With bleed
// the window stands on the panel's bottom edge and runs 28 px past it, and past the right edge when the panel is
// wide enough (the panel clips both); without, it fits inside.
function WindowShot({ src, alt, w, h, bleed }) {
  return (
    <div className="auth-shot overflow-hidden rounded-[10px] border border-[var(--auth-shot-border)] bg-[var(--auth-shot-bar)]"
      style={{ width: bleed ? `min(calc(100cqw + 260px), calc((100cqh + 28px - ${TITLE_BAR}px) * ${(w / h).toFixed(4)}))` : `min(100cqw, calc((100cqh - ${TITLE_BAR}px) * ${(w / h).toFixed(4)}))`, flex: 'none', marginBottom: bleed ? -28 : 0 }}>
      <div aria-hidden="true" className="flex items-center gap-2 px-3 text-[11px] text-[var(--auth-shot-bar-fg)]" style={{ height: TITLE_BAR }}>
        <img src="/logos/app-source-512.png" alt="" className="w-3.5 h-3.5" draggable={false} />
        <span className="font-medium">SoftGlaze</span>
        <span className="ms-auto flex items-center gap-3.5">
          <span className="block w-2.5 h-px bg-current" />
          <span className="block w-2.5 h-2.5 border border-current" />
          <span className="block w-3 text-center leading-none">&#x2715;</span>
        </span>
      </div>
      {src ? <img src={src} alt={alt} width={w} height={h} className="block w-full h-auto" draggable={false} /> : <div role="img" aria-label={alt} style={{ aspectRatio: `${w} / ${h}` }} />}
    </div>
  );
}

// A phone around a phone-sized screenshot.
function PhoneShot({ src, alt, w, h }) {
  return (
    <div className="auth-shot rounded-[34px] bg-[#0b0f19] p-[9px] ring-1 ring-[var(--auth-shot-border)]"
      style={{ width: `min(100cqw, 300px, calc((100cqh + 120px) * ${(w / h).toFixed(4)}))`, flex: 'none' }}>
      <div className="overflow-hidden rounded-[26px] bg-black">
        {src ? <img src={src} alt={alt} width={w} height={h} className="block w-full h-auto" draggable={false} /> : <div role="img" aria-label={alt} style={{ aspectRatio: `${w} / ${h}` }} />}
      </div>
    </div>
  );
}

export default function AuthProductPanel() {
  const { t } = useTranslation('gate');
  const theme = useTheme();
  const reduced = useReducedMotion();
  const n = SLIDES.length;
  const [i, setI] = useState(0);
  const [loaded, setLoaded] = useState(() => new Set([0, 1])); // the first slide and the next one
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [away, setAway] = useState(() => (typeof document !== 'undefined' ? document.hidden || !document.hasFocus() : false));
  const [stopped, setStopped] = useState(false); // the Pause button

  const go = useCallback((next) => {
    const k = ((next % n) + n) % n;
    setI(k);
    setLoaded((s) => (s.has(k) && s.has((k + 1) % n) ? s : new Set([...s, k, (k + 1) % n])));
  }, [n]);

  // The window in the background: no rotation.
  useEffect(() => {
    const on = () => setAway(document.hidden || !document.hasFocus());
    window.addEventListener('focus', on); window.addEventListener('blur', on); document.addEventListener('visibilitychange', on);
    return () => { window.removeEventListener('focus', on); window.removeEventListener('blur', on); document.removeEventListener('visibilitychange', on); };
  }, []);

  const running = !reduced && !stopped && !hover && !focusIn && !away;
  useEffect(() => {
    if (!running) return undefined;
    const id = setTimeout(() => go(i + 1), SLIDE_MS);
    return () => clearTimeout(id);
  }, [running, i, go]);

  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    // Right to left (Arabic, Urdu): the next button sits on the left, so ArrowLeft moves forward.
    const step = document.documentElement.dir === 'rtl' ? -1 : 1;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + step); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - step); }
  }

  const slide = SLIDES[i];
  const ctrl = 'grid place-items-center shrink-0 [width:44px] [height:44px] rounded-full border border-[var(--auth-panel-ctrl-border)] text-[var(--auth-panel-fg)] hover:bg-[var(--auth-panel-ctrl-hover)] transition-colors';
  return (
    <section
      aria-roledescription={t('panel.carousel')}
      aria-label={t('panel.label')}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocusIn(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusIn(false); }}
      onKeyDown={onKeyDown}
      className="auth-panel auth-brand relative hidden min-[960px]:flex flex-col overflow-hidden px-10 xl:px-14 pt-12 pb-10 text-[var(--auth-panel-fg)]"
    >
      <p className="text-[13px] font-medium text-[var(--auth-panel-muted)]">{t('panel.trust')}</p>

      {/* The words of the current slide; announced only when the slides are not moving on their own. */}
      <div aria-live={running ? 'off' : 'polite'} className="auth-caption mt-5 max-w-[40rem]">
        <h2 key={slide.key} className="font-display text-[32px] leading-[1.12] font-semibold tracking-tight animate-fade-in">
          {t(`panel.slides.${slide.key}.title`)}
        </h2>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--auth-panel-muted)]">{t(`panel.slides.${slide.key}.body`)}</p>
      </div>

      <div className="auth-controls mt-5 flex items-center gap-2">
        <button type="button" onClick={() => go(i - 1)} aria-label={t('panel.prev')} className={ctrl}><ChevronLeft className="w-5 h-5" aria-hidden="true" /></button>
        <button type="button" onClick={() => go(i + 1)} aria-label={t('panel.next')} className={ctrl}><ChevronRight className="w-5 h-5" aria-hidden="true" /></button>
        <div className="ms-2 flex items-center">
          {SLIDES.map((s, k) => (
            <button key={s.key} type="button" onClick={() => go(k)} aria-current={k === i ? 'true' : undefined}
              aria-label={t('panel.goTo', { n: k + 1, title: t(`panel.slides.${s.key}.title`) })}
              className="group grid place-items-center [height:44px] [min-width:28px] px-1.5">
              <span className={`block h-1.5 rounded-full transition-all duration-300 ${k === i ? 'w-7 bg-[var(--auth-panel-fg)]' : 'w-1.5 bg-[var(--auth-panel-dot)] group-hover:bg-[var(--auth-panel-muted)]'}`} />
            </button>
          ))}
        </div>
        {!reduced && (
          <button type="button" onClick={() => setStopped((v) => !v)} aria-label={stopped ? t('panel.play') : t('panel.pause')} className={`${ctrl} ms-auto`}>
            {stopped ? <Play className="w-4 h-4" aria-hidden="true" /> : <Pause className="w-4 h-4" aria-hidden="true" />}
          </button>
        )}
      </div>

      {/* The screens: stacked, the current one fades in. The stage reaches the panel's right and bottom edges. */}
      <div className="auth-stage relative flex-1 min-h-0 mt-9 -me-10 xl:-me-14 -mb-10">
        {SLIDES.map((s, k) => {
          const on = k === i;
          const src = loaded.has(k) ? s[theme] : null;
          const alt = t(`panel.slides.${s.key}.alt`);
          return (
            <div key={s.key} role="group" aria-roledescription={t('panel.slide')} aria-label={t('panel.slideOf', { n: k + 1, total: n })}
              aria-hidden={!on} inert={!on}
              className={`absolute inset-0 flex ${s.kind === 'phone' ? 'items-start justify-center pe-10 xl:pe-14' : s.bleed ? 'items-end justify-start' : 'items-start justify-start'} [container-type:size] transition-opacity duration-700 ease-out motion-reduce:transition-none ${on ? 'opacity-100' : 'opacity-0'}`}>
              {s.kind === 'phone' ? <PhoneShot src={src} alt={alt} w={s.w} h={s.h} /> : <WindowShot src={src} alt={alt} w={s.w} h={s.h} bleed={s.bleed} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
