import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, StopCircle, Loader2, Database, Clock, Zap, Settings2, ChevronDown, Mail, Send, CheckCircle2, ShieldCheck, Users, Globe2, Layers, Network, FolderSync, SlidersHorizontal, Power, KeyRound } from 'lucide-react';

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

// --- CUSTOM STYLED SELECT DROPDOWN (Max 4px rounded) ---
const CustomSelect = ({ value, onChange, className = '', children, disabled }) => (
  <div className={`relative flex items-center ${className}`}>
    <select
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
      setError(err.message || 'Failed to load settings.');
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
      setError(err.message || 'Failed to close session.');
    }
  }

  async function saveScheduler(next) {
    setSavingSched(true);
    setError('');
    try {
      const result = await softglazeApi.settings.setProxyScheduler(next);
      setScheduler(result);
    } catch (err) {
      setError(err.message || 'Failed to update scheduler.');
    } finally {
      setSavingSched(false);
    }
  }

  return (
    <div className="flex flex-col h-full space-y-4 pb-10">
      <PageHeader
        eyebrow="Application"
        title="Global Settings"
        description="Inspect local storage paths, background tasks, and currently active browser sessions."
        actions={
          <Button variant="secondary" onClick={loadSettings}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

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
          title="Local Runtime"
          description="Paths are resolved in the Electron main process."
        >
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading system info...
            </div>
          ) : (
            <dl className="space-y-4 text-sm">
              <InfoRow label="SQLite DB" value={systemInfo?.dbPath} />
              <InfoRow label="Profile Root" value={systemInfo?.profileRoot} />
              <InfoRow label="Database URL" value={systemInfo?.databaseUrlConfigured ? 'Configured' : 'Not configured'} />
            </dl>
          )}
        </SectionCard>

        {/* Active Sessions Card */}
        <SectionCard
          icon={Zap}
          accent="#10b981"
          title="Active Sessions"
          description="Sessions currently launched and consuming resources."
        >
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState title="No active sessions" description="Launch a profile to see it here." />
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div key={session.sessionId} className="rounded-lg border border-border bg-input-background p-4 transition hover:border-muted-dark">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] uppercase font-bold tracking-wider">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Running
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
                        Created {formatDateTime(session.createdAt)}
                      </div>
                    </div>
                    <Button size="sm" variant="danger" onClick={() => handleCloseSession(session.sessionId)} className="shrink-0 px-3">
                      <StopCircle className="h-4 w-4 mr-1" /> Close
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
        title="Proxy Health Scheduler"
        description="Periodically re-check every saved proxy in the background and store its health status."
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
            {scheduler.enabled ? 'Enabled' : 'Disabled'}
          </span>

          <div className="w-px h-6 bg-border" />

          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            Run sweep every
            <CustomSelect
              value={scheduler.minutes}
              disabled={savingSched}
              onChange={(e) => {
                const m = Number(e.target.value);
                if (scheduler.enabled) saveScheduler({ enabled: true, minutes: m });
                else setScheduler((prev) => ({ ...prev, minutes: m }));
              }}
              className="w-32"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
            </CustomSelect>
          </label>

          <div className="ml-auto">
            {scheduler.running ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Service Running
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-elevated text-muted-foreground border border-border text-xs font-semibold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-dark" />
                Idle
              </span>
            )}
          </div>
        </div>
        <p className="mt-5 text-xs text-muted-foreground leading-relaxed bg-input-background p-4 rounded-lg border border-border">
          <strong className="text-primary font-medium">Note:</strong> This background task runs in the Electron main process, so checks will continue seamlessly even when the app is minimized or you are navigating between pages. Health results will be displayed directly as status badges inside the Proxy Pool.
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
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-foreground">{title}</span>
          {wired && (
            <span className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              Applied at launch
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
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    softglazeApi.settings.getGlobal()
      .then((cfg) => setS(cfg))
      .catch((e) => setErr(e.message || 'Failed to load global settings.'))
      .finally(() => setLoading(false));
  }, []);

  // Optimistic update + immediate persist of a partial patch.
  const apply = useCallback((patch) => {
    setS((cur) => mergeLocal(cur, patch));
    setSaving(true);
    setErr('');
    softglazeApi.settings.setGlobal(patch)
      .then((next) => setS(next))
      .catch((e) => setErr(e.message || 'Failed to save setting.'))
      .finally(() => setSaving(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 mt-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading global settings…
      </div>
    );
  }
  if (!s) return null;

  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Global Preferences</h2>
        {saving && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</span>}
      </div>

      {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{err}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Account Security */}
        <SettingsSection icon={ShieldCheck} accent="#3b82f6" title="Account Security" description="Sign-in protection and verification policy.">
          <ToggleRow
            title="Remote login reminder"
            description="A reminder email is sent when your account is signed in from a new IP address instead of the 3 commonly used IPs."
            checked={s.security.remoteLoginReminder}
            onChange={(v) => apply({ security: { remoteLoginReminder: v } })}
          />
          <ToggleRow
            title="Failed login attempt alert"
            description="If login fails more than 3 times, a reminder email is sent to the Owner's email."
            checked={s.security.failedLoginAlert}
            onChange={(v) => apply({ security: { failedLoginAlert: v } })}
          />
          <ToggleRow
            title="Login IP allowlist"
            description="Once set, member login is restricted by IP (Owner not affected)."
            checked={s.security.loginIpAllowlist.enabled}
            onChange={(v) => apply({ security: { loginIpAllowlist: { enabled: v } } })}
          />
          <ToggleRow
            title="Two-step verification"
            description="Sensitive actions require verification via an authenticator app, email, or SMS."
            checked={s.security.twoStep.enabled}
            onChange={(v) => apply({ security: { twoStep: { enabled: v } } })}
          >
            {s.security.twoStep.enabled && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Method
                  <CustomSelect className="w-36" value={s.security.twoStep.method} onChange={(e) => apply({ security: { twoStep: { method: e.target.value } } })}>
                    <option value="app">Authenticator app</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </CustomSelect>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Authentication level
                  <CustomSelect className="w-64" value={s.security.twoStep.level} onChange={(e) => apply({ security: { twoStep: { level: e.target.value } } })}>
                    <option value="low">Low — new device or 90+ days since last 2FA</option>
                    <option value="medium">Medium (recommended) — new device or 30+ days</option>
                    <option value="high">High — 2FA required for each login</option>
                  </CustomSelect>
                </label>
              </div>
            )}
          </ToggleRow>
        </SettingsSection>

        {/* Multi-Device mode */}
        <SettingsSection icon={Users} accent="#0ea5e9" title="Multi-Device Mode" description="Control whether multiple members can access the same profile simultaneously.">
          <div className="py-3">
            <CustomSelect value={s.multiDevice.mode} onChange={(e) => apply({ multiDevice: { mode: e.target.value } })}>
              <option value="off">Off — single member per profile</option>
              <option value="full">Full — all profiles support simultaneous access</option>
              <option value="specified">Specified — only selected profiles</option>
            </CustomSelect>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              When enabled, multiple members can access the same profile at the same time. In <strong className="text-foreground">Specified</strong> mode, choose the eligible profiles from the Profiles page.
            </p>
          </div>
        </SettingsSection>

        {/* Website Management */}
        <SettingsSection icon={Globe2} accent="#8b5cf6" title="Website Management" description="URL access rules and resource loading.">
          <ToggleRow
            title="Block access"
            description="Use the blocklist and allowlist for URL management."
            checked={s.website.blockAccess.enabled}
            onChange={(v) => apply({ website: { blockAccess: { enabled: v } } })}
          >
            {s.website.blockAccess.enabled && (
              <div className="mt-3">
                <CustomSelect className="w-48" value={s.website.blockAccess.mode} onChange={(e) => apply({ website: { blockAccess: { mode: e.target.value } } })}>
                  <option value="blocklist">Blocklist</option>
                  <option value="allowlist">Allowlist</option>
                </CustomSelect>
              </div>
            )}
          </ToggleRow>
          <ToggleRow
            title="FB static resources"
            description="When enabled, Facebook static resources load using the local network."
            checked={s.website.fbStaticLocal}
            onChange={(v) => apply({ website: { fbStaticLocal: v } })}
          />
          <ToggleRow
            title="Local network access"
            description="When enabled, specific URLs can be accessed on the local network."
            checked={s.website.localNetworkAccess}
            onChange={(v) => apply({ website: { localNetworkAccess: v } })}
          />
        </SettingsSection>

        {/* Platform / Custom Icon */}
        <SettingsSection icon={Layers} accent="#d946ef" title="Platform" description="Customize the profile list display.">
          <ToggleRow
            title="Custom icon"
            description="Show a custom icon for profiles in the list."
            checked={s.platform.customIconEnabled}
            onChange={(v) => apply({ platform: { customIconEnabled: v } })}
          />
          <ToggleRow
            title="Display custom No."
            description='Show the full custom serial number (e.g. "123456").'
            checked={s.platform.displayCustomNo}
            onChange={(v) => apply({ platform: { displayCustomNo: v } })}
          />
          <ToggleRow
            title="Display last 4 digits of custom No."
            description="Show only the last 4 digits of the serial number."
            checked={s.platform.displayLast4}
            onChange={(v) => apply({ platform: { displayLast4: v } })}
          />
        </SettingsSection>

        {/* IP Setting */}
        <SettingsSection icon={Network} accent="#f59e0b" title="IP Setting" description="Proxy auto-configuration priority and IP checker.">
          <div className="py-3 text-xs text-muted-foreground leading-relaxed">
            Searching priority: <span className="text-foreground">Last used IP &gt; ASN &gt; City &gt; Region &gt; Country/Region</span>. Unchecked options are skipped.
          </div>
          <ToggleRow title="Last used IP" checked={s.ipSetting.autoConfig.lastUsedIp} onChange={(v) => apply({ ipSetting: { autoConfig: { lastUsedIp: v } } })} />
          <ToggleRow title="ASN" description="Only available for Bright auto." checked={s.ipSetting.autoConfig.asn} onChange={(v) => apply({ ipSetting: { autoConfig: { asn: v } } })} />
          <ToggleRow title="City" checked={s.ipSetting.autoConfig.city} onChange={(v) => apply({ ipSetting: { autoConfig: { city: v } } })} />
          <ToggleRow title="Region" checked={s.ipSetting.autoConfig.region} onChange={(v) => apply({ ipSetting: { autoConfig: { region: v } } })} />
          <ToggleRow title="Country/Region" checked={s.ipSetting.autoConfig.country} onChange={(v) => apply({ ipSetting: { autoConfig: { country: v } } })} />
          <div className="py-3">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">IP checker</label>
            <CustomSelect className="w-56" value={s.ipSetting.ipChecker} onChange={(e) => apply({ ipSetting: { ipChecker: e.target.value } })}>
              <option value="ip-api">ip-api.com</option>
              <option value="ipinfo">ipinfo.io</option>
              <option value="ip2location">IP2Location</option>
              <option value="luminati">Luminati / Bright</option>
            </CustomSelect>
          </div>
        </SettingsSection>

        {/* Data Sync */}
        <SettingsSection icon={FolderSync} accent="#14b8a6" title="Data Sync" description="Select the data to sync across devices.">
          {[
            ['cookie', 'Cookie'],
            ['passwords', 'Saved passwords'],
            ['bookmarks', 'Bookmarks'],
            ['localStorage', 'Local storage'],
            ['indexedDb', 'IndexedDB'],
            ['extensionData', 'Extension data'],
            ['history', 'History']
          ].map(([key, label]) => (
            <ToggleRow key={key} title={label} checked={s.dataSync[key]} onChange={(v) => apply({ dataSync: { [key]: v } })} />
          ))}
        </SettingsSection>
      </div>

      {/* Browser Settings — full width */}
      <SettingsSection icon={SlidersHorizontal} accent="#f97316" title="Browser Settings" description="Behavior of the launched browser. Items marked “Applied at launch” take effect on the next profile launch.">
        <ToggleRow
          title="Geo auto-match (timezone · locale · WebRTC)"
          description="Derive each profile's timezone, language, and WebRTC exit IP from its proxy's location at launch. Turn off to use only each profile's manual values. Applied at launch."
          checked={!(s.geoMatch && s.geoMatch.enabled === false)}
          onChange={(v) => apply({ geoMatch: { enabled: v } })}
        />
        <ToggleRow
          title="Real-time timezone match on dynamic IP change"
          description="Match the corresponding timezone and location when the dynamic IP changes."
          checked={s.browser.matchTimezoneOnIpChange}
          onChange={(v) => apply({ browser: { matchTimezoneOnIpChange: v } })}
        />
        <ToggleRow
          title="Allow Chrome sign-in"
          description="When off, you can sign in to Google sites like Gmail without signing in to Chrome itself."
          checked={s.browser.allowChromeSignin}
          onChange={(v) => apply({ browser: { allowChromeSignin: v } })}
        />
        <ToggleRow
          title="Offer to translate pages"
          description="Offer to translate pages that aren't in a language you read."
          checked={s.browser.offerTranslate}
          onChange={(v) => apply({ browser: { offerTranslate: v } })}
        />
        <ToggleRow
          title="Disable Browser Developer Tools"
          description="Writes a DeveloperToolsAvailability managed-policy file into each profile. Chromium enforces it once the file is registered in the OS managed-policy location (not applied machine-wide automatically)."
          checked={s.browser.disableDevtools}
          onChange={(v) => apply({ browser: { disableDevtools: v } })}
        />
        <ToggleRow
          title="Disable installing/removing extensions"
          description="Writes an ExtensionInstallBlocklist managed-policy file per profile (the proxy-auth extension is unaffected). Enforced once registered in the OS managed-policy location."
          checked={s.browser.lockExtensions}
          onChange={(v) => apply({ browser: { lockExtensions: v } })}
        />
        <ToggleRow
          title="Virtual camera"
          description="Simulate local video as a live camera feed. Only valid for Chrome version 140 and above."
          checked={s.browser.enableVirtualCamera}
          onChange={(v) => apply({ browser: { enableVirtualCamera: v } })}
        />
        <ToggleRow
          title="Mobile simulation optimization"
          description="Make the interface closer to a real mobile device experience. Only valid for Chrome version 143 and above."
          checked={s.browser.mobileSimulation}
          onChange={(v) => apply({ browser: { mobileSimulation: v } })}
        />
        <ToggleRow
          wired
          title="Secure access (HTTPS)"
          description="Whenever possible, use HTTPS and get warned before loading non-HTTPS sites."
          checked={s.browser.secureAccess}
          onChange={(v) => apply({ browser: { secureAccess: v } })}
        />
        <ToggleRow
          wired
          title="Disable loading videos"
          description="Block media downloads to save proxy traffic."
          checked={s.browser.disableVideos}
          onChange={(v) => apply({ browser: { disableVideos: v } })}
        />
        <ToggleRow
          wired
          title="Disable loading images"
          description="Block image loading to save traffic. Note: image loading is disabled fully; the KB threshold below is stored for future per-request filtering."
          checked={s.browser.disableImages}
          onChange={(v) => apply({ browser: { disableImages: v } })}
        >
          {s.browser.disableImages && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              Skip images under
              <input
                type="number"
                min={0}
                value={s.browser.imageMinKb}
                onChange={(e) => apply({ browser: { imageMinKb: Number(e.target.value) || 0 } })}
                className="w-20 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              KB
            </div>
          )}
        </ToggleRow>
      </SettingsSection>

      {/* Performance — bulk-launch concurrency + running ceiling */}
      <SettingsSection icon={SlidersHorizontal} accent="#22c55e" title="Performance" description="Controls for launching many profiles at once — applied to bulk launches and the running-session ceiling.">
        <div className="flex items-center justify-between gap-4 py-3 border-b border-border/60">
          <div>
            <p className="text-sm font-medium text-foreground">Parallel launch limit</p>
            <p className="text-xs text-muted-foreground mt-0.5">How many profiles spawn at the same time during a bulk launch. Higher is faster but uses more RAM. Recommended 3–8.</p>
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
            <p className="text-sm font-medium text-foreground">Max running profiles</p>
            <p className="text-xs text-muted-foreground mt-0.5">Hard ceiling on profiles running at once (memory safety). Leave at 0 for unlimited; launches past the limit are blocked with a clear message.</p>
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
      <SettingsSection icon={SlidersHorizontal} accent="#0ea5e9" title="Reliability" description="Restore your last session, recover crashed profiles, and protect against memory exhaustion when many profiles run at once.">
        <ToggleRow
          title="Restore last session on startup"
          description="When SoftGlaze reopens, offer to relaunch the profiles that were running when it last closed or crashed."
          checked={!(s.sessionRestore && s.sessionRestore.enabled === false)}
          onChange={(v) => apply({ sessionRestore: { enabled: v } })}
        />
        <ToggleRow
          title="Auto-restart crashed profiles"
          description="If a profile's browser crashes on its own, automatically relaunch it. Capped per profile so a persistently-crashing profile can't loop."
          checked={Boolean(s.crashRecovery && s.crashRecovery.autoRestart)}
          onChange={(v) => apply({ crashRecovery: { autoRestart: v } })}
        >
          {s.crashRecovery && s.crashRecovery.autoRestart && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              Max retries per profile
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
          title="Memory guard"
          description="When system memory runs low, automatically close the oldest running profiles until memory recovers. Off by default — it will never close a profile unless enabled."
          checked={Boolean(s.memoryGuard && s.memoryGuard.enabled)}
          onChange={(v) => apply({ memoryGuard: { enabled: v } })}
        >
          {s.memoryGuard && s.memoryGuard.enabled && (
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-2">
                Trigger when free RAM below
                <input
                  type="number" min={1} max={90}
                  value={s.memoryGuard?.lowFreePct ?? 12}
                  onChange={(e) => apply({ memoryGuard: { lowFreePct: Math.max(1, Number(e.target.value) || 1) } })}
                  className="w-16 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                %
              </span>
              <span className="flex items-center gap-2">
                stop once free RAM reaches
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
      <SettingsSection icon={Zap} accent="#3DC6DA" title="Smart Autofill" description="The Identity Data Vault widget that detects signup forms in launched profiles and fills them from your saved personas.">
        <ToggleRow
          title="Enable Smart Autofill"
          description="Inject the autofill widget into launched profiles. On Chromium this uses the in-page bridge; turning this off skips injection entirely."
          checked={!(s.smartAutofill && s.smartAutofill.enabled === false)}
          onChange={(v) => apply({ smartAutofill: { enabled: v } })}
        />
        <ToggleRow
          title="Firefox autofill"
          description="Also install the autofill WebExtension into Firefox profiles (Firefox has no in-page bridge). Loads unsigned on Firefox Developer Edition / Nightly; release Firefox requires the Mozilla-signed build bundled with the installer."
          checked={!(s.smartAutofill && s.smartAutofill.firefox === false)}
          disabled={s.smartAutofill && s.smartAutofill.enabled === false}
          onChange={(v) => apply({ smartAutofill: { firefox: v } })}
        />
      </SettingsSection>

      {/* Audit log — team activity retention */}
      <SettingsSection icon={ShieldCheck} accent="#f59e0b" title="Audit Log" description="How long team activity and security events (member changes, sign-ins, permission edits) are kept before being pruned on startup.">
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Retention period</p>
            <p className="text-xs text-muted-foreground mt-0.5">Activity older than this is deleted when SoftGlaze starts. Set to 0 to keep the full history forever.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="number" min={0} max={3650}
              value={s.audit?.retentionDays ?? 90}
              onChange={(e) => apply({ audit: { retentionDays: Math.max(0, Number(e.target.value) || 0) } })}
              className="w-20 bg-input-background border border-border rounded px-2 py-1 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">days</span>
          </div>
        </div>
      </SettingsSection>

      {/* On Startup — full width */}
      <SettingsSection icon={Power} accent="#ef4444" title="On Startup" description="What happens when a profile is launched.">
        <div className="py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Start page</label>
            <span className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Applied at launch</span>
          </div>
          <CustomSelect className="w-72 mt-2" value={s.onStartup.mode} onChange={(e) => apply({ onStartup: { mode: e.target.value } })}>
            <option value="detection">Show proxy/fingerprint detection page</option>
            <option value="last">Continue browsing the last opened page</option>
            <option value="blank">Do not start the proxy detection page (blank)</option>
          </CustomSelect>
        </div>
        <ToggleRow
          wired
          title="Only open with an available proxy"
          description="If no proxy is found, the browser won't open. (Fingerprint items based on IP would otherwise not match.)"
          checked={s.onStartup.onlyOpenWithProxy}
          onChange={(v) => apply({ onStartup: { onlyOpenWithProxy: v } })}
        />
        <ToggleRow
          title="Only open when extension data is loaded"
          description="Open the browser only when the extension data has successfully loaded."
          checked={s.onStartup.onlyOpenWhenExtensionLoaded}
          onChange={(v) => apply({ onStartup: { onlyOpenWhenExtensionLoaded: v } })}
        />
        <ToggleRow
          title="Block if country/region changed"
          description="Don't open the profile if the country/region differs from the last time it was opened."
          checked={s.onStartup.blockIfCountryChanged}
          onChange={(v) => apply({ onStartup: { blockIfCountryChanged: v } })}
        />
      </SettingsSection>

      {/* Captcha solver — full width */}
      <SettingsSection icon={KeyRound} accent="#10b981" title="Captcha Auto-Solving" description="Automatically solve reCAPTCHA v2 and hCaptcha during browsing using a paid third-party solver. This is separate from fingerprinting — a clean fingerprint reduces how often captchas appear, but solving them needs a paid service billed per solve by the provider (not by SoftGlaze).">
        <ToggleRow
          wired
          title="Enable captcha auto-solving"
          description="When on, launched profiles detect supported captchas and submit them to your solver automatically."
          checked={s.captcha.enabled}
          onChange={(v) => apply({ captcha: { enabled: v } })}
        />
        <div className="py-3">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Solver provider</label>
          <CustomSelect className="w-72" value={s.captcha.provider} onChange={(e) => apply({ captcha: { provider: e.target.value } })}>
            <option value="2captcha">2captcha</option>
            <option value="anticaptcha">Anti-Captcha</option>
          </CustomSelect>
        </div>
        <div className="py-3">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">API key</label>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={s.captcha.provider === 'anticaptcha' ? 'Anti-Captcha clientKey' : '2captcha API key'}
            value={s.captcha.apiKey || ''}
            onChange={(e) => apply({ captcha: { apiKey: e.target.value } })}
            className="w-full max-w-md bg-input-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition font-mono"
          />
          <p className="text-[11px] text-muted-foreground mt-2">Stored locally in your settings DB. You are billed per solve by {s.captcha.provider === 'anticaptcha' ? 'Anti-Captcha' : '2captcha'}.</p>
        </div>
        <ToggleRow
          title="Solve reCAPTCHA v2"
          checked={s.captcha.solveRecaptchaV2}
          onChange={(v) => apply({ captcha: { solveRecaptchaV2: v } })}
        />
        <ToggleRow
          title="Solve hCaptcha"
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
      setCfg(saved); setPass(''); setMsg('Email settings saved.');
    } catch (e) { setErr(e.message || 'Could not save email settings.'); }
    finally { setBusy(false); }
  }

  async function sendTest() {
    setTesting(true); setErr(''); setMsg('');
    try {
      const r = await softglazeApi.settings.testEmail(testTo.trim().toLowerCase());
      if (r.devMode) setErr('No SMTP configured yet — save your settings first.');
      else setMsg(`Test email sent to ${testTo.trim()}.`);
    } catch (e) { setErr(e.message || 'Test failed — check your settings.'); }
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
            <p className="text-sm font-semibold text-foreground">Email (verification codes)</p>
            {cfg.configured
              ? <Badge className="bg-green-500/15 text-green-400 border-0">Configured</Badge>
              : <Badge className="bg-secondary text-muted-foreground border-0">Offline mode</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            SMTP for sending OTP codes at registration. Leave blank to run offline — the code is then shown in-app instead of emailed.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>SMTP host</label>
            <input className={inputCls} value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} placeholder="smtp.hostinger.com" />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input className={inputCls} value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: e.target.value })} placeholder="465" />
          </div>
          <div>
            <label className={labelCls}>Encryption</label>
            <CustomSelect value={cfg.secure ? 'ssl' : 'starttls'} onChange={(e) => setCfg({ ...cfg, secure: e.target.value === 'ssl' })}>
              <option value="ssl">SSL/TLS (465)</option>
              <option value="starttls">STARTTLS (587)</option>
            </CustomSelect>
          </div>
          <div>
            <label className={labelCls}>Username</label>
            <input className={inputCls} value={cfg.user} onChange={(e) => setCfg({ ...cfg, user: e.target.value })} placeholder="security@yourdomain.com" />
          </div>
          <div>
            <label className={labelCls}>Password {cfg.hasPassword && <span className="text-muted-dark normal-case tracking-normal">(saved — leave blank to keep)</span>}</label>
            <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cfg.hasPassword ? '••••••••' : 'App password'} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>From name</label>
            <input className={inputCls} value={cfg.fromName} onChange={(e) => setCfg({ ...cfg, fromName: e.target.value })} placeholder="SoftGlaze Security" />
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
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save email settings'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <input className={inputCls + ' w-56'} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="test@recipient.com" />
            <Button variant="secondary" onClick={sendTest} disabled={testing || !testTo.trim()}>
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Test</>}
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
