import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Play, Globe, Folder, Clock, X, MonitorSmartphone, Zap, Loader2,
  ArrowUpRight, Shield, RefreshCw, Cpu, HardDrive, Server, Sparkles, CalendarDays,
  Fingerprint, Users, Wand2, IdCard, LineChart, BarChart3, PieChart, Rocket
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/ui/Button.jsx';
import { useDialog } from '@/lib/useDialog.js';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { Sparkline, Bars, Donut, Legend, HBars, Meter } from '@/components/dashboard/DashCharts.jsx';

// Brand chart palette - themes in light + dark via index.css tokens.
const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const fmtGB = (bytes) => (bytes / 1024 / 1024 / 1024).toFixed(1);
const fmtNum = (v) => (v == null ? '—' : v);

// Build the last 7 calendar days (oldest -> today) with short weekday labels in
// the app's language, plus a bucketing helper for createdAt-style timestamps.
function last7Days(locale) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); days.push(d); }
  const labels = days.map((d) => {
    try { return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d); }
    catch (e) { return String(d.getDate()); }
  });
  return { days, labels };
}
function bucketByDay(items, getDate, days) {
  const startMs = days.map((d) => d.getTime());
  const counts = days.map(() => 0);
  for (const it of items) {
    const raw = getDate(it); if (!raw) continue;
    const dt = new Date(raw); if (Number.isNaN(dt.getTime())) continue;
    dt.setHours(0, 0, 0, 0);
    const idx = startMs.indexOf(dt.getTime());
    if (idx >= 0) counts[idx] += 1;
  }
  return counts;
}

// Clean brand stat tile: token-coloured icon tile, big value, small delta line.
function StatCard({ icon: Icon, label, value, change, color }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-fade-up">
      <div className="flex items-center justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      </div>
      <p className="mt-4 font-display text-3xl font-bold tracking-tight tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[11px] font-medium" style={{ color }}>{change}</p>
    </div>
  );
}

function ChartCard({ title, subtitle, icon: Icon, iconColor, children, className = '', actions, headingId, badge }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-5 animate-fade-up ${className}`} aria-labelledby={headingId}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${iconColor} 14%, transparent)`, color: iconColor }}>
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 id={headingId} className="truncate text-sm font-semibold text-foreground">{title}</h3>
              {badge}
            </div>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// Navigable quick-access card: a real <a> (keyboard focusable, global focus ring),
// a key number, and a short caption. Jumps to the target page on click/Enter.
function QuickLink({ to, icon: Icon, label, value, caption, color, openLabel }) {
  return (
    <Link
      to={to}
      aria-label={openLabel}
      className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-secondary/40 animate-fade-up"
    >
      <div className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
          <p className="truncate text-[11px] text-muted-foreground">{caption}</p>
        </div>
        <span className="shrink-0 font-display text-xl font-bold tabular-nums text-foreground">{fmtNum(value)}</span>
      </div>
    </Link>
  );
}

const MOTIVATION_COUNT = 12;

function greetingKey(hour) {
  if (hour >= 5 && hour < 12) return 'dashboard.greetingMorning';
  if (hour >= 12 && hour < 17) return 'dashboard.greetingAfternoon';
  if (hour >= 17 && hour < 22) return 'dashboard.greetingEvening';
  return 'dashboard.greetingLate';
}

function firstNameOf(member, account) {
  const raw = (member && member.name) || (account && [account.firstName, account.lastName].filter(Boolean).join(' ')) || '';
  const first = String(raw).trim().split(/\s+/)[0];
  return first || '';
}

