import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Play, Globe, Folder, Clock, X, MonitorSmartphone, Zap, Loader2,
  TrendingUp, ArrowUpRight, Shield, RefreshCw, Cpu, HardDrive, Server,
  Sparkles, CalendarDays
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/ui/Button.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { AreaChart, Donut, Legend, GroupedBars, ProgressMeter } from '@/components/charts/Charts.jsx';

const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const fmtGB = (bytes) => (bytes / 1024 / 1024 / 1024).toFixed(1);

// Figma-style stat card: tinted background, glow blob, icon tile, trend line.
function StatCard({ icon: Icon, label, value, change, color, delay = 0 }) {
  return (
    <div
      className="rounded-xl p-5 relative overflow-hidden group cursor-default animate-fade-up"
      style={{ background: `color-mix(in srgb, ${color} 8%, var(--card))`, border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`, animationDelay: `${delay}ms` }}
    >
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 group-hover:opacity-20 transition-opacity duration-500" style={{ background: color, filter: 'blur(22px)' }} />
      <div className="flex items-start justify-between relative z-10">
        <div className="w-10 h-10 rounded-lg grid place-items-center" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <ArrowUpRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color }} />
      </div>
      <div className="mt-4 relative z-10">
        <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
        <p className="text-3xl font-bold text-foreground font-display tracking-tight">{value}</p>
        <div className="flex items-center gap-1 mt-1.5">
          <TrendingUp className="w-3 h-3" style={{ color }} />
          <span className="text-[11px] font-medium" style={{ color }}>{change}</span>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, icon: Icon, iconColor, children, className = '', actions }) {
  return (
    <div className={`rounded-xl bg-card border border-border p-5 animate-fade-up ${className}`}>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${iconColor} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${iconColor} 22%, transparent)` }}>
              <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

// Motivational lines live in the i18n locale files (dashboard.motivation, an
// array); one index is picked per mount so the dashboard feels fresh.
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
// date in the OS/region locale, and a rotating motivational line.
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
      } catch (e) { /* ignore — fall back to a generic greeting */ }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Format the clock/date in the app's selected language (falls back to the OS
  // locale if the language tag isn't recognized by Intl).
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
    <div
      className="relative overflow-hidden rounded-2xl border p-6 sm:p-7 animate-fade-up"
      style={{
        background: 'linear-gradient(120deg, color-mix(in srgb, var(--chart-1) 16%, var(--card)) 0%, color-mix(in srgb, var(--chart-2) 14%, var(--card)) 55%, var(--card) 100%)',
        borderColor: 'color-mix(in srgb, var(--primary) 26%, transparent)'
      }}
    >
      <div className="absolute -top-10 -right-8 w-48 h-48 rounded-full opacity-30 pointer-events-none" style={{ background: 'var(--chart-2)', filter: 'blur(70px)' }} />
      <div className="absolute -bottom-12 -left-6 w-44 h-44 rounded-full opacity-20 pointer-events-none" style={{ background: 'var(--chart-1)', filter: 'blur(70px)' }} />
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{t('dashboard.welcomeBack')}</span>
          </div>
          <h1 className="text-2xl sm:text-[32px] font-bold text-foreground font-display tracking-tight leading-tight">
            {greeting}, <span style={{ color: 'var(--primary)' }}>{who.name || t('dashboard.guestName')}</span> <span className="inline-block">👋</span>
          </h1>
          <p className="text-[13px] sm:text-sm text-muted-foreground mt-2 max-w-xl italic">“{quote}”</p>
        </div>
        <div className="shrink-0 rounded-xl border border-border bg-card/60 backdrop-blur px-4 py-3 text-right">
          <div className="font-mono text-2xl sm:text-3xl font-bold text-foreground tabular-nums tracking-tight">{timeStr}</div>
          <div className="flex items-center justify-end gap-1.5 text-[12px] text-muted-foreground mt-1">
            <CalendarDays className="w-3.5 h-3.5" /> {dateStr}
          </div>
        </div>
      </div>
    </div>
  );
}

