import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, Globe, Loader2, QrCode, Copy, Check, X, ShieldCheck, Trash2, Pencil, RefreshCw, Wifi, WifiOff, FolderSync, AlertTriangle } from 'lucide-react';
import Switch from '@/components/ui/Switch.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { fmtDateTime, fmtTime } from '@/lib/intl.mjs';

// Settings > Phones: pair the SoftGlaze phone app by QR, confirm the 6-digit code, choose who the
// phone acts as and what it may do, rename or remove phones, and pick profiles that sync.
// Main enforces every rule (src/main/mobile/ipc.js); this page only hides what cannot be used.
const SCOPES = ['view', 'control_profiles', 'approve_ai', 'approve_team', 'totp', 'phone_profiles_linked'];
const DEFAULT_SCOPES = ['view', 'control_profiles', 'approve_ai'];

export default function PhonesSettings() {
  const { t } = useTranslation('mobile');
  const [me, setMe] = useState(undefined); // undefined = loading
  const [status, setStatus] = useState(null);
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const isAdmin = me !== undefined && (!me || ['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(me.role));
  const isOwner = me !== undefined && (!me || ['OWNER', 'SUPER_ADMIN'].includes(me.role));

  const load = useCallback(async () => {
    try {
      const s = await softglazeApi.mobile.status();
      setStatus(s);
      setErr('');
    } catch (e) {
      setErr(e.code === 'MOBILE_UNAVAILABLE' ? t('errors.unavailable') : (e.message || t('errors.load')));
    }
  }, [t]);

  useEffect(() => { softglazeApi.members.current().then((m) => setMe(m || null)).catch(() => setMe(null)); }, []);
  useEffect(() => {
    if (!isAdmin) return undefined;
    load();
    softglazeApi.mobile.members().then((m) => setMembers(Array.isArray(m) ? m : [])).catch(() => setMembers([]));
    return softglazeApi.mobile.onChanged(() => load());
  }, [isAdmin, load]);
  useEffect(() => {
    if (!isOwner || !status || !status.enabled) return;
    softglazeApi.profiles.list({}).then((rows) => setProfiles(Array.isArray(rows) ? rows : [])).catch(() => setProfiles([]));
  }, [isOwner, status && status.enabled]);
  // Countdown for the QR and the code check.
  useEffect(() => {
    if (!status || !status.pairing) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status && status.pairing && status.pairing.pairingId]);

  if (me === undefined || !isAdmin) return null;

  async function run(tag, fn) {
    setBusy(tag); setErr('');
    try { const r = await fn(); if (r && typeof r === 'object' && 'devices' in r) setStatus(r); else await load(); }
    catch (e) { setErr(e.message || t('errors.generic')); }
    finally { setBusy(''); }
  }

  const relayState = status ? status.relay && status.relay.state : 'off';
  const pairing = status && status.pairing;
  const secondsLeft = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;

  function copyText(text) {
    try { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* clipboard blocked */ }
  }

  return (
    <section className="rounded-xl bg-card border border-border p-5" aria-labelledby="phones-title">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 bg-sky-500/12 border border-sky-500/20">
          <Smartphone className="w-5 h-5 text-sky-400" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="phones-title" className="text-sm font-semibold text-foreground">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {status && (
          <Switch
            checked={Boolean(status.enabled)}
            disabled={!isOwner || busy === 'enable'}
            label={t('enable')}
            onChange={(on) => run('enable', () => softglazeApi.mobile.setEnabled(on))}
          />
        )}
      </div>

      {err && <div role="alert" className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-400">{err}</div>}

      {!status ? (
        <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" aria-label={t('loading')} /></div>
      ) : !status.enabled ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">{isOwner ? t('offOwner') : t('offOther')}</p>
      ) : (
        <div className="mt-4 space-y-5">
          <RelayLine t={t} state={relayState} relay={status.relay} url={status.relayUrl} />

          {/* Pairing */}
          <div className="rounded-xl border border-border bg-elevated/50 p-4">
            {!pairing ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">{t('pair.title')}</p>
                  <p className="text-[12px] text-muted-foreground">{t('pair.help')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => run('pair', () => softglazeApi.mobile.pairing.start())}
                  disabled={busy === 'pair' || relayState !== 'ready'}
                  className="shrink-0 h-10 px-4 rounded-lg text-[13px] font-semibold text-white bg-primary hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {busy === 'pair' ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" aria-hidden="true" />} {t('pair.start')}
                </button>
              </div>
            ) : pairing.stage === 'open' ? (
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                {pairing.qrImage && <img src={pairing.qrImage} alt={t('pair.qrAlt')} className="w-[220px] h-[220px] rounded-lg border border-border self-center md:self-start bg-white" />}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[13px] font-semibold text-foreground">{t('pair.scanTitle')}</p>
                  <ol className="list-decimal pl-5 text-[12.5px] text-muted-foreground space-y-1">
                    <li>{t('pair.step1')}</li>
                    <li>{t('pair.step2')}</li>
                    <li>{t('pair.step3')}</li>
                  </ol>
                  <p className="text-[12px] text-muted-foreground" aria-live="polite">{t('pair.expiresIn', { time: fmtSeconds(secondsLeft) })}</p>
                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('pair.textTitle')}</summary>
                    <div className="mt-2 flex items-start gap-2">
                      <code className="flex-1 min-w-0 break-all font-mono text-[11px] text-foreground bg-background/60 border border-border rounded px-2 py-1.5">{pairing.qrText}</code>
                      <button type="button" onClick={() => copyText(pairing.qrText)} className="shrink-0 h-9 px-3 rounded-lg bg-secondary hover:bg-secondary/70 text-[12px] font-medium text-foreground inline-flex items-center gap-1.5">
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />} {t('copy')}
                      </button>
                    </div>
                  </details>
                  {pairing.error && <p className="text-[12px] text-amber-400">{t('pair.attemptFailed')}</p>}
                  <button type="button" onClick={() => run('cancel', () => softglazeApi.mobile.pairing.cancel())} className="h-9 px-3 rounded-lg border border-border text-[12.5px] text-foreground hover:bg-secondary inline-flex items-center gap-1.5">
                    <X className="w-3.5 h-3.5" aria-hidden="true" /> {t('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <ConfirmPairing
                t={t}
                pairing={pairing}
                members={members}
                me={me}
                secondsLeft={secondsLeft}
                busy={busy}
                onConfirm={(input) => run('confirm', () => softglazeApi.mobile.pairing.confirm({ pairingId: pairing.pairingId, ...input }))}
                onReject={() => run('reject', () => softglazeApi.mobile.pairing.reject(pairing.pairingId))}
              />
            )}
          </div>

          {/* Paired phones */}
          <div>
            <p className="text-[13px] font-semibold text-foreground mb-2">{t('devices.title')}</p>
            {status.devices.filter((d) => !d.revokedAt).length === 0 ? (
              <p className="text-[12px] text-muted-foreground">{t('devices.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {status.devices.filter((d) => !d.revokedAt).map((d) => (
                  <DeviceRow key={d.deviceId} t={t} device={d} members={members} busy={busy} run={run} />
                ))}
              </ul>
            )}
          </div>

          {isOwner && (
            <SyncSection t={t} status={status} profiles={profiles} busy={busy} run={run} />
          )}

          {isOwner && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('advanced.title')}</summary>
              <AdvancedSettings t={t} status={status} busy={busy} run={run} />
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function RelayLine({ t, state, relay, url }) {
  const ok = state === 'ready';
  return (
    <p className="text-[12px] text-muted-foreground flex items-center gap-2" aria-live="polite">
      {ok ? <Wifi className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <WifiOff className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />}
      <span>{ok ? t('relay.connected') : relay && relay.lastError === 'auth_failed' ? t('relay.authFailed') : t('relay.connecting')}</span>
      <span className="font-mono truncate">{url}</span>
    </p>
  );
}

function ConfirmPairing({ t, pairing, members, me, secondsLeft, busy, onConfirm, onReject }) {
  const [name, setName] = useState(pairing.phone ? pairing.phone.name : '');
  const [memberId, setMemberId] = useState(me && me.role !== 'SUPER_ADMIN' ? me.id : (members.find((m) => m.role === 'OWNER') || {}).id ?? null);
  const [scopes, setScopes] = useState(pairing.defaultScopes || DEFAULT_SCOPES);
  const isBrowser = pairing.phone && pairing.phone.kind === 'browser';
  const toggle = (s) => setScopes((cur) => (s === 'view' ? cur : cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const sas = String(pairing.sas || '');
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground">{t('confirm.title', { name: pairing.phone ? pairing.phone.name : '' })}</p>
        <p className="text-[12px] text-muted-foreground">{isBrowser ? t('confirm.helpBrowser') : t('confirm.help')}</p>
      </div>
      <p className="font-mono text-3xl tracking-[0.3em] text-foreground text-center sm:text-left" aria-label={t('confirm.codeLabel', { code: sas.split('').join(' ') })}>
        {sas.slice(0, 3)} {sas.slice(3)}
      </p>
      <p className="text-[12px] text-muted-foreground">{t('pair.expiresIn', { time: fmtSeconds(secondsLeft) })}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] text-muted-foreground space-y-1">
          <span>{t('confirm.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
        </label>
        {members.length > 0 && (
          <label className="text-[12px] text-muted-foreground space-y-1">
            <span>{t('confirm.member')}</span>
            <select value={memberId ?? ''} onChange={(e) => setMemberId(e.target.value ? Number(e.target.value) : null)} className="w-full h-10 bg-input-background border border-border rounded-lg px-2 text-[13px] text-foreground outline-none focus:border-primary">
              {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({t(`roles.${m.role}`, { defaultValue: m.role })})</option>)}
            </select>
          </label>
        )}
      </div>

      <fieldset>
        <legend className="text-[12px] text-muted-foreground mb-2">{t('confirm.scopes')}</legend>
        <ScopeChecks t={t} scopes={scopes} onToggle={toggle} />
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" disabled={busy === 'confirm'} onClick={() => onConfirm({ name, memberId, scopes })} className="h-10 px-4 rounded-lg text-[13px] font-semibold text-white bg-primary hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
          {busy === 'confirm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />} {t('confirm.match')}
        </button>
        <button type="button" disabled={busy === 'reject'} onClick={onReject} className="h-10 px-4 rounded-lg border border-border text-[13px] text-foreground hover:bg-secondary inline-flex items-center justify-center gap-2">
          <X className="w-4 h-4" aria-hidden="true" /> {t('confirm.noMatch')}
        </button>
      </div>
    </div>
  );
}

function ScopeChecks({ t, scopes, onToggle, disabled = false }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SCOPES.map((s) => (
        <label key={s} className="flex items-start gap-2 text-[12.5px] text-foreground min-h-[44px] sm:min-h-0">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={scopes.includes(s)} disabled={disabled || s === 'view'} onChange={() => onToggle(s)} />
          <span>
            <span className="font-medium">{t(`scopes.${s}.label`)}</span>
            <span className="block text-[11.5px] text-muted-foreground">{t(`scopes.${s}.help`)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function DeviceRow({ t, device, members, busy, run }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [scopes, setScopes] = useState(device.scopes || ['view']);
  const member = members.find((m) => m.id === device.memberId);
  const toggle = (s) => setScopes((cur) => (s === 'view' ? cur : cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const changed = JSON.stringify([...scopes].sort()) !== JSON.stringify([...(device.scopes || [])].sort());
  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        {device.kind === 'browser'
          ? <Globe className="w-4 h-4 text-muted-foreground shrink-0" aria-label={t('devices.kindBrowser')} />
          : <Smartphone className="w-4 h-4 text-muted-foreground shrink-0" aria-label={t('devices.kindPhone')} />}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground truncate">{device.name}</p>
          <p className="text-[11.5px] text-muted-foreground">
            {device.kind === 'browser' ? `${t('devices.kindBrowser')} · ` : ''}
            {device.online ? t('devices.online') : device.lastSeenAt ? t('devices.lastSeen', { when: fmtDateTime(device.lastSeenAt) }) : t('devices.offline')}
            {member ? ` · ${t('devices.actsAs', { name: member.name })}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => setEditing((v) => !v)} className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary" aria-label={t('devices.edit', { name: device.name })} aria-expanded={editing}>
          <Pencil className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => { if (window.confirm(t('devices.removeConfirm', { name: device.name }))) run(`revoke-${device.deviceId}`, () => softglazeApi.mobile.devices.revoke(device.deviceId)); }}
          disabled={busy === `revoke-${device.deviceId}`}
          className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-secondary"
          aria-label={t('devices.remove', { name: device.name })}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {editing && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label={t('confirm.name')} className="flex-1 min-w-0 h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
            <button type="button" disabled={!name.trim() || name === device.name} onClick={() => run('rename', () => softglazeApi.mobile.devices.rename(device.deviceId, name))} className="h-10 px-3 rounded-lg bg-secondary text-[12.5px] text-foreground disabled:opacity-50">{t('devices.rename')}</button>
          </div>
          <ScopeChecks t={t} scopes={scopes} onToggle={toggle} />
          <button type="button" disabled={!changed || busy === 'scopes'} onClick={() => run('scopes', () => softglazeApi.mobile.devices.update(device.deviceId, { scopes }))} className="h-10 px-4 rounded-lg text-[13px] font-semibold text-white bg-primary disabled:opacity-50">{t('devices.saveScopes')}</button>
        </div>
      )}
    </li>
  );
}

function SyncSection({ t, status, profiles, busy, run }) {
  const [filter, setFilter] = useState('');
  const synced = useMemo(() => new Set(status.syncProfiles || []), [status.syncProfiles]);
  const withPw = useMemo(() => new Set(status.syncProxyPassword || []), [status.syncProxyPassword]);
  const linked = status.devices.some((d) => !d.revokedAt && (d.scopes || []).includes('phone_profiles_linked'));
  const list = profiles
    .filter((p) => !filter || String(p.title || '').toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(synced.has(b.id)) - Number(synced.has(a.id)))
    .slice(0, 200);
  const report = status.sync && status.sync.lastReport;
  return (
    <div className="rounded-xl border border-border bg-elevated/50 p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground flex items-center gap-2"><FolderSync className="w-4 h-4" aria-hidden="true" /> {t('sync.title')}</p>
          <p className="text-[12px] text-muted-foreground">{t('sync.help')}</p>
        </div>
        <button type="button" disabled={busy === 'syncnow' || !synced.size} onClick={() => run('syncnow', () => softglazeApi.mobile.sync.now())} className="shrink-0 h-10 px-3 rounded-lg border border-border text-[12.5px] text-foreground hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy === 'syncnow' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />} {t('sync.now')}
        </button>
      </div>
      {!linked && <p className="text-[12px] text-amber-400 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" /> {t('sync.noPhone')}</p>}
      {report && <p className="text-[11.5px] text-muted-foreground">{report.ok ? t('sync.lastOk', { when: fmtTime(report.at) }) : t('sync.lastError', { code: report.error || 'error' })}</p>}
      <p className="text-[11.5px] text-muted-foreground">{t('sync.limits')}</p>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('sync.search')} aria-label={t('sync.search')} className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
      <ul className="max-h-80 overflow-y-auto space-y-1.5">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border">
            <span className="min-w-0 flex-1 text-[12.5px] text-foreground truncate">{p.title}</span>
            {synced.has(p.id) && (
              <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <input type="checkbox" className="h-4 w-4" checked={withPw.has(p.id)} onChange={(e) => run(`pw-${p.id}`, () => softglazeApi.mobile.sync.setProxyPassword(p.id, e.target.checked))} />
                {t('sync.proxyPassword')}
              </label>
            )}
            <Switch
              checked={synced.has(p.id)}
              disabled={busy === `sync-${p.id}`}
              label={t('sync.toggle', { name: p.title })}
              onChange={(on) => {
                if (!on && !window.confirm(t('sync.offConfirm', { name: p.title }))) return;
                run(`sync-${p.id}`, () => softglazeApi.mobile.sync.setProfile(p.id, on, false));
              }}
            />
          </li>
        ))}
      </ul>
      {synced.size > 0 && (
        <button type="button" onClick={() => { if (window.confirm(t('sync.removeAllConfirm'))) run('removeall', () => softglazeApi.mobile.sync.removeAll()); }} className="h-10 px-3 rounded-lg border border-red-500/30 text-[12.5px] text-red-400 hover:bg-red-500/10">
          {t('sync.removeAll')}
        </button>
      )}
    </div>
  );
}

function AdvancedSettings({ t, status, busy, run }) {
  const [pcName, setPcName] = useState(status.pcName || '');
  const [relayUrl, setRelayUrl] = useState(status.relayUrl === status.defaultRelayUrl ? '' : status.relayUrl);
  return (
    <div className="mt-3 space-y-3">
      <label className="block text-[12px] text-muted-foreground space-y-1">
        <span>{t('advanced.pcName')}</span>
        <input value={pcName} onChange={(e) => setPcName(e.target.value)} maxLength={60} className="w-full h-10 bg-input-background border border-border rounded-lg px-3 text-[13px] text-foreground outline-none focus:border-primary" />
      </label>
      <label className="block text-[12px] text-muted-foreground space-y-1">
        <span>{t('advanced.relay')}</span>
        <input value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} placeholder={status.defaultRelayUrl} disabled={status.relayUrlFromEnv} className="w-full h-10 bg-input-background border border-border rounded-lg px-3 font-mono text-[12.5px] text-foreground outline-none focus:border-primary disabled:opacity-60" />
        {status.relayUrlFromEnv && <span className="block text-[11.5px]">{t('advanced.relayFromEnv')}</span>}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" disabled={busy === 'settings'} onClick={() => run('settings', () => softglazeApi.mobile.setSettings({ pcName, relayUrl: relayUrl.trim() || null }))} className="h-10 px-4 rounded-lg text-[13px] font-semibold text-white bg-primary disabled:opacity-50">{t('advanced.save')}</button>
        <button type="button" disabled={busy === 'reset'} onClick={() => { if (window.confirm(t('advanced.resetConfirm'))) run('reset', () => softglazeApi.mobile.resetKeys()); }} className="h-10 px-4 rounded-lg border border-red-500/30 text-[12.5px] text-red-400 hover:bg-red-500/10">{t('advanced.reset')}</button>
      </div>
      <p className="text-[11px] text-muted-foreground font-mono">{t('advanced.protocol', { version: status.protocol ? status.protocol.version : '?' })}</p>
    </div>
  );
}

function fmtSeconds(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