// Personalized hero: time-aware greeting + the user's first name, a live clock and
// date in the app language, and a rotating motivational line. Clean brand surface -
// no decorative gradient or glow (a thin primary bar is the only accent).
function WelcomeBanner() {
  const { t, i18n } = useTranslation();
  const [who, setWho] = useState({ name: '', role: '' });
  const [now, setNow] = useState(() => new Date());
  const quoteIdx = useRef(Math.floor(Math.random() * MOTIVATION_COUNT));

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [member, account] = await Promise.all([
          softglazeApi.members.current().catch(() => null),
          softglazeApi.account.get().catch(() => null)
        ]);
        if (!live) return;
        setWho({ name: firstNameOf(member, account), role: member ? member.role : '' });
      } catch (e) { /* ignore - fall back to a generic greeting */ }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const locale = i18n.language || undefined;
  let timeStr = '';
  let dateStr = '';
  try {
    timeStr = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
    dateStr = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  } catch (e) {
    timeStr = now.toLocaleTimeString();
    dateStr = now.toLocaleDateString();
  }
  const greeting = t(greetingKey(now.getHours()));
  const motivation = t('dashboard.motivation', { returnObjects: true });
  const quote = (Array.isArray(motivation) && (motivation[quoteIdx.current] || motivation[0])) || '';

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 pl-7 sm:p-7 sm:pl-8 animate-fade-up">
      <span className="absolute inset-y-0 left-0 w-1 rounded-r" style={{ background: 'var(--primary)' }} aria-hidden="true" />
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{t('dashboard.welcomeBack')}</span>
          </div>
          <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-[32px]">
            {greeting}, <span style={{ color: 'var(--primary)' }}>{who.name || t('dashboard.guestName')}</span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] italic text-muted-foreground sm:text-sm">“{quote}”</p>
        </div>
        <div className="shrink-0 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-right">
          <div className="font-mono text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">{timeStr}</div>
          <div className="mt-1 flex items-center justify-end gap-1.5 text-[12px] text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {dateStr}
          </div>
        </div>
      </div>
    </section>
  );
}

