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
const COLORS = ['#3DC6DA', '#3B82F6', '#8B5CF6', '#2FB8A0', '#E2A93C', '#22C55E', '#E2685E', '#94A0AE'];

function roleBadge(role) {
  const map = {
    OWNER: 'bg-accent/15 text-accent',
    ADMIN: 'bg-[#8B5CF6]/15 text-[#A78BFA]',
    MANAGER: 'bg-[#3B82F6]/15 text-[#60A5FA]',
    OPERATOR: 'bg-panel-3 text-mute'
  };
  return map[role] || 'bg-panel-3 text-mute';
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
  const [editing, setEditing] = useState(null); // member object or {} for new

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
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint mb-1">Team</div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight leading-none">Members</h1>
        </div>
        <span className="text-[12px] text-mute pb-0.5 font-mono">{members.length} member{members.length === 1 ? '' : 's'}</span>
        <button onClick={() => setEditing({})} className="ml-auto h-9 px-3 rounded-md bg-accent text-accent-ink font-semibold text-[12.5px] flex items-center gap-2">
          <Plus className="w-4 h-4" />Add member
        </button>
      </div>

      {error && <div className="mb-4 px-3 py-2 rounded-md bg-down/10 border border-down/30 text-[12.5px] text-down">{error}</div>}

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="w-5 h-5 text-mute animate-spin" /></div>
      ) : members.length === 0 ? (
        <div className="border border-line rounded-xl bg-panel grid place-items-center py-16 text-center">
          <Users className="w-7 h-7 text-faint mb-3" />
          <p className="text-[13px] text-fg font-medium">No members yet</p>
          <p className="text-[12px] text-mute mt-1 mb-4">Add your first member to start assigning profiles and tracking activity.</p>
          <button onClick={() => setEditing({})} className="h-9 px-3 rounded-md bg-accent text-accent-ink font-semibold text-[12.5px] flex items-center gap-2"><Plus className="w-4 h-4" />Add member</button>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {members.map((m) => (
            <button key={m.id} onClick={() => setEditing(m)} className="text-left bg-panel border border-line rounded-xl p-4 hover:border-line-2 transition-colors">
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-full grid place-items-center text-[14px] font-semibold" style={{ background: (m.color || '#3DC6DA') + '22', color: m.color || '#3DC6DA' }}>{m.initials}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium truncate">{m.name}</span>
                    {m.isCurrent && <span className="text-[10px] text-accent">You</span>}
                  </div>
                  <div className="text-[11.5px] text-faint truncate">{m.email || 'No email'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3.5">
                <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[11px] font-medium ${roleBadge(m.role)}`}><Shield className="w-3 h-3" />{ROLE_LABEL[m.role] || m.role}</span>
                {m.hasPin && <span className="inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[11px] text-mute bg-panel-3"><KeyRound className="w-3 h-3" />PIN</span>}
                {m.status === 'suspended' && <span className="h-[22px] px-2 rounded-md text-[11px] text-down bg-down/10 grid place-items-center">Suspended</span>}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-line text-[11.5px] text-faint">
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
  const [color, setColor] = useState(member.color || '#3DC6DA');
  const [pin, setPin] = useState('');
  const [suspended, setSuspended] = useState(member.status === 'suspended');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputCls = 'w-full h-10 bg-bg border border-line rounded-md px-3 text-[13px] text-fg outline-none focus:border-accent-dim';

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
    <div className="fixed inset-0 z-50 bg-black/55 grid place-items-center p-4" onMouseDown={onClose}>
      <div className="w-[440px] bg-panel border border-line-2 rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-display text-[15px] font-semibold">{isNew ? 'Add member' : 'Edit member'}</h2>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-md text-mute hover:bg-panel-2 hover:text-fg"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-mute mb-1.5">Name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-mute mb-1.5">Email</label>
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-mute mb-1.5">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button key={r} onClick={() => setRole(r)} className={`text-left p-2.5 rounded-md border transition-colors ${role === r ? 'border-accent bg-accent/10' : 'border-line hover:border-line-2'}`}>
                  <div className="text-[12.5px] font-medium">{ROLE_LABEL[r]}</div>
                  <div className="text-[10.5px] text-faint leading-snug mt-0.5">{ROLE_DESC[r]}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-mute mb-1.5">Color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-offset-panel scale-110' : ''}`} style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : 'none' }} aria-label={c} />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-mute mb-1.5">{isNew ? 'PIN' : 'Set new PIN'} <span className="text-faint">(optional)</span></label>
            <input type="password" className={inputCls} value={pin} onChange={(e) => setPin(e.target.value)} placeholder={member.hasPin ? 'Leave blank to keep current PIN' : 'No PIN'} />
          </div>

          {!isNew && (
            <label className="flex items-center gap-2.5 text-[12.5px] text-mute cursor-pointer">
              <input type="checkbox" checked={suspended} onChange={(e) => setSuspended(e.target.checked)} className="accent-[#E2685E]" />
              Suspend this member (blocks sign-in)
            </label>
          )}

          {err && <p className="text-[12px] text-down">{err}</p>}
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-line">
          {!isNew && <button onClick={remove} disabled={busy} className="h-9 px-3 rounded-md text-[12.5px] text-down hover:bg-down/10 flex items-center gap-1.5"><Trash2 className="w-4 h-4" />Remove</button>}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="h-9 px-3 rounded-md text-[12.5px] text-mute hover:bg-panel-2">Cancel</button>
            <button onClick={save} disabled={busy} className="h-9 px-4 rounded-md bg-accent text-accent-ink font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (isNew ? 'Add member' : 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}