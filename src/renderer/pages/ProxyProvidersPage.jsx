import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ExternalLink, Globe, KeyRound, Loader2, Plug, RefreshCw,
  Search, Server, Activity, CalendarClock, History, Pencil
} from 'lucide-react';

import ProxyProviders, { PROVIDERS, ProviderLogo } from '@/components/ProxyProviders.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import { Card } from '@/components/ui/Card.jsx';
import Input from '@/components/ui/Input.jsx';
import Switch from '@/components/ui/Switch.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { TONE, daysUntil, parseDay, shortDate, toneText, useProviderStates } from '@/lib/providerStates.js';
import { cn, formatDateTime } from '@/lib/utils.js';
import i18n from '@/i18n/index.js';
import providersPageEn from '@/i18n/locales/en/providersPage.json';
import providersPageEs from '@/i18n/locales/es/providersPage.json';

// Own namespace, registered here so the shared locale files stay untouched.
if (!i18n.hasResourceBundle('en', 'providersPage')) i18n.addResourceBundle('en', 'providersPage', providersPageEn);
if (!i18n.hasResourceBundle('es', 'providersPage')) i18n.addResourceBundle('es', 'providersPage', providersPageEs);

// ---------------------------------------------------------------------------
// Proxy providers - every vendor integration on one page.
//
// The connector forms themselves (geo, count, protocol, sticky, creds, pull) are the
// existing ProxyProviders component rendered in `embedded` mode, so every IPC call,
// FORM_DRAFTS, persistCreds and syncVendorPool path is the same code the Proxy Pool
// tab used. This page adds the shell around it, built from useProviderStates. Needs attention
// and Trials are on the Super Admin's Provider status page, not here.
// ---------------------------------------------------------------------------

const TEST_AFTER_KEY = 'sg.providers.testAfterImport';
const POOL_PREVIEW = 50;

function readTestAfter() {
  try { return window.localStorage.getItem(TEST_AFTER_KEY) !== '0'; } catch (e) { return true; }
}
function writeTestAfter(on) {
  try { window.localStorage.setItem(TEST_AFTER_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
}

const STATE_TONE = { connected: 'success', trial: 'trial', needsKey: 'warning', notSetUp: 'muted', unavailable: 'muted' };

function StateDot({ state, label }) {
  const tone = STATE_TONE[state] || 'muted';
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: state === 'notSetUp' || state === 'unavailable' ? 'transparent' : TONE[tone], border: `1.5px solid ${TONE[tone]}` }} />
      <span className={state === 'notSetUp' || state === 'unavailable' ? 'text-muted-foreground' : ''}>{label}</span>
    </span>
  );
}

function LogoTile({ p, size = 'sm' }) {
  const box = size === 'lg' ? 'w-11 h-11 rounded-xl' : 'w-7 h-7 rounded-lg';
  const icon = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';
  return (
    <span className={cn(box, 'grid place-items-center shrink-0')} style={{ background: `color-mix(in srgb, ${p.color} 14%, transparent)`, color: `color-mix(in srgb, ${p.color} 80%, var(--foreground))`, border: `1px solid color-mix(in srgb, ${p.color} 28%, transparent)` }}>
      <ProviderLogo k={p.key} className={icon} />
    </span>
  );
}

function maskedLine(px) {
  const scheme = String(px.type || 'HTTP').toLowerCase();
  const auth = px.username ? `${px.username}:${px.hasPassword || px.password ? '••••' : ''}@` : '';
  return `${scheme}://${auth}${px.host}:${px.port}`;
}

