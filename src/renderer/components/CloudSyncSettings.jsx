import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Loader2, RefreshCw, Copy, Check, Printer, KeyRound, Monitor, Globe, Smartphone, X, ShieldCheck, Power } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { fmtDateTime } from '@/lib/intl.mjs';

// Settings > Cloud sync (phase 1, Owner only): turn on with a 24-word recovery kit, connect another PC with
// the kit, approve a web browser with a one-time code, see devices, sync now, turn off. Main enforces every
// rule (src/main/workspaceSync/ipc.js). The section stays hidden until the server opens cloud sync for
// this account, so builds can ship before the feature is live.

const btnPrimary = 'h-10 px-4 rounded-lg text-[13px] font-semibold text-white bg-primary hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2';
const btnSecondary = 'h-10 px-3 rounded-lg border border-border text-[13px] text-foreground hover:bg-secondary disabled:opacity-50 inline-flex items-center justify-center gap-1.5';

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtSeconds(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function WordGrid({ words }) {
  return (
    <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-background/60 p-3 font-mono text-[13px]">
      {words.map((w, i) => (
        <li key={i} className="flex gap-2 min-w-0">
          <span className="w-6 text-end text-muted-foreground tabular-nums">{i + 1}</span>
          <span className="text-foreground select-all">{w}</span>
        </li>
      ))}
    </ol>
  );
}

function printKit(t, words, workspaceId) {
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return;
  const doc = w.document;
  doc.title = t('kit.printTitle');
  const h = doc.createElement('h1');
  h.textContent = t('kit.printTitle');
  const p = doc.createElement('p');
  p.textContent = t('kit.printNote', { id: workspaceId || '' });
  const ol = doc.createElement('ol');
  ol.style.cssText = 'columns:3;font:16px/2 monospace';
  for (const word of words) {
    const li = doc.createElement('li');
    li.textContent = word;
    ol.appendChild(li);
  }
  doc.body.style.cssText = 'font-family:system-ui;padding:32px';
  doc.body.append(h, p, ol);
  w.print();
}

function KitWords({ t, words, workspaceId }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <WordGrid words={words} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => {
            try { navigator.clipboard.writeText(words.join(' ')); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* clipboard blocked */ }
          }}
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />} {copied ? t('kit.copied') : t('kit.copy')}
        </button>
        <button type="button" className={btnSecondary} onClick={() => printKit(t, words, workspaceId)}>
          <Printer className="w-4 h-4" aria-hidden="true" /> {t('kit.print')}
        </button>
      </div>
    </div>
  );
}

function PlatformIcon({ platform }) {
  const C = platform === 'web' ? Globe : platform === 'phone' ? Smartphone : Monitor;
  return <C className="w-4 h-4 text-muted-foreground" aria-hidden="true" />;
}

