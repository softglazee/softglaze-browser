import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCcw, StopCircle, Loader2, Database, Clock, Zap, Settings2, ChevronDown, Mail, Send, CheckCircle2, ShieldCheck, Users, Globe2, Layers, Network, FolderSync, SlidersHorizontal, Power, KeyRound, Languages, Search, FlaskConical, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import BillingSettings from '@/components/BillingSettings.jsx';
import MonetizationSettings from '@/components/MonetizationSettings.jsx';
import DeveloperApiSettings from '@/components/DeveloperApiSettings.jsx';
import MigrationSettings from '@/components/MigrationSettings.jsx';
import SyncSettings from '@/components/SyncSettings.jsx';
import DbEncryptionSettings from '@/components/DbEncryptionSettings.jsx';
import WorkspaceBackupSettings from '@/components/WorkspaceBackupSettings.jsx';
import BrandingSettings from '@/components/BrandingSettings.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import NumberInput from '@/components/ui/NumberInput.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';
import { getStoredLang, setLang, SUPPORTED_LANGS } from '@/lib/lang.js';
import i18n from '@/i18n/index.js';
import settingsExtraEn from '@/i18n/locales/en/settingsExtra.json';
import settingsExtraEs from '@/i18n/locales/es/settingsExtra.json';

// Register this page's "settingsExtra" namespace without touching the central
// i18n config (which only bundles the "common" namespace). addResourceBundle is
// a no-op if the bundle already exists, so this is safe across hot reloads.
if (!i18n.hasResourceBundle('en', 'settingsExtra')) i18n.addResourceBundle('en', 'settingsExtra', settingsExtraEn);
if (!i18n.hasResourceBundle('es', 'settingsExtra')) i18n.addResourceBundle('es', 'settingsExtra', settingsExtraEs);

// Lowercased live search query, shared with every section/row so they can hide
// themselves when they do not match. Empty string = show everything.
const SearchCtx = createContext('');

const numCls = 'w-20 bg-input-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary';

// --- CUSTOM STYLED SELECT DROPDOWN (Max 4px rounded) ---
function CustomSelect({ value, onChange, className = '', children, disabled, id }) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <select
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="w-full appearance-none bg-input-background border border-border rounded pl-3 pr-9 py-1.5 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap cursor-pointer hover:border-muted-dark"
      >
        {children}
      </select>
      <div className="absolute right-3 pointer-events-none text-muted-foreground">
        <ChevronDown className="w-4 h-4" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section metadata. Built from the live translations so nav labels, section
// headings and the search keywords all stay in sync in both languages. Both the
// left nav and the content sections reference the same ids / keyword strings.
// ---------------------------------------------------------------------------
function buildSections(t, tx) {
  const n = (s) => (s || '').toLowerCase();
  const map = {};
  const add = (id, group, label, desc, extra = '') => {
    map[id] = { id, group, label, desc, kw: n(`${label} ${desc} ${extra}`) };
  };

  add('language', 'general', t('settings.language.title'), t('settings.language.description'), 'language locale translate interface');
  add('onstartup', 'general', tx('onStartup.title'), tx('onStartup.description'), 'start page proxy extension country launch');
  add('updates', 'general', tx('updates.title'), tx('updates.description'), 'update version upgrade install');
  add('platform', 'general', tx('platform.title'), tx('platform.description'), 'icon serial number taskbar');

  add('fingerprint', 'browser', tx('fingerprint.title'), tx('fingerprint.description'), 'anti-detect fingerprint canvas webgl geolocation timezone cdp camera mobile webrtc chromium');
  add('behaviour', 'browser', tx('behaviour.title'), tx('behaviour.description'), 'chrome sign-in translate devtools extensions https videos images bandwidth');
  add('website', 'browser', tx('website.title'), tx('website.description'), 'block allowlist blocklist facebook local network url');
  add('ipsetting', 'browser', tx('ipSetting.title'), tx('ipSetting.description'), 'ip asn city region country checker ipinfo');
  add('autofill', 'browser', tx('smartAutofill.title'), tx('smartAutofill.description'), 'autofill vault persona firefox form');
  add('captcha', 'browser', tx('captcha.title'), tx('captcha.description'), 'captcha recaptcha hcaptcha 2captcha anticaptcha solver api key');

  add('localruntime', 'runtime', tx('localRuntime.title'), tx('localRuntime.description'), 'sqlite database path profile root');
  add('performance', 'runtime', tx('performance.title'), tx('performance.description'), 'parallel launch concurrency max running memory');
  add('reliability', 'runtime', tx('reliability.title'), tx('reliability.description'), 'restore session crash auto-restart memory guard');
  add('sessions', 'runtime', tx('sessions.title'), tx('sessions.description'), 'active session running close');
  add('scheduler', 'runtime', tx('scheduler.title'), tx('scheduler.description'), 'proxy health sweep schedule interval');
  add('datasync', 'runtime', tx('dataSync.title'), tx('dataSync.description'), 'cookie passwords bookmarks localstorage indexeddb extension history sync');

  add('security', 'security', tx('security.title'), tx('security.description'), 'login ip allowlist two-step 2fa failed remote verification');
  add('multidevice', 'security', tx('multiDevice.title'), tx('multiDevice.description'), 'device member simultaneous');
  add('audit', 'security', tx('audit.title'), tx('audit.description'), 'audit log retention activity');
  add('email', 'security', tx('email.title'), tx('email.description'), 'smtp email otp verification host port sender');

  add('billing', 'account', tx('nav.billing'), '', 'billing plan invoice payment subscription');
  add('monetization', 'account', tx('nav.monetization'), '', 'monetization plan usage revenue');
  add('migration', 'account', tx('nav.migration'), '', 'import migration data transfer');
  add('workspacesync', 'account', tx('nav.workspaceSync'), '', 'sync workspace cloud');
  add('branding', 'account', tx('nav.branding'), '', 'branding logo white-label');
  add('dbencryption', 'account', tx('nav.dbEncryption'), '', 'database encryption security');
  add('workspacebackup', 'account', tx('nav.workspaceBackup'), '', 'backup restore export');
  add('developerapi', 'account', tx('nav.developerApi'), '', 'developer api token local');

  const order = [
    'language', 'onstartup', 'updates', 'platform',
    'fingerprint', 'behaviour', 'website', 'ipsetting', 'autofill', 'captcha',
    'localruntime', 'performance', 'reliability', 'sessions', 'scheduler', 'datasync',
    'security', 'multidevice', 'audit', 'email',
    'billing', 'monetization', 'migration', 'workspacesync', 'branding', 'dbencryption', 'workspacebackup', 'developerapi'
  ];
  const groupLabels = {
    general: tx('groups.general'),
    browser: tx('groups.browser'),
    runtime: tx('groups.runtime'),
    security: tx('groups.security'),
    account: tx('groups.account')
  };
  const groups = ['general', 'browser', 'runtime', 'security', 'account'].map((gid) => ({
    id: gid,
    label: groupLabels[gid],
    items: order.filter((id) => map[id].group === gid).map((id) => ({ id, label: map[id].label }))
  }));
  return { map, groups, order };
}

