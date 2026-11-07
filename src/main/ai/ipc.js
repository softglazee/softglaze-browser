'use strict';
// IPC for the SoftGlaze AI page (spec §10). The channel names, inputs and return shapes are the
// contract with the renderer. These channels are kept out of ipcHandlers' CHANNELS map on purpose:
// the preload exposes them as window.softglaze.ai from its own constant.
//
// Every handler needs the signed-in window member to be the Owner, an Admin or the Super Admin
// (single-user mode counts as the Owner), except:
//   ai:approvals-respond  any signed-in member may answer approvals from tokens that act as
//                         themselves; Owner and Admin may answer all.
//   ai:approvals-list     filtered the same way, so a member's dialog can show their own approvals.
// Events main -> renderer: ai:approval-requested (one approval, only to a window whose member may
// answer it), ai:approvals-changed ({ pending }), ai:status-changed ({ at }).

const AI_CHANNELS = Object.freeze({
  STATUS: 'ai:status',
  SET_ENABLED: 'ai:set-enabled',
  SETTINGS_GET: 'ai:settings-get',
  SETTINGS_SET: 'ai:settings-set',
  TOKENS_LIST: 'ai:tokens-list',
  TOKENS_CREATE: 'ai:tokens-create',
  TOKENS_REVOKE: 'ai:tokens-revoke',
  APPROVALS_LIST: 'ai:approvals-list',
  APPROVALS_RESPOND: 'ai:approvals-respond',
  STOP_ALL: 'ai:stop-all',
  AUDIT_LIST: 'ai:audit-list',
  MEMORY_GET: 'ai:memory-get',
  MEMORY_SET: 'ai:memory-set',
  MEMORY_RESET: 'ai:memory-reset',
  PROMPTS_LIST: 'ai:prompts-list',
  SNIPPETS: 'ai:snippets',
  BRIDGE_INFO: 'ai:bridge-info',
  PREAPPROVABLE_TOOLS: 'ai:preapprovable-tools',
  // main -> renderer events
  APPROVAL_REQUESTED: 'ai:approval-requested',
  APPROVALS_CHANGED: 'ai:approvals-changed',
  STATUS_CHANGED: 'ai:status-changed'
});

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN', 'SUPER_ADMIN']);
const OWNER_ROLES = new Set(['OWNER', 'SUPER_ADMIN']);

function forbidden(message) {
  const e = new Error(message);
  e.code = 'FORBIDDEN';
  return e;
}

// Who may answer an approval: single-user mode, the Owner, an Admin or the Super Admin, or the
// member the token acts as. Suspended, banned or unknown members answer nothing. Used for
// ai:approvals-list, ai:approvals-respond and the ai:approval-requested event alike.
function canAnswerApproval(member, approval) {
  if (!member) return true; // single-user mode == Owner
  if (member.status && member.status !== 'active') return false;
  if (ADMIN_ROLES.has(member.role)) return true;
  return Boolean(approval && approval.memberId != null && member.id != null && Number(approval.memberId) === Number(member.id));
}

// Wraps the window sender for AI events: an approval dialog reaches the window only when the
// member signed in to it may answer it; other events go through. getWindowMember must read the
// window's member, not the AI actor (this runs inside the AI call).
function createWindowEmitter({ getWindowMember, send }) {
  return (channel, data) => {
    if (channel !== AI_CHANNELS.APPROVAL_REQUESTED) { send(channel, data); return; }
    Promise.resolve()
      .then(() => getWindowMember())
      .then((m) => { if (canAnswerApproval(m, data)) send(channel, data); })
      .catch(() => {});
  };
}

function activeOrThrow(m) {
  if (m && (m.status === 'suspended' || m.status === 'banned')) throw forbidden(m.status === 'banned' ? 'This account is banned.' : 'This member is suspended.');
}