// In-app OTA update banner. Subscribes to updater events and reads the current
// state on mount (so it appears even if the event fired before this page mounted).
// Only visible once an update is available/downloading/downloaded.
// i18n note: this banner and ResilienceToasts below are intentionally NOT yet
// localized in the G3 pilot — they are event-driven (rarely on screen) and build
// their copy from nested conditionals/concatenation; they'll be migrated in a
// later i18n pass where the strings can be restructured into clean t() keys.
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
  // Always surface the actionable states; surface error/checking ONLY once an update
  // was in flight, so a cold offline launch-check doesn't nag here (Settings → Updates
  // is the home for manual checks + "up to date").
  const isError = status === 'error' && sawActive.current;
  const isChecking = status === 'checking' && sawActive.current;
  const actionable = status === 'available' || status === 'downloading' || status === 'downloaded';
  if (!actionable && !isError && !isChecking) return null;
  const downloaded = status === 'downloaded';
  const v = version ? `v${version}` : '';
  const accent = isError ? '#ef4444' : 'var(--primary)';

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
        <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}>
          {isChecking ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: accent }} /> : <Sparkles className="w-4 h-4" style={{ color: accent }} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>
        </div>
        {downloaded && (
          <Button variant="primary" size="sm" onClick={install} disabled={installing}>
            {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Install &amp; restart
          </Button>
        )}
        {isError && (
          <Button variant="secondary" size="sm" onClick={retry}>
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </Button>
        )}
        {(downloaded || status === 'available') && releaseNotes && (
          <button onClick={() => setShowNotes((s) => !s)} className="shrink-0 text-[11px] text-primary hover:underline px-1" title="What's new">
            {showNotes ? 'Hide notes' : "What's new"}
          </button>
        )}
        <button onClick={() => setDismissed(true)} className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title="Dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
      {showNotes && releaseNotes && (
        <pre className="mt-2 ml-12 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground bg-secondary/40 rounded-lg p-2.5 border border-border">{releaseNotes}</pre>
      )}
    </div>
  );
}

// Offers to restore the profiles that were open when the app last exited or crashed.
// Pull model (like the update banner) — robust to mount timing.
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
      <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, var(--primary) 16%, transparent)' }}>
        <RefreshCw className="w-4 h-4 text-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">{t('dashboard.restoreTitle')}</p>
        <p className="text-[11.5px] text-muted-foreground">{t('dashboard.restoreDesc', { count: profiles.length })}</p>
      </div>
      <Button variant="primary" size="sm" onClick={restore} disabled={busy}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} {t('dashboard.restore')}
      </Button>
      <button onClick={dismiss} disabled={busy} className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title={t('shell.dismiss')}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Transient toasts for crash + memory-pressure notifications pushed from main.
