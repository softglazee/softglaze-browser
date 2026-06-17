import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, StopCircle, Loader2, Database, Clock, Zap, Settings2, ChevronDown, Mail, Send, CheckCircle2 } from 'lucide-react';

import EmptyState from '@/components/EmptyState.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

// --- CUSTOM STYLED SELECT DROPDOWN (Max 4px rounded) ---
const CustomSelect = ({ value, onChange, className = '', children, disabled }) => (
  <div className={`relative flex items-center ${className}`}>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-full appearance-none bg-background border border-border rounded pl-3 pr-9 py-1.5 text-zinc-100 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition disabled:opacity-50 text-ellipsis overflow-hidden whitespace-nowrap cursor-pointer hover:border-muted-dark"
    >
      {children}
    </select>
    <div className="absolute right-3 pointer-events-none text-muted">
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
        <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Local Runtime Card */}
        <Card className="bg-surface border-border shadow-sm rounded">
          <CardHeader className="border-b border-border bg-card/50 rounded-t">
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <Database className="w-4 h-4 text-primary" />
              Local Runtime
            </CardTitle>
            <CardDescription className="text-muted mt-1.5">
              Paths are resolved in the Electron main process.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="text-sm text-muted flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading system info...
              </div>
            ) : (
              <dl className="space-y-5 text-sm">
                <InfoRow label="SQLite DB" value={systemInfo?.dbPath} />
                <InfoRow label="Profile Root" value={systemInfo?.profileRoot} />
                <InfoRow label="Database URL" value={systemInfo?.databaseUrlConfigured ? 'Configured' : 'Not configured'} />
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Active Sessions Card */}
        <Card className="bg-surface border-border shadow-sm rounded">
          <CardHeader className="border-b border-border bg-card/50 rounded-t">
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <Zap className="w-4 h-4 text-emerald-400" />
              Active Sessions
            </CardTitle>
            <CardDescription className="text-muted mt-1.5">
              Sessions currently launched and consuming resources.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="text-sm text-muted flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading sessions...
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState title="No active sessions" description="Launch a profile to see it here." />
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div key={session.sessionId} className="rounded border border-border bg-background p-4 transition hover:border-muted-dark">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] uppercase font-bold tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Running
                          </span>
                          <code className="truncate text-xs font-mono text-muted bg-surface px-2 py-0.5 rounded border border-border">
                            {session.sessionId}
                          </code>
                        </div>
                        <div className="mt-3 truncate text-sm font-medium text-zinc-100">
                          {session.userDataDir}
                        </div>
                        <div className="mt-2 text-xs text-muted flex items-center gap-1.5">
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
          </CardContent>
        </Card>
      </div>

      {/* Proxy Health Scheduler Card */}
      <Card className="bg-surface border-border shadow-sm rounded">
        <CardHeader className="border-b border-border bg-card/50 rounded-t">
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            <Settings2 className="w-4 h-4 text-orange-400" />
            Proxy Health Scheduler
          </CardTitle>
          <CardDescription className="text-muted mt-1.5">
            Periodically re-check every saved proxy in the background and store its health status.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
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
            
            <span className="text-sm font-medium text-zinc-200 w-16">
              {scheduler.enabled ? 'Enabled' : 'Disabled'}
            </span>
            
            <div className="w-px h-6 bg-border" />
            
            <label className="flex items-center gap-3 text-sm text-muted">
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
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface text-muted border border-border text-xs font-semibold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-dark" />
                  Idle
                </span>
              )}
            </div>
          </div>
          <p className="mt-5 text-xs text-muted leading-relaxed bg-background p-4 rounded border border-border">
            <strong className="text-primary font-medium">Note:</strong> This background task runs in the Electron main process, so checks will continue seamlessly even when the app is minimized or you are navigating between pages. Health results will be displayed directly as status badges inside the Proxy Pool.
          </p>
        </CardContent>
      </Card>

      <EmailSettingsCard />
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

  const inputCls = 'w-full bg-background border border-border rounded px-3 py-2 text-sm text-zinc-100 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition';

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
    <Card className="bg-surface border-border shadow-sm rounded mt-6">
      <CardHeader className="border-b border-border bg-card/50 rounded-t">
        <CardTitle className="flex items-center gap-2 text-zinc-100">
          <Mail className="w-4 h-4 text-primary" /> Email (verification codes)
          {cfg.configured
            ? <Badge className="bg-green-500/15 text-green-400 border-0">Configured</Badge>
            : <Badge className="bg-white/5 text-muted border-0">Offline mode</Badge>}
        </CardTitle>
        <CardDescription className="text-muted mt-1.5">
          SMTP for sending OTP codes at registration. Leave blank to run offline — the code is then shown in-app instead of emailed.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-muted mb-1.5">SMTP host</label>
            <input className={inputCls} value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} placeholder="smtp.hostinger.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Port</label>
            <input className={inputCls} value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: e.target.value })} placeholder="465" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Encryption</label>
            <CustomSelect value={cfg.secure ? 'ssl' : 'starttls'} onChange={(e) => setCfg({ ...cfg, secure: e.target.value === 'ssl' })}>
              <option value="ssl">SSL/TLS (465)</option>
              <option value="starttls">STARTTLS (587)</option>
            </CustomSelect>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Username</label>
            <input className={inputCls} value={cfg.user} onChange={(e) => setCfg({ ...cfg, user: e.target.value })} placeholder="security@yourdomain.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Password {cfg.hasPassword && <span className="text-muted-dark">(saved — leave blank to keep)</span>}</label>
            <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cfg.hasPassword ? '••••••••' : 'App password'} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-muted mb-1.5">From name</label>
            <input className={inputCls} value={cfg.fromName} onChange={(e) => setCfg({ ...cfg, fromName: e.target.value })} placeholder="SoftGlaze Security" />
          </div>
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}
        {msg && <p className="text-xs text-green-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</p>}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save email settings'}</Button>
          <div className="ml-auto flex items-center gap-2">
            <input className={inputCls + ' w-56'} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="test@recipient.com" />
            <Button variant="secondary" onClick={sendTest} disabled={testing || !testTo.trim()}>
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Test</>}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Reusable component for displaying key-value pairs cleanly
function InfoRow({ label, value }) {
  return (
    <div>
      <dt className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd className="break-all rounded border border-border bg-background px-4 py-2.5 font-mono text-xs text-zinc-300 shadow-sm">
        {value || '—'}
      </dd>
    </div>
  );
}