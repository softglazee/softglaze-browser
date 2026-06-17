import { useEffect, useState } from 'react';
import { Plus, Users, Shield, X, Loader2, Trash2, KeyRound } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'];
const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', OPERATOR: 'Operator' };
const ROLE_DESC = {
  OWNER: 'Full control, including members and the vault.',
  ADMIN: 'Manage profiles, proxies, groups and members.',
  MANAGER: 'Create, edit and launch profiles in their groups.',
  OPERATOR: 'Launch and use assigned profiles only.'
};
const COLORS = ['#6366f1', '#3B82F6', '#8B5CF6', '#2FB8A0', '#E2A93C', '#22C55E', '#EF4444', '#a1a1aa'];

function roleBadge(role) {
  const map = {
    OWNER: 'bg-primary/15 text-primary',
    ADMIN: 'bg-purple-500/15 text-purple-300',
    MANAGER: 'bg-blue-500/15 text-blue-300',
    OPERATOR: 'bg-white/5 text-muted'
  };
  return map[role] || 'bg-white/5 text-muted';
}

function relTime(iso) {
  if (!iso) return 'Never active';
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'Active just now';
  if (s < 3600) return `Active ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`;
  return `Active ${Math.floor(s / 86400)}d ago`;
}

export default function MembersPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true); setError('');
    try { setMembers(await softglazeApi.members.list()); }
    catch (e) { setError(e.message || 'Could not load members.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-end gap-3 mb-6">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-dark mb-1">Team</div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight leading-none">Members</h1>
        </div>
        <span className="text-[12px] text-muted pb-0.5 font-mono">{members.length} member{members.length === 1 ? '' : 's'}</span>
        <button onClick={() => setEditing({})} className="ml-auto h-9 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] flex items-center gap-2 shadow-glow transition-colors">
          <Plus className="w-4 h-4" />Add member
        </button>
      </div>

      {error && <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12.5px] text-red-400">{error}</div>}

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>
      ) : members.length === 0 ? (
        <div className="border border-border rounded-2xl bg-card grid place-items-center py-16 text-center">
          <Users className="w-7 h-7 text-muted-dark mb-3" />
          <p className="text-[13px] text-zinc-100 font-medium">No members yet</p>
          <p className="text-[12px] text-muted mt-1 mb-4">Add your first member to start assigning profiles and tracking activity.</p>
          <button onClick={() => setEditing({})} className="h-9 px-3 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] flex items-center gap-2 shadow-glow"><Plus className="w-4 h-4" />Add member</button>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {members.map((m) => (
            <button key={m.id} onClick={() => setEditing(m)} className="text-left bg-card border border-border rounded-2xl p-4 hover:border-muted-dark transition-colors">
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-full grid place-items-center text-[14px] font-semibold" style={{ background: (m.color || '#6366f1') + '22', color: m.color || '#6366f1' }}>{m.initials}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium truncate">{m.name}</span>
                    {m.isCurrent && <span className="text-[10px] text-primary">You</span>}
                  </div>
                  <div className="text-[11.5px] text-muted-dark truncate">{m.email || 'No email'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3.5">
                <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[11px] font-medium ${roleBadge(m.role)}`}><Shield className="w-3 h-3" />{ROLE_LABEL[m.role] || m.role}</span>
                {m.hasPin && <span className="inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[11px] text-muted bg-white/5"><KeyRound className="w-3 h-3" />PIN</span>}
                {m.status === 'suspended' && <span className="h-[22px] px-2 rounded-md text-[11px] text-red-400 bg-red-500/10 grid place-items-center">Suspended</span>}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-[11.5px] text-muted-dark">
                <span>{relTime(m.lastActiveAt)}</span>
                <span className="font-mono">{m.assignedProfiles || 0} profiles</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {editing && <MemberModal member={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function MemberModal({ member, onClose, onSaved }) {
  const isNew = !member.id;
  const [name, setName] = useState(member.name || '');
  const [email, setEmail] = useState(member.email || '');
  const [role, setRole] = useState(member.role || 'OPERATOR');
  const [color, setColor] = useState(member.color || '#6366f1');
  const [pin, setPin] = useState('');
  const [suspended, setSuspended] = useState(member.status === 'suspended');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputCls = 'w-full h-10 bg-background border border-border rounded-lg px-3 text-[13px] text-zinc-100 outline-none focus:border-primary';

  async function save() {
    setErr('');
    if (!name.trim()) { setErr('Name is required.'); return; }
    setBusy(true);
    try {
      if (isNew) {
        const created = await softglazeApi.members.create({ name: name.trim(), email: email.trim() || undefined, role, color });
        if (pin) await softglazeApi.members.setPin(created.id, pin);
      } else {
        await softglazeApi.members.update({ id: member.id, name: name.trim(), email: email.trim() || null, role, color, status: suspended ? 'suspended' : 'active' });
        if (pin) await softglazeApi.members.setPin(member.id, pin);
      }
      onSaved();
    } catch (e) { setErr(e.message || 'Could not save member.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Remove ${member.name}? Their assigned profiles will be unassigned.`)) return;
    setBusy(true); setErr('');
    try { await softglazeApi.members.delete(member.id); onSaved(); }
    catch (e) { setErr(e.message || 'Could not remove member.'); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={onClose}>
      <div className="w-[440px] bg-card border border-border rounded-2xl shadow-2xl shadow-black/50" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display text-[15px] font-semibold">{isNew ? 'Add member' : 'Edit member'}</h2>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-zinc-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1.5">Name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1.5">Email</label>
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted mb-1.5">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button key={r} onClick={() => setRole(r)} className={`text-left p-2.5 rounded-lg border transition-colors ${role === r ? 'border-primary bg-primary/10' : 'border-border hover:border-muted-dark'}`}>
                  <div className="text-[12.5px] font-medium">{ROLE_LABEL[r]}</div>
                  <div className="text-[10.5px] text-muted-dark leading-snug mt-0.5">{ROLE_DESC[r]}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted mb-1.5">Color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className="w-7 h-7 rounded-full transition-transform" style={{ background: c, transform: color === c ? 'scale(1.12)' : 'none', boxShadow: color === c ? `0 0 0 2px var(--color-card), 0 0 0 4px ${c}` : 'none' }} aria-label={c} />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted mb-1.5">{isNew ? 'PIN' : 'Set new PIN'} <span className="text-muted-dark">(optional)</span></label>
            <input type="password" className={inputCls} value={pin} onChange={(e) => setPin(e.target.value)} placeholder={member.hasPin ? 'Leave blank to keep current PIN' : 'No PIN'} />
          </div>

          {!isNew && (
            <label className="flex items-center gap-2.5 text-[12.5px] text-muted cursor-pointer">
              <input type="checkbox" checked={suspended} onChange={(e) => setSuspended(e.target.checked)} className="accent-red-500" />
              Suspend this member (blocks sign-in)
            </label>
          )}

          {err && <p className="text-[12px] text-red-400">{err}</p>}
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-border">
          {!isNew && <button onClick={remove} disabled={busy} className="h-9 px-3 rounded-lg text-[12.5px] text-red-400 hover:bg-red-500/10 flex items-center gap-1.5"><Trash2 className="w-4 h-4" />Remove</button>}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted hover:bg-white/5">Cancel</button>
            <button onClick={save} disabled={busy} className="h-9 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-glow transition-colors">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (isNew ? 'Add member' : 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}