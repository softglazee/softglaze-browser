'use strict';
// Cloud sync service of the PC (docs/CLOUD-SYNC.md, spec 00-SPEC phase 1).
//
// Turn on (Owner): make the workspace keys and the 24-word recovery kit, the user types back two words,
// then the encrypted workspace is created on the licensing server and everything is uploaded. Every
// 20 seconds (and on "Sync now") the shared engine pulls changes from the web, merges them per field and
// pushes local changes. "Approve a browser" shows a one-time code; a browser that typed it asks to join,
// and this PC wraps the workspace key for it after the user clicks Approve. Recover: a PC with no keys
// types the kit to rejoin an existing workspace.
//
// deps: {
//   P, keystore, replica, shadow (createDbShadowStore result, with clear()),
//   apiBaseUrl() -> 'https://api.softglaze.com', sessionToken() -> account bearer | null,
//   accountId() -> customer id or email of the signed-in account | null,
//   deviceName() -> 'DESKTOP-ABC', flagEnabled() -> bool (SG_CLOUD_SYNC / setting),
//   fetch?, now?, setInterval?, clearInterval?, log?, onChange?(what)
// }

const SYNC_EVERY_MS = 20_000;

function codeError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function createWorkspaceSyncService(deps) {
  const { P, keystore } = deps;
  const now = deps.now || Date.now;
  const log = deps.log || { info() {}, warn() {} };
  const setIntervalFn = deps.setInterval || setInterval;
  const clearIntervalFn = deps.clearInterval || clearInterval;
  const changed = (what) => {
    try {
      if (deps.onChange) deps.onChange(what);
    } catch (_) {
      /* ignore */
    }
  };

  let timer = null;
  let engine = null; // { sync, ring, mk, info }
  let pendingCreate = null; // { made, check: [a, b], expiresAt }
  let enrol = null; // { offer, expiresAt }
  let last = { at: null, report: null, error: null };
  let syncing = null;

  function api() {
    const base = deps.apiBaseUrl();
    if (!base) throw codeError('NOT_CONFIGURED', 'This build has no SoftGlaze server configured.');
    return new P.WsHttpApi({ baseUrl: base, auth: { token: () => deps.sessionToken() }, fetch: deps.fetch });
  }

  function identity() {
    const rec = keystore.read();
    if (rec && rec.identity) return P.importIdentity(rec.identity);
    const id = P.generateIdentity();
    keystore.patch({ identity: P.exportIdentity(id) });
    return id;
  }

  function memberKeys() {
    const rec = keystore.read();
    if (!rec || !rec.mkSeed) return null;
    const mk = P.deriveMemberKeys(P.fromBase64Url(rec.mkSeed));
    if (rec.workspaceId && rec.workspaceId !== mk.workspaceId) return null;
    // Keys of another account's workspace (someone else signed in on this PC) are not used.
    const acc = deps.accountId();
    if (rec.customerId && acc && String(rec.customerId) !== String(acc)) return null;
    return mk;
  }

  function requireReady() {
    if (!deps.flagEnabled()) throw codeError('CLOUD_SYNC_UNAVAILABLE', 'Cloud sync is not available in this version yet.');
    if (!deps.sessionToken()) throw codeError('SIGN_IN_REQUIRED', 'Sign in to your SoftGlaze account first (Settings > Account).');
  }

  async function serverStatus() {
    return api().status();
  }

  async function buildEngine() {
    const mk = memberKeys();
    if (!mk) return null;
    const st = await serverStatus();
    if (!st.workspace) throw codeError('WORKSPACE_GONE', 'The cloud copy of this workspace was deleted. Turn cloud sync on again.');
    const { ring } = P.openWorkspace(st.workspace, mk);
    const id = identity();
    const sync = new P.WorkspaceSync({
      api: api(),
      ring,
      ownerSignPub: mk.sign.publicKey,
      device: { tag: P.deviceTagOf(id.sign.publicKey), signSecret: id.sign.secretKey },
      replica: deps.replica,
      shadow: deps.shadow,
      now
    });
    return { sync, ring, mk, info: st.workspace, plan: st.plan };
  }

  async function syncNow() {
    if (syncing) return syncing;
    syncing = (async () => {
      requireReady();
      if (!engine) engine = await buildEngine();
      if (!engine) throw codeError('CLOUD_SYNC_OFF', 'Cloud sync is off on this PC.');
      try {
        const report = await engine.sync.sync();
        last = { at: now(), report, error: null };
        if (report.rejected.length) log.warn(`[SG][cloud] ${report.rejected.length} change(s) refused: ${[...new Set(report.rejected.map((r) => r.reason))].join(', ')}`);
        if (report.conflicts.length) log.info(`[SG][cloud] ${report.conflicts.length} conflicting field(s); newest kept`);
        if (report.applied) changed('data');
        changed('status');
        return report;
      } catch (e) {
        last = { ...last, error: { code: e.code || 'SYNC_FAILED', message: e.message } };
        // A changed keyring or a workspace deleted elsewhere: rebuild next time.
        if (e && (e.status === 404 || e.code === 'tampered' || e.code === 'WORKSPACE_GONE')) engine = null;
        changed('status');
        throw e;
      }
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  function startLoop() {
    if (timer) return;
    timer = setIntervalFn(() => {
      syncNow().catch((e) => log.warn(`[SG][cloud] sync failed: ${e && e.message ? e.message : e}`));
    }, SYNC_EVERY_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function stopLoop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  async function start() {
    if (!deps.flagEnabled() || !memberKeys() || !deps.sessionToken()) return false;
    startLoop();
    syncNow().catch((e) => log.warn(`[SG][cloud] first sync failed: ${e && e.message ? e.message : e}`));
    return true;
  }

  async function status() {
    const on = !!memberKeys();
    const base = {
      available: !!deps.flagEnabled(),
      signedIn: !!deps.sessionToken(),
      osEncryption: keystore.available(),
      on,
      workspaceId: on ? memberKeys().workspaceId : null,
      pendingKit: !!pendingCreate,
      lastSyncAt: last.at,
      lastError: last.error,
      last: last.report
        ? { pulled: last.report.pulled, applied: last.report.applied, pushed: last.report.pushed, conflicts: last.report.conflicts.length, rejected: last.report.rejected.length }
        : null
    };
    if (!base.available || !base.signedIn) return { ...base, server: null };
    try {
      const st = await serverStatus();
      return {
        ...base,
        server: {
          enabled: st.enabled,
          plan: st.plan,
          workspace: st.workspace ? { id: st.workspace.id, bytesUsed: st.workspace.bytesUsed, quotaBytes: st.workspace.quotaBytes, createdAt: st.workspace.createdAt } : null
        }
      };
    } catch (e) {
      return { ...base, server: null, serverError: { code: e.code || 'NETWORK', message: e.message } };
    }
  }

  // Step 1 of turning on: keys + kit (nothing leaves the PC yet).
  async function turnOnStart() {
    requireReady();
    if (memberKeys()) throw codeError('ALREADY_ON', 'Cloud sync is already on.');
    const st = await serverStatus();
    if (!st.enabled) throw codeError('CLOUD_SYNC_UNAVAILABLE', 'Cloud sync is not open for your account yet.');
    if (!st.plan || !st.plan.allowed) throw codeError('PLAN_REQUIRED', 'Cloud sync comes with Pro and Enterprise.');
    if (st.workspace) throw codeError('WORKSPACE_EXISTS', 'Your account already has a cloud workspace. Use your recovery kit to connect this PC.');
    const made = P.createWorkspace({ device: identity(), deviceName: deps.deviceName(), platform: 'pc', now: now() });
    pendingCreate = { made, check: P.kitCheckPositions(), expiresAt: now() + 30 * 60_000 };
    return { words: made.words, check: pendingCreate.check, workspaceId: made.mk.workspaceId };
  }

  function turnOnCancel() {
    pendingCreate = null;
    return { ok: true };
  }

  // Step 2: the user typed back the two words; create the workspace and upload.
  async function turnOnConfirm(answers) {
    requireReady();
    if (!pendingCreate || pendingCreate.expiresAt < now()) {
      pendingCreate = null;
      throw codeError('KIT_EXPIRED', 'Start again: the recovery kit was not confirmed in time.');
    }
    const { made, check } = pendingCreate;
    for (const pos of check) {
      const typed = String((answers && answers[pos]) || '').trim().toLowerCase();
      if (typed !== made.words[pos - 1]) throw codeError('KIT_MISMATCH', `Word ${pos} does not match your recovery kit.`);
    }
    // Signed again now: the server accepts a create signed in the last 10 minutes only.
    const at = now();
    await api().create({ ...made.body, at, sig: P.signAction(made.mk, 'create', at, made.body.ownerSignPub) });
    keystore.patch({ mkSeed: P.toBase64Url(made.mk.seed), workspaceId: made.mk.workspaceId, customerId: deps.accountId() || null, deviceName: deps.deviceName() });
    pendingCreate = null;
    if (deps.shadow.clear) await deps.shadow.clear();
    engine = null;
    startLoop();
    changed('status');
    const report = await syncNow().catch((e) => ({ error: e.message }));
    return { ok: true, workspaceId: made.mk.workspaceId, report };
  }

  // A PC without keys joins the account's workspace with the recovery kit.
  async function recover(words) {
    requireReady();
    if (memberKeys()) throw codeError('ALREADY_ON', 'Cloud sync is already on.');
    const st = await serverStatus();
    if (!st.workspace) throw codeError('NO_WORKSPACE', 'Your account has no cloud workspace yet. Turn cloud sync on instead.');
    let opened;
    try {
      opened = P.recoverWorkspace(st.workspace, words);
    } catch (e) {
      if (e && e.code === 'invalid') throw codeError('KIT_INVALID', `Check the words: ${e.message}.`);
      throw codeError('KIT_WRONG', 'These words do not open your cloud workspace.');
    }
    const { cert, certSig } = P.deviceCertFor(opened.mk, identity(), deps.deviceName(), 'pc', now());
    await api().addDevice({ cert, certSig });
    keystore.patch({ mkSeed: P.toBase64Url(opened.mk.seed), workspaceId: opened.mk.workspaceId, customerId: deps.accountId() || null, deviceName: deps.deviceName() });
    if (deps.shadow.clear) await deps.shadow.clear();
    engine = null;
    startLoop();
    changed('status');
    const report = await syncNow().catch((e) => ({ error: e.message }));
    return { ok: true, workspaceId: opened.mk.workspaceId, report };
  }

  // ---- Adding a browser -------------------------------------------------------------------------------

  function enrolStart() {
    requireReady();
    if (!memberKeys()) throw codeError('CLOUD_SYNC_OFF', 'Turn cloud sync on first.');
    const offer = P.createEnrolOffer();
    enrol = { offer, expiresAt: now() + P.ENROL_TTL_MS, seen: new Map() };
    return { code: offer.code, qr: offer.qr, expiresAt: enrol.expiresAt };
  }

  function enrolCancel() {
    enrol = null;
    return { ok: true };
  }

  // Requests made with the code on screen (others are ignored: another PC's code, or forged).
  async function enrolPoll() {
    if (!enrol) return { active: false, requests: [] };
    if (enrol.expiresAt < now()) {
      enrol = null;
      return { active: false, expired: true, requests: [] };
    }
    const pending = await api().pendingEnrolments();
    const requests = [];
    for (const p of pending) {
      if (!P.checkEnrolRequest(enrol.offer.secret, p.request)) continue;
      enrol.seen.set(p.id, p.request);
      requests.push({ id: p.id, name: p.request.name, platform: p.request.platform, createdAt: p.createdAt });
    }
    return { active: true, expiresAt: enrol.expiresAt, requests };
  }

  async function enrolApprove(id) {
    const mk = memberKeys();
    if (!enrol || !mk) throw codeError('ENROL_EXPIRED', 'Show a new code and try again.');
    const req = enrol.seen.get(String(id));
    if (!req) throw codeError('ENROL_UNKNOWN', 'That request was not made with the code on screen.');
    const approval = P.approveEnrolRequest(enrol.offer.secret, mk, req, now());
    await api().approveEnrolment(String(id), approval);
    enrol = null;
    changed('devices');
    return { ok: true, tag: approval.cert.tag, name: approval.cert.name };
  }

  async function enrolDeny(id) {
    await api().denyEnrolment(String(id));
    if (enrol) enrol.seen.delete(String(id));
    return { ok: true };
  }

  // ---- Devices, kit, off ------------------------------------------------------------------------------

  async function devices() {
    const mk = memberKeys();
    if (!mk) return [];
    const self = P.deviceTagOf(identity().sign.publicKey);
    const rows = await api().devices();
    return rows
      .filter((r) => P.verifyDeviceCert(mk.sign.publicKey, mk.workspaceId, r.cert, r.certSig))
      .map((r) => ({ tag: r.tag, name: r.cert.name, platform: r.cert.platform, addedAt: r.cert.at, revokedAt: r.revokedAt || null, self: r.tag === self }));
  }

  async function revokeDevice(tag) {
    const mk = memberKeys();
    if (!mk) throw codeError('CLOUD_SYNC_OFF', 'Cloud sync is off.');
    if (tag === P.deviceTagOf(identity().sign.publicKey)) throw codeError('SELF', 'This PC cannot remove itself; turn cloud sync off instead.');
    const r = P.signRevocation(mk, String(tag), now());
    await api().revokeDevice(String(tag), r);
    changed('devices');
    return { ok: true };
  }

  async function reissueKit() {
    const mk = memberKeys();
    if (!mk) throw codeError('CLOUD_SYNC_OFF', 'Cloud sync is off.');
    const { words, body } = P.reissueRecovery(mk, now());
    await api().putRecovery(body);
    return { words };
  }

  // Off on this PC. deleteCloud: also delete the encrypted cloud copy (every device loses it; local data stays).
  async function turnOff({ deleteCloud = false } = {}) {
    const mk = memberKeys();
    stopLoop();
    if (deleteCloud && mk) await api().remove(P.deleteWorkspaceProof(mk, now()));
    const rec = keystore.read() || {};
    keystore.write({ identity: rec.identity || null, mkSeed: null, workspaceId: null, customerId: null, deviceName: rec.deviceName || null });
    if (deps.shadow.clear) await deps.shadow.clear();
    engine = null;
    last = { at: null, report: null, error: null };
    changed('status');
    return { ok: true };
  }

  return { start, stop: stopLoop, status, syncNow, turnOnStart, turnOnCancel, turnOnConfirm, recover, enrolStart, enrolCancel, enrolPoll, enrolApprove, enrolDeny, devices, revokeDevice, reissueKit, turnOff, SYNC_EVERY_MS };
}

module.exports = { createWorkspaceSyncService, SYNC_EVERY_MS };
