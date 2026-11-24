'use strict';
// Cloud sync: the PC's database as a replica for the shared sync engine (@softglaze/protocol ws).
// Rows <-> plain field maps for profiles, proxies, proxy groups, groups and templates. Only the fields in
// the protocol's lists ever leave or enter the PC (launch flags, data folders, extension paths, 2FA seeds
// and saved account passwords are not in them). Everything arriving is sanitized again here (defence in
// depth, spec 2.5) before it touches the database.
//
// deps: {
//   P                       the vendored protocol (sanitizeValues, newSid, PROFILE_FIELDS ...)
//   getPrisma()             the app's Prisma client (proxy passwords sealed/opened by its extension)
//   uniqueDataDirName(t)    a never-used profile folder name
//   assertProfileCapacity() throws when the plan's profile limit is reached
//   isProfileRunning(id)    true while that profile's browser is open
//   fillNewProfile(values)  optional: generated fingerprint fields for a profile made elsewhere
//   log                     { info, warn }
// }

const KIND_ORDER = ['proxyGroup', 'group', 'proxy', 'template', 'profile'];
const MODEL = { profile: 'profile', proxy: 'proxy', proxyGroup: 'proxyGroup', group: 'group', template: 'template' };

const msOf = (d) => (d instanceof Date ? d.getTime() : d == null ? null : Number.isFinite(Number(new Date(d))) ? new Date(d).getTime() : null);
const dateOf = (ms) => (ms == null ? null : new Date(Number(ms)));

function parseTags(s) {
  if (!s) return [];
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.filter((t) => typeof t === 'string') : [];
  } catch (_) {
    return [];
  }
}

