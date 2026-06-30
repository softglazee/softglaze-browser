import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, StopCircle, Loader2, Database, Clock, Zap, Settings2, ChevronDown, Mail, Send, CheckCircle2, ShieldCheck, Users, Globe2, Layers, Network, FolderSync, SlidersHorizontal, Power, KeyRound, Languages } from 'lucide-react';
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

// --- CUSTOM STYLED SELECT DROPDOWN (Max 4px rounded) ---
const CustomSelect = ({ value, onChange, className = '', children, disabled, id }) => (
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

export default function SettingsPage() {
  const { t } = useTranslation();
  const { t: tx } = useTranslation('settingsExtra');
  const [systemInfo, setSystemInfo] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scheduler, setScheduler] = useState({ enabled: false, minutes: 30, running: false });
  const [savingSched, setSavingSched] = useState(false);

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

  return (
    <div className="flex flex-col h-full space-y-4 pb-10">
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

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <LanguageSection />

      <BillingSettings />

      <MonetizationSettings />

      <MigrationSettings />

      <SyncSettings />

      <BrandingSettings />

      <DbEncryptionSettings />

      <WorkspaceBackupSettings />

      <DeveloperApiSettings />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Local Runtime Card */}
        <SectionCard
          icon={Database}
          accent="#3b82f6"
          title={tx('localRuntime.title')}
          description={tx('localRuntime.description')}
        >
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {tx('localRuntime.loading')}
            </div>
          ) : (
            <dl className="space-y-4 text-sm">
              <InfoRow label={tx('localRuntime.sqliteDb')} value={systemInfo?.dbPath} />
              <InfoRow label={tx('localRuntime.profileRoot')} value={systemInfo?.profileRoot} />
              <InfoRow label={tx('localRuntime.databaseUrl')} value={systemInfo?.databaseUrlConfigured ? tx('localRuntime.configured') : tx('localRuntime.notConfigured')} />
            </dl>
          )}
        </SectionCard>

        {/* Active Sessions Card */}
        <SectionCard
          icon={Zap}
          accent="#10b981"
          title={tx('sessions.title')}
          description={tx('sessions.description')}
        >
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
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
                      <div className="mt-3 truncate text-sm font-medium text-foreground">
                        {session.userDataDir}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {tx('sessions.created', { date: formatDateTime(session.createdAt) })}
                      </div>
                    </div>
                    <Button size="sm" variant="danger" onClick={() => handleCloseSession(session.sessionId)} className="shrink-0 px-3">
                      <StopCircle className="h-4 w-4 mr-1" /> {tx('sessions.close')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Proxy Health Scheduler Card */}
      <SectionCard
        icon={Settings2}
        accent="#f59e0b"
        title={tx('scheduler.title')}
        description={tx('scheduler.description')}
      >
        <div className="flex flex-wrap items-center gap-5">
          {/* Custom Toggle Switch */}
          <button
            type="button"
            disabled={savingSched}
            onClick={() => saveScheduler({ enabled: !scheduler.enabled, minutes: scheduler.minutes })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 ${scheduler.enabled ? 'bg-primary' : 'bg-muted-dark'}`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${scheduler.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>

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
      </SectionCard>

      <EmailSettingsCard />

      <GlobalPreferences />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable settings primitives
// ---------------------------------------------------------------------------

// Figma-style settings section: a card with an icon-tile header (accent-tinted
// via color-mix so it themes in light + dark), a title and a description.
function SectionCard({ icon: Icon, accent = '#3b82f6', title, description, children, className = '' }) {
  return (
    <section className={`bg-card border border-border rounded-xl p-5 animate-fade-up ${className}`}>
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
          }}
        >
          <Icon className="w-4 h-4" style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// App display-language picker. Persists via lib/lang.js (localStorage + <html lang>)
// and switches the live i18next language, so the whole UI re-renders instantly with
// no reload — the same model as the theme toggle.
function LanguageSection() {
  const { t } = useTranslation();
  const [lang, setLangState] = useState(getStoredLang());
  return (
    <SectionCard
      icon={Languages}
      accent="#6366f1"
      title={t('settings.language.title')}
      description={t('settings.language.description')}
    >
      <div className="py-2 max-w-md">
        <label htmlFor="settings-language-select" className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
          {t('settings.language.label')}
        </label>
        <CustomSelect id="settings-language-select" className="w-64" value={lang} onChange={(e) => setLangState(setLang(e.target.value))}>
          {SUPPORTED_LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.native}</option>
          ))}
        </CustomSelect>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{t('settings.language.hint')}</p>
      </div>
    </SectionCard>
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

function ToggleRow({ title, description, checked, onChange, disabled, wired, children }) {
  const { t: tx } = useTranslation('settingsExtra');
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-foreground">{title}</span>
          {wired && (
            <span className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              {tx('toggleRow.appliedAtLaunch')}
            </span>
          )}
        </div>
        {description && <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-2xl">{description}</p>}
        {children}
      </div>
      <div className="pt-0.5">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

function SettingsSection({ icon: Icon, accent, title, description, children, className = '' }) {
  return (
    <SectionCard icon={Icon} accent={accent} title={title} description={description} className={className}>
      {children}
    </SectionCard>
  );
}

// App auto-update: the manual-check home that surfaces every updater state (idle /
// checking / up-to-date / available / downloading / downloaded / error+retry) and
// whether updates are even enabled in this build. The Dashboard banner handles the
// proactive "an update is ready" prompt; this is where the user can check on demand.
function UpdatesSection() {
  const { t: tx } = useTranslation('settingsExtra');
  const [st, setSt] = useState(null);
  const [checked, setChecked] = useState(false); // user pressed Check at least once this session

  useEffect(() => {
    let live = true;
    softglazeApi.updater.getState().then((s) => { if (live) setSt(s); }).catch(() => {});
    const off = softglazeApi.updater.onEvent((s) => { if (live) setSt(s); });
    return () => { live = false; if (typeof off === 'function') off(); };
  }, []);

  const status = (st && st.status) || 'idle';
  const active = !st || st.active !== false; // assume active until told otherwise
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
  if (!active) line = tx('updates.notEnabled');
  else if (checking) line = tx('updates.checking');
  else if (status === 'available') line = tx('updates.available', { version: v });
  else if (status === 'downloading') line = tx('updates.downloading', { version: v, percent: st.percent || 0 });
  else if (downloaded) line = tx('updates.ready', { version: v });
  else if (status === 'error') line = st && st.error ? tx('updates.errorWithReason', { reason: String(st.error).slice(0, 120) }) : tx('updates.errorNoReason');
  else if (status === 'not-available' && checked) line = tx('updates.upToDate');

  return (
    <SettingsSection icon={RefreshCcw} accent="#0ea5e9" title={tx('updates.title')} description={tx('updates.description')}>
      <div className="flex items-center justify-between gap-4 py-3">
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
          <Button variant="secondary" size="sm" onClick={check} disabled={checking || !active}>
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} {tx('updates.checkForUpdates')}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

// Recursive merge for optimistic local updates (mirrors the main-process store).
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

// ---------------------------------------------------------------------------
// Industry-standard global preferences. Every control persists immediately to the
// main-process settings store. The "Applied at launch" badge marks the controls
// the browser engine actually honors today; the rest are stored preferences.
// ---------------------------------------------------------------------------
function GlobalPreferences() {
  const { t: tx } = useTranslation('settingsExtra');
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    softglazeApi.settings.getGlobal()
      .then((cfg) => setS(cfg))
      .catch((e) => setErr(e.message || tx('errors.loadGlobal')))
      .finally(() => setLoading(false));
  }, []);

  // Optimistic update + immediate persist of a partial patch.
  const apply = useCallback((patch) => {
    setS((cur) => mergeLocal(cur, patch));
    setSaving(true);
    setErr('');
    softglazeApi.settings.setGlobal(patch)
      .then((next) => setS(next))
      .catch((e) => setErr(e.message || tx('errors.saveSetting')))
      .finally(() => setSaving(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 mt-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> {tx('globalPreferences.loading')}
      </div>
    );
  }
  if (!s) return null;

  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tx('globalPreferences.heading')}</h2>
        {saving && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {tx('globalPreferences.saving')}</span>}
      </div>

      {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{err}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Account Security */}
        <SettingsSection icon={ShieldCheck} accent="#3b82f6" title={tx('security.title')} description={tx('security.description')}>
          <ToggleRow
            title={tx('security.remoteLogin.title')}
            description={tx('security.remoteLogin.desc')}
            checked={s.security.remoteLoginReminder}
            onChange={(v) => apply({ security: { remoteLoginReminder: v } })}
          />
          <ToggleRow
            title={tx('security.failedLogin.title')}
            description={tx('security.failedLogin.desc')}
            checked={s.security.failedLoginAlert}
            onChange={(v) => apply({ security: { failedLoginAlert: v } })}
          />
          <ToggleRow
            title={tx('security.ipAllowlist.title')}
            description={tx('security.ipAllowlist.desc')}
            checked={s.security.loginIpAllowlist.enabled}
            onChange={(v) => apply({ security: { loginIpAllowlist: { enabled: v } } })}
          />
          <ToggleRow
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
          </ToggleRow>
        </SettingsSection>

        {/* Multi-Device mode */}
        <SettingsSection icon={Users} accent="#0ea5e9" title={tx('multiDevice.title')} description={tx('multiDevice.description')}>
          <div className="py-3">
            <CustomSelect value={s.multiDevice.mode} onChange={(e) => apply({ multiDevice: { mode: e.target.value } })}>
              <option value="off">{tx('multiDevice.modeOff')}</option>
              <option value="full">{tx('multiDevice.modeFull')}</option>
              <option value="specified">{tx('multiDevice.modeSpecified')}</option>
            </CustomSelect>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              {tx('multiDevice.hintBefore')}<strong className="text-foreground">{tx('multiDevice.hintSpecified')}</strong>{tx('multiDevice.hintAfter')}
            </p>
          </div>
        </SettingsSection>

        {/* Website Management */}
        <SettingsSection icon={Globe2} accent="#8b5cf6" title={tx('website.title')} description={tx('website.description')}>
          <ToggleRow
            title={tx('website.blockAccess.title')}
            description={tx('website.blockAccess.desc')}
            checked={s.website.blockAccess.enabled}
            onChange={(v) => apply({ website: { blockAccess: { enabled: v } } })}
          >
            {s.website.blockAccess.enabled && (
              <div className="mt-3">
                <CustomSelect className="w-48" value={s.website.blockAccess.mode} onChange={(e) => apply({ website: { blockAccess: { mode: e.target.value } } })}>
                  <option value="blocklist">{tx('website.blockAccess.blocklist')}</option>
                  <option value="allowlist">{tx('website.blockAccess.allowlist')}</option>
                </CustomSelect>
              </div>
            )}
          </ToggleRow>
          <ToggleRow
            title={tx('website.fbStatic.title')}
            description={tx('website.fbStatic.desc')}
            checked={s.website.fbStaticLocal}
            onChange={(v) => apply({ website: { fbStaticLocal: v } })}
          />
          <ToggleRow
            title={tx('website.localNetwork.title')}
            description={tx('website.localNetwork.desc')}
            checked={s.website.localNetworkAccess}
            onChange={(v) => apply({ website: { localNetworkAccess: v } })}
          />
        </SettingsSection>

        {/* Platform / Custom Icon */}
        <SettingsSection icon={Layers} accent="#d946ef" title={tx('platform.title')} description={tx('platform.description')}>
          <ToggleRow
            title={tx('platform.customIcon.title')}
            description={tx('platform.customIcon.desc')}
            checked={s.platform.customIconEnabled}
            onChange={(v) => apply({ platform: { customIconEnabled: v } })}
          />
          <ToggleRow
            title={tx('platform.displayCustomNo.title')}
            description={tx('platform.displayCustomNo.desc')}
            checked={s.platform.displayCustomNo}
            onChange={(v) => apply({ platform: { displayCustomNo: v } })}
          />
          <ToggleRow
            title={tx('platform.displayLast4.title')}
            description={tx('platform.displayLast4.desc')}
            checked={s.platform.displayLast4}
            onChange={(v) => apply({ platform: { displayLast4: v } })}
          />
        </SettingsSection>

        {/* IP Setting */}
        <SettingsSection icon={Network} accent="#f59e0b" title={tx('ipSetting.title')} description={tx('ipSetting.description')}>
          <div className="py-3 text-xs text-muted-foreground leading-relaxed">
            {tx('ipSetting.priorityPrefix')} <span className="text-foreground">{tx('ipSetting.priorityChain')}</span>. {tx('ipSetting.prioritySuffix')}
          </div>
          <ToggleRow title={tx('ipSetting.lastUsedIp')} checked={s.ipSetting.autoConfig.lastUsedIp} onChange={(v) => apply({ ipSetting: { autoConfig: { lastUsedIp: v } } })} />
          <ToggleRow title={tx('ipSetting.asn')} description={tx('ipSetting.asnDesc')} checked={s.ipSetting.autoConfig.asn} onChange={(v) => apply({ ipSetting: { autoConfig: { asn: v } } })} />
          <ToggleRow title={tx('ipSetting.city')} checked={s.ipSetting.autoConfig.city} onChange={(v) => apply({ ipSetting: { autoConfig: { city: v } } })} />
          <ToggleRow title={tx('ipSetting.region')} checked={s.ipSetting.autoConfig.region} onChange={(v) => apply({ ipSetting: { autoConfig: { region: v } } })} />
          <ToggleRow title={tx('ipSetting.country')} checked={s.ipSetting.autoConfig.country} onChange={(v) => apply({ ipSetting: { autoConfig: { country: v } } })} />
          <div className="py-3">
            <label htmlFor="set-ip-checker" className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{tx('ipSetting.ipCheckerLabel')}</label>
            <CustomSelect id="set-ip-checker" className="w-56" value={s.ipSetting.ipChecker} onChange={(e) => apply({ ipSetting: { ipChecker: e.target.value } })}>
              <option value="ip-api">ip-api.com</option>
              <option value="ipinfo">ipinfo.io</option>
              <option value="ip2location">IP2Location</option>
              <option value="luminati">Luminati / Bright</option>
            </CustomSelect>
          </div>
        </SettingsSection>

        {/* Data Sync */}
        <SettingsSection icon={FolderSync} accent="#14b8a6" title={tx('dataSync.title')} description={tx('dataSync.description')}>
          {[
            ['cookie', tx('dataSync.cookie')],
            ['passwords', tx('dataSync.passwords')],
            ['bookmarks', tx('dataSync.bookmarks')],
            ['localStorage', tx('dataSync.localStorage')],
            ['indexedDb', tx('dataSync.indexedDb')],
            ['extensionData', tx('dataSync.extensionData')],
            ['history', tx('dataSync.history')]
          ].map(([key, label]) => (
            <ToggleRow key={key} title={label} checked={s.dataSync[key]} onChange={(v) => apply({ dataSync: { [key]: v } })} />
          ))}
        </SettingsSection>
      </div>

      {/* Browser Settings — full width */}
      <SettingsSection icon={SlidersHorizontal} accent="#f97316" title={tx('browser.title')} description={tx('browser.description')}>
        <ToggleRow
          title={tx('browser.geoMatch.title')}
          description={tx('browser.geoMatch.desc')}
          checked={!(s.geoMatch && s.geoMatch.enabled === false)}
          onChange={(v) => apply({ geoMatch: { enabled: v } })}
        />
        <ToggleRow
          title={tx('browser.realtimeTimezone.title')}
          description={tx('browser.realtimeTimezone.desc')}
          checked={s.browser.matchTimezoneOnIpChange}
          onChange={(v) => apply({ browser: { matchTimezoneOnIpChange: v } })}
        />
        <ToggleRow
          title={tx('browser.chromeSignin.title')}
          description={tx('browser.chromeSignin.desc')}
          checked={s.browser.allowChromeSignin}
          onChange={(v) => apply({ browser: { allowChromeSignin: v } })}
        />
        <ToggleRow
          title={tx('browser.offerTranslate.title')}
          description={tx('browser.offerTranslate.desc')}
          checked={s.browser.offerTranslate}
          onChange={(v) => apply({ browser: { offerTranslate: v } })}
        />
        <ToggleRow
          title={tx('browser.disableDevtools.title')}
          description={tx('browser.disableDevtools.desc')}
          checked={s.browser.disableDevtools}
          onChange={(v) => apply({ browser: { disableDevtools: v } })}
        />
        <ToggleRow
          title={tx('browser.lockExtensions.title')}
          description={tx('browser.lockExtensions.desc')}
          checked={s.browser.lockExtensions}
          onChange={(v) => apply({ browser: { lockExtensions: v } })}
        />
        <ToggleRow
          title={tx('browser.virtualCamera.title')}
          description={tx('browser.virtualCamera.desc')}
          checked={s.browser.enableVirtualCamera}
          onChange={(v) => apply({ browser: { enableVirtualCamera: v } })}
        />
        <ToggleRow
          title={tx('browser.mobileSimulation.title')}
          description={tx('browser.mobileSimulation.desc')}
          checked={s.browser.mobileSimulation}
          onChange={(v) => apply({ browser: { mobileSimulation: v } })}
        />
        <ToggleRow
          wired
          title={tx('browser.secureAccess.title')}
          description={tx('browser.secureAccess.desc')}
          checked={s.browser.secureAccess}
          onChange={(v) => apply({ browser: { secureAccess: v } })}
        />
        <ToggleRow
          wired
          title={tx('browser.disableVideos.title')}
          description={tx('browser.disableVideos.desc')}
          checked={s.browser.disableVideos}
          onChange={(v) => apply({ browser: { disableVideos: v } })}
        />
        <ToggleRow
          wired
          title={tx('browser.disableImages.title')}
          description={tx('browser.disableImages.desc')}
          checked={s.browser.disableImages}
          onChange={(v) => apply({ browser: { disableImages: v } })}
        >
          {s.browser.disableImages && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {tx('browser.disableImages.skipUnder')}
              <input
                type="number"
                min={0}
                value={s.browser.imageMinKb}
                onChange={(e) => apply({ browser: { imageMinKb: Number(e.target.value) || 0 } })}
                className="w-20 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {tx('browser.disableImages.kb')}
            </div>
          )}
        </ToggleRow>
      </SettingsSection>

      {/* Performance — bulk-launch concurrency + running ceiling */}
      <SettingsSection icon={SlidersHorizontal} accent="#22c55e" title={tx('performance.title')} description={tx('performance.description')}>
        <div className="flex items-center justify-between gap-4 py-3 border-b border-border/60">
          <div>
            <p className="text-sm font-medium text-foreground">{tx('performance.parallelLimit.title')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{tx('performance.parallelLimit.desc')}</p>
          </div>
          <input
            type="number" min={1} max={50}
            value={s.performance?.launchConcurrency ?? 5}
            onChange={(e) => apply({ performance: { launchConcurrency: Math.max(1, Number(e.target.value) || 1) } })}
            className="w-20 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{tx('performance.maxRunning.title')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{tx('performance.maxRunning.desc')}</p>
          </div>
          <input
            type="number" min={0} max={500}
            value={s.performance?.maxConcurrentProfiles ?? 0}
            onChange={(e) => { const n = Math.max(0, Number(e.target.value) || 0); apply({ performance: { maxConcurrentProfiles: n === 0 ? null : n } }); }}
            className="w-20 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </SettingsSection>

      {/* Reliability — session restore, crash recovery, memory guard */}
      <SettingsSection icon={SlidersHorizontal} accent="#0ea5e9" title={tx('reliability.title')} description={tx('reliability.description')}>
        <ToggleRow
          title={tx('reliability.restoreSession.title')}
          description={tx('reliability.restoreSession.desc')}
          checked={!(s.sessionRestore && s.sessionRestore.enabled === false)}
          onChange={(v) => apply({ sessionRestore: { enabled: v } })}
        />
        <ToggleRow
          title={tx('reliability.autoRestart.title')}
          description={tx('reliability.autoRestart.desc')}
          checked={Boolean(s.crashRecovery && s.crashRecovery.autoRestart)}
          onChange={(v) => apply({ crashRecovery: { autoRestart: v } })}
        >
          {s.crashRecovery && s.crashRecovery.autoRestart && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {tx('reliability.autoRestart.maxRetries')}
              <input
                type="number" min={1} max={10}
                value={s.crashRecovery?.maxRetries ?? 2}
                onChange={(e) => apply({ crashRecovery: { maxRetries: Math.max(1, Number(e.target.value) || 1) } })}
                className="w-16 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
        </ToggleRow>
        <ToggleRow
          title={tx('reliability.memoryGuard.title')}
          description={tx('reliability.memoryGuard.desc')}
          checked={Boolean(s.memoryGuard && s.memoryGuard.enabled)}
          onChange={(v) => apply({ memoryGuard: { enabled: v } })}
        >
          {s.memoryGuard && s.memoryGuard.enabled && (
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-2">
                {tx('reliability.memoryGuard.triggerBelow')}
                <input
                  type="number" min={1} max={90}
                  value={s.memoryGuard?.lowFreePct ?? 12}
                  onChange={(e) => apply({ memoryGuard: { lowFreePct: Math.max(1, Number(e.target.value) || 1) } })}
                  className="w-16 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                %
              </span>
              <span className="flex items-center gap-2">
                {tx('reliability.memoryGuard.stopWhenReaches')}
                <input
                  type="number" min={1} max={95}
                  value={s.memoryGuard?.recoverFreePct ?? 25}
                  onChange={(e) => apply({ memoryGuard: { recoverFreePct: Math.max(1, Number(e.target.value) || 1) } })}
                  className="w-16 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                %
              </span>
            </div>
          )}
        </ToggleRow>
      </SettingsSection>

      {/* Smart Autofill — Identity Data Vault widget injected into launched profiles */}
      <SettingsSection icon={Zap} accent="#3DC6DA" title={tx('smartAutofill.title')} description={tx('smartAutofill.description')}>
        <ToggleRow
          title={tx('smartAutofill.enable.title')}
          description={tx('smartAutofill.enable.desc')}
          checked={!(s.smartAutofill && s.smartAutofill.enabled === false)}
          onChange={(v) => apply({ smartAutofill: { enabled: v } })}
        />
        <ToggleRow
          title={tx('smartAutofill.firefox.title')}
          description={tx('smartAutofill.firefox.desc')}
          checked={!(s.smartAutofill && s.smartAutofill.firefox === false)}
          disabled={s.smartAutofill && s.smartAutofill.enabled === false}
          onChange={(v) => apply({ smartAutofill: { firefox: v } })}
        />
      </SettingsSection>

      {/* Audit log — team activity retention */}
      <SettingsSection icon={ShieldCheck} accent="#f59e0b" title={tx('audit.title')} description={tx('audit.description')}>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{tx('audit.retentionTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{tx('audit.retentionDesc')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="number" min={0} max={3650}
              value={s.audit?.retentionDays ?? 90}
              onChange={(e) => apply({ audit: { retentionDays: Math.max(0, Number(e.target.value) || 0) } })}
              className="w-20 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">{tx('audit.days')}</span>
          </div>
        </div>
      </SettingsSection>

      {/* Updates — manual check + all updater states */}
      <UpdatesSection />

      {/* On Startup — full width */}
      <SettingsSection icon={Power} accent="#ef4444" title={tx('onStartup.title')} description={tx('onStartup.description')}>
        <div className="py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="set-onstartup-mode" className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{tx('onStartup.startPageLabel')}</label>
            <span className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{tx('toggleRow.appliedAtLaunch')}</span>
          </div>
          <CustomSelect id="set-onstartup-mode" className="w-72 mt-2" value={s.onStartup.mode} onChange={(e) => apply({ onStartup: { mode: e.target.value } })}>
            <option value="detection">{tx('onStartup.modeDetection')}</option>
            <option value="last">{tx('onStartup.modeLast')}</option>
            <option value="blank">{tx('onStartup.modeBlank')}</option>
          </CustomSelect>
        </div>
        <ToggleRow
          wired
          title={tx('onStartup.onlyWithProxy.title')}
          description={tx('onStartup.onlyWithProxy.desc')}
          checked={s.onStartup.onlyOpenWithProxy}
          onChange={(v) => apply({ onStartup: { onlyOpenWithProxy: v } })}
        />
        <ToggleRow
          title={tx('onStartup.onlyWhenExtensionLoaded.title')}
          description={tx('onStartup.onlyWhenExtensionLoaded.desc')}
          checked={s.onStartup.onlyOpenWhenExtensionLoaded}
          onChange={(v) => apply({ onStartup: { onlyOpenWhenExtensionLoaded: v } })}
        />
        <ToggleRow
          title={tx('onStartup.blockIfCountryChanged.title')}
          description={tx('onStartup.blockIfCountryChanged.desc')}
          checked={s.onStartup.blockIfCountryChanged}
          onChange={(v) => apply({ onStartup: { blockIfCountryChanged: v } })}
        />
      </SettingsSection>

      {/* Captcha solver — full width */}
      <SettingsSection icon={KeyRound} accent="#10b981" title={tx('captcha.title')} description={tx('captcha.description')}>
        <ToggleRow
          wired
          title={tx('captcha.enable.title')}
          description={tx('captcha.enable.desc')}
          checked={s.captcha.enabled}
          onChange={(v) => apply({ captcha: { enabled: v } })}
        />
        <div className="py-3">
          <label htmlFor="set-captcha-provider" className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{tx('captcha.providerLabel')}</label>
          <CustomSelect id="set-captcha-provider" className="w-72" value={s.captcha.provider} onChange={(e) => apply({ captcha: { provider: e.target.value } })}>
            <option value="2captcha">2captcha</option>
            <option value="anticaptcha">Anti-Captcha</option>
          </CustomSelect>
        </div>
        <div className="py-3">
          <label htmlFor="set-captcha-apikey" className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{tx('captcha.apiKeyLabel')}</label>
          <input
            id="set-captcha-apikey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={s.captcha.provider === 'anticaptcha' ? tx('captcha.apiKeyPlaceholderAnticaptcha') : tx('captcha.apiKeyPlaceholder2captcha')}
            value={s.captcha.apiKey || ''}
            onChange={(e) => apply({ captcha: { apiKey: e.target.value } })}
            className="w-full max-w-md bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition font-mono"
          />
          <p className="text-[11px] text-muted-foreground mt-2">{s.captcha.provider === 'anticaptcha' ? tx('captcha.billedAnticaptcha') : tx('captcha.billed2captcha')}</p>
        </div>
        <ToggleRow
          title={tx('captcha.solveRecaptchaV2')}
          checked={s.captcha.solveRecaptchaV2}
          onChange={(v) => apply({ captcha: { solveRecaptchaV2: v } })}
        />
        <ToggleRow
          title={tx('captcha.solveHcaptcha')}
          checked={s.captcha.solveHcaptcha}
          onChange={(v) => apply({ captcha: { solveHcaptcha: v } })}
        />
      </SettingsSection>
    </div>
  );
}

// Email (SMTP) configuration for sending OTP verification codes. Optional:
// when left blank the app runs in offline mode and shows the code in-app.
function EmailSettingsCard() {
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
        pass: pass || undefined // blank keeps the stored password
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
    <section className="bg-card border border-border rounded-xl p-5 mt-6 animate-fade-up">
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: 'color-mix(in srgb, #06b6d4 14%, transparent)',
            border: '1px solid color-mix(in srgb, #06b6d4 28%, transparent)',
          }}
        >
          <Mail className="w-4 h-4" style={{ color: '#06b6d4' }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">{tx('email.title')}</p>
            {cfg.configured
              ? <Badge className="bg-green-500/15 text-green-400 border-0">{tx('email.configured')}</Badge>
              : <Badge className="bg-secondary text-muted-foreground border-0">{tx('email.offlineMode')}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {tx('email.description')}
          </p>
        </div>
      </div>

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

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25 transition hover:from-blue-500 hover:to-blue-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : tx('email.saveButton')}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <input className={inputCls + ' w-56'} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="test@recipient.com" />
            <Button variant="secondary" onClick={sendTest} disabled={testing || !testTo.trim()}>
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> {tx('email.test')}</>}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// Reusable component for displaying key-value pairs cleanly
function InfoRow({ label, value }) {
  return (
    <div>
      <dt className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="break-all rounded-lg border border-border bg-input-background px-4 py-2.5 font-mono text-xs text-foreground">
        {value || '—'}
      </dd>
    </div>
  );
}
