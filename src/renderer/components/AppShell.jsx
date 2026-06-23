import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Fingerprint, Layers, Globe, Puzzle, FileSpreadsheet,
  Trash2, Settings, Users, Lock, Check, ChevronsUpDown, Sun, Moon,
  Shield, ChevronLeft, ChevronRight, Activity, MonitorDown, AlertTriangle, Sparkles, X, Wand2,
  LogOut, UserCog, CreditCard
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { getStoredTheme, setTheme as applyThemeChoice } from '@/lib/theme.js';
import CommandPalette from '@/components/CommandPalette.jsx';
import OnboardingWizard from '@/components/OnboardingWizard.jsx';

function ThemeToggle({ collapsed }) {
  const [theme, setThemeState] = useState(getStoredTheme());
  const isDark = theme === 'dark';
  return (
    <button
      onClick={() => setThemeState(applyThemeChoice(isDark ? 'light' : 'dark'))}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-left text-[13px] font-medium text-muted-foreground hover:text-foreground"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="relative w-[18px] h-[18px] grid place-items-center shrink-0">
        {isDark
          ? <Moon className="w-[18px] h-[18px]" strokeWidth={1.75} />
          : <Sun className="w-[18px] h-[18px]" strokeWidth={1.75} />}
      </span>
      {!collapsed && <>
        {isDark ? 'Dark mode' : 'Light mode'}
        <span className="ml-auto inline-flex items-center h-5 w-9 rounded-full p-0.5 transition-colors" style={{ background: isDark ? 'var(--switch-background)' : 'var(--primary)' }}>
          <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${isDark ? '' : 'translate-x-4'}`} />
        </span>
      </>}
    </button>
  );
}

const SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, featureKey: 'dashboard' },
      { path: '/profiles', label: 'Profiles', icon: Fingerprint, badgeKey: 'profiles', featureKey: 'profiles' },
      { path: '/groups', label: 'Groups', icon: Layers, featureKey: 'groups' },
      { path: '/proxies', label: 'Proxy pool', icon: Globe, featureKey: 'proxies' },
      { path: '/browsers', label: 'Browsers', icon: MonitorDown, featureKey: 'browsers' },
      { path: '/extensions', label: 'Extensions', icon: Puzzle, featureKey: 'extensions' }
    ]
  },
  {
    label: 'Data',
    items: [
      { path: '/batch-import', label: 'Batch import', icon: FileSpreadsheet, featureKey: 'batchImport' },
      { path: '/trash', label: 'Trash', icon: Trash2, featureKey: 'trash' }
    ]
  },
  {
    label: 'Pro',
    items: [{ path: '/automation', label: 'Automation', icon: Wand2, featureKey: 'automation' }]
  },
  {
    label: 'Team',
    items: [{ path: '/members', label: 'Members', icon: Users, featureKey: 'members' }]
  }
];

// A nav item is visible unless the active member's permissions explicitly hide it.
// No member (single-user) or no features map => everything is shown.
function makeCanSee(me) {
  const feats = me && me.permissions && me.permissions.features;
  return (key) => !feats || !key || feats[key] !== false;
}

const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', OPERATOR: 'Operator' };

function NavItem({ path, label, icon: Icon, collapsed, badge }) {
  return (
    <NavLink to={path} className="block" title={collapsed ? label : undefined}>
      {({ isActive }) => (
        <div
          className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
            isActive ? 'text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
          }`}
          style={isActive ? { background: 'color-mix(in srgb, var(--primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 24%, transparent)' } : { border: '1px solid transparent' }}
        >
          <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-primary' : ''}`} strokeWidth={1.75} />
          {!collapsed && <span className="flex-1 truncate">{label}</span>}
          {!collapsed && badge != null && badge !== '' && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">{badge}</span>
          )}
        </div>
      )}
    </NavLink>
  );
}

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState([]);
  const [vault, setVault] = useState({ enabled: false });
  const [license, setLicense] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState('');
  const [pwFor, setPwFor] = useState(null); // member id needing a password (upward switch)
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [counts, setCounts] = useState({ profiles: 0, sessions: 0 });
  const ref = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [cur, list, vs, lic] = await Promise.all([
          softglazeApi.members.current().catch(() => null),
          softglazeApi.members.list().catch(() => []),
          softglazeApi.vault.status().catch(() => ({ enabled: false })),
          softglazeApi.license.get().catch(() => null)
        ]);
        if (!live) return;
        setMe(cur);
        setMembers(Array.isArray(list) ? list : []);
        setVault(vs || { enabled: false });
        setLicense(lic);
      } catch (e) { /* members API unavailable on older builds */ }
    })();
    return () => { live = false; };
  }, []);

  // Live counts for the sidebar badge + status pill (best-effort, polled).
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const [stats, sessions] = await Promise.all([
          softglazeApi.dashboard.getStats().catch(() => null),
          softglazeApi.sessions.list().catch(() => [])
        ]);
        if (!live) return;
        setCounts({
          profiles: stats?.totalProfiles ?? 0,
          sessions: Array.isArray(sessions) ? sessions.length : (stats?.activeSessions ?? 0)
        });
      } catch (e) { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { live = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setPinFor(null); setPwFor(null); setErr(''); }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function doSwitch(m) {
    setErr('');
    if (m.hasPin && pinFor !== m.id) { setPinFor(m.id); setPin(''); return; }
    try {
      await softglazeApi.members.switch(m.id, m.hasPin ? pin : undefined, pwFor === m.id ? pw : undefined);
      window.location.reload();
    } catch (e) {
      // Switching up to a higher/equal-rank member requires that member's password.
      if (e.code === 'NEED_PASSWORD') { setPwFor(m.id); setPw(''); setErr('Enter this member’s password to switch into their account.'); return; }
      setErr(e.message || 'Could not switch member.');
    }
  }

  async function doLock() {
    try { await softglazeApi.vault.lock(); window.location.reload(); } catch (e) { /* ignore */ }
  }

  // Sign out: clear the active member server-side, then reload so Gate.jsx falls
  // back to the member-picker / login screen. The reload runs even if the API call
  // fails, so the user is never stuck in a half-logged-out state.
  async function doLogout() {
    try { await softglazeApi.members.logout(); } catch (e) { /* proceed to reload anyway */ }
    window.location.reload();
  }

  const initials = me?.initials || 'SG';
  const name = me?.name || 'Local workspace';
  const role = me ? (ROLE_LABEL[me.role] || me.role) : 'No member';
  const badges = { profiles: counts.profiles ? String(counts.profiles) : '' };
  const canSee = makeCanSee(me);

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans overflow-hidden">
      <aside
        className="bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 transition-[width] duration-300 ease-out"
        style={{ width: collapsed ? 68 : 232 }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-5 shrink-0 overflow-hidden">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 grid place-items-center shrink-0 shadow-lg shadow-blue-500/25">
            <Shield className="w-[18px] h-[18px] text-white" strokeWidth={2} />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0 animate-fade-in">
              <span className="font-display font-semibold text-[15px] tracking-tight leading-none text-foreground">SoftGlaze</span>
              <span className="text-[10px] text-primary font-semibold tracking-[0.18em] uppercase mt-1">Anti-Detect</span>
            </div>
          )}
        </div>

        {/* Active-session status pill */}
        {!collapsed && (
          <div
            className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg animate-fade-in"
            style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)' }}
          >
            <span className="relative flex h-2 w-2">
              {counts.sessions > 0 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${counts.sessions > 0 ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
            </span>
            <span className={`text-xs font-medium ${counts.sessions > 0 ? 'text-emerald-500' : 'text-muted-foreground'}`}>
              {counts.sessions > 0 ? `${counts.sessions} session${counts.sessions > 1 ? 's' : ''} active` : 'No active sessions'}
            </span>
            <Activity className="w-3 h-3 text-emerald-500 ml-auto" />
          </div>
        )}

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
          {SECTIONS.map((section) => {
            const items = section.items.filter((item) => canSee(item.featureKey));
            if (items.length === 0) return null;
            return (
              <div key={section.label} className="mt-3">
                {!collapsed && <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/70">{section.label}</div>}
                <div className="space-y-0.5">
                  {items.map((item) => <NavItem key={item.path} {...item} collapsed={collapsed} badge={item.badgeKey ? badges[item.badgeKey] : undefined} />)}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="px-3 pb-3 mt-auto">
          <div className="border-t border-sidebar-border pt-2.5 space-y-0.5 relative" ref={ref}>
            <ThemeToggle collapsed={collapsed} />
            {canSee('billing') && <NavItem path="/billing" label="Billing" icon={CreditCard} collapsed={collapsed} />}
            {canSee('settings') && <NavItem path="/settings" label="Settings" icon={Settings} collapsed={collapsed} />}

            {/* Collapse toggle */}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? <ChevronRight className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} /> : <ChevronLeft className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />}
              {!collapsed && <span className="text-[13px] font-medium">Collapse</span>}
            </button>

            <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left">
              <span className="w-8 h-8 rounded-full grid place-items-center font-semibold text-[11px] shrink-0" style={{ background: me?.color ? me.color + '22' : 'color-mix(in srgb, var(--accent) 22%, transparent)', color: me?.color || 'var(--accent)' }}>{initials}</span>
              {!collapsed && <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-foreground leading-tight truncate">{name}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{role}</span>
                </span>
                <ChevronsUpDown className="w-[15px] h-[15px] text-muted-foreground" strokeWidth={1.75} />
              </>}
            </button>

            {open && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-popover border border-border rounded-xl overflow-hidden shadow-2xl shadow-black/40 animate-scale-in">
                <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Switch member</div>
                <div className="max-h-60 overflow-y-auto">
                  {members.length === 0 && <div className="px-3 py-2 text-[12px] text-muted-foreground">No members yet.</div>}
                  {members.map((m) => (
                    <div key={m.id}>
                      <button onClick={() => doSwitch(m)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary text-left">
                        <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold" style={{ background: (m.color || '#6366f1') + '22', color: m.color || '#6366f1' }}>{m.initials}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] truncate text-foreground">{m.name}</span>
                          <span className="block text-[10.5px] text-muted-foreground">{ROLE_LABEL[m.role] || m.role}</span>
                        </span>
                        {m.isCurrent && <Check className="w-4 h-4 text-primary" />}
                      </button>
                      {pinFor === m.id && pwFor !== m.id && (
                        <div className="px-3 pb-2 flex items-center gap-2">
                          <input type="password" value={pin} autoFocus onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSwitch(m); }} placeholder="PIN" className="flex-1 h-8 bg-input-background border border-border rounded-lg px-2 text-[12px] text-foreground outline-none focus:border-primary" />
                          <button onClick={() => doSwitch(m)} className="h-8 px-3 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground text-[12px] font-semibold">Go</button>
                        </div>
                      )}
                      {pwFor === m.id && (
                        <div className="px-3 pb-2 flex items-center gap-2">
                          <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSwitch(m); }} placeholder={`${m.name}'s password`} className="flex-1 h-8 bg-input-background border border-border rounded-lg px-2 text-[12px] text-foreground outline-none focus:border-primary" />
                          <button onClick={() => doSwitch(m)} className="h-8 px-3 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground text-[12px] font-semibold">Go</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {err && <div className="px-3 py-1.5 text-[11px] text-red-400">{err}</div>}
                <div className="border-t border-border">
                  <button onClick={() => { setOpen(false); navigate('/account'); }} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary text-left text-[12.5px] text-muted-foreground hover:text-foreground"><UserCog className="w-4 h-4" />Account settings</button>
                  <button onClick={() => { setOpen(false); navigate('/members'); }} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary text-left text-[12.5px] text-muted-foreground hover:text-foreground"><Users className="w-4 h-4" />Manage members</button>
                  {vault.enabled && <button onClick={doLock} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary text-left text-[12.5px] text-muted-foreground hover:text-foreground"><Lock className="w-4 h-4" />Lock workspace</button>}
                </div>
                <div className="border-t border-border">
                  <button onClick={doLogout} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-red-500/10 text-left text-[12.5px] text-red-400 hover:text-red-300"><LogOut className="w-4 h-4" />Log out</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {license && !bannerDismissed && me?.role !== 'SUPER_ADMIN' && (license.isExpired || (license.isTrial && license.daysLeft <= 3)) && (
          <div className="flex items-center gap-3 px-7 py-2.5 border-b" style={{ background: license.isExpired ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)', borderColor: license.isExpired ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)' }}>
            {license.isExpired ? <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" /> : <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />}
            <span className="text-[12.5px] flex-1 min-w-0" style={{ color: license.isExpired ? 'var(--color-red-400, #f87171)' : '#fbbf24' }}>
              {license.isExpired
                ? `Your ${license.isTrial ? 'free trial' : 'subscription'} has ended — the app keeps working, but please subscribe ($5/mo) to keep it supported.`
                : `Free trial ends in ${license.daysLeft} day${license.daysLeft === 1 ? '' : 's'}. Subscribe for $5/month to keep going.`}
            </span>
            <button onClick={() => navigate('/billing')} className="shrink-0 text-[12px] font-semibold px-3 py-1 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow shadow-blue-500/25">Subscribe</button>
            <button onClick={() => setBannerDismissed(true)} className="shrink-0 text-muted-foreground hover:text-foreground" title="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
      </main>
      <CommandPalette />
      <OnboardingWizard />
    </div>
  );
}