// host: { getWindowMember(), visibleMemberIds(member) -> Promise<Set|null> }
function registerAiIpc(registerHandler, ai, host) {
  const windowMember = () => host.getWindowMember();
  const requireAdmin = async () => {
    const m = await windowMember();
    if (!m) return null; // single-user mode == Owner
    activeOrThrow(m);
    if (!ADMIN_ROLES.has(m.role)) throw forbidden('Only the Owner or an Admin can manage SoftGlaze AI.');
    return m;
  };
  const isOwner = (m) => !m || OWNER_ROLES.has(m.role);
  const canAnswer = canAnswerApproval;

  registerHandler(AI_CHANNELS.STATUS, async () => { await requireAdmin(); return ai.status(); });
  registerHandler(AI_CHANNELS.SET_ENABLED, async (payload) => {
    await requireAdmin();
    const on = (payload && typeof payload === 'object') ? payload.enabled : payload;
    return ai.setEnabled(Boolean(on));
  });
  registerHandler(AI_CHANNELS.SETTINGS_GET, async () => { await requireAdmin(); return ai.getSettings(); });
  registerHandler(AI_CHANNELS.SETTINGS_SET, async (patch) => {
    const m = await requireAdmin();
    if (patch && patch.port !== undefined && !isOwner(m)) throw forbidden('Only the Owner can change the port.');
    return ai.setSettings(patch, { isOwner: isOwner(m) });
  });

  registerHandler(AI_CHANNELS.TOKENS_LIST, async () => { await requireAdmin(); return ai.listTokens(); });
  registerHandler(AI_CHANNELS.TOKENS_CREATE, async (input) => {
    const m = await requireAdmin();
    const src = (input && typeof input === 'object') ? input : {};
    // The token acts as the chosen member, who must be the creator or someone the creator manages:
    // an Admin cannot mint a token that acts as the Owner.
    let memberId = src.memberId == null || src.memberId === '' ? null : Number(src.memberId);
    if (m && memberId == null) memberId = m.role === 'SUPER_ADMIN' ? null : m.id;
    if (m && memberId != null && m.role !== 'SUPER_ADMIN' && memberId !== m.id) {
      const visible = await host.visibleMemberIds(m);
      if (!visible || !visible.has(memberId)) throw forbidden('You can create tokens only for yourself or members you manage.');
    }
    if (m && memberId == null && m.role === 'ADMIN') throw forbidden('Only the Owner can create a token that acts as the workspace owner.');
    if (src.scope === 'full' && !isOwner(m)) throw forbidden('Only the Owner can create full-scope tokens.');
    return ai.createToken({ ...src, memberId }, { createdById: m ? m.id : null, callerIsOwner: isOwner(m) });
  });
  registerHandler(AI_CHANNELS.TOKENS_REVOKE, async (payload) => {
    await requireAdmin();
    const id = (payload && typeof payload === 'object') ? payload.id : payload;
    return ai.revokeToken(id);
  });

  registerHandler(AI_CHANNELS.APPROVALS_LIST, async () => {
    const m = await windowMember();
    activeOrThrow(m);
    return ai.listApprovals().filter((a) => canAnswer(m, a));
  });
  registerHandler(AI_CHANNELS.APPROVALS_RESPOND, async (payload) => {
    const m = await windowMember();
    activeOrThrow(m);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const approval = ai.getApproval(p.id);
    if (!approval) return { ok: false };
    if (!canAnswer(m, approval)) throw forbidden('You can answer only approvals for tokens that act as you.');
    return ai.respondApproval(p.id, String(p.decision || ''));
  });

  registerHandler(AI_CHANNELS.STOP_ALL, async () => { await requireAdmin(); return ai.stopAll(); });
  registerHandler(AI_CHANNELS.AUDIT_LIST, async (q) => { await requireAdmin(); return ai.listAudit(q); });

  registerHandler(AI_CHANNELS.MEMORY_GET, async () => { await requireAdmin(); return ai.memoryGet(); });
  registerHandler(AI_CHANNELS.MEMORY_SET, async (payload) => {
    await requireAdmin();
    const md = (payload && typeof payload === 'object') ? payload.markdown : payload;
    return ai.memorySet(md);
  });
  registerHandler(AI_CHANNELS.MEMORY_RESET, async () => { await requireAdmin(); return ai.memoryReset(); });

  registerHandler(AI_CHANNELS.PROMPTS_LIST, async () => { await requireAdmin(); return ai.listPrompts(); });
  registerHandler(AI_CHANNELS.SNIPPETS, async () => { await requireAdmin(); return ai.getSnippets(); });
  registerHandler(AI_CHANNELS.BRIDGE_INFO, async () => { await requireAdmin(); return ai.bridgeInfo(); });
  registerHandler(AI_CHANNELS.PREAPPROVABLE_TOOLS, async () => { await requireAdmin(); return ai.preApprovableTools(); });
}

module.exports = { AI_CHANNELS, registerAiIpc, canAnswerApproval, createWindowEmitter };