function createDesktopReplica(deps) {
  const { P, getPrisma } = deps;
  const log = deps.log || { info() {}, warn() {} };
  const PROFILE_COLUMNS = Object.keys(P.PROFILE_FIELDS).filter((f) => !['tags', 'groupSid', 'proxySid', 'createdAt', 'deletedAt'].includes(f));

  // Gives every row of a model a syncId (once). -> rows with syncId set.
  async function withSyncIds(model, rows) {
    const db = getPrisma();
    for (const r of rows) {
      if (r.syncId) continue;
      const sid = P.newSid(msOf(r.createdAt) || Date.now());
      await db[model].update({ where: { id: r.id }, data: { syncId: sid } });
      r.syncId = sid;
    }
    return rows;
  }

  function profileValues(row, sidOf) {
    const v = {};
    for (const c of PROFILE_COLUMNS) v[c] = row[c] === undefined ? null : row[c];
    v.tags = parseTags(row.tags);
    v.groupSid = row.groupId ? sidOf.group.get(row.groupId) || null : null;
    v.proxySid = row.proxyId ? sidOf.proxy.get(row.proxyId) || null : null;
    v.createdAt = msOf(row.createdAt);
    v.deletedAt = msOf(row.deletedAt);
    return v;
  }

  function proxyValues(row, sidOf) {
    const check = {
      status: row.lastStatus || undefined,
      latencyMs: row.lastLatencyMs == null ? undefined : row.lastLatencyMs,
      country: row.lastCountry || undefined,
      region: row.lastRegion || undefined,
      city: row.lastCity || undefined,
      isp: row.lastIsp || undefined,
      error: row.lastError || undefined,
      blacklisted: row.lastBlacklisted == null ? undefined : row.lastBlacklisted,
      checkedAt: msOf(row.lastCheckedAt) || undefined
    };
    return {
      name: row.name,
      type: row.type,
      host: row.host,
      port: row.port,
      username: row.username || null,
      password: row.password || null,
      rotationUrl: row.rotationUrl || null,
      proxyGroupSid: row.proxyGroupId ? sidOf.proxyGroup.get(row.proxyGroupId) || null : null,
      provider: row.provider || null,
      check: Object.values(check).some((x) => x !== undefined) ? JSON.parse(JSON.stringify(check)) : null,
      createdAt: msOf(row.createdAt)
    };
  }

  async function list() {
    const db = getPrisma();
    const [groups, proxyGroups, proxies, templates, profiles] = await Promise.all([
      db.group.findMany({ orderBy: { id: 'asc' } }),
      db.proxyGroup.findMany({ orderBy: { id: 'asc' } }),
      db.proxy.findMany({ orderBy: { id: 'asc' } }),
      db.template.findMany({ orderBy: { id: 'asc' } }),
      db.profile.findMany({ orderBy: { id: 'asc' } })
    ]);
    await withSyncIds('group', groups);
    await withSyncIds('proxyGroup', proxyGroups);
    await withSyncIds('proxy', proxies);
    await withSyncIds('template', templates);
    await withSyncIds('profile', profiles);
    const sidOf = {
      group: new Map(groups.map((g) => [g.id, g.syncId])),
      proxyGroup: new Map(proxyGroups.map((g) => [g.id, g.syncId])),
      proxy: new Map(proxies.map((p) => [p.id, p.syncId]))
    };
    const out = [];
    for (const g of groups) out.push({ sid: g.syncId, kind: 'group', values: { name: g.name, color: g.color || null, createdAt: msOf(g.createdAt) } });
    for (const g of proxyGroups) out.push({ sid: g.syncId, kind: 'proxyGroup', values: { name: g.name, color: g.color || null, autoCreated: !!g.autoCreated, createdAt: msOf(g.createdAt) } });
    for (const p of proxies) out.push({ sid: p.syncId, kind: 'proxy', values: proxyValues(p, sidOf) });
    for (const t of templates) out.push({ sid: t.syncId, kind: 'template', values: { name: t.name, dataJson: t.dataJson, createdAt: msOf(t.createdAt) } });
    for (const p of profiles) out.push({ sid: p.syncId, kind: 'profile', values: profileValues(p, sidOf) });
    return out;
  }

  async function idOfSid(model, sid) {
    if (!sid) return null;
    const row = await getPrisma()[model].findUnique({ where: { syncId: sid }, select: { id: true } });
    return row ? row.id : null;
  }

  // Plain values (already sanitized by the engine) -> Prisma data for one kind.
  async function dataFor(kind, values, { creating }) {
    // The engine hands over secrets opened (plain text); they are not in sealed form here, so they are
    // taken out before the field check and handled below.
    const input = { ...values };
    const hasPassword = kind === 'proxy' && Object.prototype.hasOwnProperty.call(input, 'password');
    const password = hasPassword ? input.password : undefined;
    delete input.password;
    const clean = P.sanitizeValues(kind, input);
    if (clean.dropped.length) log.warn(`[SG][cloud] dropped fields on apply (${kind}): ${clean.dropped.join(', ')}`);
    const v = clean.values;
    const d = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(v, k);
    if (kind === 'profile') {
      for (const c of PROFILE_COLUMNS) if (has(c)) d[c] = v[c];
      if (has('tags')) d.tags = v.tags && v.tags.length ? JSON.stringify(v.tags) : null;
      if (has('groupSid')) d.groupId = await idOfSid('group', v.groupSid);
      if (has('proxySid')) d.proxyId = await idOfSid('proxy', v.proxySid);
      if (has('deletedAt')) d.deletedAt = dateOf(v.deletedAt);
      if (creating && has('createdAt') && v.createdAt) d.createdAt = dateOf(v.createdAt);
      if (creating && (d.title == null || d.title === '')) d.title = 'Untitled profile';
      // Booleans the database requires: null from a cleared field means "back to default".
      for (const b of ['canvasNoise', 'webglImageNoise', 'audioContextNoise', 'clientRectsNoise', 'speechVoicesNoise']) if (d[b] === null) d[b] = true;
      for (const b of ['enableQuic', 'antidetectEngine', 'randomFingerprint']) if (d[b] === null) d[b] = false;
      if (d.systemProxyBehavior === null) d.systemProxyBehavior = 'PROFILE_PROXY';
    } else if (kind === 'proxy') {
      for (const c of ['name', 'type', 'host', 'port', 'username', 'rotationUrl', 'provider']) if (has(c)) d[c] = v[c];
      // The engine opened the sealed password; the client extension seals it again at rest.
      if (hasPassword) d.password = typeof password === 'string' && password ? password.slice(0, 1024) : null;
      if (has('proxyGroupSid')) d.proxyGroupId = await idOfSid('proxyGroup', v.proxyGroupSid);
      if (has('check')) {
        const c = v.check || {};
        Object.assign(d, {
          lastStatus: c.status || null,
          lastLatencyMs: c.latencyMs == null ? null : c.latencyMs,
          lastCountry: c.country || null,
          lastRegion: c.region || null,
          lastCity: c.city || null,
          lastIsp: c.isp || null,
          lastError: c.error || null,
          lastBlacklisted: c.blacklisted == null ? null : c.blacklisted,
          lastCheckedAt: c.checkedAt ? dateOf(c.checkedAt) : null
        });
      }
      if (d.type === null) d.type = 'HTTP';
      if (creating) {
        if (!d.name) d.name = d.host || 'Proxy';
        if (!d.type) d.type = 'HTTP';
        if (!d.host || !d.port) return null; // not usable yet
      }
      if (d.name === null) delete d.name;
      if (d.host === null) delete d.host;
      if (d.port === null) delete d.port;
    } else if (kind === 'proxyGroup' || kind === 'group') {
      if (has('name')) d.name = v.name || 'Group';
      if (has('color')) d.color = v.color;
      if (kind === 'proxyGroup' && has('autoCreated')) d.autoCreated = !!v.autoCreated;
      if (creating && !d.name) d.name = 'Group';
    } else if (kind === 'template') {
      if (has('name')) d.name = v.name || 'Template';
      if (has('dataJson')) d.dataJson = v.dataJson || '{}';
      if (creating) {
        if (!d.name) d.name = 'Template';
        if (!d.dataJson) d.dataJson = '{}';
      }
    }
    if (creating && kind !== 'profile' && has('createdAt') && v.createdAt) d.createdAt = dateOf(v.createdAt);
    return d;
  }

  async function applyOne(change) {
    const db = getPrisma();
    const model = MODEL[change.kind];
    const row = await db[model].findUnique({ where: { syncId: change.sid } });
    if (change.values === null) {
      if (!row) return null;
      if (change.kind === 'profile' && deps.isProfileRunning && deps.isProfileRunning(row.id)) return 'running';
      // The profile's data folder is left for the app's normal cleanup; the row goes now.
      await db[model].delete({ where: { id: row.id } });
      return null;
    }
    if (row) {
      const data = await dataFor(change.kind, change.values, { creating: false });
      if (data && Object.keys(data).length) await db[model].update({ where: { id: row.id }, data });
      return null;
    }
    const data = await dataFor(change.kind, change.values, { creating: true });
    if (!data) return 'incomplete';
    if (change.kind === 'profile') {
      if (!data.deletedAt && deps.assertProfileCapacity) {
        try {
          await deps.assertProfileCapacity();
        } catch (e) {
          return 'plan_limit';
        }
      }
      if (deps.fillNewProfile) {
        const fp = (await deps.fillNewProfile(data)) || {};
        for (const [k, val] of Object.entries(fp)) if ((data[k] === undefined || data[k] === null || data[k] === '') && PROFILE_COLUMNS.includes(k)) data[k] = val;
      }
      data.dataDirName = await deps.uniqueDataDirName(data.title);
    }
    try {
      await db[model].create({ data: { ...data, syncId: change.sid } });
    } catch (e) {
      if (e && e.code === 'P2002') return 'duplicate';
      throw e;
    }
    return null;
  }

  async function apply(changes) {
    const rejected = [];
    const order = (c) => (c.values === null ? 10 - KIND_ORDER.indexOf(c.kind) : KIND_ORDER.indexOf(c.kind));
    const sorted = [...changes].sort((a, b) => order(a) - order(b));
    for (const c of sorted) {
      try {
        const why = await applyOne(c);
        if (why) rejected.push({ sid: c.sid, reason: why });
      } catch (e) {
        log.warn(`[SG][cloud] apply ${c.kind} failed: ${e && e.message ? e.message : e}`);
        rejected.push({ sid: c.sid, reason: 'error' });
      }
    }
    return { rejected };
  }

  return { list, apply };
}