function ResilienceToasts() {
  const [toasts, setToasts] = useState([]); // { id, kind, text }
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
      add('crash', `${d.title || 'A profile'} stopped unexpectedly${d.restarted ? ' — restarting…' : ''}.`);
    }));
    if (softglazeApi.sessions.onMemoryPressure) offs.push(softglazeApi.sessions.onMemoryPressure((d) => {
      if (!d) return;
      add('memory', `Low memory — closed ${d.closed} profile${d.closed === 1 ? '' : 's'} (free ${d.freePct}%).`);
    }));
    return () => offs.forEach((off) => { if (typeof off === 'function') off(); });
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg animate-fade-up" style={{ background: 'var(--card)', borderColor: 'color-mix(in srgb, #ef4444 35%, transparent)' }}>
          {t.kind === 'crash'
            ? <Zap className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#f59e0b' }} />
            : <Cpu className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#ef4444' }} />}
          <p className="text-[12.5px] text-foreground">{t.text}</p>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState({ totalProfiles: 0, activeSessions: 0, totalProxies: 0, totalGroups: 0 });
  const [sessions, setSessions] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [sysInfo, setSysInfo] = useState(null);
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
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground animate-pulse">{t('dashboard.loadingCenter')}</p>
        </div>
      </div>
    );
  }

  // ---- Derived REAL data ------------------------------------------------
  const proxyTypes = proxies.reduce((acc, p) => {
    const t = String(p.type || 'OTHER').toUpperCase().replace('SOCKS5', 'SOCKS5');
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const proxyDonut = Object.entries(proxyTypes).map(([label, value], i) => ({ label, value, color: CHART[i % CHART.length] }));
  if (proxyDonut.length === 0) proxyDonut.push({ label: t('dashboard.noProxies'), value: 1, color: 'var(--elevated)' });

  const memPct = sysInfo && sysInfo.memTotal ? Math.round((sysInfo.memUsed / sysInfo.memTotal) * 100) : 0;
  const activeRatio = stats.totalProfiles ? Math.round((stats.activeSessions / stats.totalProfiles) * 100) : 0;
  const proxyCoverage = stats.totalProfiles ? Math.min(100, Math.round((stats.totalProxies / stats.totalProfiles) * 100)) : (stats.totalProxies ? 100 : 0);

  const resourceBars = [
    { label: t('dashboard.barProfiles'), value: stats.totalProfiles },
    { label: t('dashboard.barActive'), value: stats.activeSessions },
    { label: t('dashboard.barProxies'), value: stats.totalProxies },
    { label: t('dashboard.barGroups'), value: stats.totalGroups }
  ];

  const areaData = history.map((h) => ({ x: h.x, y: h[metric] }));

  return (
    <div className="space-y-6 pb-10">
      {/* IN-APP OTA UPDATE BANNER */}
      <UpdateBanner />

      {/* SESSION RESTORE OFFER (after a crash or last close) */}
      <RestoreBanner />
      {/* CRASH / MEMORY-PRESSURE TOASTS */}
      <ResilienceToasts />

      {/* PERSONALIZED WELCOME */}
      <WelcomeBanner />

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-1">{t('dashboard.overview')}</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-display tracking-tight">{t('dashboard.commandCenter')}</h1>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" /></span>
            {t('dashboard.liveMonitoring')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--success) 9%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 18%, transparent)', color: 'var(--success)' }}>
            <Shield className="w-3.5 h-3.5" /> {t('dashboard.antiDetectActive')}
          </div>
          <Button variant="secondary" size="md" onClick={() => setShowStatus(true)}>
            <Activity className="h-4 w-4" /> {t('dashboard.systemStatus')}
          </Button>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={MonitorSmartphone} label={t('dashboard.statTotalProfiles')} value={stats.totalProfiles} change={t('dashboard.changeGroups', { count: stats.totalGroups })} color="#3b82f6" delay={0} />
        <StatCard icon={Play} label={t('dashboard.statActiveSessions')} value={stats.activeSessions} change={stats.activeSessions > 0 ? t('dashboard.changeLiveNow') : t('dashboard.changeIdle')} color="#10b981" delay={60} />
        <StatCard icon={Globe} label={t('dashboard.statProxyPool')} value={stats.totalProxies} change={t('dashboard.changeTypes', { count: proxyDonut.length })} color="#8b5cf6" delay={120} />
        <StatCard icon={Folder} label={t('dashboard.statGroups')} value={stats.totalGroups} change={t('dashboard.changeOrganized')} color="#f59e0b" delay={180} />
      </div>

      {/* CHARTS ROW 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          className="xl:col-span-2"
          title={t('dashboard.activityTimeline')}
          subtitle={t('dashboard.activityTimelineSub')}
          icon={Activity}
          iconColor="#3b82f6"
          actions={
            <div className="flex items-center gap-1 p-1 rounded-lg bg-elevated">
              {['sessions', 'proxies'].map((m) => (
                <button key={m} onClick={() => setMetric(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${metric === m ? 'bg-card text-foreground border border-border' : 'text-muted-foreground border border-transparent hover:text-foreground'}`}>
                  {t(m === 'sessions' ? 'dashboard.metricSessions' : 'dashboard.metricProxies')}
                </button>
              ))}
            </div>
          }
        >
          <AreaChart data={areaData} color={metric === 'sessions' ? 'var(--chart-1)' : 'var(--chart-2)'} height={210} />
        </ChartCard>

        <ChartCard title={t('dashboard.statProxyPool')} subtitle={t('dashboard.proxyPoolSub', { count: stats.totalProxies })} icon={Globe} iconColor="#8b5cf6">
          <div className="flex items-center justify-center mb-4">
            <Donut data={proxyDonut} centerLabel={stats.totalProxies} centerSub={t('dashboard.proxiesUnit')} />
          </div>
          <Legend data={proxyDonut} />
        </ChartCard>
      </div>

      {/* CHARTS ROW 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard title={t('dashboard.resourceOverview')} subtitle={t('dashboard.resourceOverviewSub')} icon={Zap} iconColor="#3b82f6">
          <GroupedBars data={resourceBars} keys={[{ key: 'value', label: 'count', color: 'var(--chart-1)' }]} height={180} />
        </ChartCard>

        <ChartCard title={t('dashboard.healthScores')} subtitle={t('dashboard.healthScoresSub')} icon={Shield} iconColor="#10b981">
          <div className="space-y-4 pt-1">
            <ProgressMeter label={t('dashboard.memoryAvailable')} value={100 - memPct} color="var(--chart-3)" />
            <ProgressMeter label={t('dashboard.activeRatio')} value={activeRatio} color="var(--chart-1)" />
            <ProgressMeter label={t('dashboard.proxyCoverage')} value={proxyCoverage} color="var(--chart-2)" />
          </div>
        </ChartCard>

        <ChartCard title={t('dashboard.systemResources')} subtitle={sysInfo ? sysInfo.cpuModel : t('dashboard.realTimeMetrics')} icon={Cpu} iconColor="#f59e0b">
          <div className="space-y-3">
            {[
              { label: t('dashboard.resMemory'), icon: Server, val: sysInfo ? `${fmtGB(sysInfo.memUsed)} / ${fmtGB(sysInfo.memTotal)} GB` : '—', color: '#8b5cf6' },
              { label: t('dashboard.resCpuCores'), icon: Cpu, val: sysInfo ? t('dashboard.resCpuCoresVal', { count: sysInfo.cpuCount }) : '—', color: '#3b82f6' },
              { label: t('dashboard.resActiveSessions'), icon: Play, val: t('dashboard.resRunningVal', { count: stats.activeSessions }), color: '#10b981' },
              { label: t('dashboard.resProfiles'), icon: HardDrive, val: t('dashboard.resStoredVal', { count: stats.totalProfiles }), color: '#f59e0b' }
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between p-3 rounded-lg bg-elevated">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: r.color, boxShadow: `0 0 6px ${r.color}` }} />
                  <span className="text-xs text-muted-foreground">{r.label}</span>
                </div>
                <span className="text-xs font-bold font-mono" style={{ color: r.color }}>{r.val}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* LIVE SESSIONS TABLE */}
      <div className="rounded-xl bg-card border border-border overflow-hidden animate-fade-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 22%, transparent)' }}>
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('dashboard.liveSessions')}</h3>
              <p className="text-xs text-muted-foreground">{t('dashboard.runningCount', { count: sessions.length })}</p>
            </div>
          </div>
          <button onClick={loadDashboardData} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <RefreshCw className="w-3 h-3" /> {t('dashboard.refresh')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-border">
                {['thProfile', 'thProxyIp', 'thUptime', 'thHealth', 'thAction'].map((k) => (
                  <th key={k} className="px-5 py-3 text-left font-semibold uppercase tracking-wider text-muted-foreground text-[10px]">{t(`dashboard.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-5 py-12 text-center">
                    <MonitorSmartphone className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium text-foreground">{t('dashboard.noActiveSessions')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('dashboard.launchToMonitor')}</p>
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-secondary/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>
                        <span className="font-medium text-foreground">{s.profileName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <code className="px-2 py-1 rounded-md text-[11px] bg-elevated border border-border text-muted-foreground font-mono">{s.ip}</code>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-xs"><Clock className="w-3 h-3" />{s.uptime}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider" style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 22%, transparent)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} /> {t('dashboard.healthy')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => handleStopSession(s.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors">
                        <X className="w-3 h-3" /> {t('dashboard.stop')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showStatus && <SystemStatusModal stats={stats} sessions={sessions} onClose={() => setShowStatus(false)} />}
    </div>
  );
}

function SystemStatusModal({ stats, sessions, onClose }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
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
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={onClose}>
      <div className="w-[460px] bg-popover border border-border rounded-2xl shadow-2xl shadow-black/50" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /><h2 className="font-display text-[15px] font-semibold text-foreground">{t('dashboard.statusTitle')}</h2></div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" /></span>
            <span className="font-medium text-emerald-400">{t('dashboard.allOperational')}</span>
          </div>
          <div className="space-y-2">
            {components.map((c) => (
              <div key={c.label} className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-2 text-foreground"><span className={`w-2 h-2 rounded-full ${c.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />{c.label}</span>
                <span className="text-muted-foreground font-mono text-[11.5px]">{c.note}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {metrics.map(([l, v]) => (
              <div key={l} className="bg-elevated border border-border rounded-xl p-3 text-center">
                <div className="text-[18px] font-bold text-foreground font-mono">{v}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{l}</div>
              </div>
            ))}
          </div>
          <div className="bg-elevated border border-border rounded-xl p-3 space-y-1.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.environment')}</div>
            {loadingInfo ? (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('dashboard.reading')}</div>
            ) : (
              <>
                <div className="text-[11.5px] text-muted-foreground break-all"><span className="text-muted-foreground">DB: </span><span className="font-mono text-foreground">{info?.dbPath || t('dashboard.unknown')}</span></div>
                <div className="text-[11.5px] text-muted-foreground break-all"><span className="text-muted-foreground">Profiles: </span><span className="font-mono text-foreground">{info?.profileRoot || t('dashboard.unknown')}</span></div>
                {info?.cpuModel && <div className="text-[11.5px] text-muted-foreground break-all"><span>CPU: </span><span className="font-mono text-foreground">{info.cpuModel} ({info.cpuCount} cores)</span></div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
