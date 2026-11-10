'use strict';
// SoftGlaze AI tools. One definition per tool: input schema (zod), the token scope and app
// permission it needs, MCP annotations, its approval rule, which profiles it touches, a one-line
// summary for the approval dialog and audit, and the handler. toolRegistry.js runs every call
// through scope, permission, group, plan, approval and audit checks before a handler sees it, and
// the handler runs as the token's member, so the app's own permission checks apply inside it.
//
// Handlers call existing app functions passed in as ctx.deps (see ipcHandlers.buildAiDeps). They
// return { summary, data } (compact JSON) or { summary, content } for non-text content.
//
// Approval rules: 'none' (follows the read approval mode), 'ask' (the scope's mode), 'always'
// (ask every time), 'page' (once per profile per hour), 'self' (no ask when this token started the
// target, otherwise 'ask'). `many` marks calls that touch more than one profile: those always ask.
const z = require('zod');
const captchaScore = require('../captchaScore');
const proxyScope = require('../proxyScope');
const { PAGE_TOOLS } = require('./pageTools');
const memories = require('./memories');

const id = () => z.number().int().positive();
const groupRef = () => z.union([z.number().int().positive(), z.string().trim().min(1).max(80)]);
const idList = (max) => z.array(id()).min(1).max(max);
const httpUrl = () => z.string().trim().max(2000).refine((u) => /^https?:\/\/[^\s]+$/i.test(u), 'Must be an http(s) URL.');

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const CHANGE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const iso = (d) => (d instanceof Date ? d.toISOString() : (d || null));
const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? `${t.slice(0, n)}…` : t; };
const plural = (n, word, many) => `${n} ${n === 1 ? word : (many || `${word}s`)}`;

function parseTags(raw) {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.map(String) : []; } catch (e) { return []; }
}

function startUrlsOf(raw) {
  return String(raw || '').split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
}

// Compact, secret-free view of a profile. Never: platform accounts, 2FA seed, proxy string,
// proxy credentials, cookies.
function compactProfile(p, running) {
  const proxy = p.proxy || null;
  return {
    id: p.id,
    name: p.title,
    group: p.group ? { id: p.group.id, name: p.group.name } : null,
    tags: parseTags(p.tags),
    notes: p.notes ? clip(p.notes, 200) : null,
    browser: p.browserCore === 'Firefox' ? 'Firefox' : 'Chromium',
    os: p.os || null,
    deviceClass: p.deviceClass || 'desktop',
    usesProxy: p.systemProxyBehavior === 'PROFILE_PROXY' && Boolean(proxy),
    proxy: proxy ? {
      id: proxy.id,
      name: proxy.name || null,
      type: proxy.type,
      country: proxy.lastCountry || null,
      status: proxy.lastStatus || 'unchecked',
      latencyMs: proxy.lastLatencyMs == null ? null : proxy.lastLatencyMs
    } : null,
    running: Boolean(running && running.has(p.id)),
    launchCount: p.launchCount || 0,
    lastUsedAt: iso(p.lastUsedAt),
    createdAt: iso(p.createdAt)
  };
}

function detailedProfile(p, running) {
  return {
    ...compactProfile(p, running),
    notes: p.notes ? clip(p.notes, 1000) : null,
    startUrls: startUrlsOf(p.startupUrls),
    fingerprint: {
      os: p.os || null,
      osVersion: p.osVersion || null,
      browserBrand: p.browserBrand || null,
      browserVersion: p.browserVersion || null,
      userAgent: p.userAgent && p.userAgent !== 'Auto' ? p.userAgent : 'Auto (matches the browser)',
      screen: p.resolutionType === 'Custom' && p.resolutionW ? `${p.resolutionW}x${p.resolutionH}` : (p.resolutionType || 'Auto'),
      cpuCores: p.cpuCores || null,
      ramGb: p.ramGb || null,
      gpu: p.webglRenderer || null,
      noise: {
        canvas: p.canvasNoise !== false,
        webglImage: p.webglImageNoise !== false,
        audio: p.audioContextNoise !== false,
        clientRects: p.clientRectsNoise !== false
      },
      antidetectEngine: p.antidetectEngine === true
    },
    location: {
      timezone: p.timezoneType === 'Custom' ? `Custom: ${p.timezoneCustom || '?'}` : (p.timezoneType || 'Based on IP'),
      language: p.languageType === 'Custom' ? `Custom: ${p.languageCustom || '?'}` : (p.languageType || 'Based on IP'),
      geolocation: p.locationType || 'Based on IP',
      // Firefox profiles always run with WebRTC off (media.peerconnection.enabled false); the saved
      // setting applies only if the profile moves to Chromium.
      webrtc: p.browserCore === 'Firefox' ? `Off (Firefox profiles always run with WebRTC off; saved setting ${p.webrtc || 'Forward'} applies on Chromium)` : (p.webrtc || 'Forward')
    }
  };
}

// DataImpulse sticky ports (10000+) rotate through the vendor's API without a link, so they can rotate
// too. The same rule as ipcHandlers.isDataImpulseSticky (test/spanishRound8.test.js keeps them equal).
function isDataImpulseSticky(p) {
  return Boolean(p)
    && String(p.provider || '').toLowerCase() === 'dataimpulse'
    && /(^|\.)dataimpulse\.com$/i.test(String(p.host || ''))
    && Number(p.port) >= 10000
    && Boolean(p.username) && Boolean(p.password);
}

// Compact proxy view: never the username, password, rotation link or raw string.
function compactProxy(p) {
  return {
    id: p.id,
    name: p.name || null,
    type: p.type,
    host: p.host,
    port: p.port,
    provider: p.provider || null,
    free: p.provider === proxyScope.FREE_PROVIDER,
    group: p.proxyGroup ? { id: p.proxyGroup.id, name: p.proxyGroup.name } : null,
    country: p.lastCountry || null,
    isp: p.lastIsp || null,
    status: p.lastStatus || 'unchecked',
    error: p.lastStatus === 'fail' && p.lastError ? clip(p.lastError, 160) : null,
    latencyMs: p.lastLatencyMs == null ? null : p.lastLatencyMs,
    blocklisted: typeof p.lastBlacklisted === 'boolean' ? p.lastBlacklisted : null,
    lastCheckedAt: iso(p.lastCheckedAt),
    canRotate: Boolean(p.rotationUrl) || isDataImpulseSticky(p),
    usedByProfiles: p._count && typeof p._count.profiles === 'number' ? p._count.profiles : undefined
  };
}

const HIDDEN_VALUE = '[hidden value]';

// Typed values in macros often hold passwords: show {{placeholders}} as they are, hide the rest.
function redactMacroSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s) => {
    if (!s || typeof s !== 'object') return s;
    const out = { ...s };
    if ((out.type === 'type' || out.type === 'select') && out.value != null && out.value !== '') {
      const v = String(out.value);
      if (!/^\s*\{\{[^}]+\}\}\s*$/.test(v)) out.value = HIDDEN_VALUE;
    }
    return out;
  });
}

async function visibleRunning(ctx) {
  return ctx.runningProfileIds();
}

// Running profiles stop_all_profiles would close: every visible one, or only AI-started ones.
async function runningTargets(a, ctx) {
  const running = [...await visibleRunning(ctx)];
  return a.onlyStartedByAi ? running.filter((pid) => ctx.tracker.isAiStartedProfile(pid)) : running;
}

