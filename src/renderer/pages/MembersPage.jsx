import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Users, X, Loader2, Trash2, KeyRound, Activity, ClipboardList,
  Crown, UserCog, UserCheck, User, Clock, Copy, Check, Mail, Link2, ShieldCheck,
  Download, FolderInput, Search, Lock, CreditCard, RotateCcw, Layers,
  Sparkles, Settings2, Ban, AlertTriangle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { useDialog } from '@/lib/useDialog.js';

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

// Role ranks (mirror of permissions.js) — used to show only the action toggles a
// member's role can actually perform.
const ROLE_RANK = { OPERATOR: 1, MANAGER: 2, ADMIN: 3, OWNER: 4, SUPER_ADMIN: 5 };

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
function relTime(iso, t) {
  if (!iso) return t('time.neverActive');
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return t('time.activeJustNow');
  if (s < 3600) return t('time.activeMinutes', { count: Math.floor(s / 60) });
  if (s < 86400) return t('time.activeHours', { count: Math.floor(s / 3600) });
  return t('time.activeDays', { count: Math.floor(s / 86400) });
}
function fmtLimit(used, max) {
  if (max === -1 || max == null) return `${used || 0} / ∞`;
  return `${used || 0} / ${max}`;
}

export default function MembersPage() {
  const { t } = useTranslation('members');
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
    } catch (e) { setError(e.message || t('errors.loadMembers')); }
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-1">{t('header.eyebrow')}</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground font-display tracking-tight">{t('header.title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t('header.manageCount', { count: members.length })}
            {members[0] && <> · {t('header.workspaceStats', { profiles: workspaceProfiles, proxies: workspaceProxies })}</>}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setEditing({})} className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 hover:from-blue-400 hover:to-blue-500 transition-colors">
            <Plus className="w-3.5 h-3.5" />{t('actions.inviteMember')}
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
                  <p className="text-sm font-semibold text-foreground truncate">{t(`roles.${role}`)}</p>
                  <p className="text-xs text-muted-foreground">{t('memberCount', { count })}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && members.length > 0 && (
        <div className="bg-elevated p-1 rounded-lg inline-flex gap-1 mb-5">
          {[{ id: 'members', label: t('tabs.members'), icon: Users }, { id: 'activity', label: t('tabs.activity'), icon: Activity },
            ...(me && me.role === 'SUPER_ADMIN' ? [{ id: 'licenses', label: t('tabs.licenses'), icon: CreditCard }] : [])].map((tab2) => {
            const Icon = tab2.icon; const active = tab === tab2.id;
            return (
              <button key={tab2.id} onClick={() => setTab(tab2.id)} className={`px-4 py-2 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${active ? 'bg-card text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />{tab2.label}
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
          <p className="text-[13px] text-foreground font-medium">{t('empty.title')}</p>
          <p className="text-[12px] text-muted-foreground mt-1 mb-4">{canCreate ? t('empty.canCreate') : t('empty.noMembers')}</p>
          {canCreate && <button onClick={() => setEditing({})} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white text-xs font-semibold shadow-lg shadow-blue-500/25"><Plus className="w-3.5 h-3.5" />{t('actions.inviteMember')}</button>}
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
                      {m.isCurrent && <span className="text-[10px] text-primary shrink-0">{t('member.you')}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{m.email || t('member.noEmail')}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={roleBadgeStyle(m.role)}>
                    <RoleIcon className="w-3 h-3" />{ROLE_LABEL[m.role] ? t(`roles.${m.role}`) : m.role}
                  </span>
                  {pending && <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"><Mail className="w-3 h-3" />{t('member.invitePending')}</span>}
                  {m.hasPassword && !pending && <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-secondary text-muted-foreground border border-border"><KeyRound className="w-3 h-3" />{t('member.loginSet')}</span>}
                  {m.status === 'suspended' && <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">{t('status.suspended')}</span>}
                  {m.status === 'banned' && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/15 text-red-400 border border-red-500/30"><Lock className="w-3 h-3" />{t('status.banned')}</span>}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4 text-[11px]">
                  <div className="rounded-lg bg-elevated border border-border px-2.5 py-1.5"><span className="text-muted-foreground">{t('labels.profiles')}</span><div className="font-mono text-foreground">{fmtLimit(m.ownedProfiles, perms.maxProfiles)}</div></div>
                  <div className="rounded-lg bg-elevated border border-border px-2.5 py-1.5"><span className="text-muted-foreground">{t('labels.proxies')}</span><div className="font-mono text-foreground">{fmtLimit(m.ownedProxies, perms.maxProxies)}</div></div>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{relTime(m.lastActiveAt, t)}</span>
                  {m.childCounts?.total > 0 && <span className="font-mono">{t('member.subMembers', { count: m.childCounts.total })}</span>}
                </div>
              </button>
            );
          })}

          {canCreate && (
            <button onClick={() => setEditing({})} className="rounded-xl p-5 flex flex-col items-center justify-center gap-3 min-h-[160px] transition-colors animate-fade-up" style={{ background: 'color-mix(in srgb, #3b82f6 4%, transparent)', border: '1px dashed color-mix(in srgb, #3b82f6 28%, transparent)' }}>
              <span className="w-10 h-10 rounded-full grid place-items-center" style={{ background: 'color-mix(in srgb, #3b82f6 12%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 24%, transparent)' }}><Plus className="w-4 h-4 text-blue-400" /></span>
              <p className="text-xs font-medium text-blue-400">{t('actions.inviteTeamMember')}</p>
            </button>
          )}
        </div>
      ) : tab === 'licenses' ? (
        <SuperAdminLicensePanel />
      ) : (
        <TeamActivityFeed />
      )}

      {editing && <MemberModal member={editing} me={me} members={members} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// Super-Admin only: per-owner-tree license console. Grant / extend / reset a
// license and block / unblock the owner. Every action is re-enforced in main.
const LIC_TONE = {
  paid: { c: '#10b981', label: 'Paid' },
  trialing: { c: '#3b82f6', label: 'Trial' },
  grace: { c: '#f59e0b', label: 'Grace' },
  banned: { c: '#ef4444', label: 'Banned' }
};

function SuperAdminLicensePanel() {
  const { t } = useTranslation('members');
  const [rows, setRows] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null); // null | row
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const [owners, pl] = await Promise.all([
        softglazeApi.license.listOwners(),
        softglazeApi.billing.plansAdmin().catch(() => ({ plans: [] }))
      ]);
      setRows(owners);
      setPlans(Array.isArray(pl?.plans) ? pl.plans : []);
    }
    catch (e) { setErr(e.message || t('license.errors.load')); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(ownerId, fn) {
    setBusyId(ownerId); setErr('');
    try { await fn(); await load(); }
    catch (e) { setErr(e.message || t('license.errors.action')); }
    finally { setBusyId(null); }
  }
  function terminate(r) {
    if (!window.confirm(t('license.confirm.terminate', { name: r.ownerName }))) return;
    act(r.ownerId, () => softglazeApi.license.terminate({ ownerId: r.ownerId }));
  }

  if (loading) return <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {err && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12.5px] text-red-400">{err}</div>}
      <p className="text-[12px] text-muted-foreground">{t('license.intro')}</p>
      {rows.length === 0 && <div className="bg-card border border-border rounded-xl py-12 text-center text-[13px] text-muted-foreground">{t('license.noOwners')}</div>}
      {rows.map((r) => {
        const lic = r.license || {};
        const tone = LIC_TONE[lic.state] || LIC_TONE.trialing;
        const busy = busyId === r.ownerId;
        const banned = r.ownerStatus === 'banned' || lic.isBanned;
        return (
          <div key={r.ownerId} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm font-semibold text-foreground truncate">{r.ownerName}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${tone.c} 14%, transparent)`, color: tone.c, border: `1px solid color-mix(in srgb, ${tone.c} 28%, transparent)` }}>{t(`license.state.${LIC_TONE[lic.state] ? lic.state : 'trialing'}`)}</span>
                  {lic.tier && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{lic.tier}</span>}
                </div>
                <div className="text-[11.5px] text-muted-foreground mt-0.5">{r.ownerEmail || t('member.noEmail')}</div>
                <div className="text-[11.5px] text-muted-foreground mt-1">
                  {lic.isTrial && t('license.detail.trial', { count: lic.daysLeftTrial })}
                  {lic.isGrace && t('license.detail.grace', { count: lic.daysLeftGrace })}
                  {lic.isPaid && t('license.detail.paid', { date: lic.endsAt ? new Date(lic.endsAt).toLocaleDateString() : '—' })}
                  {lic.isBanned && (r.banReason || t('status.banned'))}
                  {lic.clockTamper && <span className="ml-2 text-amber-400">{t('license.detail.clockAnomaly')}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button onClick={() => act(r.ownerId, () => softglazeApi.license.grant({ ownerId: r.ownerId, months: 1, tier: 'pro' }))} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 disabled:opacity-60"><CreditCard className="w-3.5 h-3.5" />{t('license.actions.grantMonth')}</button>
              <button onClick={() => act(r.ownerId, () => softglazeApi.license.extend({ ownerId: r.ownerId, days: 7 }))} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-secondary text-foreground border border-border hover:bg-secondary/70 disabled:opacity-60"><Clock className="w-3.5 h-3.5" />{t('license.actions.extend7')}</button>
              <button onClick={() => act(r.ownerId, () => softglazeApi.license.startTrial({ ownerId: r.ownerId }))} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/25 hover:bg-blue-500/20 disabled:opacity-60"><Sparkles className="w-3.5 h-3.5" />{t('license.actions.startTrial')}</button>
              <button onClick={() => act(r.ownerId, () => softglazeApi.license.reset({ ownerId: r.ownerId }))} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-secondary text-foreground border border-border hover:bg-secondary/70 disabled:opacity-60"><RotateCcw className="w-3.5 h-3.5" />{t('license.actions.resetTrial')}</button>
              <button onClick={() => setEditing(r)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-secondary text-foreground border border-border hover:bg-secondary/70 disabled:opacity-60"><Settings2 className="w-3.5 h-3.5" />{t('license.actions.edit')}</button>
              <button onClick={() => terminate(r)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/25 hover:bg-orange-500/20 disabled:opacity-60"><Ban className="w-3.5 h-3.5" />{t('license.actions.terminate')}</button>
              {banned ? (
                <button onClick={() => act(r.ownerId, () => softglazeApi.members.setStatus({ id: r.ownerId, status: 'active' }))} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 disabled:opacity-60"><ShieldCheck className="w-3.5 h-3.5" />{t('license.actions.unblock')}</button>
              ) : (
                <button onClick={() => act(r.ownerId, () => softglazeApi.members.setStatus({ id: r.ownerId, status: 'banned', reason: 'Blocked by Super Admin.' }))} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 disabled:opacity-60"><Lock className="w-3.5 h-3.5" />{t('license.actions.block')}</button>
              )}
              {busy && <Loader2 className="w-4 h-4 animate-spin text-muted" />}
            </div>
          </div>
        );
      })}
      {editing && <LicenseEditModal row={editing} plans={plans} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// Full per-owner license editor: set type/tier/exact expiry, grant a chosen plan,
// start the free trial or terminate — every action re-enforced in main.
function LicenseEditModal({ row, plans, onClose, onSaved }) {
  const { t } = useTranslation('members');
  const lic = row.license || {};
  const toDateInput = (iso) => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; return d.toISOString().slice(0, 10); };

  const [type, setType] = useState(lic.isPaid ? 'paid' : 'trial');
  const [tier, setTier] = useState(lic.tier === 'enterprise' ? 'enterprise' : 'pro');
  const [endsAt, setEndsAt] = useState(toDateInput(lic.endsAt));
  const paidPlans = plans.filter((p) => p.kind !== 'trial');
  const [planId, setPlanId] = useState(paidPlans[0] ? paidPlans[0].id : '');
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const { dialogRef } = useDialog({ onClose, closeOnEscape: !busy });

  async function run(key, fn) {
    setBusy(key); setErr('');
    try { await fn(); onSaved(); }
    catch (e) { setErr(e.message || t('license.errors.action')); setBusy(''); }
  }

  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary';
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5';

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('license.editTitle', { name: row.ownerName })} tabIndex={-1} className="w-full max-w-lg rounded-xl bg-card border border-border shadow-2xl max-h-[90vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
          <div className="flex items-center gap-2"><Crown className="w-4 h-4 text-amber-400" /><h3 className="text-sm font-semibold text-foreground">{t('license.editTitle', { name: row.ownerName })}</h3></div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Set exact state */}
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{t('license.setState')}</p>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>{t('license.fields.type')}</label>
                <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="trial">{t('license.type.trial')}</option><option value="paid">{t('license.type.paid')}</option>
                </select>
              </div>
              <div><label className={labelCls}>{t('license.fields.tier')}</label>
                <select className={inputCls} value={tier} onChange={(e) => setTier(e.target.value)}>
                  <option value="pro">{t('license.tier.pro')}</option><option value="enterprise">{t('license.tier.enterprise')}</option>
                </select>
              </div>
              <div><label className={labelCls}>{t('license.fields.expiry')}</label><input type="date" className={inputCls} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
            </div>
            <button onClick={() => run('save', () => softglazeApi.license.edit({ ownerId: row.ownerId, type, tier, endsAt: endsAt || null }))} disabled={busy === 'save'} className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-blue-500 to-blue-600 disabled:opacity-60">{busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('license.actions.saveState')}</button>
          </div>

          {/* Grant a plan */}
          {paidPlans.length > 0 && (
            <div className="border-t border-border pt-4">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{t('license.grantPlan')}</p>
              <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                <div><label className={labelCls}>{t('license.fields.plan')}</label>
                  <select className={inputCls} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    {paidPlans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.tier}</option>)}
                  </select>
                </div>
                <div className="w-24"><label className={labelCls}>{t('license.fields.months')}</label><input className={inputCls} value={months} onChange={(e) => setMonths(e.target.value)} /></div>
              </div>
              <button onClick={() => run('grant', () => softglazeApi.billing.assignPlan({ ownerId: row.ownerId, planId, months: Number(months) || 1 }))} disabled={busy === 'grant'} className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-emerald-600 disabled:opacity-60">{busy === 'grant' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} {t('license.actions.grantPlan')}</button>
            </div>
          )}

          {/* Lifecycle */}
          <div className="border-t border-border pt-4">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{t('license.lifecycle')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => run('trial', () => softglazeApi.license.startTrial({ ownerId: row.ownerId }))} disabled={busy === 'trial'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/25 hover:bg-blue-500/20 disabled:opacity-60">{busy === 'trial' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} {t('license.actions.startFreeTrial')}</button>
              <button onClick={() => { if (window.confirm(t('license.confirm.terminateModal'))) run('term', () => softglazeApi.license.terminate({ ownerId: row.ownerId })); }} disabled={busy === 'term'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/25 hover:bg-orange-500/20 disabled:opacity-60">{busy === 'term' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} {t('license.actions.terminateNow')}</button>
            </div>
          </div>

          {err && <p className="text-[12px] text-red-400">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function MemberModal({ member, me, members = [], onClose, onSaved }) {
  const { t } = useTranslation('members');
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
  const [showDelete, setShowDelete] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  // Change account status (suspend / ban / unban) — re-enforced in main. Owners can
  // only be blocked/unblocked by the Super Admin (the backend enforces this).
  async function changeStatus(status, reason) {
    setStatusBusy(true); setErr('');
    try { await softglazeApi.members.setStatus({ id: member.id, status, reason }); onSaved(); }
    catch (e) { setErr(e.message || t('errors.changeStatus')); setStatusBusy(false); }
  }

  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';
  const inputCls = 'w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary';

  // Keep limits sensible when the role changes for a new member.
  function pickRole(r) { setRole(r); if (isNew) setPerms(defaultPerms(r)); }

  function copy(text, key) {
    try { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch (e) { /* ignore */ }
  }

  async function save() {
    setErr('');
    if (!name.trim()) { setErr(t('errors.nameRequired')); return; }
    setBusy(true);
    try {
      if (isNew) {
        const created = await softglazeApi.members.create({ name: name.trim(), email: email.trim() || undefined, role, color, permissions: perms });
        if (instructions.trim()) await softglazeApi.members.setInstructions(created.id, instructions.trim()).catch(() => {});
        if (created.inviteCode) { setInvite({ code: created.inviteCode, link: created.inviteLink, emailed: created.emailed }); setBusy(false); return; }
        onSaved();
      } else {
        await softglazeApi.members.update({ id: member.id, name: name.trim(), email: email.trim() || null, color, ...(member.status === 'banned' ? {} : { status: suspended ? 'suspended' : 'active' }) });
        await softglazeApi.members.updatePermissions(member.id, perms).catch(() => {});
        await softglazeApi.members.setInstructions(member.id, instructions.trim()).catch(() => {});
        onSaved();
      }
    } catch (e) { setErr(e.message || t('errors.saveMember')); setBusy(false); }
  }

  // Reset this member's limits + features to their role's built-in defaults.
  async function revertPerms() {
    if (!window.confirm(t('confirm.revertPerms', { name: member.name }))) return;
    setBusy(true); setErr('');
    try { const updated = await softglazeApi.members.resetPermissions(member.id); setPerms(updated.permissions); }
    catch (e) { setErr(e.message || t('errors.resetPerms')); }
    finally { setBusy(false); }
  }

  // Invite-code result screen.
  if (invite) {
    return (
      <Shell onClose={onSaved} title={t('invite.createdTitle')} icon={Mail}>
        <div className="p-6 space-y-4">
          <p className="text-[12.5px] text-muted-foreground">{t('invite.sharePrefix')}<b className="text-foreground">{name}</b>{t('invite.shareSuffix')}</p>
          <div>
            <label className={labelCls}>{t('invite.code')}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-11 rounded-lg bg-input-background border border-border grid place-items-center font-mono text-lg tracking-widest text-foreground">{invite.code}</div>
              <button onClick={() => copy(invite.code, 'code')} className="h-11 px-3 rounded-lg bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[12px]">{copied === 'code' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}{copied === 'code' ? t('actions.copied') : t('actions.copy')}</button>
            </div>
          </div>
          {invite.link && (
            <div>
              <label className={labelCls}>{t('invite.link')}</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-10 rounded-lg bg-input-background border border-border flex items-center px-3 font-mono text-[12px] text-muted-foreground truncate">{invite.link}</div>
                <button onClick={() => copy(invite.link, 'link')} className="h-10 px-3 rounded-lg bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[12px]">{copied === 'link' ? <Check className="w-4 h-4 text-emerald-400" /> : <Link2 className="w-4 h-4" />}</button>
              </div>
            </div>
          )}
          <div className={`px-3 py-2 rounded-lg text-[12px] border ${invite.emailed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
            {invite.emailed ? t('invite.emailedTo', { email }) : t('invite.emailNotSent')}
          </div>
        </div>
        <div className="flex justify-end px-6 py-4 border-t border-border">
          <button onClick={onSaved} className="h-9 px-5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12.5px] shadow-lg shadow-blue-500/25">{t('actions.done')}</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title={isNew ? t('modal.inviteTitle') : t('modal.editTitle', { name: member.name })} icon={Users}>
      <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>{t('fields.name')}</label><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('fields.namePlaceholder')} autoFocus /></div>
          <div><label className={labelCls}>{t('fields.email')}</label><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.com" /></div>
        </div>

        {isNew ? (
          <div>
            <label className={labelCls}>{t('fields.role')}</label>
            {allowed.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">{t('modal.noCreatableRoles')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {allowed.map((r) => {
                  const cfg = ROLE_CONFIG[r]; const Icon = cfg.icon; const active = role === r;
                  return (
                    <button key={r} onClick={() => pickRole(r)} className="flex items-start gap-2.5 p-3 rounded-lg text-left border transition-colors" style={active ? { borderColor: cfg.color, background: `color-mix(in srgb, ${cfg.color} 12%, transparent)` } : { borderColor: 'var(--border)', background: 'var(--input-background)' }}>
                      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: cfg.color }} />
                      <div>
                        <div className="text-[12.5px] font-semibold" style={{ color: active ? cfg.color : undefined }}>{t(`roles.${r}`)}</div>
                        <div className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">{t(`roleDesc.${r}`)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className={labelCls}>{t('fields.role')}</label>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium" style={roleBadgeStyle(member.role)}>{ROLE_LABEL[member.role] ? t(`roles.${member.role}`) : member.role}</span>
          </div>
        )}

        <div>
          <label className={labelCls}>{t('fields.color')}</label>
          <div className="flex gap-2">
            {COLORS.map((c) => <button key={c} onClick={() => setColor(c)} className="w-7 h-7 rounded-full transition-transform" style={{ background: c, transform: color === c ? 'scale(1.12)' : 'none', boxShadow: color === c ? `0 0 0 2px var(--color-card), 0 0 0 4px ${c}` : 'none' }} aria-label={c} />)}
          </div>
        </div>

        {member.inviteStatus === 'pending' && member.inviteCode && (
          <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-amber-400 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{t('modal.invitePendingCode')} <b className="font-mono">{member.inviteCode}</b></span>
              <button onClick={() => copy(member.inviteCode, 'code')} className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1">{copied === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{t('actions.copy')}</button>
            </div>
          </div>
        )}

        {/* Allocation rollup — how much of this member's quota is handed to their team */}
        {!isNew && member.allocation && member.allocation.childCount > 0 && (
          <div className="rounded-xl border border-border bg-elevated/40 p-3 space-y-1.5">
            <div className="flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-primary" /><span className="text-[12px] font-semibold text-foreground">{t('alloc.heading', { count: member.allocation.childCount })}</span></div>
            <AllocRow label={t('labels.profiles')} roll={member.allocation.profiles} t={t} />
            <AllocRow label={t('labels.proxies')} roll={member.allocation.proxies} t={t} />
          </div>
        )}

        {/* Permissions + limits — editable for sub-members, and for OWNERs when a Super Admin is editing */}
        {(isNew ? allowed.length > 0 : (member.role !== 'OWNER' || me?.role === 'SUPER_ADMIN')) && (
          <div className="space-y-2">
            <PermissionEditor role={isNew ? role : member.role} value={perms} onChange={setPerms} granter={granter} />
            {!isNew && (
              <button onClick={revertPerms} disabled={busy} className="text-[11.5px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 disabled:opacity-50">
                <RotateCcw className="w-3.5 h-3.5" /> {t('perms.revertDefaults')}
              </button>
            )}
          </div>
        )}

        <div>
          <label className={`${labelCls} flex items-center gap-1.5`}><ClipboardList className="w-3.5 h-3.5" />{t('fields.instructions')} <span className="text-muted-dark normal-case">{t('fields.optional')}</span></label>
          <textarea className={inputCls.replace('h-10', 'min-h-[64px] py-2 leading-snug resize-y')} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t('fields.instructionsPlaceholder')} maxLength={4000} />
        </div>

        {!isNew && (
          <div className="rounded-lg border border-border bg-elevated/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{t('accountStatus.title')}</span>
              {member.status === 'banned'
                ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/15 text-red-400 border border-red-500/30"><Lock className="w-3 h-3" />{t('status.banned')}</span>
                : member.status === 'suspended'
                  ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">{t('status.suspended')}</span>
                  : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{t('status.active')}</span>}
            </div>
            {member.status === 'banned' ? (
              <>
                {member.banReason && <p className="text-[11.5px] text-red-400/90">{t('accountStatus.reason', { reason: member.banReason })}</p>}
                <button type="button" onClick={() => changeStatus('active')} disabled={statusBusy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 disabled:opacity-60">
                  {statusBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} {t('accountStatus.unban')}
                </button>
                <p className="text-[11px] text-muted-foreground">{t('accountStatus.banHint')}</p>
              </>
            ) : (
              <>
                <label className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={suspended} onChange={(e) => setSuspended(e.target.checked)} className="accent-red-500" />
                  {t('accountStatus.suspendToggle')}
                </label>
                <button type="button" onClick={() => changeStatus('banned', 'Blocked by administrator.')} disabled={statusBusy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 disabled:opacity-60">
                  {statusBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />} {t('accountStatus.ban')}
                </button>
              </>
            )}
          </div>
        )}

        {err && <p className="text-[12px] text-red-400">{err}</p>}
      </div>
      <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
        {!isNew && !member.isCurrent && <button onClick={() => setShowDelete(true)} disabled={busy} className="h-9 px-3 rounded-lg text-[12.5px] text-red-400 hover:bg-red-500/10 flex items-center gap-1.5"><Trash2 className="w-4 h-4" />{t('actions.remove')}</button>}
        {!isNew && member.inviteStatus !== 'pending' && canManageTeam(me) && (
          <button onClick={() => setShowAssign(true)} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary flex items-center gap-1.5"><FolderInput className="w-4 h-4" />{t('actions.assignProfiles')}</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">{t('actions.cancel')}</button>
          <button onClick={save} disabled={busy} className="h-9 px-5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-500/25 hover:from-blue-400 hover:to-blue-500 transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (isNew ? t('actions.createInvite') : t('actions.save'))}
          </button>
        </div>
      </div>
      {showAssign && <AssignProfilesModal member={member} onClose={() => setShowAssign(false)} />}
      {showDelete && <DeleteMemberModal member={member} members={members} onClose={() => setShowDelete(false)} onDeleted={onSaved} />}
    </Shell>
  );
}

// Delete a member with an explicit choice for their data (Profiles / Proxies /
// ProxyGroups): reassign to the actor, reassign to another member, or delete it
// all (profiles → Trash, proxies/groups removed). Backend re-enforces every guard.
function DeleteMemberModal({ member, members = [], onClose, onDeleted }) {
  const { t } = useTranslation('members');
  const pickable = (members || []).filter((m) => m.id !== member.id && m.inviteStatus !== 'pending');
  const [action, setAction] = useState('reassign-me'); // 'reassign-me' | 'reassign-other' | 'delete'
  const [targetId, setTargetId] = useState(pickable[0]?.id != null ? String(pickable[0].id) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const profiles = member.ownedProfiles ?? 0;
  const proxies = member.ownedProxies ?? 0;

  const OPTIONS = [
    { id: 'reassign-me', label: t('delete.options.reassignMe.label'), desc: t('delete.options.reassignMe.desc') },
    { id: 'reassign-other', label: t('delete.options.reassignOther.label'), desc: t('delete.options.reassignOther.desc') },
    { id: 'delete', label: t('delete.options.delete.label'), desc: t('delete.options.delete.desc') }
  ];

  async function confirm() {
    setBusy(true); setErr('');
    try {
      let opts;
      if (action === 'delete') opts = { dataAction: 'delete' };
      else if (action === 'reassign-other') {
        if (!targetId) { setErr(t('delete.pickTarget')); setBusy(false); return; }
        opts = { dataAction: 'reassign', reassignToMemberId: targetId };
      } else opts = { dataAction: 'reassign', reassignToMemberId: 'me' };
      await softglazeApi.members.delete(member.id, opts);
      onDeleted();
    } catch (e) { setErr(e.message || t('errors.removeMember')); setBusy(false); }
  }

  return (
    <Shell onClose={onClose} title={t('delete.title', { name: member.name })} icon={Trash2}>
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('delete.warnPrefix')}<b className="text-foreground">{member.name}</b>{t('delete.warnMiddle')} <b className="text-foreground">{profiles}</b> {t('delete.profilesWord', { count: profiles })} · <b className="text-foreground">{proxies}</b> {t('delete.proxiesWord', { count: proxies })}</span>
        </div>
        <div className="space-y-2">
          {OPTIONS.map((opt) => (
            <label key={opt.id} className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors" style={action === opt.id ? { borderColor: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 8%, transparent)' } : { borderColor: 'var(--border)' }}>
              <input type="radio" name="del-action" checked={action === opt.id} onChange={() => setAction(opt.id)} className="accent-primary mt-0.5" />
              <span>
                <span className="text-[12.5px] font-medium text-foreground">{opt.label}</span>
                <span className="block text-[11px] text-muted-foreground">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {action === 'reassign-other' && (
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{t('delete.reassignTo')}</label>
            {pickable.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">{t('delete.noOtherMembers')}</p>
            ) : (
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary">
                {pickable.map((m) => <option key={m.id} value={m.id}>{m.name} ({ROLE_LABEL[m.role] ? t(`roles.${m.role}`) : m.role})</option>)}
              </select>
            )}
          </div>
        )}
        {err && <p className="text-[12px] text-red-400">{err}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
        <button onClick={onClose} disabled={busy} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary disabled:opacity-50">{t('actions.cancel')}</button>
        <button onClick={confirm} disabled={busy || (action === 'reassign-other' && pickable.length === 0)} className="h-9 px-5 rounded-lg bg-red-500/90 hover:bg-red-500 text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t('actions.removeMember')}
        </button>
      </div>
    </Shell>
  );
}

// Handoff: pick which profiles are assigned to a member. Pre-checks profiles
// already assigned to them; on save, newly checked are assigned and previously-
// assigned-but-unchecked are unassigned (each writes an audit row in main).
function AssignProfilesModal({ member, onClose }) {
  const { t } = useTranslation('members');
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
      } catch (e) { if (alive) setErr(e.message || t('errors.loadProfiles')); }
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
      setDone(t('assign.updated', { assigned: toAssign.length, unassigned: toUnassign.length }));
    } catch (e) { setErr(e.message || t('errors.reassignProfiles')); }
    finally { setBusy(false); }
  }

  return (
    <Shell onClose={onClose} title={t('assign.title', { name: member.name })} icon={FolderInput}>
      <div className="p-6 space-y-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('assign.searchPlaceholder')} className="w-full h-9 bg-input-background border border-border rounded-lg pl-8 pr-3 text-[12.5px] text-foreground outline-none focus:border-primary" />
        </div>
        <div className="rounded-lg border border-border bg-elevated/40 max-h-[44vh] overflow-y-auto divide-y divide-border/60">
          {loading ? (
            <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">{t('assign.noProfiles')}</div>
          ) : filtered.map((p) => {
            const other = p.assignedMemberId != null && Number(p.assignedMemberId) !== Number(member.id);
            return (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-secondary/50">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-blue-500" />
                <span className="text-[12.5px] text-foreground truncate flex-1">{p.title}</span>
                {other && <span className="text-[10.5px] text-muted-foreground shrink-0">{nameById.get(Number(p.assignedMemberId)) || t('assign.memberFallback', { id: p.assignedMemberId })}</span>}
                <span className="text-[10.5px] text-muted-foreground/70 shrink-0">#{p.id}</span>
              </label>
            );
          })}
        </div>
        {err && <p className="text-[12px] text-red-400">{err}</p>}
        {done && <p className="text-[12px] text-emerald-400 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{done}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
        <button onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] text-muted-foreground hover:bg-secondary">{t('actions.close')}</button>
        <button onClick={save} disabled={busy || loading} className="h-9 px-5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-[12.5px] flex items-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-500/25">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('assign.save')}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose, title, icon: Icon }) {
  const { dialogRef } = useDialog({ onClose });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="w-[480px] bg-card border border-border rounded-2xl shadow-2xl shadow-black/50 animate-scale-in overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
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

// One line of the allocation rollup: how much of a cap is handed to sub-members.
function AllocRow({ label, roll, t }) {
  const cap = roll.cap;
  const capLabel = cap === -1 ? '∞' : cap;
  const remaining = cap === -1 ? '∞' : Math.max(0, cap - roll.allocated);
  return (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">
        {t('alloc.allocated', { allocated: `${roll.allocated}${roll.unlimitedKids ? ` +${roll.unlimitedKids}×∞` : ''}`, cap: capLabel })}
        <span className="text-muted-foreground"> {t('alloc.left', { remaining })}</span>
      </span>
    </div>
  );
}

// Limits + child caps + create flags + feature toggles, clamped to the granter.
function PermissionEditor({ role, value, onChange, granter }) {
  const { t } = useTranslation('members');
  const labelCls = 'block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2';
  const set = (patch) => onChange({ ...value, ...patch });
  const setFeature = (k, on) => onChange({ ...value, features: { ...(value.features || {}), [k]: on } });
  const setAction = (k, on) => onChange({ ...value, actions: { ...(value.actions || {}), [k]: on } });

  // Per-action capability catalog (single source = permissions.js). We only show the
  // actions this member's ROLE can perform; toggling one OFF revokes it (restrict-only).
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    let live = true;
    softglazeApi.team.permissionCatalog().then((r) => { if (live) setCatalog((r && r.actions) || []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const rank = ROLE_RANK[String(role || '').toUpperCase()] || 0;
  const roleActions = catalog.filter((a) => rank >= a.minRank);
  const actionCats = [];
  for (const a of roleActions) {
    let g = actionCats.find((c) => c.name === a.category);
    if (!g) { g = { name: a.category, items: [] }; actionCats.push(g); }
    g.items.push(a);
  }

  const NumLimit = ({ k, label }) => {
    const max = granter ? granter[k] : -1;
    const unlimited = value[k] === -1;
    const gUnlimited = max === -1 || max == null;
    return (
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1">{label}{!gUnlimited && <span className="text-muted-dark"> {t('perms.max', { max })}</span>}</label>
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
      <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /><span className="text-[12px] font-semibold text-foreground">{t('perms.title')}</span></div>

      <div>
        <label className={labelCls}>{t('perms.resourceLimits')}</label>
        <div className="grid grid-cols-3 gap-2">
          <NumLimit k="maxProfiles" label={t('labels.profiles')} />
          <NumLimit k="maxProxies" label={t('labels.proxies')} />
          <NumLimit k="maxBrowsers" label={t('labels.browsers')} />
        </div>
      </div>

      {(CHILD_CAPS[role] || []).length > 0 && (
        <div>
          <label className={labelCls}>{t('perms.subMemberCaps')}</label>
          <div className="grid grid-cols-3 gap-2">
            {(CHILD_CAPS[role] || []).map(([k]) => <NumLimit key={k} k={k} label={t(`caps.${k}`)} />)}
          </div>
          <div className="mt-2 space-y-1.5">
            {(CREATE_FLAGS[role] || []).map(([flag]) => {
              const granterOk = !granter || granter[flag];
              return (
                <label key={flag} className={`flex items-center gap-2 text-[12px] ${granterOk ? 'text-muted-foreground cursor-pointer' : 'text-muted-dark cursor-not-allowed'}`}>
                  <input type="checkbox" disabled={!granterOk} checked={Boolean(value[flag]) && granterOk} onChange={(e) => set({ [flag]: e.target.checked })} className="accent-blue-500" />
                  {t(`perms.canInvite.${flag}`)}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>{t('perms.visibleFeatures')}</label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {FEATURES.map(([k]) => {
            const granterOk = !granter || !granter.features || granter.features[k] !== false;
            return (
              <label key={k} className={`flex items-center gap-2 text-[12px] ${granterOk ? 'text-muted-foreground cursor-pointer' : 'text-muted-dark cursor-not-allowed'}`}>
                <input type="checkbox" disabled={!granterOk} checked={(value.features || {})[k] !== false && granterOk} onChange={(e) => setFeature(k, e.target.checked)} className="accent-blue-500" />
                {t(`features.${k}`)}
              </label>
            );
          })}
        </div>
      </div>

      {actionCats.length > 0 && (
        <div>
          <label className={labelCls}>{t('perms.actionPermissions')}</label>
          <p className="text-[10.5px] text-muted-foreground mb-2 -mt-1">{t('perms.actionHint')}</p>
          <div className="space-y-2.5">
            {actionCats.map((cat) => (
              <div key={cat.name}>
                <div className="text-[10px] uppercase tracking-wider text-muted-dark mb-1">{cat.name}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {cat.items.map((a) => {
                    const granterOk = !granter || !granter.actions || granter.actions[a.key] !== false;
                    return (
                      <label key={a.key} className={`flex items-center gap-2 text-[12px] ${granterOk ? 'text-muted-foreground cursor-pointer' : 'text-muted-dark cursor-not-allowed'}`}>
                        <input type="checkbox" disabled={!granterOk} checked={granterOk && ((value.actions || {})[a.key] !== false)} onChange={(e) => setAction(a.key, e.target.checked)} className="accent-blue-500" />
                        {a.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function actionLabel(a) {
  const map = {
    launch: 'launched', stop: 'stopped', create: 'created', update: 'edited', delete: 'deleted',
    restore: 'restored', import: 'imported', assign: 'assigned', reassign: 'reassigned',
    'parallel-run': 'parallel run', 'macro-run': 'macro run',
    // Security / team audit events (logAudit).
    'member.create': 'member added', 'member.update': 'member edited', 'member.delete': 'member removed',
    'member.permissions': 'permissions changed', 'member.status': 'status changed',
    'member.login': 'signed in', 'member.logout': 'signed out', 'member.invite-accept': 'invite accepted'
  };
  return map[String(a || '').toLowerCase()] || a;
}
// Translated display label for an action. Keeps actionLabel() as the canonical
// English value (used for ACTION_COLORS lookup); this only swaps the visible text.
function actionLabelT(a, t) {
  const eng = actionLabel(a);
  const key = String(eng).replace(/[^a-z0-9]+/gi, '_');
  return t(`activityActions.${key}`, { defaultValue: eng });
}
const ACTION_COLORS = {
  launched: '#10b981', stopped: '#ef4444', created: '#3b82f6', edited: '#8b5cf6', deleted: '#ef4444',
  restored: '#10b981', imported: '#f59e0b', assigned: '#06b6d4', reassigned: '#06b6d4',
  'member added': '#3b82f6', 'member edited': '#8b5cf6', 'member removed': '#ef4444',
  'permissions changed': '#f59e0b', 'status changed': '#f59e0b',
  'signed in': '#10b981', 'signed out': '#94a3b8', 'invite accepted': '#06b6d4'
};
// Structured audit detail is stored as compact JSON (logAudit) — render it as a
// readable "key: value · key: value" line; legacy free-text detail passes through.
function humanizeDetail(detail) {
  if (!detail) return '';
  const s = String(detail);
  if (s[0] !== '{' && s[0] !== '[') return s;
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      return Object.entries(o)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join(' · ');
    }
  } catch (e) { /* not JSON */ }
  return s;
}
function feedTime(iso, t) {
  if (!iso) return '';
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return t('feedTime.justNow');
  if (s < 3600) return t('feedTime.minutes', { count: Math.floor(s / 60) });
  if (s < 86400) return t('feedTime.hours', { count: Math.floor(s / 3600) });
  return t('feedTime.days', { count: Math.floor(s / 86400) });
}

function TeamActivityFeed() {
  const { t } = useTranslation('members');
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
      if (res && res.ok) setNotice(t('activity.exported', { count: res.count, path: res.path }));
    } catch (e) { setErr(e.message || t('activity.exportError')); }
    finally { setExporting(''); }
  }

  const selCls = 'h-8 rounded-lg border border-border bg-input-background px-2 text-[12px] text-foreground outline-none focus:border-primary';

  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-fade-up">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #3b82f6 16%, transparent)', border: '1px solid color-mix(in srgb, #3b82f6 28%, transparent)' }}><Activity className="w-3.5 h-3.5 text-blue-400" /></span>
        <div className="mr-auto"><h2 className="text-sm font-semibold text-foreground">{t('activity.title')}</h2><p className="text-xs text-muted-foreground">{t('activity.subtitle')}</p></div>
        <button onClick={() => doExport('csv')} disabled={!!exporting} className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
          {exporting === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} CSV
        </button>
        <button onClick={() => doExport('json')} disabled={!!exporting} className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground flex items-center gap-1.5 disabled:opacity-60">
          {exporting === 'json' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} JSON
        </button>
      </div>

      {/* Filters (apply to the view below and to the export) */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={fMember} onChange={(e) => setFMember(e.target.value)} className={selCls} title={t('activity.filterByMember')}>
          <option value="">{t('activity.allMembers')}</option>
          {members.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
        <select value={fAction} onChange={(e) => setFAction(e.target.value)} className={selCls} title={t('activity.filterByAction')}>
          <option value="">{t('activity.allActions')}</option>
          {actionOptions.map((a) => <option key={a} value={a}>{actionLabelT(a, t)}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selCls} title={t('activity.fromDate')} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selCls} title={t('activity.toDate')} />
        {(fMember || fAction || from || to) && (
          <button onClick={() => { setFMember(''); setFAction(''); setFrom(''); setTo(''); }} className="text-[11.5px] text-muted-foreground hover:text-foreground">{t('actions.clear')}</button>
        )}
      </div>

      {notice && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[12px] text-emerald-400 break-all">{notice}</div>}
      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      <div className="-mx-5 -mb-5 border-t border-border">
        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted animate-spin" /></div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-[12.5px] text-muted-foreground">{rows.length === 0 ? t('activity.empty') : t('activity.noMatch')}</div>
        ) : visible.map((r) => {
          const action = actionLabel(r.action);
          const ac = ACTION_COLORS[String(action).toLowerCase()] || '#8b94a7';
          return (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3 text-[12.5px] border-b border-border hover:bg-secondary/50 transition-colors last:border-b-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ac }} />
              <span className="text-foreground font-semibold">{r.memberName}</span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${ac} 14%, transparent)`, color: ac }}>{actionLabelT(r.action, t)}</span>
              {r.profileTitle && <span className="text-muted-foreground truncate">{r.profileTitle}</span>}
              {r.detail && <span className="text-muted-foreground truncate hidden md:inline">· {humanizeDetail(r.detail)}</span>}
              <span className="ml-auto text-[11px] text-muted-foreground font-mono shrink-0">{feedTime(r.createdAt, t)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
