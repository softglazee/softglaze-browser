/**
 * Cross test: the phone app's REAL relay code (SoftGlaze-Mobile app/src/features/live, imported
 * read only) against the REAL desktop companion (src/main/mobile, as a child process:
 * desktopPeer.cjs) through the real relay (SoftGlaze-Mobile relay/dist). No fake PC.
 *
 * Run from this repository:  node test/cross/run.cjs   (uses the phone app's jest + jest-expo)
 *
 * Covers: pairing with the same 6 digit code, link + presence + IK, snapshot (+ this phone's own
 * member), approval with tokenName allowed once and another denied, an approval made while the
 * phone is away answered after the reconnect, an approval sent while the phone is in the
 * background (socket open, nothing read: pushed within seconds, delivered once on return), an
 * approval answered on the PC ending on the phone (live, and as a silent update push in the
 * background), start/stop a profile, profile sync PC -> phone, unpair from the phone, revoke from
 * the desktop. The relay writes its pushes to a file (RELAY_PUSH_SINK_FILE, no FCM).
 */
import { decodePairingPayload, generateIdentity, setRandomSource, type HttpFn } from '@softglaze/protocol';

jest.mock('expo-sqlite/kv-store', () => {
  const m = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (k: string) => m.get(k) ?? null,
      setItemSync: (k: string, v: string) => void m.set(k, v),
      removeItemSync: (k: string) => void m.delete(k),
    },
  };
});
jest.mock('expo-secure-store', () => {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void m.set(k, v),
    deleteItemAsync: async (k: string) => void m.delete(k),
  };
});
jest.mock('@/../modules/sg-browser-profiles', () => ({
  __esModule: true,
  default: {
    getCapabilities: () => ({ platform: 'android', engine: 'webview', multiProfile: false, proxyOverride: false }),
    getCookies: async (_id: string, urls: string[]) => [{ url: urls[0], cookies: [], withAttributes: true, records: [] }],
    setCookies: async (_id: string, list: unknown[]) => ({ set: list.length, failed: 0 }),
    clearCookies: async () => true,
    flush: async () => true,
    deleteProfileData: async () => true,
  },
}));
jest.mock('@/data/storage/prefs', () => ({ getPrefs: () => null, getPref: () => null, setPref: () => {} }));

/* eslint-disable import/first */
import type { WorkspaceEvent } from '@/data/client';
import { getRecord, initRepository } from '@/features/phone/data/repository';
import { runPairing } from '@/features/security/pairing/pairingFlow';
import type { PairedPc } from '@/features/security/pairing/pairedPcs';
import { localIdOf, phoneSyncLocal } from '@/features/sync/data/adapter';
import { createSyncService } from '@/features/sync/data/service';
import { kvStateStore, loadKeyring, secureKeyringStore } from '@/features/sync/data/stores';
import { openRelays, configureRelay, resetRelays, type WebSocketCtor } from '@/features/live/RelayConnection';
import { readPush } from '@/features/live/pushPayload';
import { RelayPairingTransport } from '@/features/live/RelayPairingTransport';
import { RelayWorkspaceClient, sendRevokeAndUnlink } from '@/features/live/RelayWorkspaceClient';
/* eslint-enable import/first */

const nodeRequire = jest.requireActual<NodeRequire>('module').createRequire(__filename);
const { spawn } = nodeRequire('node:child_process') as typeof import('node:child_process');
const { createInterface } = nodeRequire('node:readline') as typeof import('node:readline');
const path = nodeRequire('node:path') as typeof import('node:path');

interface Harness {
  canRun(): boolean;
  startRelay(env?: Record<string, string>): Promise<{ port: number; log: string[]; dataDir: string; stop(): Promise<void> }>;
  nodeHttp: HttpFn;
  wsClient(): WebSocketCtor;
}
const MOBILE = process.env.SG_MOBILE_REPO || 'D:/sgm-live';
const H = nodeRequire(path.join(MOBILE, 'tools/sync-peer/harness.cjs')) as Harness;
const d = H.canRun() ? describe : describe.skip;
const { webcrypto } = nodeRequire('crypto') as { webcrypto: { getRandomValues<T extends Uint8Array>(a: T): T } };
const fs = nodeRequire('node:fs') as typeof import('node:fs');
const os = nodeRequire('node:os') as typeof import('node:os');