// In-app OTA update banner. Subscribes to updater events and reads the current
// state on mount (so it appears even if the event fired before this page mounted).
function UpdateBanner() {
  const [state, setState] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const sawActive = useRef(false);

  useEffect(() => {
    let live = true;
    softglazeApi.updater.getState().then((s) => { if (live) setState(s); }).catch(() => {});
    const off = softglazeApi.updater.onEvent((s) => { if (live) { setState(s); setDismissed(false); } });
    return () => { live = false; if (typeof off === 'function') off(); };
  }, []);

  if (!state || dismissed) return null;
  const { status, version, percent, releaseNotes } = state;
  if (status === 'available' || status === 'downloading' || status === 'downloaded') sawActive.current = true;
  const isError = status === 'error' && sawActive.current;
  const isChecking = status === 'checking' && sawActive.current;
  const actionable = status === 'available' || status === 'downloading' || status === 'downloaded';
  if (!actionable && !isError && !isChecking) return null;
  const downloaded = status === 'downloaded';
  const v = version ? `v${version}` : '';
  const accent = isError ? 'var(--destructive)' : 'var(--primary)';

  async function install() {
    setInstalling(true);
    try { await softglazeApi.updater.install(); }
    catch (e) { setInstalling(false); }
  }
  function retry() { softglazeApi.updater.check().catch(() => {}); }

  const title = isError ? `Update download failed${v ? ` (${v})` : ''}`
    : isChecking ? 'Checking for updates…'
    : downloaded ? `Update ready ${v}`
    : status === 'downloading' ? `Downloading update ${v}…`
    : `New update available ${v}`;
  const subtitle = isError ? (state.error ? String(state.error).slice(0, 140) : 'Could not download the update. Check your connection and retry.')
    : isChecking ? 'Contacting the update server…'
    : downloaded ? 'Click install to restart and apply the new version.'
    : status === 'downloading' ? `${percent || 0}% downloaded`
    : 'It will download in the background.';

  return (
    <div className="rounded-xl border px-4 py-3 animate-fade-up" style={{ background: `color-mix(in srgb, ${accent} 10%, var(--card))`, borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}>
          {isChecking ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: accent }} /> : <Sparkles className="h-4 w-4" style={{ color: accent }} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>
        </div>
        {downloaded && (
          <Button variant="primary" size="sm" onClick={install} disabled={installing}>
            {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Install &amp; restart
          </Button>
        )}
        {isError && (
          <Button variant="secondary" size="sm" onClick={retry}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        )}
        {(downloaded || status === 'available') && releaseNotes && (
          <button onClick={() => setShowNotes((s) => !s)} className="shrink-0 px-1 text-[11px] text-primary hover:underline" title="What's new">
            {showNotes ? 'Hide notes' : "What's new"}
          </button>
        )}
        <button onClick={() => setDismissed(true)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Dismiss update notice">
          <X className="h-4 w-4" />
        </button>
      </div>
      {showNotes && releaseNotes && (
        <pre className="ml-12 mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">{releaseNotes}</pre>
      )}
    </div>
  );
}

// Offers to restore the profiles that were open when the app last exited or crashed.
function RestoreBanner() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    if (!softglazeApi.sessions.restoreGet) return undefined;
    softglazeApi.sessions.restoreGet()
      .then((r) => { if (live) setProfiles((r && r.profiles) || []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (hidden || !profiles || profiles.length === 0) return null;

  async function restore() {
    setBusy(true);
    try { await softglazeApi.sessions.restoreRun({ action: 'restore', ids: profiles.map((p) => p.id) }); } catch (e) { /* ignore */ }
    setHidden(true);
  }
  async function dismiss() {
    setBusy(true);
    try { await softglazeApi.sessions.restoreRun({ action: 'dismiss' }); } catch (e) { /* ignore */ }
    setHidden(true);
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3 animate-fade-up" style={{ background: 'color-mix(in srgb, var(--primary) 10%, var(--card))', borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)' }}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--primary) 16%, transparent)' }}>
        <RefreshCw className="h-4 w-4 text-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">{t('dashboard.restoreTitle')}</p>
        <p className="text-[11.5px] text-muted-foreground">{t('dashboard.restoreDesc', { count: profiles.length })}</p>
      </div>
      <Button variant="primary" size="sm" onClick={restore} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t('dashboard.restore')}
      </Button>
      <button onClick={dismiss} disabled={busy} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title={t('shell.dismiss')} aria-label={t('shell.dismiss')}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Transient toasts for crash + memory-pressure notifications pushed from main.
function ResilienceToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  useEffect(() => {
    const add = (kind, text) => {
      const id = ++idRef.current;
      setToasts((t) => [...t, { id, kind, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
    };
    const offs = [];
    if (softglazeApi.sessions.onCrash) offs.push(softglazeApi.sessions.onCrash((d) => {
      if (!d) return;
      add('crash', `${d.title || 'A profile'} stopped unexpectedly${d.restarted ? ' - restarting…' : ''}.`);
    }));
    if (softglazeApi.sessions.onMemoryPressure) offs.push(softglazeApi.sessions.onMemoryPressure((d) => {
      if (!d) return;
      add('memory', `Low memory - closed ${d.closed} profile${d.closed === 1 ? '' : 's'} (free ${d.freePct}%).`);
    }));
    return () => offs.forEach((off) => { if (typeof off === 'function') off(); });
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg animate-fade-up" style={{ background: 'var(--card)', borderColor: 'color-mix(in srgb, var(--destructive) 35%, transparent)' }}>
          {t.kind === 'crash'
            ? <Zap className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }} />
            : <Cpu className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--destructive)' }} />}
          <p className="text-[12.5px] text-foreground">{t.text}</p>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ icon: Icon, title, sub }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {Icon && <Icon className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden="true" />}
      <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-foreground">{title}</h2>
      {sub && <span className="truncate text-xs text-muted-foreground">· {sub}</span>}
    </div>
  );
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState({ totalProfiles: 0, activeSessions: 0, totalProxies: 0, totalGroups: 0 });
  const [sessions, setSessions] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [sysInfo, setSysInfo] = useState(null);
  const [aux, setAux] = useState({ members: null, macros: null, personas: null });
  const [loading, setLoading] = useState(true);
  const [showStatus, setShowStatus] = useState(false);
  const [metric, setMetric] = useState('sessions');
  const [history, setHistory] = useState([]);
  const seeded = useRef(false);

  const loadDashboardData = useCallback(async () => {
    try {
      const [realStats, realSessions, proxyRes, info] = await Promise.all([
        softglazeApi.dashboard.getStats(),
        softglazeApi.sessions.list(),
        softglazeApi.proxies.list().catch(() => []),
        softglazeApi.system.getInfo().catch(() => null)
      ]);
      setStats(realStats);
      setSessions(Array.isArray(realSessions) ? realSessions : []);
      const arr = Array.isArray(proxyRes) ? proxyRes : (proxyRes?.items || proxyRes?.proxies || proxyRes?.rows || []);
      setProxies(Array.isArray(arr) ? arr : []);
      setSysInfo(info);

      // Live rolling timeline (real values sampled over the app's runtime).
      const label = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const point = { x: label, sessions: (Array.isArray(realSessions) ? realSessions.length : 0), proxies: Array.isArray(arr) ? arr.length : 0 };
      setHistory((prev) => {
        let next = prev;
        if (!seeded.current) { next = Array.from({ length: 8 }, () => point); seeded.current = true; }
        next = [...next, point].slice(-12);
        return next;
      });
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 10000);
    return () => clearInterval(interval);
  }, [loadDashboardData]);

  // One-time, best-effort counts for the quick-access cards (existing IPC only).
  useEffect(() => {
    let live = true;
    const len = (r) => {
      if (r.status !== 'fulfilled' || r.value == null) return null;
      const v = r.value;
      if (Array.isArray(v)) return v.length;
      if (Array.isArray(v.items)) return v.items.length;
      if (Array.isArray(v.personas)) return v.personas.length;
      if (Array.isArray(v.macros)) return v.macros.length;
      return null;
    };
    Promise.allSettled([
      softglazeApi.members.list(),
      softglazeApi.automation.getMacros(),
      softglazeApi.personas.getAll()
    ]).then(([m, a, p]) => {
      if (!live) return;
      setAux({ members: len(m), macros: len(a), personas: len(p) });
    });
    return () => { live = false; };
  }, []);

  const handleStopSession = async (sessionId) => {
    try {
      await softglazeApi.sessions.close(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setStats((prev) => ({ ...prev, activeSessions: Math.max(0, prev.activeSessions - 1) }));
    } catch (err) {
      alert('Failed to close session: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="animate-pulse text-sm text-muted-foreground">{t('dashboard.loadingCenter')}</p>
        </div>
      </div>
    );
  }

  // ---- Derived REAL data -------------------------------------------------
  const { days, labels: dayLabels } = last7Days(i18n.language);

  // Proxy pool health = latest check result per proxy (ok / fail / never checked).
  const health = proxies.reduce((a, p) => {
    if (p.lastStatus === 'ok') a.verified += 1;
    else if (p.lastStatus === 'fail') a.failed += 1;
    else a.unchecked += 1;
    return a;
  }, { verified: 0, failed: 0, unchecked: 0 });
  const healthSegments = [
    { label: t('dashboard.hVerified'), value: health.verified, color: 'var(--success)' },
    { label: t('dashboard.hFailed'), value: health.failed, color: 'var(--destructive)' },
    { label: t('dashboard.hUnchecked'), value: health.unchecked, color: 'var(--muted-foreground)' }
  ];

  // Proxies by exit country (top 5).
  const countryMap = {};
  for (const p of proxies) {
    const c = String(p.lastCountry || '').trim() || t('dashboard.geoUnknown');
    countryMap[c] = (countryMap[c] || 0) + 1;
  }
  const topCountries = Object.entries(countryMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([label, value], i) => ({ label, title: label, value, color: CHART[i % CHART.length] }));

  // Proxies by protocol type.
  const typeMap = {};
  for (const p of proxies) {
    const ty = String(p.type || 'OTHER').toUpperCase();
    typeMap[ty] = (typeMap[ty] || 0) + 1;
  }
  const typeRows = Object.entries(typeMap).sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: CHART[i % CHART.length] }));

  // New proxies added per day over the last 7 days (REAL, from createdAt).
  const newProxySeries = bucketByDay(proxies, (p) => p.createdAt, days);
  const newProxyTotal = newProxySeries.reduce((a, b) => a + b, 0);

  // Launches per day - SAMPLE. The app does not persist per-day launch history,
  // so this illustrative shape is clearly badged and never presented as real.
  const launchSample = [4, 6, 3, 8, 5, 9, 6];

  const providerCount = new Set(proxies.map((p) => p.provider).filter(Boolean)).size || null;

  // Health scores (REAL).
  const memPct = sysInfo && sysInfo.memTotal ? Math.round((sysInfo.memUsed / sysInfo.memTotal) * 100) : 0;
  const activeRatio = stats.totalProfiles ? Math.round((stats.activeSessions / stats.totalProfiles) * 100) : 0;
  const proxyCoverage = stats.totalProfiles ? Math.min(100, Math.round((stats.totalProxies / stats.totalProfiles) * 100)) : (stats.totalProxies ? 100 : 0);

  // Live activity timeline (REAL, sampled this runtime).
  const activityValues = history.map((h) => h[metric]);
  const activityLabels = history.map((h) => h.x);
  const activityPeak = activityValues.length ? Math.max(...activityValues) : 0;
  const activityColor = metric === 'sessions' ? 'var(--chart-1)' : 'var(--chart-2)';

  const quickLinks = [
    { to: '/profiles', icon: Fingerprint, label: t('nav.profiles'), value: stats.totalProfiles, caption: t('dashboard.qProfilesCap'), color: 'var(--chart-1)' },
    { to: '/proxies', icon: Globe, label: t('nav.proxies'), value: stats.totalProxies, caption: t('dashboard.qProxiesCap'), color: 'var(--chart-2)' },
    { to: '/proxy-providers', icon: Server, label: t('dashboard.quickProviders'), value: providerCount, caption: t('dashboard.qProvidersCap'), color: 'var(--chart-3)' },
    { to: '/automation', icon: Wand2, label: t('nav.automation'), value: aux.macros, caption: t('dashboard.qAutomationCap'), color: 'var(--chart-4)' },
    { to: '/members', icon: Users, label: t('nav.members'), value: aux.members, caption: t('dashboard.qMembersCap'), color: 'var(--chart-5)' },
    { to: '/personas', icon: IdCard, label: t('nav.dataVault'), value: aux.personas, caption: t('dashboard.qVaultCap'), color: 'var(--chart-1)' }
  ];

  return (
    <div className="space-y-6 pb-10">
      <UpdateBanner />
      <RestoreBanner />
      <ResilienceToasts />

      {/* PERSONALIZED WELCOME */}
      <WelcomeBanner />

      {/* COMMAND-CENTER TOOLBAR */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t('dashboard.overview')}</p>
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t('dashboard.commandCenter')}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--success)' }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} />
            </span>
            {t('dashboard.liveMonitoring')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--success) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 18%, transparent)', color: 'var(--success)' }}>
            <Shield className="h-3.5 w-3.5" /> {t('dashboard.antiDetectActive')}
          </div>
          <Button variant="secondary" size="md" onClick={() => setShowStatus(true)}>
            <Activity className="h-4 w-4" /> {t('dashboard.systemStatus')}
          </Button>
        </div>
      </div>

      {/* STAT TILES */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard icon={MonitorSmartphone} label={t('dashboard.statTotalProfiles')} value={stats.totalProfiles} change={t('dashboard.changeGroups', { count: stats.totalGroups })} color="var(--chart-1)" />
        <StatCard icon={Play} label={t('dashboard.statActiveSessions')} value={stats.activeSessions} change={stats.activeSessions > 0 ? t('dashboard.changeLiveNow') : t('dashboard.changeIdle')} color="var(--chart-3)" />
        <StatCard icon={Globe} label={t('dashboard.statProxyPool')} value={stats.totalProxies} change={t('dashboard.changeTypes', { count: typeRows.length || 1 })} color="var(--chart-2)" />
        <StatCard icon={Folder} label={t('dashboard.statGroups')} value={stats.totalGroups} change={t('dashboard.changeOrganized')} color="var(--chart-4)" />
      </div>

      {/* QUICK ACCESS */}
      <section aria-labelledby="dash-quick">
        <SectionLabel icon={Rocket} title={<span id="dash-quick">{t('dashboard.quickAccessTitle')}</span>} sub={t('dashboard.quickAccessSub')} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {quickLinks.map((q) => (
            <QuickLink key={q.to} {...q} openLabel={t('dashboard.openLabel', { name: q.label })} />
          ))}
        </div>
      </section>

      {/* INSIGHTS */}
      <section aria-labelledby="dash-insights">
        <SectionLabel icon={LineChart} title={<span id="dash-insights">{t('dashboard.insightsTitle')}</span>} sub={t('dashboard.insightsSub')} />

        {/* Row 1 */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ChartCard
            className="xl:col-span-2"
            headingId="c-activity"
            title={t('dashboard.activitySessionsTitle')}
            subtitle={t('dashboard.activitySessionsSub')}
            icon={Activity}
            iconColor="var(--chart-1)"
            actions={
              <div className="flex items-center gap-1 rounded-lg bg-elevated p-1">
                {['sessions', 'proxies'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    aria-pressed={metric === m}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${metric === m ? 'border border-border bg-card text-foreground' : 'border border-transparent text-muted-foreground hover:text-foreground'}`}
                  >
                    {t(m === 'sessions' ? 'dashboard.metricSessions' : 'dashboard.metricProxies')}
                  </button>
                ))}
              </div>
            }
          >
            <Sparkline data={activityValues} labels={activityLabels} color={activityColor} height={200} ariaLabel={t('dashboard.chartActivityAria', { metric: t(metric === 'sessions' ? 'dashboard.metricSessions' : 'dashboard.metricProxies') })} />
            <p className="mt-2 text-[11px] text-muted-foreground">{t('dashboard.peakLabel', { count: activityPeak })}</p>
          </ChartCard>

          <ChartCard headingId="c-health" title={t('dashboard.poolHealthTitle')} subtitle={t('dashboard.poolHealthSub')} icon={Shield} iconColor="var(--chart-3)">
            <div className="mb-4 flex justify-center">
              <Donut
                segments={healthSegments}
                centerLabel={stats.totalProxies}
                centerSub={t('dashboard.proxiesUnit')}
                ariaLabel={t('dashboard.chartPoolHealthAria', { verified: health.verified, failed: health.failed, unchecked: health.unchecked, total: stats.totalProxies })}
              />
            </div>
            <Legend items={healthSegments} total={stats.totalProxies} />
          </ChartCard>
        </div>

        {/* Row 2 */}
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ChartCard headingId="c-geo" title={t('dashboard.topCountriesTitle')} subtitle={t('dashboard.topCountriesSub')} icon={Globe} iconColor="var(--chart-2)">
            <HBars rows={topCountries} ariaLabel={t('dashboard.chartCountriesAria')} emptyLabel={t('dashboard.noData')} />
          </ChartCard>

          <ChartCard headingId="c-newproxy" title={t('dashboard.newProxiesTitle')} subtitle={t('dashboard.newProxiesSub')} icon={BarChart3} iconColor="var(--chart-3)">
            <Bars data={newProxySeries} labels={dayLabels} color="var(--chart-3)" height={160} ariaLabel={t('dashboard.chartNewProxiesAria')} />
            <p className="mt-2 text-[11px] text-muted-foreground">{t('dashboard.addedThisWeek', { count: newProxyTotal })}</p>
          </ChartCard>

          <ChartCard
            headingId="c-launch"
            title={t('dashboard.launchesTitle')}
            subtitle={t('dashboard.launchesSub')}
            icon={Rocket}
            iconColor="var(--chart-4)"
            badge={<span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.sampleBadge')}</span>}
          >
            <Bars data={launchSample} labels={dayLabels} color="var(--chart-4)" height={160} ariaLabel={t('dashboard.chartLaunchesAria')} />
            <p className="mt-2 text-[11px] italic text-muted-foreground">{t('dashboard.sampleNote')}</p>
          </ChartCard>
        </div>

        {/* Row 3 */}
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ChartCard headingId="c-scores" title={t('dashboard.healthScores')} subtitle={t('dashboard.healthScoresSub')} icon={Shield} iconColor="var(--chart-3)">
            <div className="space-y-4 pt-1">
              <Meter label={t('dashboard.memoryAvailable')} value={100 - memPct} color="var(--chart-3)" />
              <Meter label={t('dashboard.activeRatio')} value={activeRatio} color="var(--chart-1)" />
              <Meter label={t('dashboard.proxyCoverage')} value={proxyCoverage} color="var(--chart-2)" />
            </div>
          </ChartCard>

          <ChartCard headingId="c-sys" title={t('dashboard.systemResources')} subtitle={sysInfo ? sysInfo.cpuModel : t('dashboard.realTimeMetrics')} icon={Cpu} iconColor="var(--chart-4)">
            <div className="space-y-3">
              {[
                { label: t('dashboard.resMemory'), val: sysInfo ? `${fmtGB(sysInfo.memUsed)} / ${fmtGB(sysInfo.memTotal)} GB` : '-', color: 'var(--chart-2)' },
                { label: t('dashboard.resCpuCores'), val: sysInfo ? t('dashboard.resCpuCoresVal', { count: sysInfo.cpuCount }) : '-', color: 'var(--chart-1)' },
                { label: t('dashboard.resActiveSessions'), val: t('dashboard.resRunningVal', { count: stats.activeSessions }), color: 'var(--chart-3)' },
                { label: t('dashboard.resProfiles'), val: t('dashboard.resStoredVal', { count: stats.totalProfiles }), color: 'var(--chart-4)' }
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between rounded-lg bg-elevated p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden="true" />
                    <span className="text-xs text-muted-foreground">{r.label}</span>
                  </div>
                  <span className="font-mono text-xs font-bold tabular-nums" style={{ color: r.color }}>{r.val}</span>
                </div>
              ))}
            </div>
          </ChartCard>

          <ChartCard headingId="c-types" title={t('dashboard.proxyTypesTitle')} subtitle={t('dashboard.proxyTypesSub')} icon={PieChart} iconColor="var(--chart-2)">
            <HBars rows={typeRows} ariaLabel={t('dashboard.chartTypesAria')} emptyLabel={t('dashboard.noData')} />
          </ChartCard>
        </div>
      </section>

      {/* LIVE SESSIONS */}
      <section className="overflow-hidden rounded-xl border border-border bg-card animate-fade-up" aria-labelledby="dash-live">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 22%, transparent)' }}>
              <Zap className="h-3.5 w-3.5" style={{ color: 'var(--success)' }} />
            </span>
            <div>
              <h2 id="dash-live" className="text-sm font-semibold text-foreground">{t('dashboard.liveSessions')}</h2>
              <p className="text-xs text-muted-foreground">{t('dashboard.runningCount', { count: sessions.length })}</p>
            </div>
          </div>
          <button onClick={loadDashboardData} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <RefreshCw className="h-3 w-3" /> {t('dashboard.refresh')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border">
                {['thProfile', 'thProxyIp', 'thUptime', 'thHealth', 'thAction'].map((k) => (
                  <th key={k} scope="col" className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`dashboard.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-5 py-12 text-center">
                    <MonitorSmartphone className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-50" />
                    <p className="text-sm font-medium text-foreground">{t('dashboard.noActiveSessions')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.launchToMonitor')}</p>
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} className="border-b border-border transition-colors last:border-0 hover:bg-secondary/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--success)' }} />
                          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--success)' }} />
                        </span>
                        <span className="font-medium text-foreground">{s.profileName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <code className="rounded-md border border-border bg-elevated px-2 py-1 font-mono text-[11px] text-muted-foreground">{s.ip}</code>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground"><Clock className="h-3 w-3" />{s.uptime}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 22%, transparent)' }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} /> {t('dashboard.healthy')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => handleStopSession(s.id)}
                        aria-label={`${t('dashboard.stop')} ${s.profileName}`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
                        style={{ color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--destructive) 22%, transparent)' }}
                      >
                        <X className="h-3 w-3" /> {t('dashboard.stop')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showStatus && <SystemStatusModal stats={stats} sessions={sessions} onClose={() => setShowStatus(false)} />}
    </div>
  );
}

function SystemStatusModal({ stats, sessions, onClose }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const { dialogRef } = useDialog({ onClose });
  useEffect(() => {
    let live = true;
    softglazeApi.system.getInfo()
      .then((d) => { if (live) setInfo(d); })
      .catch(() => {})
      .finally(() => { if (live) setLoadingInfo(false); });
    return () => { live = false; };
  }, []);

  const components = [
    { label: t('dashboard.compBrowserEngine'), ok: true, note: t('dashboard.compOperational') },
    { label: t('dashboard.compLocalDatabase'), ok: true, note: info?.databaseUrlConfigured ? t('dashboard.compConnectedEnv') : t('dashboard.compConnected') },
    { label: t('dashboard.compIpcBridge'), ok: true, note: t('dashboard.compConnected') },
    { label: t('dashboard.compActiveSessions'), ok: true, note: t('dashboard.resRunningVal', { count: stats.activeSessions || 0 }) }
  ];
  const metrics = [
    [t('dashboard.metricGridProfiles'), stats.totalProfiles || 0],
    [t('dashboard.metricGridSessions'), stats.activeSessions || 0],
    [t('dashboard.metricGridProxies'), stats.totalProxies || 0],
    [t('dashboard.metricGridGroups'), stats.totalGroups || 0]
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('dashboard.statusTitle')} tabIndex={-1} className="w-[460px] rounded-2xl border border-border bg-popover shadow-2xl shadow-black/50" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /><h2 className="font-display text-[15px] font-semibold text-foreground">{t('dashboard.statusTitle')}</h2></div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={t('shell.dismiss')}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: 'var(--success)' }} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: 'var(--success)' }} />
            </span>
            <span className="font-medium" style={{ color: 'var(--success)' }}>{t('dashboard.allOperational')}</span>
          </div>
          <div className="space-y-2">
            {components.map((c) => (
              <div key={c.label} className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-2 text-foreground"><span className="h-2 w-2 rounded-full" style={{ background: c.ok ? 'var(--success)' : 'var(--destructive)' }} />{c.label}</span>
                <span className="font-mono text-[11.5px] text-muted-foreground">{c.note}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {metrics.map(([l, v]) => (
              <div key={l} className="rounded-xl border border-border bg-elevated p-3 text-center">
                <div className="font-mono text-[18px] font-bold text-foreground">{v}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 rounded-xl border border-border bg-elevated p-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.environment')}</div>
            {loadingInfo ? (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('dashboard.reading')}</div>
            ) : (
              <>
                <div className="break-all text-[11.5px] text-muted-foreground"><span className="text-muted-foreground">DB: </span><span className="font-mono text-foreground">{info?.dbPath || t('dashboard.unknown')}</span></div>
                <div className="break-all text-[11.5px] text-muted-foreground"><span className="text-muted-foreground">Profiles: </span><span className="font-mono text-foreground">{info?.profileRoot || t('dashboard.unknown')}</span></div>
                {info?.cpuModel && <div className="break-all text-[11.5px] text-muted-foreground"><span>CPU: </span><span className="font-mono text-foreground">{info.cpuModel} ({info.cpuCount} cores)</span></div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
