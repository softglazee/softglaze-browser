import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Users, X, Loader2, Trash2, KeyRound, Activity, ClipboardList,
  Crown, UserCog, UserCheck, User, Clock, Copy, Check, Mail, Link2, ShieldCheck,
  Download, FolderInput, Search
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Roles that may reassign profiles / manage the team (mirrors the main-side
// `members.manage` gate; the backend re-checks regardless).
function canManageTeam(me) {
  if (!me) return true; // single-user mode == owner
  return ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(me.role);
}

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'];
const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', OPERATOR: 'Operator' };
const ROLE_DESC = {
  OWNER: 'Full control, including members and the vault.',
  ADMIN: 'Manage profiles, proxies, groups and the managers/operators they create.',
  MANAGER: 'Create, edit and launch profiles, and add operators.',
  OPERATOR: 'Launch and use assigned profiles only.'
};
const COLORS = ['#6366f1', '#3B82F6', '#8B5CF6', '#2FB8A0', '#E2A93C', '#22C55E', '#EF4444', '#a1a1aa'];

const ROLE_CONFIG = {
  SUPER_ADMIN: { label: 'Super Admin', icon: ShieldCheck, color: '#f59e0b' },
  OWNER: { label: 'Owner', icon: Crown, color: '#f59e0b' },
  ADMIN: { label: 'Admin', icon: UserCog, color: '#8b5cf6' },
  MANAGER: { label: 'Manager', icon: UserCheck, color: '#3b82f6' },
  OPERATOR: { label: 'Operator', icon: User, color: '#9ca3af' }
};

// Which roles a viewer can create (mirrors permissions.js for UI gating; the
// backend re-checks and clamps everything).
const ROLES_BELOW = {
  SUPER_ADMIN: ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'],
  OWNER: ['ADMIN', 'MANAGER', 'OPERATOR'],
  ADMIN: ['MANAGER', 'OPERATOR'],
  MANAGER: ['OPERATOR'],
  OPERATOR: []
};

const FEATURES = [
  ['dashboard', 'Dashboard'], ['profiles', 'Profiles'], ['groups', 'Groups'],
  ['proxies', 'Proxy pool'], ['browsers', 'Browsers'], ['extensions', 'Extensions'],
  ['batchImport', 'Batch import'], ['trash', 'Trash'], ['members', 'Members'], ['settings', 'Settings']
];

// Child-role caps relevant to a given member role.
const CHILD_CAPS = {
  OWNER: [['maxAdmins', 'Admins'], ['maxManagers', 'Managers'], ['maxOperators', 'Operators']],
  ADMIN: [['maxManagers', 'Managers'], ['maxOperators', 'Operators']],
  MANAGER: [['maxOperators', 'Operators']],
  OPERATOR: []
};
const CREATE_FLAGS = {
  OWNER: [['canCreateAdmins', 'admins'], ['canCreateManagers', 'managers'], ['canCreateOperators', 'operators']],
  ADMIN: [['canCreateManagers', 'managers'], ['canCreateOperators', 'operators']],
  MANAGER: [['canCreateOperators', 'operators']],
  OPERATOR: []
};

function defaultPerms(role) {
  const all = Object.fromEntries(FEATURES.map(([k]) => [k, true]));
  const base = { maxProfiles: 0, maxProxies: 0, maxBrowsers: 0, maxAdmins: 0, maxManagers: 0, maxOperators: 0, canCreateAdmins: false, canCreateManagers: false, canCreateOperators: false, features: all };
  if (role === 'OWNER') return { ...base, maxProfiles: -1, maxProxies: -1, maxBrowsers: -1, maxAdmins: 10, maxManagers: 10, maxOperators: 5, canCreateAdmins: true, canCreateManagers: true, canCreateOperators: true };
  if (role === 'ADMIN') return { ...base, maxProfiles: 200, maxProxies: 200, maxBrowsers: 10, maxManagers: 5, maxOperators: 5, canCreateManagers: true, canCreateOperators: true };
  if (role === 'MANAGER') return { ...base, maxProfiles: 50, maxProxies: 50, maxBrowsers: 5, maxOperators: 3, canCreateOperators: true };
  return { ...base, maxProfiles: 10, maxProxies: 10, maxBrowsers: 2 };
}

function creatableRoles(me) {
  if (!me) return ['ADMIN', 'MANAGER', 'OPERATOR']; // single-user / no active member
  const below = ROLES_BELOW[me.role] || [];
  if (me.role === 'OWNER' || me.role === 'SUPER_ADMIN') return below;
  const p = me.permissions || {};
  return below.filter((r) => (r === 'ADMIN' ? p.canCreateAdmins : r === 'MANAGER' ? p.canCreateManagers : r === 'OPERATOR' ? p.canCreateOperators : false));
}

function roleBadgeStyle(role) {
  const color = (ROLE_CONFIG[role] || ROLE_CONFIG.OPERATOR).color;
  return { background: `color-mix(in srgb, ${color} 14%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 22%, transparent)` };
}
function relTime(iso) {
  if (!iso) return 'Never active';
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'Active just now';
  if (s < 3600) return `Active ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`;
  return `Active ${Math.floor(s / 86400)}d ago`;
}
function fmtLimit(used, max) {
  if (max === -1 || max == null) return `${used || 0} / ∞`;
  return `${used || 0} / ${max}`;
}

export default function MembersPage() {
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('members');

  async function load() {
    setLoading(true); setError('');
    try {
      const [list, cur] = await Promise.all([
        softglazeApi.members.list(),
        softglazeApi.members.current().catch(() => null)
      ]);
      setMembers(Array.isArray(list) ? list : []);
      setMe(cur);
    } catch (e) { setError(e.message || 'Could not load members.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const canCreate = creatableRoles(me).length > 0;
  const workspaceProfiles = members[0]?.workspaceProfiles ?? 0;
  const workspaceProxies = members[0]?.workspaceProxies ?? 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-1">Team</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-display tracking-tight">Members</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {members.length} member{members.length === 1 ? '' : 's'} you manage
            {members[0] && <> · {workspaceProfiles} profiles · {workspaceProxies} proxies in workspace</>}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setEditing({})} className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 hover:from-blue-400 hover:to-blue-500 transition-colors">
            <Plus className="w-3.5 h-3.5" />Invite member
          </button>
        )}
      </div>

      {error && <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12.5px] text-red-400">{error}</div>}

      {!loading && members.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {ROLES.map((role) => {
            const cfg = ROLE_CONFIG[role]; const Icon = cfg.icon;
            const count = members.filter((m) => m.role === role).length;
            return (
              <div key={role} className="flex items-center gap-3 rounded-xl p-4 animate-fade-up" style={{ background: `color-mix(in srgb, ${cfg.color} 8%, var(--card))`, border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)` }}>
                <div className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${cfg.color} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${cfg.color} 28%, transparent)` }}>
                  <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{cfg.label}</p>
                  <p className="text-xs text-muted-foreground">{count} member{count === 1 ? '' : 's'}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && members.length > 0 && (
        <div className="bg-elevated p-1 rounded-lg inline-flex gap-1 mb-5">
          {[{ id: 'members', label: 'Members', icon: Users }, { id: 'activity', label: 'Activity', icon: Activity }].map((t) => {
            const Icon = t.icon; const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${active ? 'bg-card text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />{t.label}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-20"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>
      ) : members.length === 0 ? (
        <div className="bg-card border border-border rounded-xl grid place-items-center py-16 text-center animate-fade-up">
          <Users className="w-7 h-7 text-muted-foreground mb-3" />
          <p className="text-[13px] text-foreground font-medium">No members yet</p>
          <p className="text-[12px] text-muted-foreground mt-1 mb-4">{canCreate ? 'Invite your first team member to start delegating work.' : 'You have no members under you yet.'}</p>
          {canCreate && <button onClick={() => setEditing({})} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white text-xs font-semibold shadow-lg shadow-blue-500/25"><Plus className="w-3.5 h-3.5" />Invite member</button>}
        </div>
      ) : tab === 'members' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {members.map((m) => {
            const cfg = ROLE_CONFIG[m.role] || ROLE_CONFIG.OPERATOR;
            const RoleIcon = cfg.icon;
            const color = m.color || '#6366f1';
            const perms = m.permissions || {};
            const pending = m.inviteStatus === 'pending';
            return (
              <button key={m.id} onClick={() => setEditing(m)} className="group text-left bg-card border border-border rounded-xl p-5 hover:border-border-strong transition-colors animate-fade-up">
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <span className="w-11 h-11 rounded-full grid place-items-center text-sm font-bold" style={{ background: color + '22', color, border: `1px solid ${color}33` }}>{m.initials}</span>
                    {!pending && m.status !== 'suspended' && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex w-3 h-3">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                        <span className="relative inline-flex w-3 h-3 rounded-full bg-emerald-500 border-2 border-card" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground truncate">{m.name}</span>
                      {m.isCurrent && <span className="text-[10px] text-primary shrink-0">You</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{m.email || 'No email'}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={roleBadgeStyle(m.role)}>
                    <RoleIcon className="w-3 h-3" />{ROLE_LABEL[m.role] || m.role}
                  </span>
                  {pending && <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"><Mail className="w-3 h-3" />Invite pending</span>}
                  {m.hasPassword && !pending && <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-secondary text-muted-foreground border border-border"><KeyRound className="w-3 h-3" />Login set</span>}
                  {m.status === 'suspended' && <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">Suspended</span>}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4 text-[11px]">
                  <div className="rounded-lg bg-elevated border border-border px-2.5 py-1.5"><span className="text-muted-foreground">Profiles</span><div className="font-mono text-foreground">{fmtLimit(m.ownedProfiles, perms.maxProfiles)}</div></div>
                  <div className="rounded-lg bg-elevated border border-border px-2.5 py-1.5"><span className="text-muted-foreground">Proxies</span><div className="font-mono text-foreground">{fmtLimit(m.ownedProxies, perms.maxProxies)}</div></div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{relTime(m.lastActiveAt)}</span>
                  {m.childCounts?.total > 0 && <span className="font-mono">{m.childCounts.total} sub-member{m.childCounts.total === 1 ? '' : 's'}</span>}
                </div>
              </button>
            );
          })}

          {canCreate && (
            <button onClick={() => setEditing({})} className="rounded-xl p-5 flex flex-col items-center justify-center gap-3 min-h-[160px] transition-colors animate-fade-up" style={{ background: 'color-mix(in srgb, #3b82f6 4%, transparent)', border: '1px dashed color-mix(in srgb, #3b82f6 28%, transparent)' }}>
              <span className="w-10 h-10 rounded-full grid place-items-center" style={{ background: 'color-mix(in srgb, #3b82f6 12%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}><Plus className="w-4 h-4 text-blue-400" /></span>
              <p className="text-xs font-medium text-blue-400">Invite team member</p>
            </button>
          )}
        </div>
      ) : (
        <TeamActivityFeed />
      )}

      {editing && <MemberModal member={editing} me={me} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function MemberModal({ member, me, onClose, onSaved }) {
  const isNew = !member.id;
  const allowed = creatableRoles(me);
  const granter = (me && me.permissions) || defaultPerms('OWNER');

  const [name, setName] = useState(member.name || '');
  const [email, setEmail] = useState(member.email || '');
  const [role, setRole] = useState(member.role || allowed[0] || 'OPERATOR');
  const [color, setColor] = useState(member.color || '#6366f1');
  const [instructions, setInstructions] = useState(member.instructions || '');
  const [suspended, setSuspended] = useState(member.status === 'suspended');
  const [perms, setPerms] = useState(member.permissions || defaultPerms(member.role || role));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [invite, setInvite] = useState(null); // { code, link, emailed }
  const [copied, setCopied] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';
  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary';

  // Keep limits sensible when the role changes for a new member.
  function pickRole(r) { setRole(r); if (isNew) setPerms(defaultPerms(r)); }

  function copy(text, key) {
    try { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch (e) { /* ignore */ }
  }

  async function save() {
    setErr('');
    if (!name.trim()) { setErr('Name is required.'); return; }
    setBusy(true);
    try {
      if (isNew) {
        const created = await softglazeApi.members.create({ name: name.trim(), email: email.trim() || undefined, role, color, permissions: perms });
        if (instructions.trim()) await softglazeApi.members.setInstructions(created.id, instructions.trim()).catch(() => {});
        if (created.inviteCode) { setInvite({ code: created.inviteCode, link: created.inviteLink, emailed: created.emailed }); setBusy(false); return; }
        onSaved();
      } else {
        await softglazeApi.members.update({ id: member.id, name: name.trim(), email: email.trim() || null, color, status: suspended ? 'suspended' : 'active' });
        await softglazeApi.members.updatePermissions(member.id, perms).catch(() => {});
        await softglazeApi.members.setInstructions(member.id, instructions.trim()).catch(() => {});
        onSaved();
      }
    } catch (e) { setErr(e.message || 'Could not save member.'); setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Remove ${member.name}? Their profiles are unassigned and their sub-members move up to you.`)) return;
    setBusy(true); setErr('');
    try { await softglazeApi.members.delete(member.id); onSaved(); }
    catch (e) { setErr(e.message || 'Could not remove member.'); setBusy(false); }
  }

  // Invite-code result screen.
  if (invite) {
    return (
      <Shell onClose={onSaved} title="Invitation created" icon={Mail}>
        <div className="p-6 space-y-4">
          <p className="text-[12.5px] text-muted-foreground">Share this code with <b className="text-foreground">{name}</b>. They open SoftGlaze Browser → “Have an invite code?”, enter it and set their password.</p>
          <div>
            <label className={labelCls}>Invite code</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-11 rounded-lg bg-input-background border border-border grid place-items-center font-mono text-lg tracking-widest text-foreground">{invite.code}</div>
              <button onClick={() => copy(invite.code, 'code')} className="h-11 px-3 rounded-lg bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[12px]">{copied === 'code' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}{copied === 'code' ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
          {invite.link && (
            <div>
              <label className={labelCls}>Invite link</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-10 rounded-lg bg-input-background border border-border flex items-center px-3 font-mono text-[12px] text-muted-foreground truncate">{invite.link}</div>
                <button onClick={() => copy(invite.link, 'link')} className="h-10 px-3 rounded-lg bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[12px]">{copied === 'link' ? <Check className="w-4 h-4 text-emerald-400" /> : <Link2 className="w-4 h-4" />}</button>
              </div>
            </div>
          )}
          <div className={`px-3 py-2 rounded-lg text-[12px] border ${invite.emailed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
            {invite.emailed ? `Emailed to ${email}.` : 'Email not sent (configure SMTP in Settings → Email). Share the code manually.'}
          </div>
        </div>
        <div className="flex justify-end px-6 py-4 border-t border-border">
          <button onClick={onSaved} className="h-9 px-5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12.5px] shadow-lg shadow-blue-500/25">Done</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title={isNew ? 'Invite member' : `Edit ${member.name}`} icon={Users}>
      <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Name</label><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus /></div>
          <div><label className={labelCls}>Email</label><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.com" /></div>
        </div>

        {isNew ? (
          <div>
            <label className={labelCls}>Role</label>
            {allowed.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">You're not allowed to create any sub-members.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {allowed.map((r) => {
                  const cfg = ROLE_CONFIG[r]; const Icon = cfg.icon; const active = role === r;
                  return (
                    <button key={r} onClick={() => pickRole(r)} className="flex items-start gap-2.5 p-3 rounded-lg text-left border transition-colors" style={active ? { borderColor: cfg.color, background: `color-mix(in srgb, ${cfg.color} 12%, transparent)` } : { borderColor: 'var(--border)', background: 'var(--input-background)' }}>
                      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: cfg.color }} />
                      <div>
                        <div className="text-[12.5px] font-semibold" style={{ color: active ? cfg.color : undefined }}>{ROLE_LABEL[r]}</div>
                        <div className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">{ROLE_DESC[r]}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className={labelCls}>Role</label>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium" style={roleBadgeStyle(member.role)}>{ROLE_LABEL[member.role] || member.role}</span>
          </div>
        )}

        <div>
          <label className={labelCls}>Color</label>
          <div className="flex gap-2">
            {COLORS.map((c) => <button key={c} onClick={() => setColor(c)} className="w-7 h-7 rounded-full transition-transform" style={{ background: c, transform: color === c ? 'scale(1.12)' : 'none', boxShadow: color === c ? `0 0 0 2px var(--color-card), 0 0 0 4px ${c}` : 'none' }} aria-label={c} />)}
          </div>
        </div>

        {member.inviteStatus === 'pending' && member.inviteCode && (
          <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-amber-400 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />Invite pending — code <b className="font-mono">{member.inviteCode}</b></span>
              <button onClick={() => copy(member.inviteCode, 'code')} className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1">{copied === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}Copy</button>
            </div>
          </div>
        )}

        {/* Permissions + limits */}
        {(isNew ? allowed.length > 0 : member.role !== 'OWNER') && (
          <PermissionEditor role={isNew ? role : member.role} value={perms} onChange={setPerms} granter={granter} />
        )}

        <div>
          <label className={`${labelCls} flex items-center gap-1.5`}><ClipboardList className="w-3.5 h-3.5" />Instructions <span className="text-muted-dark normal-case">(optional)</span></label>
          <textarea className={inputCls.replace('h-10', 'min-h-[64px] py-2 leading-snug resize-y')} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="What this member is responsible for…" maxLength={4000} />
        </div>

        {!isNew && (
          <label className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={suspended} onChange={(e) => setSuspended(e.target.checked)} className="accent-red-500" />
            Suspend this member (blocks sign-in)
          </label>
        )}

        {err && <p className="text-[12px] text-red-400">{err}</p>}
      </div>
      <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
        {!isNew && !member.isCurrent && <button onClick={remove} disabled={busy} className="h-9 px-3 rounded-lg text-[12.5px] text-red-400 hover:bg-red-500/10 flex items-center gap-1.5"><Trash2 className="w-4 h-4" />Remove</button>}
        {!isNew && member.inviteStatus !== 'pending' && canManageTeam(me) && (
          <button onClick={() => setShowAssign(true)} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary flex items-center gap-1.5"><FolderInput className="w-4 h-4" />Assign profiles</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">Cancel</button>
          <button onClick={save} disabled={busy} className="h-9 px-5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-500/25 hover:from-blue-400 hover:to-blue-500 transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (isNew ? 'Create invite' : 'Save')}
          </button>
        </div>
      </div>
      {showAssign && <AssignProfilesModal member={member} onClose={() => setShowAssign(false)} />}
    </Shell>
  );
}

// Handoff: pick which profiles are assigned to a member. Pre-checks profiles
// already assigned to them; on save, newly checked are assigned and previously-
// assigned-but-unchecked are unassigned (each writes an audit row in main).
function AssignProfilesModal({ member, onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [initial, setInitial] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, mem] = await Promise.all([
          softglazeApi.profiles.list({}),
          softglazeApi.members.list().catch(() => [])
        ]);
        const rows = Array.isArray(list) ? list : (list && (list.profiles || list.rows)) || [];
        if (!alive) return;
        setProfiles(rows);
        setMembers(Array.isArray(mem) ? mem : []);
        const mine = new Set(rows.filter((p) => Number(p.assignedMemberId) === Number(member.id)).map((p) => p.id));
        setSelected(new Set(mine));
        setInitial(new Set(mine));
      } catch (e) { if (alive) setErr(e.message || 'Could not load profiles.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [member.id]);

  const nameById = useMemo(() => new Map(members.map((m) => [Number(m.id), m.name])), [members]);
  const filtered = profiles.filter((p) => !search || String(p.title || '').toLowerCase().includes(search.toLowerCase()));

  function toggle(id) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function save() {
    setErr(''); setDone(''); setBusy(true);
    try {
      const toAssign = [...selected];
      const toUnassign = [...initial].filter((id) => !selected.has(id));
      if (toAssign.length) await softglazeApi.team.reassignProfiles({ profileIds: toAssign, memberId: member.id });
      if (toUnassign.length) await softglazeApi.team.reassignProfiles({ profileIds: toUnassign, memberId: null });
      setInitial(new Set(selected));
      setDone(`Updated — ${toAssign.length} assigned, ${toUnassign.length} unassigned.`);
    } catch (e) { setErr(e.message || 'Could not reassign profiles.'); }
    finally { setBusy(false); }
  }

  return (
    <Shell onClose={onClose} title={`Assign profiles · ${member.name}`} icon={FolderInput}>
      <div className="p-6 space-y-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search profiles" className="w-full h-9 bg-input-background border border-border rounded-lg pl-8 pr-3 text-[12.5px] text-foreground outline-none focus:border-primary" />
        </div>
        <div className="rounded-lg border border-border bg-elevated/40 max-h-[44vh] overflow-y-auto divide-y divide-border/60">
          {loading ? (
            <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">No profiles found.</div>
          ) : filtered.map((p) => {
            const other = p.assignedMemberId != null && Number(p.assignedMemberId) !== Number(member.id);
            return (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-secondary/50">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-blue-500" />
                <span className="text-[12.5px] text-foreground truncate flex-1">{p.title}</span>
                {other && <span className="text-[10.5px] text-muted-foreground shrink-0">{nameById.get(Number(p.assignedMemberId)) || `member #${p.assignedMemberId}`}</span>}
                <span className="text-[10.5px] text-muted-foreground/70 shrink-0">#{p.id}</span>
              </label>
            );
          })}
        </div>
        {err && <p className="text-[12px] text-red-400">{err}</p>}
        {done && <p className="text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{done}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
        <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">Close</button>
        <button onClick={save} disabled={busy || loading} className="h-9 px-5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-500/25">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save assignment'}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose, title, icon: Icon }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onMouseDown={onClose}>
      <div className="w-[480px] bg-card border border-border rounded-2xl shadow-2xl shadow-black/50 animate-scale-in overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: 'color-mix(in srgb, #3b82f6 14%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}><Icon className="w-4 h-4 text-blue-400" /></span>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Limits + child caps + create flags + feature toggles, clamped to the granter.
function PermissionEditor({ role, value, onChange, granter }) {
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';
  const set = (patch) => onChange({ ...value, ...patch });
  const setFeature = (k, on) => onChange({ ...value, features: { ...(value.features || {}), [k]: on } });

  const NumLimit = ({ k, label }) => {
    const max = granter ? granter[k] : -1;
    const unlimited = value[k] === -1;
    const gUnlimited = max === -1 || max == null;
    return (
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">{label}{!gUnlimited && <span className="text-muted-dark"> (max {max})</span>}</label>
        <div className="flex items-center gap-2">
          <input type="number" min={0} disabled={unlimited} value={unlimited ? '' : (value[k] ?? 0)} onChange={(e) => set({ [k]: Math.max(0, Number(e.target.value) || 0) })} placeholder={unlimited ? '∞' : '0'} className="w-full h-9 bg-input-background border border-border rounded-lg px-2.5 text-[12.5px] text-foreground outline-none focus:border-primary disabled:opacity-50" />
          {gUnlimited && (
            <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground cursor-pointer shrink-0">
              <input type="checkbox" checked={unlimited} onChange={(e) => set({ [k]: e.target.checked ? -1 : 0 })} className="accent-blue-500" />∞
            </label>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-elevated/50 p-4 space-y-4">
      <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /><span className="text-[12px] font-semibold text-foreground">Permissions & limits</span></div>

      <div>
        <label className={labelCls}>Resource limits</label>
        <div className="grid grid-cols-3 gap-2">
          <NumLimit k="maxProfiles" label="Profiles" />
          <NumLimit k="maxProxies" label="Proxies" />
          <NumLimit k="maxBrowsers" label="Browsers" />
        </div>
      </div>

      {(CHILD_CAPS[role] || []).length > 0 && (
        <div>
          <label className={labelCls}>Sub-member caps</label>
          <div className="grid grid-cols-3 gap-2">
            {(CHILD_CAPS[role] || []).map(([k, lbl]) => <NumLimit key={k} k={k} label={lbl} />)}
          </div>
          <div className="mt-2 space-y-1.5">
            {(CREATE_FLAGS[role] || []).map(([flag, lbl]) => {
              const granterOk = !granter || granter[flag];
              return (
                <label key={flag} className={`flex items-center gap-2 text-[12px] ${granterOk ? 'text-muted-foreground cursor-pointer' : 'text-muted-dark cursor-not-allowed'}`}>
                  <input type="checkbox" disabled={!granterOk} checked={Boolean(value[flag]) && granterOk} onChange={(e) => set({ [flag]: e.target.checked })} className="accent-blue-500" />
                  Can invite {lbl}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>Visible features</label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {FEATURES.map(([k, lbl]) => {
            const granterOk = !granter || !granter.features || granter.features[k] !== false;
            return (
              <label key={k} className={`flex items-center gap-2 text-[12px] ${granterOk ? 'text-muted-foreground cursor-pointer' : 'text-muted-dark cursor-not-allowed'}`}>
                <input type="checkbox" disabled={!granterOk} checked={(value.features || {})[k] !== false && granterOk} onChange={(e) => setFeature(k, e.target.checked)} className="accent-blue-500" />
                {lbl}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function actionLabel(a) {
  const map = { launch: 'launched', stop: 'stopped', create: 'created', update: 'edited', delete: 'deleted', restore: 'restored', import: 'imported', assign: 'assigned', reassign: 'reassigned', 'parallel-run': 'parallel run', 'macro-run': 'macro run' };
  return map[String(a || '').toLowerCase()] || a;
}
const ACTION_COLORS = { launched: '#10b981', stopped: '#ef4444', created: '#3b82f6', edited: '#8b5cf6', deleted: '#ef4444', restored: '#10b981', imported: '#f59e0b', assigned: '#06b6d4', reassigned: '#06b6d4' };
function feedTime(iso) {
  if (!iso) return '';
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function TeamActivityFeed() {
  const [rows, setRows] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [fMember, setFMember] = useState('');
  const [fAction, setFAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, mem] = await Promise.all([
          softglazeApi.team.activity(200),
          softglazeApi.members.list().catch(() => [])
        ]);
        if (!alive) return;
        setRows(Array.isArray(r) ? r : []);
        setMembers(Array.isArray(mem) ? mem : []);
      } catch (e) { if (alive) setErr(e.message || ''); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  // Distinct actions present, plus the common set, for the dropdown.
  const actionOptions = useMemo(() => {
    const base = ['launch', 'stop', 'create', 'update', 'delete', 'restore', 'import', 'assign', 'reassign'];
    return [...new Set([...base, ...rows.map((r) => r.action)])].filter(Boolean);
  }, [rows]);

  const inRange = (iso) => {
    if (!iso) return true;
    const t = new Date(iso).getTime();
    if (from) { const g = new Date(from).getTime(); if (Number.isFinite(g) && t < g) return false; }
    if (to) { const l = new Date(to).getTime() + 86400000 - 1; if (Number.isFinite(l) && t > l) return false; }
    return true;
  };
  const visible = rows.filter((r) =>
    (!fMember || String(r.memberId) === String(fMember)) &&
    (!fAction || r.action === fAction) &&
    inRange(r.createdAt)
  );

  async function doExport(format) {
    setErr(''); setNotice(''); setExporting(format);
    try {
      const res = await softglazeApi.team.exportActivity({
        format,
        memberId: fMember || undefined,
        action: fAction || undefined,
        from: from || undefined,
        to: to || undefined
      });
      if (res && res.cancelled) return;
      if (res && res.ok) setNotice(`Exported ${res.count} row(s) → ${res.path}`);
    } catch (e) { setErr(e.message || 'Could not export the activity log.'); }
    finally { setExporting(''); }
  }

  const selCls = 'h-8 rounded-lg border border-border bg-input-background px-2 text-[12px] text-foreground outline-none focus:border-primary';

  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-fade-up">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 16%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 28%, transparent)' }}><Activity className="w-3.5 h-3.5 text-blue-400" /></span>
        <div className="mr-auto"><h2 className="text-sm font-semibold text-foreground">Team activity</h2><p className="text-xs text-muted-foreground">who did what, on this workspace</p></div>
        <button onClick={() => doExport('csv')} disabled={!!exporting} className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
          {exporting === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} CSV
        </button>
        <button onClick={() => doExport('json')} disabled={!!exporting} className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
          {exporting === 'json' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} JSON
        </button>
      </div>

      {/* Filters (apply to the view below and to the export) */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={fMember} onChange={(e) => setFMember(e.target.value)} className={selCls} title="Filter by member">
          <option value="">All members</option>
          {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
        <select value={fAction} onChange={(e) => setFAction(e.target.value)} className={selCls} title="Filter by action">
          <option value="">All actions</option>
          {actionOptions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selCls} title="From date" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selCls} title="To date" />
        {(fMember || fAction || from || to) && (
          <button onClick={() => { setFMember(''); setFAction(''); setFrom(''); setTo(''); }} className="text-[11.5px] text-muted-foreground hover:text-foreground">Clear</button>
        )}
      </div>

      {notice && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[12px] text-emerald-400 break-all">{notice}</div>}
      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      <div className="-mx-5 -mb-5 border-t border-border">
        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-[12.5px] text-muted-foreground">{rows.length === 0 ? 'No activity recorded yet.' : 'No activity matches these filters.'}</div>
        ) : visible.map((r) => {
          const action = actionLabel(r.action);
          const ac = ACTION_COLORS[String(action).toLowerCase()] || '#8b94a7';
          return (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3 text-[12.5px] border-b border-border hover:bg-secondary/50 transition-colors last:border-b-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ac }} />
              <span className="text-foreground font-semibold">{r.memberName}</span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${ac} 14%, transparent)`, color: ac }}>{action}</span>
              {r.profileTitle && <span className="text-muted-foreground truncate">{r.profileTitle}</span>}
              {r.detail && <span className="text-muted-foreground truncate hidden md:inline">· {r.detail}</span>}
              <span className="ml-auto text-[11px] text-muted-foreground font-mono shrink-0">{feedTime(r.createdAt)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