// The real `ws` client, keeping every socket so a test can "send the app to the background": the
// TCP socket stays open but nothing is read any more (no pong, no close), like a frozen phone app.
type NodeWs = { readyState: number; _socket?: { pause(): void; resume(): void } };
const sockets: NodeWs[] = [];
const CaptureWs = (() => {
  const Base = H.wsClient() as unknown as new (url: string) => NodeWs;
  return class extends Base {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  } as unknown as WebSocketCtor;
})();
const liveSocket = (): NodeWs => {
  const open = sockets.filter((s) => s.readyState === 1);
  if (open.length !== 1) throw new Error(`expected one open relay socket, found ${open.length}`);
  return open[0]!;
};
// Delivery check of the relay: short for the test (production default 4 s).
const DELIVERY_ACK_MS = 1000;

type Desk = { call<T = Record<string, any>>(cmd: string, args?: Record<string, unknown>): Promise<T & { ok: boolean }>; stop(): void };
function startDesktop(): Promise<Desk> {
  const proc = spawn(process.execPath, [path.join(__dirname, 'desktopPeer.cjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map<number, (m: any) => void>();
  let seq = 0;
  return new Promise((resolve) => {
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      const m = JSON.parse(line);
      if (m.ready) {
        resolve({
          call: (cmd, args = {}) => new Promise((r) => { const s = ++seq; waiting.set(s, r); proc.stdin!.write(`${JSON.stringify({ cmd, seq: s, ...args })}\n`); }),
          stop: () => proc.stdin!.write(`${JSON.stringify({ cmd: 'quit' })}\n`),
        });
        return;
      }
      const w = waiting.get(m.seq);
      if (w) { waiting.delete(m.seq); w(m); }
    });
  });
}

function until<T>(get: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const v = await get();
      if (v) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error('until timed out'));
      setTimeout(tick, 50);
    };
    void tick();
  });
}

jest.setTimeout(90_000);