export default function ProxyProvidersPage() {
  const { t, i18n: inst } = useTranslation('providersPage');
  const navigate = useNavigate();
  const lang = inst.language || 'en';

  const { loading, setLoading, loadErr, proxies, credsHidden, load, rows, isSuper } = useProviderStates();
  const [links, setLinks] = useState({});

  // The Provider status page links here with ?provider=<key>&tab=<pull|pool>.
  const [params] = useSearchParams();
  const [selectedKey, setSelectedKey] = useState(() => {
    const wanted = params.get('provider');
    return wanted && PROVIDERS.some((p) => p.key === wanted) ? wanted : null;
  });
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(() => (params.get('tab') === 'pool' ? 'pool' : 'pull'));

  const [testAfter, setTestAfter] = useState(readTestAfter);
  const [lastPull, setLastPull] = useState(null); // { key, created: [] }
  const [testRun, setTestRun] = useState(null); // { key, runId, done, total, ok, fail, finished }
  const testRunRef = useRef(null);
  testRunRef.current = testRun;

  const [trialEdit, setTrialEdit] = useState(null); // { endsAt, allowance } while editing
  const [trialErr, setTrialErr] = useState('');
  const [savingTrial, setSavingTrial] = useState(false);
  const detailRef = useRef(null);

  useEffect(() => {
    softglazeApi.monetization.getLinks().then((r) => setLinks(r && r.links ? r.links : {})).catch(() => {});
  }, []);

  // Live progress for "test after import" runs.
  useEffect(() => {
    if (!softglazeApi.proxies.onCheckProgress) return undefined;
    const off = softglazeApi.proxies.onCheckProgress((data) => {
      const cur = testRunRef.current;
      if (!data || !cur || cur.finished) return;
      if (cur.runId && data.runId && data.runId !== cur.runId) return;
      setTestRun((prev) => (prev ? {
        ...prev,
        runId: prev.runId || data.runId || null,
        done: data.done ?? prev.done,
        total: data.total ?? prev.total,
        ok: data.ok ?? prev.ok,
        fail: data.fail ?? prev.fail,
        finished: Boolean(data.finished)
      } : prev));
      if (data.finished) load();
    });
    return () => { if (typeof off === 'function') off(); };
  }, [load]);

  const byKey = useMemo(() => Object.fromEntries(rows.map((r) => [r.p.key, r])), [rows]);

  const counts = useMemo(() => {
    const c = { all: rows.length, connected: 0, trial: 0, needsKey: 0, notSetUp: 0 };
    for (const r of rows) {
      if (r.state === 'unavailable') c.notSetUp += 1; else c[r.state] += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all') {
        const s = r.state === 'unavailable' ? 'notSetUp' : r.state;
        if (s !== filter) return false;
      }
      return !q || r.p.name.toLowerCase().includes(q) || r.p.key.includes(q);
    });
  }, [rows, filter, query]);

  // First paint: open the first live provider.
  useEffect(() => {
    if (loading || selectedKey) return;
    const first = rows.find((r) => r.state === 'connected' || r.state === 'trial')?.p.key || PROVIDERS.find((p) => !p.unavailable)?.key || PROVIDERS[0].key;
    setSelectedKey(first);
  }, [loading, selectedKey, rows]);

  const sel = selectedKey ? byKey[selectedKey] : null;

  function openProvider(key, nextTab = 'pull', scroll = false) {
    setSelectedKey(key);
    setTab(nextTab);
    setTrialEdit(null);
    setTrialErr('');
    if (scroll && detailRef.current) {
      try { detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* ignore */ }
    }
  }

  // ---- pulls + test after import -------------------------------------------------
  async function handleSynced(r, key) {
    const created = r && Array.isArray(r.created) ? r.created.filter(Boolean) : [];
    setLastPull({ key, created });
    await load();
    const ids = created.map((px) => px.id).filter((id) => id != null);
    if (!testAfter || !ids.length) return;
    setTestRun({ key, runId: null, done: 0, total: ids.length, ok: 0, fail: 0, finished: false });
    try {
      const res = await softglazeApi.proxies.checkStream({ ids });
      setTestRun((prev) => (prev ? { ...prev, runId: prev.runId || (res && res.runId) || null, total: res && typeof res.total === 'number' ? res.total : prev.total } : prev));
    } catch (e) {
      setTestRun((prev) => (prev ? { ...prev, finished: true } : prev));
    }
  }

  // ---- trials --------------------------------------------------------------------
  async function saveTrial(remove) {
    if (!sel) return;
    setSavingTrial(true); setTrialErr('');
    try {
      const value = remove ? null : { endsAt: (trialEdit && trialEdit.endsAt) || '', allowance: ((trialEdit && trialEdit.allowance) || '').trim() };
      await softglazeApi.settings.setGlobal({ proxyProviderTrials: { [sel.p.key]: value } });
      setTrialEdit(null);
      await load();
    } catch (e) {
      setTrialErr(t('detail.trialSaveError', { message: e && e.message ? e.message : String(e) }));
    } finally { setSavingTrial(false); }
  }

  // ---- render --------------------------------------------------------------------
  const poolTotal = proxies.length;
  const active = rows.filter((r) => r.state === 'connected' || r.state === 'trial' || r.state === 'needsKey').length;
  const supplying = rows.filter((r) => r.pool.total > 0).length;

  const FILTERS = [
    ['all', t('table.all')],
    ['connected', t('states.connected')],
    ...(isSuper ? [['trial', t('states.trial')]] : []),
    ['needsKey', t('states.needsKey')],
    ['notSetUp', t('states.notSetUp')]
  ];

  return (
    <div className="flex flex-col gap-5 pb-6">
      <PageHeader
        className="mb-0"
        title={t('title')}
        description={loading ? t('loading') : active ? t('summary', { total: PROVIDERS.length, active, supplying, pool: poolTotal }) : t('summaryEmpty', { total: PROVIDERS.length })}
        actions={(
          <>
            <Button variant="secondary" size="sm" onClick={() => { setLoading(true); load(); }} disabled={loading}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> {t('refresh')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/proxies')}>
              <Globe className="w-4 h-4" /> {t('openPool')}
            </Button>
          </>
        )}
      />

      {loadErr && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm" style={toneText('danger')}>{t('loadError', { message: loadErr })}</div>}

      {/* Integrations table + detail panel */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 items-start">
        <Card className="overflow-hidden">
          <div className="p-4 flex flex-col gap-3 border-b border-border">
            <div className="max-w-sm">
              <Input icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('table.search', { count: PROVIDERS.length })} aria-label={t('table.searchLabel')} />
            </div>
            <div role="tablist" aria-label={t('table.filtersLabel')} className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-elevated/60 border border-border w-fit max-w-full">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors', filter === key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground border border-transparent')}
                >
                  {label}
                  <span className="text-[10.5px] font-semibold text-muted-foreground tabular-nums">{counts[key]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-surface text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('table.colProvider')}</th>
                  <th scope="col" className="px-4 py-3">{t('table.colState')}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t('table.colPool')}</th>
                  <th scope="col" className="px-4 py-3 hidden sm:table-cell 2xl:table-cell xl:hidden">{t('table.colKind')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const isSel = r.p.key === selectedKey;
                  return (
                    <tr
                      key={r.p.key}
                      onClick={() => openProvider(r.p.key, tab)}
                      className={cn('cursor-pointer transition-colors', isSel ? 'bg-primary/10' : 'hover:bg-secondary/60')}
                    >
                      <td className="px-4 py-2.5">
                        <button type="button" aria-current={isSel ? 'true' : undefined} onClick={(e) => { e.stopPropagation(); openProvider(r.p.key, tab); }} className="flex items-center gap-2.5 text-left rounded outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <LogoTile p={r.p} />
                          <span className={cn('text-[13px] font-medium whitespace-nowrap', isSel ? 'text-primary' : 'text-foreground')}>{r.p.name}</span>
                          {r.pool.fail > 0 && <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: TONE.warning }} aria-label={t('attention.failing', { failed: r.pool.fail, total: r.pool.total })} />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5"><StateDot state={r.state} label={t(`states.${r.state}`)} /></td>
                      <td className={cn('px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums', r.pool.total ? 'text-foreground' : 'text-muted-foreground')}>{r.pool.total}</td>
                      <td className="px-4 py-2.5 text-[12.5px] text-muted-foreground whitespace-nowrap hidden sm:table-cell 2xl:table-cell xl:hidden">{t(`kind.${r.kind}`)}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-[13px] text-muted-foreground">{t('table.noMatch')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {sel && (
          <Card className="overflow-hidden scroll-mt-4" ref={detailRef}>
            <DetailPanel
              t={t}
              lang={lang}
              sel={sel}
              credsHidden={credsHidden}
              isSuper={isSuper}
              referral={links[sel.p.key] || sel.p.referral}
              tab={tab}
              setTab={setTab}
              trialEdit={trialEdit}
              setTrialEdit={setTrialEdit}
              trialErr={trialErr}
              savingTrial={savingTrial}
              saveTrial={saveTrial}
              testAfter={testAfter}
              setTestAfter={(v) => { setTestAfter(v); writeTestAfter(v); }}
              testRun={testRun && testRun.key === sel.p.key ? testRun : null}
              lastPull={lastPull && lastPull.key === sel.p.key ? lastPull : null}
              onSynced={handleSynced}
              openPool={() => navigate('/proxies')}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

// Module scope so its children (the trial inputs) keep focus across re-renders.
function Row({ icon: Icon, label, children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 items-start">
      <dt className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{label}</dt>
      <dd className="text-[13px] text-foreground min-w-0 break-words">{children}</dd>
    </div>
  );
}

function DetailPanel({ t, lang, sel, credsHidden, isSuper, referral, tab, setTab, trialEdit, setTrialEdit, trialErr, savingTrial, saveTrial, testAfter, setTestAfter, testRun, lastPull, onSynced, openPool }) {
  const { p, pool, keySaved, trial, state, kind } = sel;
  const gw = p.gateway ? `${p.gateway.host}:${p.gateway.port}` : null;
  const trialDay = trial ? parseDay(trial.endsAt) : null;

  const TABS = [['pull', t('detail.tabPull')], ['pool', `${t('detail.tabPool')} ${pool.total}`]];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-border">
        <LogoTile p={p} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-foreground font-display break-words">{p.name}</h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
            <StateDot state={state} label={t(`states.${state}`)} />
            <span className="text-muted-foreground text-[12px]" aria-hidden="true">·</span>
            <span className="text-[12.5px] text-muted-foreground">{t('detail.proxiesInPool', { count: pool.total })}</span>
          </div>
        </div>
        {referral && (
          <a href={referral} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium bg-secondary border border-border hover:border-border-strong text-secondary-foreground hover:bg-elevated transition-colors">
            {t('detail.dashboard')} <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Overview */}
      <section className="px-5 py-3 border-b border-border" aria-label={t('detail.overview')}>
        <dl className="divide-y divide-border/60">
          <Row icon={Plug} label={t('detail.connector')}>{t(`kind.${kind}`)}</Row>
          <Row icon={Server} label={t('detail.gateway')}>{gw ? <span className="font-mono text-[12.5px]">{gw}</span> : <span className="text-muted-foreground">{t('detail.gatewayFromKey')}</span>}</Row>
          {!p.unavailable && (
            <Row icon={KeyRound} label={t('detail.key')}>
              {credsHidden ? <span className="text-muted-foreground">{t('detail.keyHidden')}</span>
                : keySaved ? <span className="inline-flex items-center gap-1.5"><span className="font-mono tracking-widest text-muted-foreground" aria-hidden="true">••••••••</span>{t('detail.keySaved')}</span>
                  : <span className="text-muted-foreground">{t('detail.keyNotSaved')}</span>}
            </Row>
          )}
          <Row icon={Activity} label={t('detail.health')}>
            {pool.total ? (
              <span className="inline-flex flex-col gap-1.5 w-full">
                <span className="flex h-1.5 w-full max-w-[220px] rounded-full overflow-hidden bg-secondary" aria-hidden="true">
                  <span style={{ width: `${(pool.ok / pool.total) * 100}%`, background: TONE.success }} />
                  <span style={{ width: `${(pool.fail / pool.total) * 100}%`, background: TONE.danger }} />
                </span>
                <span>{t('detail.healthLine', { ok: pool.ok, failed: pool.fail, unchecked: pool.unchecked })}</span>
              </span>
            ) : <span className="text-muted-foreground">{t('detail.healthEmpty')}</span>}
          </Row>
          <Row icon={History} label={t('detail.lastPull')}>{pool.last ? formatDateTime(pool.last) : <span className="text-muted-foreground">{t('detail.never')}</span>}</Row>
          {!p.unavailable && isSuper && (
            <Row icon={CalendarClock} label={t('detail.trial')}>
              {trialEdit ? (
                <div className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                      {t('detail.trialEndsLabel')}
                      <Input type="date" value={trialEdit.endsAt} onChange={(e) => setTrialEdit({ ...trialEdit, endsAt: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                      {t('detail.trialAllowanceLabel')}
                      <Input value={trialEdit.allowance} maxLength={40} onChange={(e) => setTrialEdit({ ...trialEdit, allowance: e.target.value })} placeholder={t('detail.trialAllowancePlaceholder')} />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => saveTrial(false)} isLoading={savingTrial}>{t('detail.trialSave')}</Button>
                    {trial && <Button size="sm" variant="danger" onClick={() => saveTrial(true)} disabled={savingTrial}>{t('detail.trialRemove')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setTrialEdit(null)} disabled={savingTrial}>{t('detail.trialCancel')}</Button>
                  </div>
                  {trialErr && <p className="text-[12px]" style={toneText('danger')}>{trialErr}</p>}
                </div>
              ) : (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={trial ? '' : 'text-muted-foreground'}>
                    {trial
                      ? [trial.allowance, trialDay ? (daysUntil(trialDay) < 0 ? t('trials.ended', { date: shortDate(trialDay, lang) }) : t('trials.ends', { date: shortDate(trialDay, lang) })) : t('trials.noEnd')].filter(Boolean).join(' · ')
                      : t('detail.trialNone')}
                  </span>
                  <button type="button" onClick={() => setTrialEdit({ endsAt: (trial && trial.endsAt) || '', allowance: (trial && trial.allowance) || '' })} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">
                    <Pencil className="w-3 h-3" /> {trial ? t('detail.trialEdit') : t('detail.trialMark')}
                  </button>
                </span>
              )}
            </Row>
          )}
        </dl>
      </section>

      {/* Tabs */}
      <div role="tablist" className="flex items-center gap-1 px-5 border-b border-border">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn('px-3 py-2.5 -mb-px text-[13px] font-semibold border-b-2 transition-colors', tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'pull' ? (
          p.unavailable ? (
            <p className="text-[13px] text-muted-foreground leading-relaxed">{t('detail.noConnector')}</p>
          ) : (
            <div className="flex flex-col gap-4 provider-workspace">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground">{t('detail.testAfter')}</span>
                  <span className="block text-[12px] text-muted-foreground">{t('detail.testAfterHint')}</span>
                </span>
                <Switch checked={testAfter} onChange={setTestAfter} label={t('detail.testAfter')} />
              </label>

              {/* The real connector: same forms, IPC calls and drafts as before. */}
              <ProxyProviders embedded selectedKey={p.key} onSynced={onSynced} />

              {testRun && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3.5 py-2.5 text-[12.5px] text-foreground" role="status">
                  {testRun.finished ? <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: TONE.success }} /> : <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />}
                  {testRun.finished
                    ? t('detail.tested', { total: testRun.total, ok: testRun.ok, failed: testRun.fail })
                    : t('detail.testing', { done: testRun.done, total: testRun.total, ok: testRun.ok, failed: testRun.fail })}
                </div>
              )}

              {lastPull && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3.5 py-2 bg-surface border-b border-border text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">{t('detail.lastPullTitle')}</div>
                  {lastPull.created.length === 0 ? (
                    <p className="px-3.5 py-3 text-[12.5px] text-muted-foreground">{t('detail.lastPullEmpty')}</p>
                  ) : (
                    <pre className="px-3.5 py-3 text-[12px] leading-relaxed font-mono text-foreground overflow-x-auto whitespace-pre">
                      {lastPull.created.slice(0, 8).map(maskedLine).join('\n')}
                      {lastPull.created.length > 8 ? `\n${t('detail.andMore', { count: lastPull.created.length - 8 })}` : ''}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          <PoolList t={t} pool={pool} openPool={openPool} />
        )}
      </div>
    </>
  );
}

function PoolList({ t, pool, openPool }) {
  if (!pool.total) return <p className="text-[13px] text-muted-foreground">{t('detail.poolEmpty')}</p>;
  const shown = pool.rows.slice(0, POOL_PREVIEW);
  return (
    <div className="flex flex-col gap-3">
      <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {shown.map((px) => {
          const st = px.lastStatus === 'ok' ? 'ok' : px.lastStatus === 'fail' ? 'fail' : 'unchecked';
          const tone = st === 'ok' ? 'success' : st === 'fail' ? 'danger' : 'muted';
          return (
            <li key={px.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-4 gap-y-0.5 px-3.5 py-2">
              <span className="font-mono text-[12px] text-foreground truncate" title={px.name}>{`${px.host}:${px.port}`}</span>
              <span className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap" style={st === 'unchecked' ? undefined : toneText(tone)}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE[tone] }} />
                <span className={st === 'unchecked' ? 'text-muted-foreground' : ''}>{t(`detail.status${st === 'ok' ? 'Ok' : st === 'fail' ? 'Fail' : 'Unchecked'}`)}</span>
              </span>
              <span className="hidden sm:block text-[12px] text-muted-foreground w-10 text-right">{px.lastCountry || ''}</span>
              <span className="hidden sm:block text-[12px] text-muted-foreground font-mono w-16 text-right tabular-nums">{px.lastLatencyMs != null ? `${px.lastLatencyMs} ms` : ''}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-muted-foreground">{pool.total > POOL_PREVIEW ? t('detail.poolShowing', { shown: POOL_PREVIEW, total: pool.total }) : ''}</span>
        <Button variant="secondary" size="sm" onClick={openPool}><Globe className="w-4 h-4" /> {t('openPool')}</Button>
      </div>
    </div>
  );
}