export default function CloudSyncSettings() {
  const { t } = useTranslation('cloudSync');
  const [me, setMe] = useState(undefined);
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [kit, setKit] = useState(null); // { words, check, workspaceId }
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState({});
  const [recoverWords, setRecoverWords] = useState('');
  const [enrol, setEnrol] = useState(null); // { code, qrImage, expiresAt, requests }
  const [newKit, setNewKit] = useState(null);
  const [deleteCloud, setDeleteCloud] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef(null);

  const isOwner = me !== undefined && (!me || ['OWNER', 'SUPER_ADMIN'].includes(me.role));

  const load = useCallback(async () => {
    try {
      const s = await softglazeApi.cloudSync.status();
      setStatus(s);
      if (s && s.on) softglazeApi.cloudSync.devices().then((d) => setDevices(Array.isArray(d) ? d : [])).catch(() => {});
    } catch (e) {
      setStatus({ unavailable: true });
    }
  }, []);

  useEffect(() => { softglazeApi.members.current().then((m) => setMe(m || null)).catch(() => setMe(null)); }, []);
  useEffect(() => {
    if (!isOwner) return undefined;
    load();
    return softglazeApi.cloudSync.onChanged(() => load());
  }, [isOwner, load]);

  // Enrolment: poll for the browser's request while the code is on screen.
  useEffect(() => {
    if (!enrol) return undefined;
    const tick = async () => {
      setNow(Date.now());
      try {
        const r = await softglazeApi.cloudSync.enrol.poll();
        if (!r.active) { setEnrol(null); return; }
        setEnrol((e) => (e ? { ...e, requests: r.requests || [] } : e));
      } catch (e) { /* keep showing the code */ }
    };
    pollRef.current = setInterval(tick, 2500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(pollRef.current); clearInterval(clock); };
  }, [enrol && enrol.code]);

  if (me === undefined || !isOwner || !status || status.unavailable) return null;
  // Hidden until the server opens cloud sync for this account (or this PC already uses it).
  const server = status.server;
  if (!status.available || (!status.on && !status.pendingKit && !kit && (!server || !server.enabled) && status.signedIn && !status.serverError)) return null;

  async function run(tag, fn, after) {
    setBusy(tag); setErr(''); setInfo('');
    try { const r = await fn(); if (after) after(r); await load(); return r; }
    catch (e) { setErr(e.message || t('errors.generic')); return null; }
    finally { setBusy(''); }
  }

  const last = status.last;
  const secondsLeft = enrol ? Math.max(0, Math.round((enrol.expiresAt - now) / 1000)) : 0;

  let body;
  if (!status.signedIn) {
    body = <p className="mt-4 text-[12.5px] text-muted-foreground">{t('signIn')}</p>;
  } else if (!status.osEncryption) {
    body = <p className="mt-4 text-[12.5px] text-amber-400">{t('noOsEncryption')}</p>;
  } else if (status.serverError && !status.on) {
    body = <p className="mt-4 text-[12.5px] text-amber-400">{t('serverError', { message: status.serverError.message })}</p>;
  } else if (kit) {
    const [a, b] = kit.check;
    const ready = saved && String(answers[a] || '').trim() && String(answers[b] || '').trim();
    body = (
      <div className="mt-4 space-y-4">
        <div>
          <h4 className="text-[13px] font-semibold text-foreground flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" aria-hidden="true" /> {t('kit.title')}</h4>
          <p className="mt-1 text-[12.5px] text-muted-foreground max-w-prose">{t('kit.body')}</p>
        </div>
        <KitWords t={t} words={kit.words} workspaceId={kit.workspaceId} />
        <label className="flex items-start gap-2 text-[12.5px] text-foreground cursor-pointer">
          <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[var(--primary)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          {t('kit.saved')}
        </label>
        <fieldset disabled={!saved} className="space-y-2 disabled:opacity-50">
          <legend className="text-[12.5px] font-semibold text-foreground">{t('kit.checkTitle')}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
            {[a, b].map((n) => (
              <label key={n} className="text-[12px] text-muted-foreground space-y-1">
                <span>{t('kit.checkWord', { n })}</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={answers[n] || ''}
                  onChange={(e) => setAnswers({ ...answers, [n]: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg bg-background border border-border text-[14px] font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={!ready || busy === 'confirm'}
            onClick={() => run('confirm', () => softglazeApi.cloudSync.turnOnConfirm(answers), () => { setKit(null); setAnswers({}); setSaved(false); })}>
            {busy === 'confirm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />} {t('kit.confirm')}
          </button>
          <button type="button" className={btnSecondary} onClick={() => run('cancelKit', () => softglazeApi.cloudSync.turnOnCancel(), () => { setKit(null); setAnswers({}); setSaved(false); })}>
            {t('kit.cancel')}
          </button>
        </div>
      </div>
    );
  } else if (!status.on) {
    const plan = server && server.plan;
    if (plan && !plan.allowed) {
      body = <p className="mt-4 text-[12.5px] text-muted-foreground">{t('planRequired')}</p>;
    } else if (server && server.workspace) {
      body = (
        <div className="mt-4 space-y-3 max-w-2xl">
          <h4 className="text-[13px] font-semibold text-foreground">{t('off.existsTitle')}</h4>
          <p className="text-[12.5px] text-muted-foreground">{t('off.existsBody')}</p>
          <label className="block text-[12px] text-muted-foreground space-y-1">
            <span>{t('off.wordsLabel')}</span>
            <textarea
              rows={4}
              spellCheck={false}
              autoComplete="off"
              value={recoverWords}
              placeholder={t('off.wordsPlaceholder')}
              onChange={(e) => setRecoverWords(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-[14px] font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <button type="button" className={btnPrimary} disabled={busy === 'recover' || recoverWords.trim().split(/\s+/).length < 24}
            onClick={() => run('recover', () => softglazeApi.cloudSync.recover(recoverWords), () => setRecoverWords(''))}>
            {busy === 'recover' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" aria-hidden="true" />} {t('off.connect')}
          </button>
        </div>
      );
    } else {
      body = (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-muted-foreground max-w-prose">{t('off.body')}</p>
          <button type="button" className={btnPrimary} disabled={busy === 'start'}
            onClick={() => run('start', () => softglazeApi.cloudSync.turnOnStart(), (r) => { if (r) { setKit(r); setSaved(false); setAnswers({}); } })}>
            {busy === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" aria-hidden="true" />} {t('off.turnOn')}
          </button>
        </div>
      );
    }
  } else {
    const ws = server && server.workspace;
    body = (
      <div className="mt-4 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[12.5px] space-y-0.5">
            <p className="text-foreground font-medium">{status.lastSyncAt ? t('on.lastSync', { time: fmtDateTime(status.lastSyncAt) }) : t('on.never')}</p>
            {last && <p className="text-muted-foreground">{t('on.summary', { pushed: last.pushed, applied: last.applied })}</p>}
            {last && last.rejected > 0 && <p className="text-amber-400">{t('on.issues', { count: last.rejected })}</p>}
            {last && last.conflicts > 0 && <p className="text-muted-foreground">{t('on.conflicts', { count: last.conflicts })}</p>}
            {status.lastError && <p className="text-red-400">{status.lastError.message}</p>}
            {ws && <p className="text-muted-foreground">{t('on.usage', { used: fmtBytes(ws.bytesUsed), quota: fmtBytes(ws.quotaBytes) })}</p>}
            <p className="text-muted-foreground">{t('on.auto')}</p>
          </div>
          <button type="button" className={btnSecondary} disabled={busy === 'sync'} onClick={() => run('sync', () => softglazeApi.cloudSync.syncNow())}>
            <RefreshCw className={`w-4 h-4 ${busy === 'sync' ? 'animate-spin' : ''}`} aria-hidden="true" /> {t('on.syncNow')}
          </button>
        </div>

        {/* Add a browser */}
        <div className="rounded-xl border border-border bg-elevated/50 p-4">
          {!enrol ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">{t('enrol.title')}</p>
                <p className="text-[12px] text-muted-foreground">{t('enrol.help')}</p>
              </div>
              <button type="button" className={btnPrimary} disabled={busy === 'enrol'}
                onClick={() => run('enrol', () => softglazeApi.cloudSync.enrol.start(), (r) => r && setEnrol({ ...r, requests: [] }))}>
                {busy === 'enrol' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" aria-hidden="true" />} {t('enrol.start')}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              {enrol.qrImage && <img src={enrol.qrImage} alt={t('enrol.qrAlt')} className="w-[180px] h-[180px] rounded-lg border border-border self-center md:self-start bg-white" />}
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[12px] text-muted-foreground">{t('enrol.codeLabel')}</p>
                <p className="font-mono text-[18px] sm:text-[20px] tracking-wider text-foreground select-all">{enrol.code.split('-').map((g, i, a) => <span key={i} className="inline-block">{g}{i < a.length - 1 ? '-' : ''}</span>)}</p>
                <p className="text-[12px] text-muted-foreground">{t('enrol.help')}</p>
                <p className="text-[12px] text-muted-foreground" aria-live="polite">{t('enrol.expiresIn', { time: fmtSeconds(secondsLeft) })}</p>
                {enrol.requests.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> {t('enrol.waiting')}</p>
                ) : (
                  <ul className="space-y-2">
                    {enrol.requests.map((r) => (
                      <li key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border p-3">
                        <span className="text-[13px] text-foreground">{t('enrol.request', { name: r.name, platform: t(`devices.platform_${r.platform}`) })}</span>
                        <span className="flex gap-2">
                          <button type="button" className={btnPrimary} disabled={busy === `ok-${r.id}`}
                            onClick={() => run(`ok-${r.id}`, () => softglazeApi.cloudSync.enrol.approve(r.id), (res) => { setEnrol(null); if (res) setInfo(t('enrol.approved', { name: res.name })); })}>
                            <Check className="w-4 h-4" aria-hidden="true" /> {t('enrol.approve')}
                          </button>
                          <button type="button" className={btnSecondary} onClick={() => run(`no-${r.id}`, () => softglazeApi.cloudSync.enrol.deny(r.id))}>{t('enrol.deny')}</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className={btnSecondary} onClick={() => run('enrolCancel', () => softglazeApi.cloudSync.enrol.cancel(), () => setEnrol(null))}>
                  <X className="w-4 h-4" aria-hidden="true" /> {t('enrol.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Devices */}
        <div>
          <h4 className="text-[13px] font-semibold text-foreground mb-2">{t('devices.title')}</h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {devices.map((d) => (
              <li key={d.tag} className="flex items-center gap-3 px-3 py-2.5 min-h-[44px]">
                <PlatformIcon platform={d.platform} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[13px] truncate ${d.revokedAt ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {d.name} <span className="text-muted-foreground">· {t(`devices.platform_${d.platform}`)}</span>{d.self && <span className="ms-2 text-[11px] text-primary">{t('devices.thisPc')}</span>}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">{d.revokedAt ? t('devices.removed') : t('devices.added', { date: fmtDateTime(d.addedAt) })}</p>
                </div>
                {!d.self && !d.revokedAt && (
                  <button type="button" className={btnSecondary} disabled={busy === `rm-${d.tag}`}
                    onClick={() => { if (window.confirm(t('devices.removeConfirm', { name: d.name }))) run(`rm-${d.tag}`, () => softglazeApi.cloudSync.revokeDevice(d.tag)); }}>
                    {t('devices.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {newKit ? (
          <div className="space-y-3">
            <h4 className="text-[13px] font-semibold text-foreground">{t('kitAgain.title')}</h4>
            <KitWords t={t} words={newKit} workspaceId={status.workspaceId} />
            <button type="button" className={btnPrimary} onClick={() => setNewKit(null)}>{t('kitAgain.done')}</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className={btnSecondary} disabled={busy === 'kit'}
              onClick={() => { if (window.confirm(t('kitAgain.confirm'))) run('kit', () => softglazeApi.cloudSync.reissueKit(), (r) => r && setNewKit(r.words)); }}>
              <KeyRound className="w-4 h-4" aria-hidden="true" /> {t('kitAgain.button')}
            </button>
            <div className="flex flex-col gap-2 sm:items-end">
              <label className="flex items-start gap-2 text-[12px] text-muted-foreground cursor-pointer max-w-md">
                <input type="checkbox" className="mt-0.5 w-4 h-4" checked={deleteCloud} onChange={(e) => setDeleteCloud(e.target.checked)} />
                {t('turnOff.deleteCloud')}
              </label>
              <button type="button" className={`${btnSecondary} text-red-400`} disabled={busy === 'off'}
                onClick={() => {
                  if (!window.confirm(t('turnOff.confirm'))) return;
                  if (deleteCloud && !window.confirm(t('turnOff.deleteConfirm'))) return;
                  run('off', () => softglazeApi.cloudSync.turnOff(deleteCloud), () => setDeleteCloud(false));
                }}>
                <Power className="w-4 h-4" aria-hidden="true" /> {t('turnOff.button')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-xl bg-card border border-border p-5" aria-labelledby="cloud-sync-title">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 bg-primary/10 border border-primary/20">
          <Cloud className="w-5 h-5 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="cloud-sync-title" className="text-sm font-semibold text-foreground flex items-center gap-2">
            {t('title')} <span className="text-[10.5px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-muted-foreground">{t('beta')}</span>
          </h3>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
      </div>
      {err && <div role="alert" className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}
      {info && <div role="status" className="mt-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[12px] text-emerald-400">{info}</div>}
      {body}
    </section>
  );
}
