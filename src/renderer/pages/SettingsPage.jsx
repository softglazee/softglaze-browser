import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, StopCircle } from 'lucide-react';

import EmptyState from '@/components/EmptyState.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Badge from '@/components/ui/Badge.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { formatDateTime } from '@/lib/utils.js';

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
      const [info, activeSessions, sched] = await Promise.all([softglazeApi.system.getInfo(), softglazeApi.sessions.list(), softglazeApi.settings.getProxyScheduler()]);
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
    <>
      <PageHeader eyebrow="Application" title="Settings" description="Inspect local storage paths and currently active launched browser sessions." actions={<Button variant="outline" onClick={loadSettings}><RefreshCcw className="h-4 w-4" />Refresh</Button>} />
      {error ? <div className="mb-4 rounded-lg border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Local Runtime</CardTitle><CardDescription>Paths are resolved in the Electron main process.</CardDescription></CardHeader><CardContent>{loading ? <div className="text-sm text-slate-400">Loading system info...</div> : <dl className="space-y-4 text-sm"><InfoRow label="SQLite DB" value={systemInfo?.dbPath} /><InfoRow label="Profile Root" value={systemInfo?.profileRoot} /><InfoRow label="Database URL" value={systemInfo?.databaseUrlConfigured ? 'Configured' : 'Not configured'} /></dl>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Active Sessions</CardTitle><CardDescription>Sessions launched from the Profiles page.</CardDescription></CardHeader><CardContent>{loading ? <div className="text-sm text-slate-400">Loading sessions...</div> : sessions.length === 0 ? <EmptyState title="No active sessions" description="Launch a profile to see it here." /> : <div className="space-y-3">{sessions.map((session) => <div key={session.sessionId} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><Badge variant="green">Running</Badge><code className="truncate text-xs text-slate-400">{session.sessionId}</code></div><div className="mt-3 truncate text-sm text-slate-300">{session.userDataDir}</div><div className="mt-2 text-xs text-slate-500">Created {formatDateTime(session.createdAt)}</div></div><Button size="sm" variant="destructive" onClick={() => handleCloseSession(session.sessionId)}><StopCircle className="h-3.5 w-3.5" />Close</Button></div></div>)}</div>}</CardContent></Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Proxy Health Scheduler</CardTitle><CardDescription>Periodically re-check every saved proxy in the background and store its health status.</CardDescription></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" disabled={savingSched} onClick={() => saveScheduler({ enabled: !scheduler.enabled, minutes: scheduler.minutes })} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${scheduler.enabled ? 'bg-blue-600' : 'bg-slate-700'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${scheduler.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-sm text-slate-200">{scheduler.enabled ? 'Enabled' : 'Disabled'}</span>
            <label className="flex items-center gap-2 text-sm text-slate-400">Every
              <select value={scheduler.minutes} disabled={savingSched} onChange={(e) => { const m = Number(e.target.value); if (scheduler.enabled) saveScheduler({ enabled: true, minutes: m }); else setScheduler((prev) => ({ ...prev, minutes: m })); }} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200">
                <option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option><option value={120}>2 hours</option>
              </select>
            </label>
            {scheduler.running ? <Badge variant="green">Running</Badge> : <span className="text-xs text-slate-500">Idle</span>}
          </div>
          <p className="mt-3 text-xs text-slate-500">Runs in the app's main process, so checks continue even when the app is on another page or minimized. Results show as status badges in the Proxy Pool.</p>
        </CardContent>
      </Card>
    </>
  );
}

function InfoRow({ label, value }) {
  return <div><dt className="mb-2 text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="break-all rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">{value || '—'}</dd></div>;
}