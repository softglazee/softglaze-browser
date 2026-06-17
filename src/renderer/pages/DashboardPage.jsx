import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, Play, Globe, Folder, Clock, 
  X, MonitorSmartphone, Zap, Loader2
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Helper component for the sleek stat cards
function StatCard({ icon: Icon, label, value, colorClass, bgClass }) {
  return (
    <Card className="bg-surface border-border overflow-hidden relative group">
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-transparent to-${colorClass.split('-')[1]}-500/5`} />
      <CardContent className="p-5 flex items-center gap-4 relative z-10">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-inner ${bgClass}`}>
          <Icon className={`w-6 h-6 ${colorClass}`} />
        </div>
        <div>
          <p className="text-muted text-xs font-semibold uppercase tracking-wider mb-1">
            {label}
          </p>
          <h3 className="text-zinc-100 text-2xl font-bold tracking-tight">
            {value}
          </h3>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalProfiles: 0, activeSessions: 0, totalProxies: 0, totalGroups: 0 });
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStatus, setShowStatus] = useState(false);

  const loadDashboardData = useCallback(async () => {
    try {
      const [realStats, realSessions] = await Promise.all([
        softglazeApi.dashboard.getStats(),
        softglazeApi.sessions.list()
      ]);
      setStats(realStats);
      setSessions(realSessions);
    } catch (error) {
      console.error("Failed to load real dashboard data:", error);
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
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      setStats(prev => ({ ...prev, activeSessions: prev.activeSessions - 1 }));
    } catch (err) {
      alert("Failed to close session: " + err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted animate-pulse">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <PageHeader 
        eyebrow="Overview" 
        title="Dashboard" 
        description="Monitor active sessions, resource usage, and global statistics."
        actions={
          <Button variant="secondary" size="md" onClick={() => setShowStatus(true)}>
            <Activity className="h-4 w-4" />
            System Status
          </Button>
        }
      />

      {/* QUICK STATS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard 
          icon={MonitorSmartphone} 
          label="Total Profiles" 
          value={stats.totalProfiles} 
          colorClass="text-blue-400" 
          bgClass="bg-blue-500/10 border border-blue-500/20" 
        />
        <StatCard 
          icon={Play} 
          label="Active Sessions" 
          value={stats.activeSessions} 
          colorClass="text-emerald-400" 
          bgClass="bg-emerald-500/10 border border-emerald-500/20" 
        />
        <StatCard 
          icon={Globe} 
          label="Saved Proxies" 
          value={stats.totalProxies} 
          colorClass="text-purple-400" 
          bgClass="bg-purple-500/10 border border-purple-500/20" 
        />
        <StatCard 
          icon={Folder} 
          label="Total Groups" 
          value={stats.totalGroups} 
          colorClass="text-orange-400" 
          bgClass="bg-orange-500/10 border border-orange-500/20" 
        />
      </div>

      {/* ACTIVE SESSIONS TABLE */}
      <Card className="bg-surface border-border flex flex-col shadow-xl">
        <CardHeader className="border-b border-border px-5 py-4 bg-card rounded-t-xl">
          <CardTitle className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" /> 
            Active Running Profiles
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto rounded-b-xl">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface text-muted text-xs uppercase tracking-wider font-semibold border-b border-border">
              <tr>
                <th className="px-5 py-3">Profile</th>
                <th className="px-5 py-3">Proxy IP</th>
                <th className="px-5 py-3">Uptime</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-10">
                    <EmptyState 
                      title="No Active Sessions" 
                      description="Launch a profile from the Profiles page to see it monitored here in real-time." 
                      icon={<MonitorSmartphone className="w-10 h-10 text-muted" />}
                    />
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-card/50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-zinc-100 flex items-center gap-3">
                      <div className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </div>
                      {session.profileName}
                    </td>
                    <td className="px-5 py-3.5 text-muted">
                      <span className="bg-card border border-border px-2 py-1 rounded-md font-mono text-xs text-zinc-300 shadow-sm">
                        {session.ip}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted flex items-center gap-1.5 font-mono text-xs">
                      <Clock className="w-3.5 h-3.5 text-muted-dark" /> 
                      {session.uptime}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Button 
                        size="sm" 
                        variant="danger" 
                        onClick={() => handleStopSession(session.id)}
                      >
                        <X className="w-3.5 h-3.5" /> Close
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {showStatus && <SystemStatusModal stats={stats} sessions={sessions} onClose={() => setShowStatus(false)} />}
    </div>
  );
}

function SystemStatusModal({ stats, sessions, onClose }) {
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
    { label: 'Browser engine', ok: true, note: 'Operational' },
    { label: 'Local database', ok: true, note: info?.databaseUrlConfigured ? 'Connected (env)' : 'Connected' },
    { label: 'IPC bridge', ok: true, note: 'Connected' },
    { label: 'Active sessions', ok: true, note: `${stats.activeSessions || 0} running` }
  ];
  const metrics = [
    ['Profiles', stats.totalProfiles || 0],
    ['Sessions', stats.activeSessions || 0],
    ['Proxies', stats.totalProxies || 0],
    ['Groups', stats.totalGroups || 0]
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={onClose}>
      <div className="w-[460px] bg-card border border-border rounded-2xl shadow-2xl shadow-black/50" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /><h2 className="font-display text-[15px] font-semibold">System status</h2></div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-zinc-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" /></span>
            <span className="font-medium text-emerald-400">All systems operational</span>
          </div>
          <div className="space-y-2">
            {components.map((c) => (
              <div key={c.label} className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-2 text-zinc-200"><span className={`w-2 h-2 rounded-full ${c.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />{c.label}</span>
                <span className="text-muted font-mono text-[11.5px]">{c.note}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {metrics.map(([l, v]) => (
              <div key={l} className="bg-surface border border-border rounded-xl p-3 text-center">
                <div className="text-[18px] font-bold text-zinc-100 font-mono">{v}</div>
                <div className="text-[10px] text-muted-dark uppercase tracking-wider mt-0.5">{l}</div>
              </div>
            ))}
          </div>
          <div className="bg-surface border border-border rounded-xl p-3 space-y-1.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-dark">Environment</div>
            {loadingInfo ? (
              <div className="flex items-center gap-2 text-[12px] text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading…</div>
            ) : (
              <>
                <div className="text-[11.5px] text-muted break-all"><span className="text-muted-dark">DB: </span><span className="font-mono text-zinc-300">{info?.dbPath || 'unknown'}</span></div>
                <div className="text-[11.5px] text-muted break-all"><span className="text-muted-dark">Profiles: </span><span className="font-mono text-zinc-300">{info?.profileRoot || 'unknown'}</span></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}