d('phone app relay code <-> desktop companion (real both sides)', () => {
  let relay: Awaited<ReturnType<Harness['startRelay']>>;
  let desk: Desk;
  let relayUrl: string;
  let pc: PairedPc;
  let client: RelayWorkspaceClient;
  const events: WorkspaceEvent[] = [];
  const revoked: string[] = [];
  const ended: string[] = [];
  const pushSink = path.join(os.tmpdir(), `sg-cross-push-${process.pid}-${Date.now()}.jsonl`);
  type SinkLine = { platform: string; payload: { message: { data: Record<string, string> } } };
  const pushes = (): Record<string, string>[] =>
    fs.existsSync(pushSink)
      ? fs.readFileSync(pushSink, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as SinkLine).payload.message.data)
      : [];
  const openPush = (data: Record<string, string>) => readPush(data, { identity: phone, pcs: [pc], now: Date.now() });
  setRandomSource((n) => webcrypto.getRandomValues(new Uint8Array(n)));
  const phone = generateIdentity();

  const newClient = (p: PairedPc) => {
    const c = new RelayWorkspaceClient({
      pc: () => p,
      pcs: () => [p],
      identity: async () => phone,
      snapshotWaitMs: 10_000,
      account: () => ({ name: 'Azhar', email: 'me@example.com' }),
      onRevoked: (id) => revoked.push(id),
      pushRegistration: () => ({ platform: 'fcm', token: 'fcmTOKEN_cross_test_0123456789' }),
      onApprovalEnded: (id) => ended.push(id),
    });
    c.subscribe((e) => events.push(e));
    return c;
  };
  async function pair(name: string): Promise<PairedPc> {
    const offer = await desk.call<{ qrText: string }>('pairOffer');
    const transport = new RelayPairingTransport();
    let sas = '';
    try {
      const p = await runPairing({ payload: decodePairingPayload(offer.qrText), transport, identity: phone, device: { name, platform: 'android', appVersion: '1.0.0' }, onSas: (s) => (sas = s) });
      const st = await desk.call<{ lastSas: string }>('pairState');
      expect(st.lastSas).toBe(sas);
      return p;
    } finally {
      transport.dispose();
    }
  }

  beforeAll(async () => {
    relay = await H.startRelay({ RELAY_DELIVERY_ACK_MS: String(DELIVERY_ACK_MS), RELAY_PUSH_SINK_FILE: pushSink });
    relayUrl = `ws://127.0.0.1:${relay.port}/v1`;
    desk = await startDesktop();
    expect((await desk.call('start', { relayUrl, host: '127.0.0.1' })).ok).toBe(true);
    configureRelay({ identity: async () => phone, WebSocket: CaptureWs });
  });

  afterAll(async () => {
    client?.disconnect();
    resetRelays();
    desk?.stop();
    await relay?.stop();
    fs.rmSync(pushSink, { force: true });
  });

  it('pairs: same 6 digit code on both sides, hello with deviceId and scopes, row stored on the PC', async () => {
    pc = await pair('Pixel 9');
    expect(pc).toMatchObject({ name: 'OFFICE-PC', relayUrl, demo: false });
    expect(pc.deviceId).toMatch(/^dev_/);
    expect(pc.scopes).toEqual(expect.arrayContaining(['view', 'control', 'approveAi']));
    const devs = await desk.call<{ devices: { name: string; deviceId: string }[] }>('devices');
    expect(devs.devices).toEqual([expect.objectContaining({ name: 'Pixel 9', deviceId: pc.deviceId })]);
  });

  it('connects (link, presence, IK) and maps the desktop snapshot with this phone as a member', async () => {
    client = newClient(pc);
    await client.connect();
    const snap = await client.getSnapshot();
    expect(snap.workspace).toMatchObject({ pcName: 'OFFICE-PC', online: true });
    expect(snap.profiles.map((p) => p.title)).toEqual(['Shop US', 'Support DE', 'Research']);
    expect(snap.profiles[0]).toMatchObject({ id: 'p0000011', status: 'running', countryCode: 'US', group: 'Stores' });
    expect(snap.members).toEqual([expect.objectContaining({ id: pc.deviceId, status: 'active' })]);
    expect(snap.workspace.meMemberId).toBe(pc.deviceId);
  });

  it('approval with tokenName: allow once, then another one denied', async () => {
    const a1 = await desk.call<{ approvalId: string; sentTo: string[] }>('approval', { tokenName: 'n8n automation', summary: 'Start Shop US' });
    expect(a1.sentTo).toEqual([pc.deviceId]);
    const ev = await until(() => events.find((e) => e.type === 'approval' && e.approval.id === a1.approvalId));
    expect(ev.type === 'approval' && ev.approval).toMatchObject({ status: 'pending', source: 'ai', ai: { client: 'Claude Desktop', tool: 'profiles_start', allowHour: true, tokenLabel: 'n8n automation' } });
    expect(await client.decideApproval(a1.approvalId, { verdict: 'allow' })).toEqual({ ok: true });
    const a2 = await desk.call<{ approvalId: string }>('approval', { tokenName: 'Cursor token', tool: 'profiles_delete', allowHour: false });
    await until(() => events.find((e) => e.type === 'approval' && e.approval.id === a2.approvalId));
    expect(await client.decideApproval(a2.approvalId, { verdict: 'deny' })).toEqual({ ok: true });
    const ans = await until(async () => { const r = await desk.call<{ answers: { approvalId: string; decision: string }[] }>('answers'); return r.answers.length >= 2 ? r : null; });
    expect(ans.answers).toEqual([{ approvalId: a1.approvalId, decision: 'allow-once' }, { approvalId: a2.approvalId, decision: 'deny' }]);
  });

  it('starts and stops a profile from the phone; the state.patch arrives', async () => {
    expect(await client.startProfile('p0000012')).toEqual({ ok: true });
    await until(() => events.some((e) => e.type === 'snapshot' && e.snapshot.profiles.find((p) => p.id === 'p0000012')?.status === 'running'));
    expect(await client.stopProfile('p0000012')).toEqual({ ok: true });
    await until(() => events.some((e) => e.type === 'snapshot' && e.snapshot.profiles.find((p) => p.id === 'p0000012')?.status === 'stopped'));
    const profiles = await desk.call<{ profiles: { id: number; status: string }[] }>('profiles');
    expect(profiles.profiles.find((p) => p.id === 12)?.status).toBe('stopped');
    expect(await client.startProfile('p0009999')).toMatchObject({ ok: false });
  });

  it('an approval made while the phone is away is answered after the reconnect', async () => {
    client.disconnect();
    resetRelays();
    await until(async () => { const r = await desk.call<{ devices: { online: boolean }[] }>('devices'); return r.devices[0] && !r.devices[0].online; });
    const away = await desk.call<{ approvalId: string; sentTo: string[] }>('approval', { tokenName: 'Claude token', tool: 'cookies_export', allowHour: false });
    expect(away.sentTo).toEqual([pc.deviceId]);
    events.length = 0;
    configureRelay({ identity: async () => phone, WebSocket: CaptureWs });
    client = newClient(pc);
    await client.connect();
    await client.getSnapshot();
    const ev = await until(() => events.find((e) => e.type === 'approval' && e.approval.id === away.approvalId));
    expect(ev.type === 'approval' && ev.approval).toMatchObject({ status: 'pending', ai: { allowHour: false } });
    expect(await client.decideApproval(away.approvalId, { verdict: 'deny' })).toEqual({ ok: true });
    const ans = await until(async () => { const r = await desk.call<{ answers: { approvalId: string; decision: string }[] }>('answers'); return r.answers.find((a) => a.approvalId === away.approvalId) ? r : null; });
    expect(ans.answers.find((a) => a.approvalId === away.approvalId)?.decision).toBe('deny');
  });

  it('phone in the background (socket open, nothing read): the approval is pushed within seconds, then delivered once on return', async () => {
    const frozen = liveSocket();
    frozen._socket!.pause(); // the user pressed Home: the OS keeps the TCP socket, the app reads nothing
    const sentAt = Date.now();
    const bg = await desk.call<{ approvalId: string; sentTo: string[] }>('approval', { tokenName: 'Claude token', tool: 'profiles_start', summary: 'Start Shop US' });
    expect(bg.sentTo).toEqual([pc.deviceId]); // the relay still said delivered: the socket looked alive
    // Before the fix nothing happened for 60 to 95 s. Now: a push after the delivery check.
    const push = await until(() => pushes().find((d) => d.sgk === 'approval' && (() => { const c = openPush(d); return c.kind === 'approval' && c.approval.id === bg.approvalId; })()), 10_000);
    expect(Date.now() - sentAt).toBeLessThan(DELIVERY_ACK_MS * 6);
    expect(openPush(push)).toMatchObject({ kind: 'approval', pcId: pc.id, approval: { id: bg.approvalId, status: 'pending', ai: { tokenLabel: 'Claude token' } } });
    // No pong either: the relay closes the dead socket, so the phone counts as offline.
    await until(() => relay.log.some((l) => l.includes('"event":"conn.dead"')), 10_000);

    // The user opens the app: the socket is found dead, the client reconnects and gets it again.
    events.length = 0;
    frozen._socket!.resume();
    openRelays().forEach((c) => c.kick());
    const ev = await until(() => events.find((e) => e.type === 'approval' && e.approval.id === bg.approvalId), 20_000);
    expect(ev.type === 'approval' && ev.approval.status).toBe('pending');
    const snap = await client.getSnapshot();
    expect(snap.approvals.filter((a) => a.id === bg.approvalId)).toHaveLength(1);
    expect(await client.decideApproval(bg.approvalId, { verdict: 'allow' })).toEqual({ ok: true });
    const ans = await until(async () => { const r = await desk.call<{ answers: { approvalId: string; decision: string }[] }>('answers'); return r.answers.find((a) => a.approvalId === bg.approvalId) ? r : null; });
    expect(ans.answers.filter((a) => a.approvalId === bg.approvalId)).toEqual([{ approvalId: bg.approvalId, decision: 'allow-once' }]);
    // One push for this approval, none for the redelivery after the reconnect.
    await new Promise((r) => setTimeout(r, DELIVERY_ACK_MS * 2));
    expect(pushes().filter((d) => d.sgk === 'approval' && (() => { const c = openPush(d); return c.kind === 'approval' && c.approval.id === bg.approvalId; })())).toHaveLength(1);
  });

  it('an approval answered on the PC (or the web app) ends on the phone: card updated live, silent update push in the background', async () => {
    const live = await desk.call<{ approvalId: string }>('approval', { tokenName: 'n8n automation', tool: 'profiles_stop' });
    await until(() => events.find((e) => e.type === 'approval' && e.approval.id === live.approvalId && e.approval.status === 'pending'));
    expect((await desk.call('respond', { approvalId: live.approvalId, decision: 'deny' })).ok).toBe(true);
    const done = await until(() => events.find((e) => e.type === 'approval' && e.approval.id === live.approvalId && e.approval.status !== 'pending'));
    expect(done.type === 'approval' && done.approval).toMatchObject({ status: 'denied', decidedOn: 'pc' });
    await until(() => ended.includes(live.approvalId)); // the notification is removed

    // In the background: the end arrives as a silent update push the phone opens itself.
    liveSocket()._socket!.pause();
    const bg = await desk.call<{ approvalId: string }>('approval', { tokenName: 'Claude token', tool: 'cookies_export', allowHour: false });
    await until(() => pushes().some((d) => d.sgk === 'approval' && (() => { const c = openPush(d); return c.kind === 'approval' && c.approval.id === bg.approvalId; })()), 10_000);
    expect((await desk.call('respond', { approvalId: bg.approvalId, decision: 'allow-once' })).ok).toBe(true);
    const upd = await until(() => pushes().find((d) => d.sgk === 'update' && (() => { const c = openPush(d); return c.kind === 'approval' && c.approval.id === bg.approvalId; })()), 10_000);
    expect(openPush(upd)).toMatchObject({ kind: 'approval', approval: { id: bg.approvalId, status: 'approved', decidedOn: 'pc' } });
    // Back to the front for the next tests.
    for (const s of sockets) s._socket?.resume();
    openRelays().forEach((c) => c.kick());
    await until(() => openRelays().every((c) => c.status === 'ready'), 20_000);
  });

  it('profile sync: a desktop profile appears on the phone (link required by the relay)', async () => {
    await desk.call('enableSync', { id: 11 });
    expect((await desk.call<{ report: { ok: boolean } }>('sync')).report.ok).toBe(true);
    initRepository();
    const service = createSyncService({
      http: H.nodeHttp,
      identity: async () => phone,
      pc: () => ({ id: pc.id, name: pc.name, relayUrl: pc.relayUrl, dhPub: pc.dhPub, signPub: pc.signPub, deviceId: pc.deviceId, demo: pc.demo }),
      deviceName: () => 'Pixel 9',
      local: phoneSyncLocal,
      state: kvStateStore,
      keys: secureKeyringStore,
      prepare: loadKeyring,
    });
    expect(await service.start()).toBe(true);
    const r = await service.syncNow();
    expect(r).toMatchObject({ ok: true, added: ['p0000011'] });
    expect(getRecord(localIdOf('p0000011'))?.title).toBe('Shop US');
    // Round trip: the desktop's next round is clean (nothing it must apply or flip back).
    const back = await desk.call<{ report: { ok: boolean; profiles: { uploaded: string[] }[] } }>('sync');
    expect(back.report.ok).toBe(true);
    expect((await desk.call<{ profile: { title: string } }>('syncProfile', { id: 11 })).profile.title).toBe('Shop US');
  });

  it('unpair from the phone: sealed revoke + unlink remove the phone on the PC', async () => {
    client.disconnect();
    resetRelays();
    const r = await sendRevokeAndUnlink(pc, { identity: async () => phone });
    expect(['delivered', 'queued']).toContain(r.revoke);
    await until(async () => (await desk.call<{ devices: unknown[] }>('devices')).devices.length === 0);
  });

  it('revoke from the desktop: the phone learns it and forgets the PC', async () => {
    configureRelay({ identity: async () => phone, WebSocket: CaptureWs });
    const pc2 = await pair('Pixel 9 again');
    client = newClient(pc2);
    await client.connect();
    await client.getSnapshot();
    const devs = await desk.call<{ devices: { deviceId: string }[] }>('devices');
    expect(devs.devices).toHaveLength(1);
    revoked.length = 0;
    await desk.call('revoke', { deviceId: devs.devices[0]!.deviceId });
    await until(() => revoked.includes(pc2.id));
    expect((await desk.call<{ devices: unknown[] }>('devices')).devices).toHaveLength(0);
  });

  it('the relay log has no plaintext titles or raw mailbox ids', () => {
    const log = relay.log.join('\n');
    for (const x of ['Shop US', 'n8n automation', phone.mailboxId, pc.id]) expect(log).not.toContain(x);
  });
});
