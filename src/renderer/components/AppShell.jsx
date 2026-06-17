import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Fingerprint, Layers, Globe, Puzzle, FileSpreadsheet,
  Trash2, Settings, Users, Lock, Check, ChevronsUpDown
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

const SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/profiles', label: 'Profiles', icon: Fingerprint },
      { path: '/groups', label: 'Groups', icon: Layers },
      { path: '/proxies', label: 'Proxy pool', icon: Globe },
      { path: '/extensions', label: 'Extensions', icon: Puzzle }
    ]
  },
  {
    label: 'Data',
    items: [
      { path: '/batch-import', label: 'Batch import', icon: FileSpreadsheet },
      { path: '/trash', label: 'Trash', icon: Trash2 }
    ]
  },
  {
    label: 'Team',
    items: [{ path: '/members', label: 'Members', icon: Users }]
  }
];

const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', OPERATOR: 'Operator' };

function NavItem({ path, label, icon: Icon }) {
  return (
    <NavLink to={path} className="block">
      {({ isActive }) => (
        <div
          className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
            isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-white/5 hover:text-zinc-100'
          }`}
        >
          {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-primary" />}
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
          {label}
        </div>
      )}
    </NavLink>
  );
}

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState([]);
  const [vault, setVault] = useState({ enabled: false });
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [cur, list, vs] = await Promise.all([
          softglazeApi.members.current().catch(() => null),
          softglazeApi.members.list().catch(() => []),
          softglazeApi.vault.status().catch(() => ({ enabled: false }))
        ]);
        if (!live) return;
        setMe(cur);
        setMembers(Array.isArray(list) ? list : []);
        setVault(vs || { enabled: false });
      } catch (e) { /* members API unavailable on older builds */ }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setPinFor(null); setErr(''); }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function doSwitch(m) {
    setErr('');
    if (m.hasPin && pinFor !== m.id) { setPinFor(m.id); setPin(''); return; }
    try {
      await softglazeApi.members.switch(m.id, m.hasPin ? pin : undefined);
      window.location.reload();
    } catch (e) { setErr(e.message || 'Could not switch member.'); }
  }

  async function doLock() {
    try { await softglazeApi.vault.lock(); window.location.reload(); } catch (e) { /* ignore */ }
  }

  const initials = me?.initials || 'SG';
  const name = me?.name || 'Local workspace';
  const role = me ? (ROLE_LABEL[me.role] || me.role) : 'No member';

  return (
    <div className="flex h-screen w-full bg-background text-zinc-100 font-sans overflow-hidden">
      <aside className="w-[232px] bg-surface border-r border-border flex flex-col shrink-0">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="w-8 h-8 rounded-xl bg-primary text-white grid place-items-center font-display font-bold text-[15px] shadow-glow">S</div>
          <span className="font-display font-semibold text-[15px] tracking-tight">SoftGlaze</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {SECTIONS.map((section) => (
            <div key={section.label} className="mt-3">
              <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-dark">{section.label}</div>
              <div className="space-y-0.5">
                {section.items.map((item) => <NavItem key={item.path} {...item} />)}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 pb-3 mt-auto">
          <div className="border-t border-border pt-2.5 space-y-0.5 relative" ref={ref}>
            <NavItem path="/settings" label="Settings" icon={Settings} />
            <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors text-left">
              <span className="w-8 h-8 rounded-full grid place-items-center font-semibold text-[11px]" style={{ background: me?.color ? me.color + '22' : 'var(--color-card)', color: me?.color || 'var(--color-muted)' }}>{initials}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-zinc-100 leading-tight truncate">{name}</span>
                <span className="block text-[10.5px] text-muted-dark">{role}</span>
              </span>
              <ChevronsUpDown className="w-[15px] h-[15px] text-muted-dark" strokeWidth={1.75} />
            </button>

            {open && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-xl overflow-hidden shadow-2xl shadow-black/60">
                <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-dark">Switch member</div>
                <div className="max-h-60 overflow-y-auto">
                  {members.length === 0 && <div className="px-3 py-2 text-[12px] text-muted-dark">No members yet.</div>}
                  {members.map((m) => (
                    <div key={m.id}>
                      <button onClick={() => doSwitch(m)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 text-left">
                        <span className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold" style={{ background: (m.color || '#6366f1') + '22', color: m.color || '#6366f1' }}>{m.initials}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] truncate">{m.name}</span>
                          <span className="block text-[10.5px] text-muted-dark">{ROLE_LABEL[m.role] || m.role}</span>
                        </span>
                        {m.isCurrent && <Check className="w-4 h-4 text-primary" />}
                      </button>
                      {pinFor === m.id && (
                        <div className="px-3 pb-2 flex items-center gap-2">
                          <input type="password" value={pin} autoFocus onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSwitch(m); }} placeholder="PIN" className="flex-1 h-8 bg-background border border-border rounded-lg px-2 text-[12px] text-zinc-100 outline-none focus:border-primary" />
                          <button onClick={() => doSwitch(m)} className="h-8 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white text-[12px] font-semibold">Go</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {err && <div className="px-3 py-1.5 text-[11px] text-red-400">{err}</div>}
                <div className="border-t border-border">
                  <button onClick={() => { setOpen(false); navigate('/members'); }} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 text-left text-[12.5px] text-muted"><Users className="w-4 h-4" />Manage members</button>
                  {vault.enabled && <button onClick={doLock} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 text-left text-[12.5px] text-muted"><Lock className="w-4 h-4" />Lock workspace</button>}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
      </main>
    </div>
  );
}