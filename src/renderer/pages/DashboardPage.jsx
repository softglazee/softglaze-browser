import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, Play, Globe, Folder, Clock, 
  X, BarChart3, MonitorSmartphone, Zap, Loader2
} from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalProfiles: 0, activeSessions: 0, totalProxies: 0, totalGroups: 0 });
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  // FETCH REAL DATA FROM SQLITE DATABASE AND PUPPETEER
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
    // Refresh live sessions every 10 seconds
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

  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;

  return (
    <>
      <PageHeader 
        eyebrow="Overview" title="Dashboard" description="Monitor active sessions, resource usage, and global statistics."
        actions={<Button variant="outline" className="bg-[#181a1f] border-[#3b3e48] text-white"><Activity className="h-4 w-4 mr-2 text-blue-400" />System Status</Button>}
      />

      {/* REAL QUICK STATS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="bg-[#1e2025] border-[#2d3039]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0"><MonitorSmartphone className="w-6 h-6 text-blue-500" /></div>
            <div><p className="text-[#9ca3af] text-[12px] font-medium mb-1">Total Profiles</p><h3 className="text-white text-2xl font-bold">{stats.totalProfiles}</h3></div>
          </CardContent>
        </Card>
        <Card className="bg-[#1e2025] border-[#2d3039]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-600/10 flex items-center justify-center shrink-0"><Play className="w-6 h-6 text-emerald-500" /></div>
            <div><p className="text-[#9ca3af] text-[12px] font-medium mb-1">Active Sessions</p><h3 className="text-white text-2xl font-bold">{stats.activeSessions}</h3></div>
          </CardContent>
        </Card>
        <Card className="bg-[#1e2025] border-[#2d3039]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-purple-600/10 flex items-center justify-center shrink-0"><Globe className="w-6 h-6 text-purple-500" /></div>
            <div><p className="text-[#9ca3af] text-[12px] font-medium mb-1">Saved Proxies</p><h3 className="text-white text-2xl font-bold">{stats.totalProxies}</h3></div>
          </CardContent>
        </Card>
        <Card className="bg-[#1e2025] border-[#2d3039]">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-orange-600/10 flex items-center justify-center shrink-0"><Folder className="w-6 h-6 text-orange-500" /></div>
            <div><p className="text-[#9ca3af] text-[12px] font-medium mb-1">Total Groups</p><h3 className="text-white text-2xl font-bold">{stats.totalGroups}</h3></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* REAL ACTIVE SESSIONS TABLE */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-[#1e2025] border-[#2d3039] flex flex-col h-full">
            <CardHeader className="border-b border-[#2d3039] px-5 py-4 flex flex-row items-center justify-between">
              <CardTitle className="text-[15px] font-semibold text-white flex items-center gap-2"><Zap className="w-4 h-4 text-emerald-400" /> Active Running Profiles</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-[#181a1f] text-[#9ca3af] border-b border-[#2d3039]">
                  <tr><th className="px-5 py-3 font-medium">Profile</th><th className="px-5 py-3 font-medium">Proxy IP</th><th className="px-5 py-3 font-medium">Uptime</th><th className="px-5 py-3 font-medium text-right">Action</th></tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr><td colSpan="4" className="p-10"><EmptyState title="No Active Sessions" description="Launch a profile to see it monitored here in real-time." icon={<MonitorSmartphone className="w-10 h-10 text-[#3b3e48]" />}/></td></tr>
                  ) : (
                    sessions.map((session) => (
                      <tr key={session.id} className="border-b border-[#2d3039] last:border-0 hover:bg-[#24272e] transition">
                        <td className="px-5 py-3.5 font-medium text-white flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"></div>{session.profileName}</td>
                        <td className="px-5 py-3.5 text-[#9ca3af]"><span className="bg-[#181a1f] border border-[#3b3e48] px-2 py-1 rounded font-mono text-[11px]">{session.ip}</span></td>
                        <td className="px-5 py-3.5 text-[#9ca3af] flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-slate-500" /> {session.uptime}</td>
                        <td className="px-5 py-3.5 text-right"><Button size="sm" onClick={() => handleStopSession(session.id)} className="bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-900/50"><X className="w-3.5 h-3.5 mr-1" /> Close</Button></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}