// ---------------------------------------------------------------------------------------------
const TOOLS = [
  // ---- Workspace ----
  {
    name: 'workspace_summary',
    title: 'Workspace summary',
    description: 'Counts of profiles, groups and proxies you can see, running profiles, the plan and its limits, this token\'s scope and group limit, and the approval settings. Read-only. Call this first.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: {},
    summarize: () => 'Read the workspace summary',
    async handler(args, ctx) {
      const db = ctx.db;
      const profileWhere = await ctx.profileWhere({ deletedAt: null });
      const paidWhere = await ctx.deps.scopedProxyWhere(proxyScope.proxyScopeWhere('paid'));
      const freeWhere = await ctx.deps.scopedProxyWhere(proxyScope.proxyScopeWhere('free'));
      const [profiles, proxies, freeProxies, failing] = await Promise.all([
        db.profile.count({ where: profileWhere }),
        db.proxy.count({ where: paidWhere }),
        db.proxy.count({ where: freeWhere }),
        db.proxy.count({ where: proxyScope.andWhere(paidWhere, { lastStatus: 'fail' }) })
      ]);
      const groups = await ctx.visibleGroups();
      const running = await visibleRunning(ctx);
      const runningRows = running.size
        ? await db.profile.findMany({ where: { id: { in: [...running] } }, select: { id: true, title: true }, take: 25 })
        : [];
      const license = await ctx.license();
      const memory = await ctx.services.memory.get();
      const settings = ctx.settings();
      return {
        summary: `${plural(profiles, 'profile')}, ${running.size} running, ${plural(proxies, 'proxy', 'proxies')} (${failing} failing), ${plural(groups.length, 'group')}; plan ${license.tier}.`,
        data: {
          counts: { profiles, runningProfiles: running.size, groups: groups.length, proxies, failingProxies: failing, freeProxies },
          running: runningRows.map((r) => ({ id: r.id, name: r.title, startedByAi: ctx.tracker.isAiStartedProfile(r.id) })),
          plan: { tier: license.tier, type: license.type, state: license.state, daysLeft: license.daysLeft },
          limits: { maxParallelProfilesPerRun: license.maxParallel, seats: license.seats },
          token: {
            name: ctx.token.name,
            scope: ctx.token.scope,
            limitedToGroups: ctx.token.groupIds.length ? groups.filter((g) => ctx.token.groupIds.includes(g.id)).map((g) => g.name) : null,
            preApprovedTools: ctx.token.preApproved ? ctx.token.preApproved.tools : []
          },
          approvals: settings.approvalMode,
          pageDomainAllowList: settings.pageDomainAllowList,
          memory: { updatedAt: memory.updatedAt, isDefault: memory.isDefault, uri: memories.URIS.workspace }
        }
      };
    }
  },

  // ---- Profiles ----
  {
    name: 'list_profiles',
    title: 'List profiles',
    description: 'Lists profiles you can see, newest first, with group, tags, proxy (country and status, never credentials) and whether each is running. Filter by group (id or name), tag, status (running, stopped) or a search over names and notes. Paged: page and pageSize (max 100). Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: {
      group: groupRef().optional().describe('Group id or exact name.'),
      tag: z.string().trim().min(1).max(40).optional(),
      status: z.enum(['running', 'stopped', 'any']).optional().describe('Default any.'),
      search: z.string().trim().min(1).max(80).optional().describe('Matches profile names and notes.'),
      page: z.number().int().min(1).max(10000).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    summarize: (a) => `List profiles${a.group ? ` in group ${a.group}` : ''}${a.search ? ` matching "${a.search}"` : ''}`,
    async handler(a, ctx) {
      const page = a.page || 1;
      const pageSize = a.pageSize || 25;
      const and = [{ deletedAt: null }];
      if (a.group != null) { const g = await ctx.resolveGroup(a.group); and.push({ groupId: g.id }); }
      if (a.tag) and.push({ tags: { contains: JSON.stringify(a.tag) } });
      if (a.search) and.push({ OR: [{ title: { contains: a.search } }, { notes: { contains: a.search } }] });
      const running = await visibleRunning(ctx);
      if (a.status === 'running') and.push({ id: { in: [...running] } });
      if (a.status === 'stopped') and.push({ id: { notIn: [...running] } });
      const where = await ctx.profileWhere({ AND: and });
      const [total, rows] = await Promise.all([
        ctx.db.profile.count({ where }),
        ctx.db.profile.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { proxy: true, group: true } })
      ]);
      return {
        summary: `${plural(total, 'profile')} match; showing ${rows.length} (page ${page}).`,
        data: { total, page, pageSize, profiles: rows.map((p) => compactProfile(p, running)) }
      };
    }
  },
  {
    name: 'get_profile',
    title: 'Get a profile',
    description: 'One profile in detail: group, tags, notes, start URLs, proxy summary, fingerprint summary (OS, browser version, screen, GPU, noise) and timezone, language, location and WebRTC settings. Never returns passwords, 2FA, cookies or proxy credentials. Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: { id: id().describe('Profile id.') },
    targets: (a) => ({ profileIds: [a.id] }),
    summarize: (a) => `Read profile #${a.id}`,
    async handler(a, ctx) {
      await ctx.assertProfiles([a.id]);
      const p = await ctx.db.profile.findUnique({ where: { id: a.id }, include: { proxy: true, group: true } });
      if (!p || p.deletedAt) throw ctx.userError(`Profile #${a.id} was not found.`);
      const running = await visibleRunning(ctx);
      return { summary: `Profile "${p.title}"${running.has(p.id) ? ' (running)' : ''}.`, data: detailedProfile(p, running) };
    }
  },
  {
    name: 'profile_health',
    title: 'Profile health and CAPTCHA risk',
    description: 'Explains how likely a profile is to get CAPTCHAs and why: proxy health and blocklist, datacenter or home IP, shared proxy, timezone/language/location vs the proxy, WebRTC, third-party cookies, browsing history and fingerprint coherence, each with its fix. live: true also tests the proxy now and compares its exit country and timezone with the profile. Changes nothing.',
    scope: 'read',
    approval: 'none',
    annotations: { ...READ, openWorldHint: true },
    input: {
      id: id().describe('Profile id.'),
      live: z.boolean().optional().describe('Also test the proxy now (takes up to 30 seconds).')
    },
    targets: (a) => ({ profileIds: [a.id] }),
    summarize: (a) => `Check the health of profile #${a.id}${a.live ? ' (live proxy test)' : ''}`,
    async handler(a, ctx) {
      await ctx.assertProfiles([a.id]);
      const { scores } = await ctx.deps.captchaScores({ ids: [a.id] });
      const score = scores[a.id];
      if (!score) throw ctx.userError(`Profile #${a.id} was not found.`);
      let prelaunch = [];
      try { const r = await ctx.deps.prelaunchCheck({ ids: [a.id] }); prelaunch = (r.issues && r.issues[a.id]) || []; } catch (e) { prelaunch = []; }
      let live = null;
      if (a.live) {
        const r = await ctx.deps.analyzeProfileLeaks({ id: a.id });
        live = {
          trust: r.score,
          checks: r.checks,
          exit: r.geo && r.geo.success
            ? { ip: r.geo.ip, country: r.geo.country, city: r.geo.city, isp: r.geo.isp, timezone: r.geo.timezone, latencyMs: r.geo.latencyMs }
            : (r.geo ? { error: r.geo.error || 'The proxy did not answer.' } : null)
        };
      }
      const problems = score.factors.filter((f) => f.status !== 'pass');
      return {
        summary: `CAPTCHA risk grade ${score.grade} (score ${score.score}/100), ${plural(problems.length, 'problem')}.`,
        data: {
          profileId: a.id,
          captchaRisk: { score: score.score, grade: score.grade, level: score.level, usesProxy: score.usesProxy },
          factors: score.factors.map((f) => ({ key: f.key, status: f.status, impact: f.impact, details: f.params, fix: f.fix })),
          fixes: score.fixes,
          fixHelp: {
            'tz-auto': 'update_profile fixes ["tz-auto"]: timezone follows the proxy',
            'lang-auto': 'update_profile fixes ["lang-auto"]: language follows the proxy',
            'geo-auto': 'update_profile fixes ["geo-auto"]: location follows the proxy',
            'webrtc-safe': 'update_profile fixes ["webrtc-safe"]: WebRTC set to Forward',
            'check-proxy': 'check_proxy on the profile\'s proxy',
            'swap-proxy': 'assign_proxy with a healthy, unused proxy from the same country',
            'assign-proxy': 'assign_proxy with a healthy proxy',
            'warm-up': 'start_warmer for this profile',
            'allow-3p-cookies': 'workspace setting; only the Owner can change it in the app'
          },
          prelaunchIssues: prelaunch,
          live
        }
      };
    }
  },
  {
    name: 'create_profile',
    title: 'Create a profile',
    description: 'Creates one profile. SoftGlaze generates its fingerprint for the chosen OS and engine. Optional: group, proxy (id from list_proxies), start URL, notes, tags. Timezone, language and location follow the proxy. Asks the user first. Never sets passwords or cookies.',
    scope: 'operate',
    permission: 'profiles.create',
    feature: 'profiles', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: CHANGE,
    input: {
      name: z.string().trim().min(1).max(80),
      group: groupRef().optional().describe('Group id or exact name.'),
      os: z.enum(['Windows', 'macOS', 'Linux', 'host']).optional().describe('Default host: the OS of this computer, which is the most consistent choice.'),
      deviceClass: z.enum(['desktop', 'mobile']).optional(),
      browser: z.enum(['chromium', 'firefox']).optional().describe('Default chromium. Page tools and macros need chromium.'),
      proxyId: id().optional(),
      startUrl: httpUrl().optional(),
      notes: z.string().max(1000).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).optional()
    },
    targets: () => ({ profileIds: [], newProfiles: 1 }),
    summarize: (a) => `Create profile "${a.name}"${a.group ? ` in group ${a.group}` : ''}${a.proxyId ? ` with proxy #${a.proxyId}` : ''}`,
    async handler(a, ctx) {
      const group = a.group != null ? await ctx.resolveGroup(a.group) : null;
      ctx.assertGroupAllowed(group ? group.id : null, { forNewProfile: true });
      if (a.proxyId) await ctx.assertProxy(a.proxyId);
      if (a.startUrl) ctx.assertDomainAllowed(a.startUrl);
      const payload = {
        title: a.name,
        groupId: group ? group.id : null,
        randomFingerprint: true,
        deviceClass: a.deviceClass || 'desktop',
        browserCore: a.browser === 'firefox' ? 'Firefox' : 'Chromium',
        proxyId: a.proxyId || null,
        systemProxyBehavior: a.proxyId ? 'PROFILE_PROXY' : 'DIRECT',
        notes: a.notes || null,
        tags: a.tags || undefined
      };
      if (a.os && a.os !== 'host') payload.os = a.os;
      if (a.startUrl) payload.startupUrls = a.startUrl;
      const created = await ctx.deps.createProfile(payload);
      const row = await ctx.db.profile.findUnique({ where: { id: created.id }, include: { proxy: true, group: true } });
      return { summary: `Created profile "${created.title}" (#${created.id}).`, data: detailedProfile(row || created, new Set()) };
    }
  },
  {
    name: 'update_profile',
    title: 'Update a profile',
    description: 'Changes a profile\'s name, group, tags (replaces the list), notes, start URL or proxy (proxyId, or null to remove it), and can apply CAPTCHA fixes: tz-auto, lang-auto, geo-auto (follow the proxy) and webrtc-safe. Asks the user first. Never changes the fingerprint, passwords, 2FA or cookies, and never deletes.',
    scope: 'operate',
    permission: 'profiles.edit',
    feature: 'profiles', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: { ...CHANGE, idempotentHint: true },
    input: {
      id: id(),
      name: z.string().trim().min(1).max(80).optional(),
      group: groupRef().nullable().optional().describe('Group id or name; null removes it from its group.'),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      notes: z.string().max(1000).nullable().optional(),
      startUrl: httpUrl().nullable().optional(),
      proxyId: id().nullable().optional(),
      fixes: z.array(z.enum(Object.keys(captchaScore.PROFILE_FIELD_FIXES))).max(4).optional()
    },
    targets: (a) => ({ profileIds: [a.id] }),
    summarize: (a) => {
      const parts = [];
      if (a.name) parts.push(`rename to "${a.name}"`);
      if (a.group !== undefined) parts.push(a.group === null ? 'remove from group' : `move to group ${a.group}`);
      if (a.tags) parts.push('set tags');
      if (a.notes !== undefined) parts.push('edit notes');
      if (a.startUrl !== undefined) parts.push(a.startUrl ? 'set start URL' : 'clear start URL');
      if (a.proxyId !== undefined) parts.push(a.proxyId ? `set proxy #${a.proxyId}` : 'remove proxy');
      if (a.fixes && a.fixes.length) parts.push(`apply fixes ${a.fixes.join(', ')}`);
      return `Update profile #${a.id}: ${parts.join(', ') || 'no changes'}`;
    },
    async handler(a, ctx) {
      await ctx.assertProfiles([a.id], { edit: true });
      const payload = { id: a.id };
      if (a.name) payload.title = a.name;
      if (a.group !== undefined) {
        const g = a.group === null ? null : await ctx.resolveGroup(a.group);
        ctx.assertGroupAllowed(g ? g.id : null, { forNewProfile: true });
        payload.groupId = g ? g.id : null;
      }
      if (a.tags) payload.tags = a.tags;
      if (a.notes !== undefined) payload.notes = a.notes;
      if (a.startUrl !== undefined) {
        if (a.startUrl) ctx.assertDomainAllowed(a.startUrl);
        payload.startupUrls = a.startUrl || null;
      }
      if (a.proxyId !== undefined) {
        if (a.proxyId) await ctx.assertProxy(a.proxyId);
        payload.proxyId = a.proxyId || null;
        payload.systemProxyBehavior = a.proxyId ? 'PROFILE_PROXY' : 'DIRECT';
      }
      for (const fix of a.fixes || []) Object.assign(payload, captchaScore.PROFILE_FIELD_FIXES[fix]);
      if (Object.keys(payload).length === 1) throw ctx.userError('Nothing to change: give at least one field.');
      await ctx.deps.updateProfile(payload);
      const row = await ctx.db.profile.findUnique({ where: { id: a.id }, include: { proxy: true, group: true } });
      return { summary: `Updated profile "${row ? row.title : a.id}".`, data: detailedProfile(row, await visibleRunning(ctx)) };
    }
  },
  {
    name: 'batch_generate_profiles',
    title: 'Generate many profiles',
    description: 'Creates up to 50 profiles at once with unique generated fingerprints and, by default, one working proxy each from your pool (proxySource unique; optionally from one country). Proxies are live-checked first; profiles meant to have a proxy are never created without one. Asks the user first. Long runs continue in the background: follow them with get_run_status.',
    scope: 'operate',
    permission: 'profiles.create',
    feature: 'profiles', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: CHANGE,
    input: {
      count: z.number().int().min(1).max(50),
      country: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Two-letter country code').optional(),
      proxySource: z.enum(['unique', 'pool', 'free', 'none']).optional().describe('unique (default): one unused working proxy each; pool: reuse working proxies; free: working free proxies (not for logged-in accounts); none: no proxy.'),
      proxyGroupId: id().optional().describe('Only take proxies from this proxy group.'),
      group: groupRef().optional().describe('Existing group for the new profiles.'),
      newGroupName: z.string().trim().min(1).max(80).optional().describe('Create this group for them instead.'),
      namePrefix: z.string().trim().min(1).max(40).optional(),
      os: z.enum(['Windows', 'macOS', 'Linux', 'host']).optional(),
      deviceClass: z.enum(['desktop', 'mobile']).optional(),
      startUrl: httpUrl().optional()
    },
    targets: (a) => ({ profileIds: [], newProfiles: a.count }),
    summarize: (a) => `Generate ${plural(a.count, 'profile')}${a.country ? ` for ${a.country.toUpperCase()}` : ''}${a.group ? ` in group ${a.group}` : (a.newGroupName ? ` in new group "${a.newGroupName}"` : '')} (proxies: ${a.proxySource || 'unique'})`,
    async handler(a, ctx) {
      let groupId = null;
      if (a.group != null) { const g = await ctx.resolveGroup(a.group); groupId = g.id; }
      if (a.newGroupName && ctx.token.groupIds.length) throw ctx.denied('This token is limited to some groups, so it cannot create a new group. Pick one of its groups.');
      ctx.assertGroupAllowed(groupId, { forNewProfile: true });
      if (a.startUrl) ctx.assertDomainAllowed(a.startUrl);
      const source = a.proxySource || 'unique';
      const payload = {
        count: a.count,
        prefix: a.namePrefix || `${a.country ? a.country.toUpperCase() : 'AI'}-PROFILE`,
        os: a.os && a.os !== 'host' ? a.os : '',
        deviceClass: a.deviceClass || 'desktop',
        randomFingerprint: true,
        groupId,
        newGroupName: groupId ? undefined : a.newGroupName,
        proxyMode: source === 'none' ? 'direct' : (source === 'pool' ? 'pool' : 'unique'),
        proxySource: source === 'free' ? 'free' : 'paid',
        proxyGroupId: a.proxyGroupId,
        country: a.country ? a.country.toUpperCase() : undefined,
        startupUrls: a.startUrl || undefined,
        verifyProxies: true,
        notes: 'Created by SoftGlaze AI'
      };
      return ctx.runJob('batch_generate_profiles', `Generate ${a.count} profiles`, async (signal) => {
        const r = await ctx.deps.batchGenerateProfiles(payload, { signal });
        return {
          summary: r.message || `Created ${r.createdCount} of ${r.requested} profiles.`,
          data: {
            requested: r.requested,
            created: r.createdCount,
            cancelled: Boolean(r.cancelled),
            proxiesChecked: r.proxyChecked,
            proxiesFailed: r.proxyVerifyExcluded,
            noProxyReason: r.noProxyReason || null,
            groupId: r.groupId || null,
            profiles: (r.profiles || []).map((p) => ({ id: p.id, name: p.title })),
            errors: (r.errors || []).slice(0, 10)
          }
        };
      });
    }
  },

  // ---- Sessions ----
  {
    name: 'list_sessions',
    title: 'List running profiles',
    description: 'Lists the profiles running now that you can see, with how long they have run and whether an AI app started them. Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: {},
    summarize: () => 'List running profiles',
    async handler(a, ctx) {
      const running = await visibleRunning(ctx);
      const sessions = ctx.deps.listAllSessions().filter((s) => running.has(Number(s.sessionId)));
      const data = sessions.map((s) => ({
        profileId: Number(s.sessionId),
        name: s.profileName || null,
        engine: ctx.deps.isFirefoxSession(String(s.sessionId)) ? 'Firefox' : 'Chromium',
        uptime: s.uptime || null,
        startedAt: s.createdAt || null,
        startedByAi: ctx.tracker.isAiStartedProfile(Number(s.sessionId))
      }));
      return { summary: `${plural(data.length, 'profile')} running.`, data: { sessions: data } };
    }
  },
  {
    name: 'start_profile',
    title: 'Start a profile',
    description: 'Opens a profile\'s browser through its own proxy and fingerprint, optionally at a URL and optionally hidden (headless). Asks the user first. Stop it with stop_profile when you are done.',
    scope: 'operate',
    permission: 'profiles.launch',
    feature: 'profiles', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: { ...CHANGE, openWorldHint: true },
    input: {
      id: id(),
      url: httpUrl().optional().describe('Page to open first.'),
      headless: z.boolean().optional().describe('Run without a window.')
    },
    targets: (a) => ({ profileIds: [a.id] }),
    summarize: (a) => `Start profile #${a.id}${a.url ? ` at ${clip(a.url, 80)}` : ''}${a.headless ? ' (hidden)' : ''}`,
    async handler(a, ctx) {
      await ctx.assertProfiles([a.id]);
      if (a.url) ctx.assertDomainAllowed(a.url);
      const running = await visibleRunning(ctx);
      if (running.has(a.id)) {
        return { summary: `Profile #${a.id} is already running.`, data: { profileId: a.id, alreadyRunning: true } };
      }
      const s = await ctx.deps.launchProfile({ id: a.id, startUrl: a.url || 'about:blank', headless: Boolean(a.headless) });
      ctx.tracker.addProfile(ctx.token.id, a.id);
      const data = {
        profileId: a.id,
        sessionId: s && s.sessionId ? String(s.sessionId) : String(a.id),
        headless: Boolean(a.headless),
        fingerprintInjected: s ? s.injectionOk !== false : null,
        geoWarning: s && s.geoWarning ? s.geoWarning : null,
        rotatedToProxy: s && s.rotatedProxy ? s.rotatedProxy.name || null : null
      };
      if (ctx.includeWsEndpoint && s && s.wsEndpoint) data.wsEndpoint = s.wsEndpoint;
      return { summary: `Started profile #${a.id}.`, data };
    }
  },
  {
    name: 'stop_profile',
    title: 'Stop a profile',
    description: 'Closes a running profile\'s browser (its cookies and history are kept). Profiles this token started stop without asking; others ask the user first.',
    scope: 'operate',
    permission: 'profiles.launch',
    approval: 'self',
    selfKey: (a) => ({ kind: 'profile', id: a.id }),
    annotations: { ...CHANGE, idempotentHint: true },
    input: { id: id() },
    targets: (a) => ({ profileIds: [a.id] }),
    summarize: (a) => `Stop profile #${a.id}`,
    async handler(a, ctx) {
      await ctx.assertProfiles([a.id]);
      const r = await ctx.deps.closeSession(a.id);
      ctx.tracker.removeProfile(a.id);
      return { summary: r && r.closed ? `Stopped profile #${a.id}.` : `Profile #${a.id} was not running.`, data: { profileId: a.id, stopped: Boolean(r && r.closed) } };
    }
  },
  {
    name: 'stop_all_profiles',
    title: 'Stop all profiles',
    description: 'Closes every running profile you can see (within this token\'s groups), or only those AI apps started (onlyStartedByAi). Asks the user every time.',
    scope: 'operate',
    permission: 'profiles.launch',
    approval: 'always',
    annotations: { ...CHANGE, idempotentHint: true },
    input: { onlyStartedByAi: z.boolean().optional() },
    targets: () => ({ profileIds: [], dynamic: true }),
    resolveTargets: runningTargets,
    summarize: (a, info) => `Stop ${info && info.count != null ? plural(info.count, 'running profile') : 'all running profiles'}${a.onlyStartedByAi ? ' started by AI apps' : ''}`,
    async handler(a, ctx) {
      const ids = await runningTargets(a, ctx);
      const stopped = [];
      const errors = [];
      for (const pid of ids) {
        if (ctx.signal && ctx.signal.aborted) break;
        try { const r = await ctx.deps.closeSession(pid); if (r && r.closed) stopped.push(pid); ctx.tracker.removeProfile(pid); }
        catch (e) { errors.push({ profileId: pid, error: e.message }); }
      }
      return { summary: `Stopped ${plural(stopped.length, 'profile')}.`, data: { stopped, errors } };
    }
  },

  // ---- Proxies ----
  {
    name: 'list_proxies',
    title: 'List proxies',
    description: 'Lists proxies you can see with type, host, port, country, ISP, last check status, speed, blocklist result and how many profiles use each. Never returns usernames, passwords or rotation links. Free proxies are left out unless free is true. Paged. Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: {
      search: z.string().trim().min(1).max(80).optional().describe('Matches name or host.'),
      country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
      status: z.enum(['ok', 'fail', 'unchecked', 'any']).optional(),
      blocklisted: z.boolean().optional(),
      unused: z.boolean().optional().describe('Only proxies no profile uses.'),
      proxyGroupId: id().optional(),
      free: z.boolean().optional().describe('true: only free proxies.'),
      page: z.number().int().min(1).max(10000).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    summarize: (a) => `List proxies${a.country ? ` in ${a.country.toUpperCase()}` : ''}${a.status && a.status !== 'any' ? ` with status ${a.status}` : ''}`,
    async handler(a, ctx) {
      const page = a.page || 1;
      const pageSize = a.pageSize || 25;
      const and = [proxyScope.proxyScopeWhere(a.free ? 'free' : 'paid')];
      if (a.search) and.push({ OR: [{ name: { contains: a.search } }, { host: { contains: a.search } }] });
      if (a.country) and.push({ lastCountry: a.country.toUpperCase() });
      if (a.status === 'ok' || a.status === 'fail') and.push({ lastStatus: a.status });
      if (a.status === 'unchecked') and.push({ lastCheckedAt: null });
      if (typeof a.blocklisted === 'boolean') and.push({ lastBlacklisted: a.blocklisted });
      if (a.unused) and.push({ profiles: { none: { deletedAt: null } } });
      if (a.proxyGroupId) and.push({ proxyGroupId: a.proxyGroupId });
      const where = await ctx.deps.scopedProxyWhere({ AND: and.filter(Boolean) });
      const [total, rows] = await Promise.all([
        ctx.db.proxy.count({ where }),
        ctx.db.proxy.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { profiles: true } }, proxyGroup: true } })
      ]);
      return { summary: `${plural(total, 'proxy', 'proxies')} match; showing ${rows.length}.`, data: { total, page, pageSize, proxies: rows.map(compactProxy) } };
    }
  },
  {
    name: 'check_proxy',
    title: 'Check a proxy',
    description: 'Connects through a saved proxy now and reports whether it works, its exit IP, country, city, ISP, timezone and speed. The result is saved on the proxy. Does not change any profile.',
    scope: 'read',
    approval: 'none',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    input: { id: id().describe('Proxy id.') },
    summarize: (a) => `Check proxy #${a.id}`,
    async handler(a, ctx) {
      await ctx.assertProxy(a.id, { forRead: true });
      const r = await ctx.deps.checkProxy({ id: a.id });
      const data = {
        proxyId: a.id,
        working: Boolean(r && r.success),
        exit: r && r.success ? { ip: r.ip || null, country: r.country || null, region: r.region || null, city: r.city || null, isp: r.isp || null, timezone: r.timezone || null } : null,
        latencyMs: r && r.latencyMs != null ? r.latencyMs : null,
        error: r && !r.success ? ctx.scrub(r.error || 'The proxy did not answer.') : null
      };
      return { summary: data.working ? `Proxy #${a.id} works: ${data.exit.country || '?'} ${data.exit.isp || ''}, ${data.latencyMs} ms.` : `Proxy #${a.id} failed: ${data.error}`, data };
    }
  },
  {
    name: 'get_proxy_health',
    title: 'Proxy health history',
    description: 'With a proxy id: that proxy\'s recent checks (status, latency, country over time). Without: the recent health of your pool plus the vendor scoreboard (success rate, speed and blocklist rate per vendor from your own checks). Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: { id: id().optional(), limit: z.number().int().min(10).max(200).optional() },
    summarize: (a) => (a.id ? `Read health history of proxy #${a.id}` : 'Read pool health and vendor scoreboard'),
    async handler(a, ctx) {
      if (a.id) {
        await ctx.assertProxy(a.id, { forRead: true });
        const history = await ctx.deps.getProxyHealthHistory({ id: a.id, limit: a.limit || 50 });
        const proxy = await ctx.db.proxy.findUnique({ where: { id: a.id }, include: { _count: { select: { profiles: true } }, proxyGroup: true } });
        const ok = history.filter((h) => h.status === 'ok').length;
        return { summary: `${plural(history.length, 'check')} on record, ${ok} passed.`, data: { proxy: proxy ? compactProxy(proxy) : null, history } };
      }
      const recent = await ctx.deps.getRecentProxyHealth({ perProxy: 8, maxProxies: 40 });
      let scoreboard = null;
      try {
        const b = await ctx.deps.getVendorScoreboard();
        scoreboard = b && Array.isArray(b.vendors) ? b.vendors.slice(0, 25) : b;
      } catch (e) { scoreboard = null; }
      const regressed = recent.filter((r) => r.regressed).length;
      return {
        summary: `${plural(recent.length, 'proxy', 'proxies')} with recent checks, ${regressed} newly failing.`,
        data: {
          proxies: recent.map((r) => ({ proxyId: r.proxyId, name: r.name, type: r.type, lastStatus: r.lastStatus, lastLatencyMs: r.lastLatencyMs, okCount: r.okCount, failCount: r.failCount, regressed: r.regressed, lastCheckedAt: r.lastTs })),
          vendorScoreboard: scoreboard
        }
      };
    }
  },
  {
    name: 'assign_proxy',
    title: 'Assign proxies to profiles',
    description: 'Gives profiles a proxy. mode single: the same proxyId for all; unique: one different proxy each from source; pool: share the source round-robin; clear: remove the proxy. source all, unassigned (no profile uses it) or group (proxyGroupId); verifyProxies live-checks first. Free proxies are never used. Asks the user first.',
    scope: 'operate',
    permission: 'profiles.edit',
    feature: 'profiles', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: CHANGE,
    input: {
      profileIds: idList(100),
      mode: z.enum(['single', 'unique', 'pool', 'clear']),
      proxyId: id().optional().describe('For mode single.'),
      source: z.enum(['all', 'unassigned', 'group']).optional(),
      proxyGroupId: id().optional(),
      verifyProxies: z.boolean().optional()
    },
    targets: (a) => ({ profileIds: a.profileIds }),
    summarize: (a) => `${a.mode === 'clear' ? 'Remove the proxy from' : `Assign proxies (${a.mode}${a.proxyId ? ` #${a.proxyId}` : ''}) to`} ${plural(a.profileIds.length, 'profile')}`,
    async handler(a, ctx) {
      if (a.mode === 'single' && !a.proxyId) throw ctx.userError('mode single needs proxyId.');
      if (a.source === 'group' && !a.proxyGroupId) throw ctx.userError('source group needs proxyGroupId.');
      await ctx.assertProfiles(a.profileIds, { edit: true });
      if (a.proxyId) await ctx.assertProxy(a.proxyId);
      const r = await ctx.deps.bulkAssignProxies({
        ids: a.profileIds, mode: a.mode, proxyId: a.proxyId, source: a.source || 'unassigned', proxyGroupId: a.proxyGroupId, verifyProxies: Boolean(a.verifyProxies)
      });
      return {
        summary: `Updated ${plural(r.assigned || 0, 'profile')}${r.limited ? `; only ${r.source} proxies were available` : ''}.`,
        data: { updated: r.updated || [], errors: (r.errors || []).slice(0, 20), socks4OnChromium: r.socks4Chromium || [], proxiesAvailable: r.source }
      };
    }
  },
  {
    name: 'rotate_proxy_ip',
    title: 'Rotate a proxy\'s IP',
    description: 'Asks the proxy vendor for a new IP using the rotation link saved on the proxy (or the vendor\'s API where SoftGlaze supports it). Give proxyId for a proxy in your pool, or profileId to rotate the proxy a profile uses, a profile shared with you "use only" included. Only works where the vendor supports rotation. Asks the user first.',
    scope: 'operate',
    permission: 'proxies.manage',
    feature: 'proxies', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: { ...CHANGE, openWorldHint: true },
    input: { proxyId: id().optional(), profileId: id().optional() },
    // By profile, the registry checks access to it (a "use only" share is enough) and names it.
    targets: (a) => ({ profileIds: a.profileId ? [a.profileId] : [] }),
    summarize: (a) => (a.profileId ? `Rotate the IP of the proxy profile #${a.profileId} uses` : `Rotate the IP of proxy #${a.proxyId}`),
    async handler(a, ctx) {
      if (a.profileId) {
        const p = await ctx.db.profile.findUnique({ where: { id: a.profileId }, select: { proxyId: true, deletedAt: true } });
        if (!p || p.deletedAt) throw ctx.userError(`Profile #${a.profileId} was not found.`);
        if (p.proxyId == null) throw ctx.userError(`Profile #${a.profileId} has no proxy to rotate.`);
        if (a.proxyId && a.proxyId !== p.proxyId) throw ctx.userError(`Profile #${a.profileId} uses proxy #${p.proxyId}, not #${a.proxyId}.`);
        // The window's Rotate IP on a profile row: proxies.manage and profiles.launch, logged on the profile.
        const r = await ctx.deps.rotateProfileProxyIp({ id: a.profileId });
        return { summary: r && r.ok ? `The vendor accepted the rotation for the proxy of profile #${a.profileId}. Run check_proxy to see the new IP.` : `The vendor refused the rotation (HTTP ${r && r.status}).`, data: { profileId: a.profileId, proxyId: p.proxyId, ok: Boolean(r && r.ok), status: r ? r.status : null, latencyMs: r ? r.latencyMs : null } };
      }
      if (!a.proxyId) throw ctx.userError('Give proxyId (a proxy in your pool) or profileId (the proxy a profile uses).');
      await ctx.assertProxy(a.proxyId);
      const r = await ctx.deps.rotateProxyIp({ id: a.proxyId });
      return { summary: r && r.ok ? `The vendor accepted the rotation for proxy #${a.proxyId}. Run check_proxy to see the new IP.` : `The vendor refused the rotation (HTTP ${r && r.status}).`, data: { proxyId: a.proxyId, ok: Boolean(r && r.ok), status: r ? r.status : null, latencyMs: r ? r.latencyMs : null } };
    }
  },
  {
    name: 'find_free_proxies',
    title: 'Find free proxies',
    description: 'Searches public free-proxy lists, tests each candidate (working, anonymous, country) and adds the ones that pass to the "Free proxies" group. Free proxies are slow and short-lived and are not for logged-in accounts; they are never assigned automatically. Asks the user first. Runs in the background; follow with get_run_status.',
    scope: 'operate',
    permission: 'proxies.manage',
    feature: 'proxies', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: { ...CHANGE, openWorldHint: true },
    input: {
      protocol: z.enum(['http', 'socks5']).optional(),
      country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
      limit: z.number().int().min(1).max(25).optional()
    },
    summarize: (a) => `Find up to ${a.limit || 10} free ${a.protocol || 'http'} proxies${a.country ? ` in ${a.country.toUpperCase()}` : ''}`,
    async handler(a, ctx) {
      return ctx.runJob('find_free_proxies', 'Find free proxies', async () => {
        const r = await ctx.deps.harvestFreeProxies({ protocol: a.protocol || 'http', country: a.country ? a.country.toUpperCase() : undefined, limit: a.limit || 10 });
        return {
          summary: `Added ${plural(r.added || 0, 'free proxy', 'free proxies')} after testing ${r.checked || 0}.`,
          data: { added: r.added || 0, checked: r.checked || 0, stopped: r.stopped || null, proxies: (r.proxies || []).map((p) => ({ id: p.id, name: p.name, type: p.type, country: p.lastCountry || null, latencyMs: p.lastLatencyMs })) }
        };
      }, { cancel: () => ctx.deps.cancelFreeProxyHarvest() });
    }
  },

  // ---- Groups ----
  {
    name: 'list_groups',
    title: 'List groups',
    description: 'Lists profile groups with how many of your visible profiles each holds. Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: {},
    summarize: () => 'List groups',
    async handler(a, ctx) {
      const groups = await ctx.visibleGroups();
      return { summary: `${plural(groups.length, 'group')}.`, data: { groups } };
    }
  },
  {
    name: 'create_group',
    title: 'Create a group',
    description: 'Creates an empty profile group. Asks the user first.',
    scope: 'operate',
    permission: 'profiles.edit',
    feature: 'groups', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: CHANGE,
    input: { name: z.string().trim().min(1).max(80), color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional() },
    summarize: (a) => `Create group "${a.name}"`,
    async handler(a, ctx) {
      if (ctx.token.groupIds.length) throw ctx.denied('This token is limited to some groups, so it cannot create groups.');
      const existing = (await ctx.db.group.findMany({ where: await ctx.deps.scopedGroupWhere(undefined), select: { id: true, name: true } })).find((g) => g.name.toLowerCase() === a.name.toLowerCase());
      if (existing) return { summary: `Group "${existing.name}" already exists (#${existing.id}).`, data: { id: existing.id, name: existing.name, created: false } };
      const g = await ctx.deps.createGroup({ name: a.name, color: a.color });
      return { summary: `Created group "${g.name}" (#${g.id}).`, data: { id: g.id, name: g.name, created: true } };
    }
  },
  {
    name: 'move_profiles_to_group',
    title: 'Move profiles to a group',
    description: 'Puts profiles into a group (id or name), or takes them out of their group with group null. Asks the user first.',
    scope: 'operate',
    permission: 'profiles.edit',
    feature: 'groups', // Visible features: the window's rule (featureGate.js)
    approval: 'ask',
    annotations: { ...CHANGE, idempotentHint: true },
    input: { profileIds: idList(200), group: groupRef().nullable() },
    targets: (a) => ({ profileIds: a.profileIds }),
    summarize: (a) => `Move ${plural(a.profileIds.length, 'profile')} ${a.group === null ? 'out of their group' : `to group ${a.group}`}`,
    async handler(a, ctx) {
      const g = a.group === null ? null : await ctx.resolveGroup(a.group);
      ctx.assertGroupAllowed(g ? g.id : null, { forNewProfile: true });
      await ctx.assertProfiles(a.profileIds, { edit: true });
      const r = await ctx.deps.assignProfilesToGroup({ ids: a.profileIds, groupId: g ? g.id : null });
      return { summary: `Moved ${plural(r.assigned || 0, 'profile')}${g ? ` to "${g.name}"` : ' out of their group'}.`, data: { moved: r.assigned || 0, groupId: g ? g.id : null } };
    }
  },

  // ---- Automation ----
  {
    name: 'list_macros',
    title: 'List macros',
    description: 'Lists the macros you can see: id, name, description and number of steps. Read-only.',
    scope: 'read',
    permission: 'automation.run',
    approval: 'none',
    annotations: READ,
    input: {},
    summarize: () => 'List macros',
    async handler(a, ctx) {
      const list = await ctx.deps.getMacros();
      return { summary: `${plural(list.length, 'macro')}.`, data: { macros: list.map((m) => ({ id: m.id, name: m.name, description: m.description || '', steps: m.stepCount, updatedAt: m.updatedAt })) } };
    }
  },
  {
    name: 'get_macro',
    title: 'Get a macro',
    description: 'One macro\'s steps. Typed values are hidden (they often hold passwords) unless they are {{placeholders}}. Read-only.',
    scope: 'read',
    permission: 'automation.run',
    approval: 'none',
    annotations: READ,
    input: { id: id() },
    summarize: (a) => `Read macro #${a.id}`,
    async handler(a, ctx) {
      const m = (await ctx.deps.getMacros()).find((x) => x.id === a.id);
      if (!m) throw ctx.userError(`Macro #${a.id} was not found, or you cannot see it.`);
      return { summary: `Macro "${m.name}" has ${plural(m.stepCount, 'step')}.`, data: { id: m.id, name: m.name, description: m.description || '', steps: redactMacroSteps(m.steps), updatedAt: m.updatedAt } };
    }
  },
  {
    name: 'save_macro',
    title: 'Save a macro',
    description: 'Creates a macro, or replaces an existing one\'s steps (id). Steps are data, checked by the same validator as the app\'s editor. Step types: goto {url}, click {selector}, type {selector, value}, keypress {key}, scroll {steps}, wait {ms}, move {selector | x,y}, hover {selector, ms}, select {selector, value, by}, waitFor {selector, state visible|hidden}, submit {selector}, check {selector, state checked|unchecked}, clear {selector}; optional: true and timeout (ms) on element steps. Use {{name}} placeholders for personal values. Asks the user first.',
    scope: 'operate',
    permission: 'automation.run',
    approval: 'ask',
    annotations: CHANGE,
    input: {
      id: id().optional().describe('Existing macro to replace.'),
      name: z.string().trim().min(1).max(80),
      description: z.string().max(500).optional(),
      steps: z.array(z.record(z.string(), z.any())).min(1).max(200)
    },
    summarize: (a) => `${a.id ? `Replace macro #${a.id}` : 'Create macro'} "${a.name}" with ${plural(a.steps.length, 'step')}`,
    async handler(a, ctx) {
      a.steps.forEach((s, i) => {
        if (s && s.value === HIDDEN_VALUE) throw ctx.userError(`Step ${i + 1} still has a hidden value. Hidden values cannot be saved back; use a {{placeholder}} or ask the user to edit that step in the app.`);
      });
      let steps;
      try { steps = ctx.deps.normalizeMacroSteps(a.steps); } catch (e) { throw ctx.userError(e.message); }
      const saved = await ctx.deps.saveMacro({ id: a.id, name: a.name, description: a.description, steps });
      return { summary: `Saved macro "${saved.name}" (#${saved.id}, ${plural(saved.stepCount, 'step')}).`, data: { id: saved.id, name: saved.name, steps: saved.stepCount } };
    }
  },
  {
    name: 'run_macro',
    title: 'Run a macro',
    description: 'Runs a saved macro on one or more profiles, a few at a time. concurrency is reduced to your plan\'s limit (Pro 3, Enterprise 10). Profiles that are not running are started and closed again afterwards. Asks the user first (every time for more than one profile). Returns a runId for get_run_status and stop_run.',
    scope: 'operate',
    permission: 'automation.run',
    approval: 'ask',
    many: (a) => a.profileIds.length > 1,
    annotations: { ...CHANGE, openWorldHint: true },
    input: { macroId: id(), profileIds: idList(200), concurrency: z.number().int().min(1).max(50).optional() },
    targets: (a) => ({ profileIds: a.profileIds }),
    summarize: (a) => `Run macro #${a.macroId} on ${plural(a.profileIds.length, 'profile')}${a.concurrency ? `, ${a.concurrency} at a time` : ''}`,
    async handler(a, ctx) {
      await ctx.assertProfiles(a.profileIds);
      const limits = await ctx.license();
      const r = await ctx.deps.runParallelMacro({ macroId: a.macroId, profileIds: a.profileIds, concurrency: a.concurrency, continueOnError: true, closeWhenDone: true });
      ctx.tracker.addRun(ctx.token.id, r.runId, 'macro');
      const clamped = a.concurrency && r.concurrency < a.concurrency;
      return {
        summary: `Started run ${r.runId} on ${plural(a.profileIds.length, 'profile')}, ${r.concurrency} at a time${clamped ? ` (your plan allows ${limits.maxParallel})` : ''}.`,
        data: { runId: r.runId, profiles: a.profileIds.length, concurrency: r.concurrency, requestedConcurrency: a.concurrency || null, planLimit: limits.maxParallel }
      };
    }
  },
  {
    name: 'get_run_status',
    title: 'Run status',
    description: 'Status of a macro run, warm-up or background job by runId: running or finished, with passed/failed counts or the job result. Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: { runId: z.string().trim().min(3).max(100) },
    summarize: (a) => `Read the status of run ${a.runId}`,
    async handler(a, ctx) {
      const runId = a.runId;
      if (runId.startsWith('job-')) {
        const j = ctx.jobs.get(runId, ctx.token.id);
        if (!j) throw ctx.userError(`No background job ${runId} for this token (results are kept 30 minutes).`);
        return { summary: j.running ? `${j.label} is still running.` : (j.error ? `${j.label} failed: ${j.error}` : (j.result && j.result.summary) || `${j.label} finished.`), data: j };
      }
      if (runId.startsWith('par-')) {
        const s = await ctx.deps.getParallelRunStatus({ runId });
        if (!s.known) throw ctx.userError(`Run ${runId} is not known (finished runs are kept 10 minutes).`);
        return { summary: s.running ? `Run ${runId} is still running.` : `Run ${runId} finished: ${s.summary ? `${s.summary.passed}/${s.summary.total} passed` : 'no summary'}.`, data: { runId, running: s.running, summary: s.summary, startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null, finishedAt: s.finishedAt ? new Date(s.finishedAt).toISOString() : null } };
      }
      if (runId.startsWith('warm-')) {
        const w = (ctx.deps.listActiveWarmers() || []).find((r) => r.runId === runId);
        if (!w) return { summary: `Warm-up ${runId} is not running (finished or stopped).`, data: { runId, running: false } };
        const last = (w.logs || []).slice(-5).map((l) => ({ level: l.level, message: l.message, profileId: l.profileId || null }));
        return { summary: `Warm-up ${runId}: ${w.done}/${w.total} done, ${w.active} warming now.`, data: { runId, running: true, total: w.total, done: w.done, active: w.active, remaining: w.remaining, recent: last } };
      }
      throw ctx.userError('Unknown runId. Run ids start with par-, warm- or job-.');
    }
  },
  {
    name: 'stop_run',
    title: 'Stop a run',
    description: 'Stops a macro run, warm-up or background job by runId. Runs this token started stop without asking; others ask the user first. Profiles a run opened are closed by the run.',
    scope: 'operate',
    permission: 'automation.run',
    approval: 'self',
    selfKey: (a) => ({ kind: 'run', id: a.runId }),
    annotations: { ...CHANGE, idempotentHint: true },
    input: { runId: z.string().trim().min(3).max(100) },
    summarize: (a) => `Stop run ${a.runId}`,
    async handler(a, ctx) {
      const runId = a.runId;
      let stopped = false;
      if (runId.startsWith('job-')) stopped = ctx.jobs.cancel(runId, ctx.token.id);
      else if (runId.startsWith('par-')) stopped = Boolean((await ctx.deps.stopParallelRun({ runId })).stopped);
      else if (runId.startsWith('warm-')) stopped = Boolean((await ctx.deps.stopWarmer({ runId, force: true })).stopped);
      else throw ctx.userError('Unknown runId. Run ids start with par-, warm- or job-.');
      ctx.tracker.removeRun(runId);
      return { summary: stopped ? `Stopping run ${runId}.` : `Run ${runId} was not running.`, data: { runId, stopped } };
    }
  },
  {
    name: 'start_warmer',
    title: 'Warm up profiles',
    description: 'Starts the Cookie Warmer: each profile visits sites for a while (scrolling, optional light clicking) to build normal cookies and history. Default sites are a mix of popular ones. concurrency is limited by your plan. Asks the user first. Returns a runId.',
    scope: 'operate',
    permission: 'automation.run',
    approval: 'ask',
    many: (a) => a.profileIds.length > 1,
    annotations: { ...CHANGE, openWorldHint: true },
    input: {
      profileIds: idList(50),
      sites: z.array(z.object({ url: httpUrl(), seconds: z.number().int().min(5).max(600).optional() })).max(20).optional(),
      concurrency: z.number().int().min(1).max(10).optional(),
      headless: z.boolean().optional()
    },
    targets: (a) => ({ profileIds: a.profileIds }),
    summarize: (a) => `Warm up ${plural(a.profileIds.length, 'profile')} on ${a.sites ? plural(a.sites.length, 'site') : 'the default sites'}`,
    async handler(a, ctx) {
      await ctx.assertProfiles(a.profileIds);
      for (const s of a.sites || []) ctx.assertDomainAllowed(s.url);
      const limits = await ctx.license();
      const concurrency = Math.max(1, Math.min(a.concurrency || 1, limits.maxParallel || 1));
      const r = await ctx.deps.startWarmer({
        profileIds: a.profileIds,
        sites: a.sites ? a.sites.map((s) => ({ url: s.url, seconds: s.seconds || 45, scroll: true, clickMode: 'none' })) : undefined,
        concurrency,
        headless: Boolean(a.headless)
      });
      ctx.tracker.addRun(ctx.token.id, r.runId, 'warmer');
      return { summary: `Started warm-up ${r.runId} for ${plural(a.profileIds.length, 'profile')}, ${concurrency} at a time.`, data: { runId: r.runId, profiles: a.profileIds.length, sites: r.sites, concurrency } };
    }
  },

  // ---- Activity ----
  {
    name: 'get_activity',
    title: 'Recent activity',
    description: 'Recent workspace activity you may see (launches, edits, macro and warm-up runs, proxy changes), newest first, optionally for one profile or one action. Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: {
      profileId: id().optional(),
      action: z.string().trim().min(1).max(60).optional(),
      limit: z.number().int().min(1).max(200).optional()
    },
    targets: (a) => ({ profileIds: a.profileId ? [a.profileId] : [] }),
    summarize: (a) => `Read recent activity${a.profileId ? ` of profile #${a.profileId}` : ''}`,
    async handler(a, ctx) {
      const take = a.limit || 50;
      const where = {};
      if (a.action) where.action = a.action;
      if (a.profileId) {
        await ctx.assertProfiles([a.profileId]);
        where.profileId = a.profileId;
      } else if (!(await ctx.isUnrestrictedViewer())) {
        const visible = await ctx.db.profile.findMany({ where: await ctx.profileWhere({}), select: { id: true } });
        const ids = visible.map((p) => p.id);
        where.OR = [{ profileId: { in: ids } }];
        if (!ctx.token.groupIds.length && ctx.memberId != null) where.OR.push({ profileId: 0, memberId: ctx.memberId });
      }
      const rows = await ctx.db.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
      const memberIds = [...new Set(rows.map((r) => r.memberId).filter((x) => x != null && x >= 0))];
      const profileIds = [...new Set(rows.map((r) => r.profileId).filter(Boolean))];
      const [members, profiles] = await Promise.all([
        memberIds.length ? ctx.db.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } }) : [],
        profileIds.length ? ctx.db.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, title: true } }) : []
      ]);
      const mName = new Map(members.map((m) => [m.id, m.name]));
      const pName = new Map(profiles.map((p) => [p.id, p.title]));
      return {
        summary: `${plural(rows.length, 'activity entry', 'activity entries')}.`,
        data: {
          activity: rows.map((r) => ({
            id: r.id,
            at: iso(r.createdAt),
            action: r.action,
            detail: r.detail ? ctx.scrub(clip(r.detail, 240)) : null,
            member: r.memberId == null ? 'Owner' : (mName.get(r.memberId) || (r.memberId < 0 ? 'Super Admin' : `Member #${r.memberId}`)),
            profileId: r.profileId || null,
            profileName: r.profileId ? (pName.get(r.profileId) || null) : null
          }))
        }
      };
    }
  },

  // ---- Memory ----
  {
    name: 'read_memory',
    title: 'Read the workspace memory',
    description: 'Returns the workspace memory (the user\'s notes for AI apps: naming, groups, proxy rules, working hours, never-do list), or one section of it by heading. Read this before acting. Read-only.',
    scope: 'read',
    approval: 'none',
    annotations: READ,
    input: { section: z.string().trim().min(1).max(80).optional().describe('A heading, for example "Proxy rules".') },
    summarize: (a) => `Read the workspace memory${a.section ? ` section "${a.section}"` : ''}`,
    async handler(a, ctx) {
      const mem = await ctx.services.memory.get();
      if (a.section) {
        const found = memories.findSection(mem.markdown, a.section);
        if (!found) throw ctx.userError(`The workspace memory has no section "${a.section}".`);
        const text = found.lines.slice(found.start, found.end).join('\n').trim();
        return { summary: `Section "${a.section}".`, content: [{ type: 'text', text }] };
      }
      return { summary: `Workspace memory (${mem.bytes} bytes${mem.isDefault ? ', still the template' : ''}).`, content: [{ type: 'text', text: mem.markdown }] };
    }
  },
  {
    name: 'update_memory',
    title: 'Update the workspace memory',
    description: 'Adds to the workspace memory (mode append, optionally under a section heading, which is created if missing) or replaces one section (mode replace_section). Limited to 20 KB. Asks the user first. Write rules the user stated, never secrets.',
    scope: 'operate',
    approval: 'ask',
    annotations: CHANGE,
    input: {
      mode: z.enum(['append', 'replace_section']),
      section: z.string().trim().min(1).max(80).optional(),
      text: z.string().min(1).max(8000)
    },
    summarize: (a) => `${a.mode === 'append' ? 'Add to' : 'Replace'} the workspace memory${a.section ? ` section "${a.section}"` : ''} (${a.text.length} characters)`,
    async handler(a, ctx) {
      const mem = await ctx.services.memory.get();
      const next = memories.applyMemoryUpdate(mem.markdown, a);
      const saved = await ctx.services.memory.set(next);
      return { summary: `Saved the workspace memory (${saved.bytes} of ${saved.maxBytes} bytes).`, data: { updatedAt: saved.updatedAt, bytes: saved.bytes } };
    }
  },

  // ---- Expert ----
  {
    name: 'get_cdp_endpoint',
    title: 'Hand a profile to Playwright or DevTools (Expert)',
    description: 'Returns the Chrome DevTools WebSocket endpoint of a running Chromium profile so Playwright, Puppeteer or Chrome DevTools MCP can attach to it. Warning: an outside debugger is detectable by sites (its own Runtime.enable and other commands); SoftGlaze\'s own page tools are quieter. Expert mode only, Owner tokens with the full scope, asks every time.',
    scope: 'full',
    expert: true,
    approval: 'always',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    input: { profileId: id() },
    targets: (a) => ({ profileIds: [a.profileId] }),
    summarize: (a) => `Hand profile #${a.profileId} to an outside debugger (detectable)`,
    async handler(a, ctx) {
      await ctx.assertProfiles([a.profileId]);
      if (ctx.deps.isFirefoxSession(String(a.profileId))) throw ctx.userError('This profile runs on Firefox, which has no DevTools endpoint here.');
      const h = await ctx.deps.getAutomationPage(String(a.profileId));
      if (!h) throw ctx.userError(`Profile #${a.profileId} is not running. Start it first with start_profile.`);
      if (!h.wsEndpoint) throw ctx.userError('This session has no DevTools endpoint.');
      ctx.deps.markAutomationDriven(a.profileId);
      return {
        summary: `DevTools endpoint for profile #${a.profileId}. It works until the profile stops.`,
        data: { profileId: a.profileId, wsEndpoint: h.wsEndpoint, warning: 'Detectable: an outside DevTools client sends its own commands, which anti-bot scripts can notice. Close your client before stopping the profile.' }
      };
    }
  },

  ...PAGE_TOOLS
];

module.exports = { TOOLS, compactProfile, detailedProfile, compactProxy, redactMacroSteps, HIDDEN_VALUE };