// Nearest scrolling ancestor - the AppShell wraps every page in an
// `overflow-y-auto` container, so scroll-spy must watch that, not window.
function getScrollParent(node) {
  let el = node && node.parentElement;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

export default function SettingsPage() {
  const { t, i18n: i18nInst } = useTranslation();
  const { t: tx } = useTranslation('settingsExtra');
  const [systemInfo, setSystemInfo] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scheduler, setScheduler] = useState({ enabled: false, minutes: 30, running: false });
  const [savingSched, setSavingSched] = useState(false);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState('language');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  // Page-level auto-save status, reported by the global-settings hook. The app
  // persists every control immediately, so the concept's "Save" bar becomes an
  // honest save-status bar.
  const [save, setSave] = useState({ state: 'idle', message: '' });
  const savedTimer = useRef(null);
  const reportSave = useCallback((state, message) => {
    clearTimeout(savedTimer.current);
    if (state === 'saved') {
      setSave({ state: 'saved', message: '' });
      savedTimer.current = setTimeout(() => setSave((x) => (x.state === 'saved' ? { state: 'idle', message: '' } : x)), 1500);
    } else {
      setSave({ state, message: message || '' });
    }
  }, []);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const { s, loading: loadingGlobal, err: globalErr, apply } = useGlobalSettings(tx, reportSave);

  const sections = useMemo(() => buildSections(t, tx), [t, tx, i18nInst.language]);
  const q = query.trim().toLowerCase();
  const anyMatch = !q || sections.order.some((id) => sections.map[id].kw.includes(q));

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [info, activeSessions, sched] = await Promise.all([
        softglazeApi.system.getInfo(),
        softglazeApi.sessions.list(),
        softglazeApi.settings.getProxyScheduler()
      ]);
      setSystemInfo(info);
      setSessions(activeSessions);
      setScheduler(sched);
    } catch (err) {
      setError(err.message || tx('errors.loadSettings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Scroll-spy: highlight the section whose top has scrolled past a small band.
  useEffect(() => {
    const scroller = getScrollParent(rootRef.current);
    const ids = sections.order;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const base = scroller ? scroller.getBoundingClientRect().top : 0;
      let cur = null;
      let firstVisible = null;
      for (const id of ids) {
        const el = document.getElementById(`set-sec-${id}`);
        if (!el || el.hidden || el.offsetParent === null) continue;
        if (!firstVisible) firstVisible = id;
        const top = el.getBoundingClientRect().top - base;
        if (top <= 140) cur = id;
      }
      setActive(cur || firstVisible || ids[0]);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    const target = scroller || window;
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    compute();
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections, q, s, loadingGlobal, loading, sessions.length]);

  const jumpTo = useCallback((id) => {
    const el = document.getElementById(`set-sec-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(id); }
  }, []);

  // "/" focuses the search box, matching the concept.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchRef.current && searchRef.current.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function handleCloseSession(sessionId) {
    setError('');
    try {
      await softglazeApi.sessions.close(sessionId);
      await loadSettings();
    } catch (err) {
      setError(err.message || tx('errors.closeSession'));
    }
  }

  async function saveScheduler(next) {
    setSavingSched(true);
    setError('');
    try {
      const result = await softglazeApi.settings.setProxyScheduler(next);
      setScheduler(result);
    } catch (err) {
      setError(err.message || tx('errors.updateScheduler'));
    } finally {
      setSavingSched(false);
    }
  }

  const SEC = sections.map;

  return (
    <SearchCtx.Provider value={q}>
      <div ref={rootRef} className="pb-4">
        <PageHeader
          eyebrow={t('settings.eyebrow')}
          title={t('settings.title')}
          description={t('settings.description')}
          actions={
            <Button variant="secondary" onClick={loadSettings}>
              <RefreshCcw className="h-4 w-4" /> {tx('actions.refresh')}
            </Button>
          }
        />

        {(error || globalErr) && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error || globalErr}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[216px_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
          <SettingsNav groups={sections.groups} active={active} query={query} setQuery={setQuery} onJump={jumpTo} searchRef={searchRef} />

          <div className="min-w-0 max-w-[860px] space-y-8">
            {/* GENERAL -------------------------------------------------------- */}
            <GroupBlock group={sections.groups[0]} map={SEC}>
              <LanguageSection sec={SEC.language} />
              <OnStartupSection sec={SEC.onstartup} s={s} apply={apply} />
              <UpdatesSection sec={SEC.updates} />
              <PlatformSection sec={SEC.platform} s={s} apply={apply} />
            </GroupBlock>

            {/* BROWSER -------------------------------------------------------- */}
            <GroupBlock group={sections.groups[1]} map={SEC}>
              <FingerprintSection sec={SEC.fingerprint} s={s} apply={apply} />
              <BehaviourSection sec={SEC.behaviour} s={s} apply={apply} />
              <WebsiteSection sec={SEC.website} s={s} apply={apply} />
              <IpSettingSection sec={SEC.ipsetting} s={s} apply={apply} />
              <AutofillSection sec={SEC.autofill} s={s} apply={apply} />
              <CaptchaSection sec={SEC.captcha} s={s} apply={apply} />
            </GroupBlock>

            {/* RUNTIME -------------------------------------------------------- */}
            <GroupBlock group={sections.groups[2]} map={SEC}>
              <LocalRuntimeSection sec={SEC.localruntime} loading={loading} systemInfo={systemInfo} />
              <PerformanceSection sec={SEC.performance} s={s} apply={apply} />
              <ReliabilitySection sec={SEC.reliability} s={s} apply={apply} />
              <SessionsSection sec={SEC.sessions} loading={loading} sessions={sessions} onClose={handleCloseSession} />
              <SchedulerSection sec={SEC.scheduler} scheduler={scheduler} savingSched={savingSched} saveScheduler={saveScheduler} setScheduler={setScheduler} />
              <DataSyncSection sec={SEC.datasync} s={s} apply={apply} />
            </GroupBlock>

            {/* SECURITY & TEAM ------------------------------------------------ */}
            <GroupBlock group={sections.groups[3]} map={SEC}>
              <SecuritySection sec={SEC.security} s={s} apply={apply} />
              <MultiDeviceSection sec={SEC.multidevice} s={s} apply={apply} />
              <AuditSection sec={SEC.audit} s={s} apply={apply} />
              <EmailSection sec={SEC.email} />
            </GroupBlock>

            {/* ACCOUNT & DATA ------------------------------------------------- */}
            <GroupBlock group={sections.groups[4]} map={SEC}>
              <SearchGate sec={SEC.billing}><BillingSettings /></SearchGate>
              <SearchGate sec={SEC.monetization}><MonetizationSettings /></SearchGate>
              <SearchGate sec={SEC.migration}><MigrationSettings /></SearchGate>
              <SearchGate sec={SEC.workspacesync}><SyncSettings /></SearchGate>
              <SearchGate sec={SEC.branding}><BrandingSettings /></SearchGate>
              <SearchGate sec={SEC.dbencryption}><DbEncryptionSettings /></SearchGate>
              <SearchGate sec={SEC.workspacebackup}><WorkspaceBackupSettings /></SearchGate>
              <SearchGate sec={SEC.developerapi}><DeveloperApiSettings /></SearchGate>
            </GroupBlock>

            {q && !anyMatch && (
              <EmptyState title={tx('ui.noResultsTitle', { term: query })} description={tx('ui.noResultsDesc')} />
            )}

            <SaveBar status={save} />
          </div>
        </div>
      </div>
    </SearchCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Left section navigation: search box + grouped jump links with scroll-spy. On
// narrow screens the vertical list collapses to a search box and a jump <select>.
// ---------------------------------------------------------------------------
function SettingsNav({ groups, active, query, setQuery, onJump, searchRef }) {
  const { t: tx } = useTranslation('settingsExtra');
  const q = query.trim().toLowerCase();
  const all = groups.flatMap((g) => g.items);
  return (
    <aside className="lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1" aria-label="Settings sections">
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tx('ui.searchPlaceholder')}
          aria-label={tx('ui.searchPlaceholder')}
          autoComplete="off"
          className="w-full bg-input-background border border-border rounded-lg pl-9 pr-9 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition"
        />
        <kbd className="hidden lg:flex absolute right-2.5 top-1/2 -translate-y-1/2 items-center h-5 px-1.5 rounded border border-border bg-secondary text-[10px] font-mono text-muted-foreground pointer-events-none">/</kbd>
      </div>

      {/* Mobile / tablet: jump select */}
      <label className="lg:hidden block">
        <span className="sr-only">{tx('ui.jumpTo')}</span>
        <CustomSelect value={active} onChange={(e) => onJump(e.target.value)} aria-label={tx('ui.jumpTo')}>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.items.map((it) => (
                <option key={it.id} value={it.id}>{it.label}</option>
              ))}
            </optgroup>
          ))}
        </CustomSelect>
      </label>

      {/* Desktop: full grouped list */}
      <nav className="hidden lg:block space-y-5" aria-label="Sections">
        {groups.map((g) => {
          const groupHit = !q || g.items.some((it) => all.find((x) => x.id === it.id) && it.label.toLowerCase().includes(q));
          return (
            <div key={g.id}>
              <div className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{g.label}</div>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const dim = q && !it.label.toLowerCase().includes(q) && !groupHit;
                  const isActive = active === it.id;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => onJump(it.id)}
                        aria-current={isActive ? 'true' : undefined}
                        className={`w-full text-left flex items-center gap-2 h-7 px-2 rounded-md text-[13px] leading-tight truncate transition-colors ${
                          isActive
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        } ${dim ? 'opacity-40' : ''}`}
                      >
                        <span className="truncate">{it.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// Auto-save status bar, pinned to the bottom of the viewport while settings are
// in view. No manual Save button: every control already persists on change.
function SaveBar({ status }) {
  const { t: tx } = useTranslation('settingsExtra');
  const saving = status.state === 'saving';
  const error = status.state === 'error';
  return (
    <div className="sticky bottom-3 z-20 flex justify-center pointer-events-none">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg backdrop-blur-sm ${
          error ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-border bg-card/90 text-muted-foreground'
        }`}
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          : error ? <AlertCircle className="w-3.5 h-3.5" />
          : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
        <span>
          {saving ? tx('ui.saving')
            : error ? (status.message ? `${tx('ui.saveError')} - ${status.message}` : tx('ui.saveError'))
            : tx('ui.savedIdle')}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
function GroupBlock({ group, map, children }) {
  const query = useContext(SearchCtx);
  const visible = !query || group.items.some((it) => map[it.id] && map[it.id].kw.includes(query));
  return (
    <div hidden={!visible} className="space-y-4">
      <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground font-display">{group.label}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function IconTile({ icon: Icon, accent = '#3b82f6' }) {
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
      style={{
        background: `color-mix(in srgb, ${accent} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`
      }}
    >
      <Icon className="w-4 h-4" style={{ color: accent }} />
    </div>
  );
}

// A card-styled settings section with an id + search keywords, so the nav can
// jump to it and search can hide it.
function SectionBox({ sec, icon, accent, headerRight, children, bodyClassName = '' }) {
  const query = useContext(SearchCtx);
  const hidden = query && !sec.kw.includes(query);
  return (
    <section
      id={`set-sec-${sec.id}`}
      data-section
      hidden={hidden}
      className="bg-card border border-border rounded-xl overflow-hidden scroll-mt-6 animate-fade-up"
    >
      <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border">
        {icon && <IconTile icon={icon} accent={accent} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">{sec.label}</h3>
            {headerRight}
          </div>
          {sec.desc && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-[70ch]">{sec.desc}</p>}
        </div>
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// Wraps a standalone sub-component card so the nav can anchor to it and search
// can hide it, without restyling the card itself.
function SearchGate({ sec, children }) {
  const query = useContext(SearchCtx);
  const hidden = query && !sec.kw.includes(query);
  return (
    <div id={`set-sec-${sec.id}`} data-section hidden={hidden} className="scroll-mt-6">
      {children}
    </div>
  );
}

function AppliedBadge() {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <span className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
      {tx('toggleRow.appliedAtLaunch')}
    </span>
  );
}

function ExperimentalTag() {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
        borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)',
        color: 'var(--warning)'
      }}
    >
      <FlaskConical className="w-3 h-3" /> {tx('ui.experimental')}
    </span>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-muted-dark'}`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

// A label/description row with a right-aligned control. `inline` keeps the
// control beside the label at every width (for small controls like switches);
// otherwise the control stacks below the label on narrow screens.
function Row({ title, description, badges, experimental, control, children, inline = false, align = 'center' }) {
  return (
    <div
      data-setting-row
      className={`grid gap-x-6 gap-y-3 px-5 py-3.5 border-b border-border last:border-0 ${align === 'start' ? 'items-start' : 'items-center'} ${
        inline ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {experimental && <ExperimentalTag />}
          {badges}
        </div>
        {description && <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-[60ch]">{description}</p>}
        {children}
      </div>
      {control != null && <div className="flex items-center gap-2 sm:justify-end flex-wrap">{control}</div>}
    </div>
  );
}

function SwitchRow({ title, description, checked, onChange, disabled, wired, experimental, children }) {
  return (
    <Row
      inline
      align="start"
      title={title}
      description={description}
      experimental={experimental}
      badges={wired ? <AppliedBadge /> : null}
      control={<Toggle checked={checked} onChange={onChange} disabled={disabled} />}
    >
      {children}
    </Row>
  );
}

function LoadingRow({ label }) {
  return (
    <div className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global-settings state. Lifted into a hook so the whole page can render the
// sections in nav order and surface one shared save-status bar. The optimistic
// apply() keeps the recent request-sequence guard and revert-on-failure intact.
// ---------------------------------------------------------------------------
function mergeLocal(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const key of Object.keys(patch)) {
    const b = base ? base[key] : undefined;
    const p = patch[key];
    out[key] = (b && typeof b === 'object' && !Array.isArray(b) && p && typeof p === 'object' && !Array.isArray(p))
      ? mergeLocal(b, p) : p;
  }
  return out;
}

// audit: normalize incoming settings so every group/sub-group the render touches
// always exists (a missing top-level group used to throw a TypeError that blanked
// the whole app before the ErrorBoundary).
function withGlobalDefaults(cfg) {
  const c = cfg || {};
  return {
    ...c,
    security: { loginIpAllowlist: {}, twoStep: {}, ...(c.security || {}) },
    multiDevice: { ...(c.multiDevice || {}) },
    website: { blockAccess: {}, ...(c.website || {}) },
    platform: { ...(c.platform || {}) },
    ipSetting: { autoConfig: {}, ...(c.ipSetting || {}) },
    dataSync: { ...(c.dataSync || {}) },
    captcha: { ...(c.captcha || {}) }
  };
}

function useGlobalSettings(tx, reportSave) {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // Request bookkeeping for apply(): the newest request's ticket, how many are
  // still in flight, and the last settings the main process actually confirmed
  // (with the ticket that produced it, so an out-of-order older response cannot
  // replace it).
  const applySeq = useRef(0);
  const inFlight = useRef(0);
  const confirmed = useRef({ seq: 0, value: null });
  const failedSinceIdle = useRef(false);
  const lastError = useRef('');

  useEffect(() => {
    softglazeApi.settings.getGlobal()
      .then((cfg) => { const v = withGlobalDefaults(cfg); confirmed.current = { seq: 0, value: v }; setS(v); })
      .catch((e) => setErr(e.message || tx('errors.loadGlobal')))
      .finally(() => setLoading(false));
  }, []);

  // Optimistic update + persist of a partial patch.
  //  - Only the NEWEST request may replace the on-screen settings; a stale
  //    response resolving late used to roll back a toggle the user flipped since.
  //  - On failure the error shows and, once nothing is in flight, the screen is
  //    reset to the newest settings the main process confirmed.
  //  - saving clears only when the last in-flight request finishes.
  const apply = useCallback((patch) => {
    const seq = ++applySeq.current;
    inFlight.current += 1;
    setS((cur) => mergeLocal(cur, patch));
    setSaving(true);
    setErr('');
    reportSave && reportSave('saving');
    softglazeApi.settings.setGlobal(patch)
      .then((next) => {
        const v = withGlobalDefaults(next);
        if (seq > confirmed.current.seq) confirmed.current = { seq, value: v };
        if (seq === applySeq.current) setS(v);
      })
      .catch((e) => {
        const msg = e.message || tx('errors.saveSetting');
        setErr(msg);
        lastError.current = msg;
        failedSinceIdle.current = true;
      })
      .finally(() => {
        inFlight.current = Math.max(0, inFlight.current - 1);
        if (inFlight.current !== 0) return;
        setSaving(false);
        if (failedSinceIdle.current) {
          failedSinceIdle.current = false;
          if (confirmed.current.value) setS(confirmed.current.value);
          reportSave && reportSave('error', lastError.current);
          lastError.current = '';
        } else {
          reportSave && reportSave('saved');
        }
      });
  }, []);

  return { s, loading, saving, err, apply };
}

// ---------------------------------------------------------------------------
// GENERAL
// ---------------------------------------------------------------------------
function LanguageSection({ sec }) {
  const { t } = useTranslation();
  const [lang, setLangState] = useState(getStoredLang());
  return (
    <SectionBox sec={sec} icon={Languages} accent="#6366f1">
      <Row
        inline
        align="start"
        title={t('settings.language.label')}
        description={t('settings.language.hint')}
        control={
          <CustomSelect id="settings-language-select" className="w-full sm:w-56" value={lang} onChange={(e) => setLangState(setLang(e.target.value))}>
            {SUPPORTED_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.native}</option>
            ))}
          </CustomSelect>
        }
      />
    </SectionBox>
  );
}

function OnStartupSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Power} accent="#ef4444">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <div className="px-5 py-3.5 border-b border-border">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <label htmlFor="set-onstartup-mode" className="text-sm font-medium text-foreground">{tx('onStartup.startPageLabel')}</label>
              <AppliedBadge />
            </div>
            <CustomSelect id="set-onstartup-mode" className="w-full sm:w-72" value={s.onStartup.mode} onChange={(e) => apply({ onStartup: { mode: e.target.value } })}>
              <option value="detection">{tx('onStartup.modeDetection')}</option>
              <option value="last">{tx('onStartup.modeLast')}</option>
              <option value="blank">{tx('onStartup.modeBlank')}</option>
            </CustomSelect>
          </div>
          <SwitchRow
            wired
            title={tx('onStartup.onlyWithProxy.title')}
            description={tx('onStartup.onlyWithProxy.desc')}
            checked={s.onStartup.onlyOpenWithProxy}
            onChange={(v) => apply({ onStartup: { onlyOpenWithProxy: v } })}
          />
          <SwitchRow
            title={tx('onStartup.onlyWhenExtensionLoaded.title')}
            description={tx('onStartup.onlyWhenExtensionLoaded.desc')}
            checked={s.onStartup.onlyOpenWhenExtensionLoaded}
            onChange={(v) => apply({ onStartup: { onlyOpenWhenExtensionLoaded: v } })}
          />
          <SwitchRow
            title={tx('onStartup.blockIfCountryChanged.title')}
            description={tx('onStartup.blockIfCountryChanged.desc')}
            checked={s.onStartup.blockIfCountryChanged}
            onChange={(v) => apply({ onStartup: { blockIfCountryChanged: v } })}
          />
        </>
      )}
    </SectionBox>
  );
}

// App auto-update: the manual-check home that surfaces every updater state.
function UpdatesSection({ sec }) {
  const { t: tx } = useTranslation('settingsExtra');
  const [st, setSt] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let live = true;
    softglazeApi.updater.getState().then((x) => { if (live) setSt(x); }).catch(() => {});
    const off = softglazeApi.updater.onEvent((x) => { if (live) setSt(x); });
    return () => { live = false; if (typeof off === 'function') off(); };
  }, []);

  const status = (st && st.status) || 'idle';
  const activeUpd = !st || st.active !== false;
  const checking = status === 'checking';
  const downloaded = status === 'downloaded';
  const v = st && st.version ? `v${st.version}` : '';

  async function check() {
    setChecked(true);
    try { const r = await softglazeApi.updater.check(); if (r && r.active === false) setSt((p) => ({ ...(p || {}), active: false, status: 'idle' })); }
    catch (e) { /* ignore */ }
  }
  function install() { softglazeApi.updater.install().catch(() => {}); }

  let line = tx('updates.checkDefault');
  if (!activeUpd) line = tx('updates.notEnabled');
  else if (checking) line = tx('updates.checking');
  else if (status === 'available') line = tx('updates.available', { version: v });
  else if (status === 'downloading') line = tx('updates.downloading', { version: v, percent: st.percent || 0 });
  else if (downloaded) line = tx('updates.ready', { version: v });
  else if (status === 'error') line = st && st.error ? tx('updates.errorWithReason', { reason: String(st.error).slice(0, 120) }) : tx('updates.errorNoReason');
  else if (status === 'not-available' && checked) line = tx('updates.upToDate');

  return (
    <SectionBox sec={sec} icon={RefreshCcw} accent="#0ea5e9">
      <div className="flex items-center justify-between gap-4 px-5 py-3.5">
        <div className="min-w-0 flex items-center gap-2">
          {checking ? <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
            : status === 'not-available' && checked ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            : null}
          <p className="text-sm text-foreground truncate">{line}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {downloaded && (
            <Button variant="primary" size="sm" onClick={install}><RefreshCcw className="w-3.5 h-3.5" /> {tx('updates.installRestart')}</Button>
          )}
          <Button variant="secondary" size="sm" onClick={check} disabled={checking || !activeUpd}>
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} {tx('updates.checkForUpdates')}
          </Button>
        </div>
      </div>
    </SectionBox>
  );
}

function PlatformSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Layers} accent="#d946ef">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow title={tx('platform.customIcon.title')} description={tx('platform.customIcon.desc')} checked={s.platform.customIconEnabled} onChange={(v) => apply({ platform: { customIconEnabled: v } })} />
          <SwitchRow title={tx('platform.displayCustomNo.title')} description={tx('platform.displayCustomNo.desc')} checked={s.platform.displayCustomNo} onChange={(v) => apply({ platform: { displayCustomNo: v } })} />
          <SwitchRow title={tx('platform.displayLast4.title')} description={tx('platform.displayLast4.desc')} checked={s.platform.displayLast4} onChange={(v) => apply({ platform: { displayLast4: v } })} />
        </>
      )}
    </SectionBox>
  );
}

// ---------------------------------------------------------------------------
// BROWSER
// ---------------------------------------------------------------------------
// Install status + one-shot downloader for the native anti-detect engine.
function AntidetectEngineInstaller() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { setStatus(await softglazeApi.browsers.antidetectEngineStatus()); } catch (e) { /* ignore */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const inFlight = status && ['resolving', 'downloading', 'verifying', 'extracting'].includes(status.state);
  useEffect(() => {
    if (!inFlight) return undefined;
    const tId = setInterval(refresh, 1000);
    return () => clearInterval(tId);
  }, [inFlight, refresh]);
  const start = useCallback(async () => {
    setBusy(true);
    try { await softglazeApi.browsers.antidetectEngineDownload(); await refresh(); } catch (e) { /* surfaced via status */ } finally { setBusy(false); }
  }, [refresh]);

  if (!status) return null;
  if (status.installed) {
    return <div className="px-5 pb-3 -mt-1 text-xs text-emerald-400">Engine installed ✓ - fingerprint-chromium {status.version}</div>;
  }
  const pct = status.percent || 0;
  return (
    <div className="px-5 pb-3 -mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {inFlight ? (
        <span className="inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{status.state === 'extracting' ? 'Installing engine… extracting' : status.state === 'verifying' ? 'Verifying download…' : `Downloading engine… ${pct}%`}</span>
      ) : status.state === 'error' ? (
        <>
          <span className="text-rose-400">Download failed: {status.error || 'unknown error'}</span>
          <button onClick={start} disabled={busy} className="px-3 py-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50">Retry</button>
        </>
      ) : (
        <>
          <span>Engine not installed - the toggle above needs it.</span>
          <button onClick={start} disabled={busy} className="px-3 py-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50">Download engine (~180 MB)</button>
        </>
      )}
    </div>
  );
}

function FingerprintSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={ShieldCheck} accent="#3b82f6">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow
            title={tx('browser.antidetectEngine.title', 'Native anti-detect engine (fingerprint-chromium)')}
            description={tx('browser.antidetectEngine.desc')}
            checked={!!s.browser.antidetectEngine}
            onChange={(v) => apply({ browser: { antidetectEngine: v } })}
          />
          <AntidetectEngineInstaller />
          <SwitchRow title={tx('browser.geoMatch.title')} description={tx('browser.geoMatch.desc')} checked={!(s.geoMatch && s.geoMatch.enabled === false)} onChange={(v) => apply({ geoMatch: { enabled: v } })} />
          <SwitchRow title={tx('browser.realtimeTimezone.title')} description={tx('browser.realtimeTimezone.desc')} checked={s.browser.matchTimezoneOnIpChange} onChange={(v) => apply({ browser: { matchTimezoneOnIpChange: v } })} />
          <SwitchRow
            experimental
            title={tx('browser.minimizeCdpFootprint.shortTitle', 'Minimize CDP footprint')}
            description={tx('browser.minimizeCdpFootprint.desc')}
            checked={!!s.browser.minimizeCdpFootprint}
            onChange={(v) => apply({ browser: { minimizeCdpFootprint: v } })}
          />
          <SwitchRow title={tx('browser.virtualCamera.title')} description={tx('browser.virtualCamera.desc')} checked={s.browser.enableVirtualCamera} onChange={(v) => apply({ browser: { enableVirtualCamera: v } })} />
          <SwitchRow title={tx('browser.mobileSimulation.title')} description={tx('browser.mobileSimulation.desc')} checked={s.browser.mobileSimulation} onChange={(v) => apply({ browser: { mobileSimulation: v } })} />
        </>
      )}
    </SectionBox>
  );
}

function BehaviourSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={SlidersHorizontal} accent="#f97316">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow title={tx('browser.chromeSignin.title')} description={tx('browser.chromeSignin.desc')} checked={s.browser.allowChromeSignin} onChange={(v) => apply({ browser: { allowChromeSignin: v } })} />
          <SwitchRow title={tx('browser.offerTranslate.title')} description={tx('browser.offerTranslate.desc')} checked={s.browser.offerTranslate} onChange={(v) => apply({ browser: { offerTranslate: v } })} />
          <SwitchRow title={tx('browser.disableDevtools.title')} description={tx('browser.disableDevtools.desc')} checked={s.browser.disableDevtools} onChange={(v) => apply({ browser: { disableDevtools: v } })} />
          <SwitchRow title={tx('browser.lockExtensions.title')} description={tx('browser.lockExtensions.desc')} checked={s.browser.lockExtensions} onChange={(v) => apply({ browser: { lockExtensions: v } })} />
          <SwitchRow wired title={tx('browser.secureAccess.title')} description={tx('browser.secureAccess.desc')} checked={s.browser.secureAccess} onChange={(v) => apply({ browser: { secureAccess: v } })} />
          <SwitchRow wired title={tx('browser.disableVideos.title')} description={tx('browser.disableVideos.desc')} checked={s.browser.disableVideos} onChange={(v) => apply({ browser: { disableVideos: v } })} />
          <SwitchRow
            wired
            title={tx('browser.disableImages.title')}
            description={tx('browser.disableImages.desc')}
            checked={s.browser.disableImages}
            onChange={(v) => apply({ browser: { disableImages: v } })}
          >
            {s.browser.disableImages && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                {tx('browser.disableImages.skipUnder')}
                <NumberInput min={0} fallback={0} value={s.browser.imageMinKb ?? 0} onCommit={(n) => apply({ browser: { imageMinKb: n } })} className={numCls} />
                {tx('browser.disableImages.kb')}
              </div>
            )}
          </SwitchRow>
        </>
      )}
    </SectionBox>
  );
}

function WebsiteSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Globe2} accent="#8b5cf6">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow
            title={tx('website.blockAccess.title')}
            description={tx('website.blockAccess.desc')}
            checked={s.website.blockAccess.enabled}
            onChange={(v) => apply({ website: { blockAccess: { enabled: v } } })}
          >
            {s.website.blockAccess.enabled && (
              <div className="mt-3">
                <CustomSelect className="w-full sm:w-48" value={s.website.blockAccess.mode} onChange={(e) => apply({ website: { blockAccess: { mode: e.target.value } } })}>
                  <option value="blocklist">{tx('website.blockAccess.blocklist')}</option>
                  <option value="allowlist">{tx('website.blockAccess.allowlist')}</option>
                </CustomSelect>
              </div>
            )}
          </SwitchRow>
          <SwitchRow title={tx('website.fbStatic.title')} description={tx('website.fbStatic.desc')} checked={s.website.fbStaticLocal} onChange={(v) => apply({ website: { fbStaticLocal: v } })} />
          <SwitchRow title={tx('website.localNetwork.title')} description={tx('website.localNetwork.desc')} checked={s.website.localNetworkAccess} onChange={(v) => apply({ website: { localNetworkAccess: v } })} />
        </>
      )}
    </SectionBox>
  );
}

function IpSettingSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Network} accent="#f59e0b">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <div className="px-5 py-3.5 border-b border-border text-xs text-muted-foreground leading-relaxed">
            {tx('ipSetting.priorityPrefix')} <span className="text-foreground">{tx('ipSetting.priorityChain')}</span>. {tx('ipSetting.prioritySuffix')}
          </div>
          <SwitchRow title={tx('ipSetting.lastUsedIp')} checked={s.ipSetting.autoConfig.lastUsedIp} onChange={(v) => apply({ ipSetting: { autoConfig: { lastUsedIp: v } } })} />
          <SwitchRow title={tx('ipSetting.asn')} description={tx('ipSetting.asnDesc')} checked={s.ipSetting.autoConfig.asn} onChange={(v) => apply({ ipSetting: { autoConfig: { asn: v } } })} />
          <SwitchRow title={tx('ipSetting.city')} checked={s.ipSetting.autoConfig.city} onChange={(v) => apply({ ipSetting: { autoConfig: { city: v } } })} />
          <SwitchRow title={tx('ipSetting.region')} checked={s.ipSetting.autoConfig.region} onChange={(v) => apply({ ipSetting: { autoConfig: { region: v } } })} />
          <SwitchRow title={tx('ipSetting.country')} checked={s.ipSetting.autoConfig.country} onChange={(v) => apply({ ipSetting: { autoConfig: { country: v } } })} />
          <Row
            title={tx('ipSetting.ipCheckerLabel')}
            control={
              <CustomSelect id="set-ip-checker" className="w-full sm:w-56" value={s.ipSetting.ipChecker} onChange={(e) => apply({ ipSetting: { ipChecker: e.target.value } })}>
                <option value="ip-api">ip-api.com</option>
                <option value="ipinfo">ipinfo.io</option>
                <option value="ip2location">IP2Location</option>
                <option value="luminati">Luminati / Bright</option>
              </CustomSelect>
            }
          />
        </>
      )}
    </SectionBox>
  );
}

function AutofillSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Zap} accent="#3DC6DA">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow
            title={tx('smartAutofill.enable.title')}
            description={tx('smartAutofill.enable.desc')}
            checked={!(s.smartAutofill && s.smartAutofill.enabled === false)}
            onChange={(v) => apply({ smartAutofill: { enabled: v } })}
          />
          <SwitchRow
            title={tx('smartAutofill.firefox.title')}
            description={tx('smartAutofill.firefox.desc')}
            checked={!(s.smartAutofill && s.smartAutofill.firefox === false)}
            disabled={s.smartAutofill && s.smartAutofill.enabled === false}
            onChange={(v) => apply({ smartAutofill: { firefox: v } })}
          />
        </>
      )}
    </SectionBox>
  );
}

function CaptchaSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={KeyRound} accent="#10b981">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow wired title={tx('captcha.enable.title')} description={tx('captcha.enable.desc')} checked={s.captcha.enabled} onChange={(v) => apply({ captcha: { enabled: v } })} />
          <div className="px-5 py-3.5 border-b border-border">
            <label htmlFor="set-captcha-provider" className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{tx('captcha.providerLabel')}</label>
            <CustomSelect id="set-captcha-provider" className="w-full sm:w-72" value={s.captcha.provider} onChange={(e) => apply({ captcha: { provider: e.target.value } })}>
              <option value="2captcha">2captcha</option>
              <option value="anticaptcha">Anti-Captcha</option>
            </CustomSelect>
          </div>
          <div className="px-5 py-3.5 border-b border-border">
            <label htmlFor="set-captcha-apikey" className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{tx('captcha.apiKeyLabel')}</label>
            <DraftTextInput
              id="set-captcha-apikey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={s.captcha.provider === 'anticaptcha' ? tx('captcha.apiKeyPlaceholderAnticaptcha') : tx('captcha.apiKeyPlaceholder2captcha')}
              value={s.captcha.apiKey || ''}
              onCommit={(v) => apply({ captcha: { apiKey: v } })}
              className="w-full max-w-md bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition font-mono"
            />
            <p className="text-[11px] text-muted-foreground mt-2">{s.captcha.provider === 'anticaptcha' ? tx('captcha.billedAnticaptcha') : tx('captcha.billed2captcha')}</p>
          </div>
          <SwitchRow title={tx('captcha.solveRecaptchaV2')} checked={s.captcha.solveRecaptchaV2} onChange={(v) => apply({ captcha: { solveRecaptchaV2: v } })} />
          <SwitchRow title={tx('captcha.solveHcaptcha')} checked={s.captcha.solveHcaptcha} onChange={(v) => apply({ captcha: { solveHcaptcha: v } })} />
        </>
      )}
    </SectionBox>
  );
}

// ---------------------------------------------------------------------------
// RUNTIME
// ---------------------------------------------------------------------------
function LocalRuntimeSection({ sec, loading, systemInfo }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Database} accent="#3b82f6" bodyClassName="px-5 py-4">
      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-1">
          <Loader2 className="w-4 h-4 animate-spin" /> {tx('localRuntime.loading')}
        </div>
      ) : (
        <dl className="space-y-4 text-sm">
          <InfoRow label={tx('localRuntime.sqliteDb')} value={systemInfo?.dbPath} />
          <InfoRow label={tx('localRuntime.profileRoot')} value={systemInfo?.profileRoot} />
          <InfoRow label={tx('localRuntime.databaseUrl')} value={systemInfo?.databaseUrlConfigured ? tx('localRuntime.configured') : tx('localRuntime.notConfigured')} />
        </dl>
      )}
    </SectionBox>
  );
}

function PerformanceSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={SlidersHorizontal} accent="#22c55e">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <Row
            title={tx('performance.parallelLimit.title')}
            description={tx('performance.parallelLimit.desc')}
            control={<NumberInput min={1} max={50} fallback={1} value={s.performance?.launchConcurrency ?? 5} onCommit={(n) => apply({ performance: { launchConcurrency: n } })} className={numCls} />}
          />
          <Row
            title={tx('performance.maxRunning.title')}
            description={tx('performance.maxRunning.desc')}
            control={<NumberInput min={0} max={500} fallback={0} value={s.performance?.maxConcurrentProfiles ?? 0} onCommit={(n) => apply({ performance: { maxConcurrentProfiles: n === 0 ? null : n } })} className={numCls} />}
          />
        </>
      )}
    </SectionBox>
  );
}

function ReliabilitySection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={SlidersHorizontal} accent="#0ea5e9">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow
            title={tx('reliability.restoreSession.title')}
            description={tx('reliability.restoreSession.desc')}
            checked={!(s.sessionRestore && s.sessionRestore.enabled === false)}
            onChange={(v) => apply({ sessionRestore: { enabled: v } })}
          />
          <SwitchRow
            title={tx('reliability.autoRestart.title')}
            description={tx('reliability.autoRestart.desc')}
            checked={Boolean(s.crashRecovery && s.crashRecovery.autoRestart)}
            onChange={(v) => apply({ crashRecovery: { autoRestart: v } })}
          >
            {s.crashRecovery && s.crashRecovery.autoRestart && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                {tx('reliability.autoRestart.maxRetries')}
                <NumberInput min={1} max={10} fallback={1} value={s.crashRecovery?.maxRetries ?? 2} onCommit={(n) => apply({ crashRecovery: { maxRetries: n } })} className="w-16 bg-input-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
            )}
          </SwitchRow>
          <SwitchRow
            title={tx('reliability.memoryGuard.title')}
            description={tx('reliability.memoryGuard.desc')}
            checked={Boolean(s.memoryGuard && s.memoryGuard.enabled)}
            onChange={(v) => apply({ memoryGuard: { enabled: v } })}
          >
            {s.memoryGuard && s.memoryGuard.enabled && (
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-2">
                  {tx('reliability.memoryGuard.triggerBelow')}
                  <NumberInput min={1} max={90} fallback={1} value={s.memoryGuard?.lowFreePct ?? 12} onCommit={(n) => apply({ memoryGuard: { lowFreePct: n } })} className="w-16 bg-input-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
                  %
                </span>
                <span className="flex items-center gap-2">
                  {tx('reliability.memoryGuard.stopWhenReaches')}
                  <NumberInput min={1} max={95} fallback={1} value={s.memoryGuard?.recoverFreePct ?? 25} onCommit={(n) => apply({ memoryGuard: { recoverFreePct: n } })} className="w-16 bg-input-background border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
                  %
                </span>
              </div>
            )}
          </SwitchRow>
        </>
      )}
    </SectionBox>
  );
}

function SessionsSection({ sec, loading, sessions, onClose }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Zap} accent="#10b981" bodyClassName="px-5 py-4">
      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-1">
          <Loader2 className="w-4 h-4 animate-spin" /> {tx('sessions.loading')}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState title={tx('sessions.emptyTitle')} description={tx('sessions.emptyDescription')} />
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div key={session.sessionId} className="rounded-lg border border-border bg-input-background p-4 transition hover:border-muted-dark">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] uppercase font-bold tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {tx('sessions.running')}
                    </span>
                    <code className="truncate text-xs font-mono text-muted-foreground bg-elevated px-2 py-0.5 rounded border border-border">
                      {session.sessionId}
                    </code>
                  </div>
                  <div className="mt-3 truncate text-sm font-medium text-foreground">{session.userDataDir}</div>
                  <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {tx('sessions.created', { date: formatDateTime(session.createdAt) })}
                  </div>
                </div>
                <Button size="sm" variant="danger" onClick={() => onClose(session.sessionId)} className="shrink-0 px-3">
                  <StopCircle className="h-4 w-4 mr-1" /> {tx('sessions.close')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionBox>
  );
}

function SchedulerSection({ sec, scheduler, savingSched, saveScheduler, setScheduler }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Settings2} accent="#f59e0b" bodyClassName="px-5 py-4">
      <div className="flex flex-wrap items-center gap-5">
        <Toggle checked={scheduler.enabled} disabled={savingSched} onChange={() => saveScheduler({ enabled: !scheduler.enabled, minutes: scheduler.minutes })} />
        <span className="text-sm font-medium text-foreground w-16">
          {scheduler.enabled ? tx('scheduler.enabled') : tx('scheduler.disabled')}
        </span>
        <div className="w-px h-6 bg-border" />
        <label htmlFor="set-scheduler-interval" className="flex items-center gap-3 text-sm text-muted-foreground">
          {tx('scheduler.runSweepEvery')}
          <CustomSelect
            id="set-scheduler-interval"
            value={scheduler.minutes}
            disabled={savingSched}
            onChange={(e) => {
              const m = Number(e.target.value);
              if (scheduler.enabled) saveScheduler({ enabled: true, minutes: m });
              else setScheduler((prev) => ({ ...prev, minutes: m }));
            }}
            className="w-32"
          >
            <option value={15}>{tx('scheduler.every15min')}</option>
            <option value={30}>{tx('scheduler.every30min')}</option>
            <option value={60}>{tx('scheduler.every1hour')}</option>
            <option value={120}>{tx('scheduler.every2hours')}</option>
          </CustomSelect>
        </label>
        <div className="ml-auto">
          {scheduler.running ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {tx('scheduler.serviceRunning')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-elevated text-muted-foreground border border-border text-xs font-semibold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-dark" />
              {tx('scheduler.idle')}
            </span>
          )}
        </div>
      </div>
      <p className="mt-5 text-xs text-muted-foreground leading-relaxed bg-input-background p-4 rounded-lg border border-border">
        <strong className="text-primary font-medium">{tx('scheduler.noteLabel')}</strong> {tx('scheduler.noteBody')}
      </p>
    </SectionBox>
  );
}

function DataSyncSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  const rows = [
    ['cookie', tx('dataSync.cookie')],
    ['passwords', tx('dataSync.passwords')],
    ['bookmarks', tx('dataSync.bookmarks')],
    ['localStorage', tx('dataSync.localStorage')],
    ['indexedDb', tx('dataSync.indexedDb')],
    ['extensionData', tx('dataSync.extensionData')],
    ['history', tx('dataSync.history')]
  ];
  return (
    <SectionBox sec={sec} icon={FolderSync} accent="#14b8a6">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        rows.map(([key, label]) => (
          <SwitchRow key={key} title={label} checked={s.dataSync[key]} onChange={(v) => apply({ dataSync: { [key]: v } })} />
        ))
      )}
    </SectionBox>
  );
}

// ---------------------------------------------------------------------------
// SECURITY & TEAM
// ---------------------------------------------------------------------------
function SecuritySection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={ShieldCheck} accent="#3b82f6">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <>
          <SwitchRow title={tx('security.remoteLogin.title')} description={tx('security.remoteLogin.desc')} checked={s.security.remoteLoginReminder} onChange={(v) => apply({ security: { remoteLoginReminder: v } })} />
          <SwitchRow title={tx('security.failedLogin.title')} description={tx('security.failedLogin.desc')} checked={s.security.failedLoginAlert} onChange={(v) => apply({ security: { failedLoginAlert: v } })} />
          <SwitchRow title={tx('security.ipAllowlist.title')} description={tx('security.ipAllowlist.desc')} checked={s.security.loginIpAllowlist.enabled} onChange={(v) => apply({ security: { loginIpAllowlist: { enabled: v } } })} />
          <SwitchRow
            title={tx('security.twoStep.title')}
            description={tx('security.twoStep.desc')}
            checked={s.security.twoStep.enabled}
            onChange={(v) => apply({ security: { twoStep: { enabled: v } } })}
          >
            {s.security.twoStep.enabled && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label htmlFor="set-security-2fa-method" className="flex items-center gap-2 text-xs text-muted-foreground">
                  {tx('security.twoStep.methodLabel')}
                  <CustomSelect id="set-security-2fa-method" className="w-36" value={s.security.twoStep.method} onChange={(e) => apply({ security: { twoStep: { method: e.target.value } } })}>
                    <option value="app">{tx('security.twoStep.methodApp')}</option>
                    <option value="email">{tx('security.twoStep.methodEmail')}</option>
                    <option value="sms">{tx('security.twoStep.methodSms')}</option>
                  </CustomSelect>
                </label>
                <label htmlFor="set-security-2fa-level" className="flex items-center gap-2 text-xs text-muted-foreground">
                  {tx('security.twoStep.levelLabel')}
                  <CustomSelect id="set-security-2fa-level" className="w-64" value={s.security.twoStep.level} onChange={(e) => apply({ security: { twoStep: { level: e.target.value } } })}>
                    <option value="low">{tx('security.twoStep.levelLow')}</option>
                    <option value="medium">{tx('security.twoStep.levelMedium')}</option>
                    <option value="high">{tx('security.twoStep.levelHigh')}</option>
                  </CustomSelect>
                </label>
              </div>
            )}
          </SwitchRow>
        </>
      )}
    </SectionBox>
  );
}

function MultiDeviceSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={Users} accent="#0ea5e9">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <div className="px-5 py-4">
          <CustomSelect className="w-full sm:w-80" value={s.multiDevice.mode} onChange={(e) => apply({ multiDevice: { mode: e.target.value } })}>
            <option value="off">{tx('multiDevice.modeOff')}</option>
            <option value="full">{tx('multiDevice.modeFull')}</option>
            <option value="specified">{tx('multiDevice.modeSpecified')}</option>
          </CustomSelect>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            {tx('multiDevice.hintBefore')}<strong className="text-foreground">{tx('multiDevice.hintSpecified')}</strong>{tx('multiDevice.hintAfter')}
          </p>
        </div>
      )}
    </SectionBox>
  );
}

function AuditSection({ sec, s, apply }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <SectionBox sec={sec} icon={ShieldCheck} accent="#f59e0b">
      {!s ? <LoadingRow label={tx('globalPreferences.loading')} /> : (
        <Row
          title={tx('audit.retentionTitle')}
          description={tx('audit.retentionDesc')}
          control={
            <div className="flex items-center gap-2">
              <NumberInput min={0} max={3650} fallback={0} value={s.audit?.retentionDays ?? 90} onCommit={(n) => apply({ audit: { retentionDays: n } })} className={numCls} />
              <span className="text-xs text-muted-foreground">{tx('audit.days')}</span>
            </div>
          }
        />
      )}
    </SectionBox>
  );
}

// Email (SMTP) configuration for sending OTP verification codes. Optional: when
// left blank the app runs offline and shows the code in-app.
function EmailSection({ sec }) {
  const { t: tx } = useTranslation('settingsExtra');
  const [cfg, setCfg] = useState({ host: '', port: 465, secure: true, user: '', fromName: 'SoftGlaze Security', configured: false, hasPassword: false });
  const [pass, setPass] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    softglazeApi.settings.getEmail().then((c) => { if (c) { setCfg(c); setTestTo(c.user || ''); } }).catch(() => {});
  }, []);

  const inputCls = 'w-full bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5';

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const saved = await softglazeApi.settings.setEmail({
        host: cfg.host, port: Number(cfg.port) || 465, secure: cfg.secure,
        user: cfg.user, fromName: cfg.fromName,
        pass: pass || undefined
      });
      setCfg(saved); setPass(''); setMsg(tx('email.saved'));
    } catch (e) { setErr(e.message || tx('email.saveFailed')); }
    finally { setBusy(false); }
  }

  async function sendTest() {
    setTesting(true); setErr(''); setMsg('');
    try {
      const r = await softglazeApi.settings.testEmail(testTo.trim().toLowerCase());
      if (r.devMode) setErr(tx('email.noSmtpYet'));
      else setMsg(tx('email.testSent', { to: testTo.trim() }));
    } catch (e) { setErr(e.message || tx('email.testFailed')); }
    finally { setTesting(false); }
  }

  return (
    <SectionBox
      sec={sec}
      icon={Mail}
      accent="#06b6d4"
      bodyClassName="px-5 py-4"
      headerRight={cfg.configured
        ? <Badge className="bg-green-500/15 text-green-400 border-0">{tx('email.configured')}</Badge>
        : <Badge className="bg-secondary text-muted-foreground border-0">{tx('email.offlineMode')}</Badge>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="set-email-host" className={labelCls}>{tx('email.smtpHost')}</label>
            <input id="set-email-host" className={inputCls} value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} placeholder="smtp.hostinger.com" />
          </div>
          <div>
            <label htmlFor="set-email-port" className={labelCls}>{tx('email.port')}</label>
            <input id="set-email-port" className={inputCls} value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: e.target.value })} placeholder="465" />
          </div>
          <div>
            <label htmlFor="set-email-encryption" className={labelCls}>{tx('email.encryption')}</label>
            <CustomSelect id="set-email-encryption" value={cfg.secure ? 'ssl' : 'starttls'} onChange={(e) => setCfg({ ...cfg, secure: e.target.value === 'ssl' })}>
              <option value="ssl">SSL/TLS (465)</option>
              <option value="starttls">STARTTLS (587)</option>
            </CustomSelect>
          </div>
          <div>
            <label htmlFor="set-email-user" className={labelCls}>{tx('email.username')}</label>
            <input id="set-email-user" className={inputCls} value={cfg.user} onChange={(e) => setCfg({ ...cfg, user: e.target.value })} placeholder="security@yourdomain.com" />
          </div>
          <div>
            <label htmlFor="set-email-password" className={labelCls}>{tx('email.password')} {cfg.hasPassword && <span className="text-muted-dark normal-case tracking-normal">{tx('email.passwordSavedHint')}</span>}</label>
            <input id="set-email-password" type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cfg.hasPassword ? '••••••••' : 'App password'} />
          </div>
          <div className="col-span-2">
            <label htmlFor="set-email-fromname" className={labelCls}>{tx('email.fromName')}</label>
            <input id="set-email-fromname" className={inputCls} value={cfg.fromName} onChange={(e) => setCfg({ ...cfg, fromName: e.target.value })} placeholder="SoftGlaze Security" />
          </div>
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}
        {msg && <p className="text-xs text-green-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : tx('email.saveButton')}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <input className={inputCls + ' w-56'} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="test@recipient.com" />
            <Button variant="secondary" onClick={sendTest} disabled={testing || !testTo.trim()}>
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> {tx('email.test')}</>}
            </Button>
          </div>
        </div>
      </div>
    </SectionBox>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
// Free-text setting field that keeps a local draft and persists on blur, on
// Enter, or after a short pause in typing (not on every keystroke).
function DraftTextInput({ value, onCommit, delayMs = 800, ...rest }) {
  const [draft, setDraft] = useState(value || '');
  const focused = useRef(false);
  const timer = useRef(null);
  const lastSent = useRef(value || '');
  useEffect(() => { if (!focused.current) { setDraft(value || ''); lastSent.current = value || ''; } }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function commit(v) {
    clearTimeout(timer.current);
    if (v === lastSent.current) return;
    lastSent.current = v;
    onCommit(v);
  }
  return (
    <input
      {...rest}
      value={draft}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), delayMs);
      }}
      onBlur={() => { focused.current = false; commit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(draft); }}
    />
  );
}

// Key-value pair for the read-only Local Runtime card.
function InfoRow({ label, value }) {
  return (
    <div>
      <dt className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="break-all rounded-lg border border-border bg-input-background px-4 py-2.5 font-mono text-xs text-foreground">
        {value || '-'}
      </dd>
    </div>
  );
}