// Shadow store in the app database (WsShadow + WsMeta).
function createDbShadowStore(getPrisma) {
  return {
    async load() {
      const db = getPrisma();
      const [rows, meta] = await Promise.all([db.wsShadow.findMany(), db.wsMeta.findMany()]);
      if (!rows.length && !meta.length) return null;
      const m = Object.fromEntries(meta.map((r) => [r.key, r.value]));
      const entries = {};
      for (const r of rows) {
        entries[r.sid] = { sid: r.sid, kind: r.kind, rid: r.rid, version: r.version, base: JSON.parse(r.base), local: JSON.parse(r.local), present: !!r.present };
      }
      return { v: 1, cursor: Number(m.cursor) || 0, lamport: Number(m.lamport) || 0, entries };
    },
    async save(state, changed) {
      const db = getPrisma();
      const ops = [];
      for (const sid of changed) {
        const e = state.entries[sid];
        if (!e) {
          ops.push(db.wsShadow.deleteMany({ where: { sid } }));
          continue;
        }
        const data = { kind: e.kind, rid: e.rid, version: e.version, base: JSON.stringify(e.base), local: JSON.stringify(e.local), present: !!e.present };
        ops.push(db.wsShadow.upsert({ where: { sid }, create: { sid, ...data }, update: data }));
      }
      for (const [key, value] of [['cursor', String(state.cursor)], ['lamport', String(state.lamport)]]) {
        ops.push(db.wsMeta.upsert({ where: { key }, create: { key, value }, update: { value } }));
      }
      // Chunks keep each transaction small on big workspaces.
      for (let i = 0; i < ops.length; i += 200) await db.$transaction(ops.slice(i, i + 200));
    },
    async clear() {
      const db = getPrisma();
      await db.wsShadow.deleteMany({});
      await db.wsMeta.deleteMany({});
    }
  };
}

module.exports = { createDesktopReplica, createDbShadowStore, KIND_ORDER };
