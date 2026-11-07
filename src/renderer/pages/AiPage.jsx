import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  Activity, AppWindow, BookOpen, Check, Cpu, ExternalLink, KeyRound, Lock, MessageSquareText,
  OctagonX, RefreshCw, Settings2, ShieldCheck, Sparkles, TriangleAlert
} from 'lucide-react';

import PageHeader from '@/components/PageHeader.jsx';
import Button from '@/components/ui/Button.jsx';
import Switch from '@/components/ui/Switch.jsx';
import { useAiApprovals } from '@/components/ai/AiApprovalsProvider.jsx';
import {
  AI_TONE, BetaPill, ConfirmDialog, DangerButton, PrimaryButton, SUBTLE_TEXT, StatusDot, clientLabel, toneSurface, toneText
} from '@/components/ai/AiShared.jsx';
import AiConnectTab from '@/components/ai/AiConnectTab.jsx';
import AiTokensTab from '@/components/ai/AiTokensTab.jsx';
import CreateTokenDialog from '@/components/ai/CreateTokenDialog.jsx';
import AiApprovalsTab from '@/components/ai/AiApprovalsTab.jsx';
import AiActivityTab from '@/components/ai/AiActivityTab.jsx';
import AiMemoryTab from '@/components/ai/AiMemoryTab.jsx';
import AiPromptsTab from '@/components/ai/AiPromptsTab.jsx';
import AiSettingsTab from '@/components/ai/AiSettingsTab.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import {
  DOCS_BASE, buildClientList, canManageAi, classifyAiError, defaultTokenForm, errorText,
  initialTokenFlow, isAiOwner, relativeTime, serverAddress, serverState, tokenFlowReducer, tokenState
} from '@/lib/aiCore.mjs';
import { cn } from '@/lib/utils.js';

const TABS = ['connect', 'tokens', 'approvals', 'activity', 'memory', 'prompts', 'settings'];
const TAB_ICONS = { connect: AppWindow, tokens: KeyRound, approvals: ShieldCheck, activity: Activity, memory: BookOpen, prompts: MessageSquareText, settings: Settings2 };
const STATUS_POLL_MS = 5000;

const asArray = (v) => (Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : []));

export default function AiPage() {
  const { t, i18n } = useTranslation('ai');
  const lang = i18n.language || 'en';
  const [params, setParams] = useSearchParams();
  const approvals = useAiApprovals();

  const [me, setMe] = useState(undefined);
  const [phase, setPhase] = useState('loading'); // loading | ready | unavailable | forbidden | error
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [tokensState, setTokensState] = useState({ loading: true, error: '' });
  const [members, setMembers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [snippets, setSnippets] = useState([]);
  const [bridge, setBridge] = useState(null);
  const [connectLoaded, setConnectLoaded] = useState(false);
  const [connectErr, setConnectErr] = useState('');
  const [toggling, setToggling] = useState(false);
  const [toggleErr, setToggleErr] = useState('');
  const [stop, setStop] = useState({ open: false, busy: false, result: null, error: '' });
  const [flow, dispatch] = useReducer(tokenFlowReducer, initialTokenFlow);

  const tabParam = params.get('tab');
  const tab = TABS.includes(tabParam) ? tabParam : 'connect';
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);
  const setTab = useCallback((next) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set('tab', next); n.delete('confirmStop'); return n; }, { replace: true });
  }, [setParams]);

  const allowed = canManageAi(me);
  const owner = isAiOwner(me);

  const loadStatus = useCallback(async () => {
    try {
      const s = await softglazeApi.ai.getStatus();
      setStatus(s || null);
      setPhase('ready');
      return s;
    } catch (e) {
      const kind = classifyAiError(e);
      if (kind === 'unavailable') setPhase('unavailable');
      else if (kind === 'forbidden') setPhase('forbidden');
      else { setLoadError(errorText(e)); setPhase((p) => (p === 'ready' ? p : 'error')); }
      return null;
    }
  }, []);

  const loadTokens = useCallback(async () => {
    try {
      const list = await softglazeApi.ai.tokens.list();
      setTokens(asArray(list));
      setTokensState({ loading: false, error: '' });
    } catch (e) {
      setTokensState({ loading: false, error: errorText(e) });
    }
  }, []);

  const loadConnect = useCallback(async () => {
    setConnectErr('');
    const [sn, br] = await Promise.allSettled([softglazeApi.ai.snippets(), softglazeApi.ai.bridgeInfo()]);
    if (sn.status === 'fulfilled') setSnippets(asArray(sn.value));
    else setConnectErr(errorText(sn.reason));
    setBridge(br.status === 'fulfilled' ? (br.value || null) : null);
    setConnectLoaded(true);
  }, []);

  // Who is signed in decides whether the page opens at all.
  useEffect(() => {
    let live = true;
    softglazeApi.members.current().then((m) => { if (live) setMe(m || null); }).catch(() => { if (live) setMe(null); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (me === undefined) return;
    if (!allowed) { setPhase('forbidden'); return; }
    let live = true;
    (async () => {
      const s = await loadStatus();
      if (!live || !s) return;
      loadTokens();
      loadConnect();
      softglazeApi.members.list().then((l) => { if (live) setMembers(asArray(l)); }).catch(() => {});
      softglazeApi.groups.list().then((l) => { if (live) setGroups(asArray(l)); }).catch(() => {});
    })();
    return () => { live = false; };
  }, [me, allowed, loadStatus, loadTokens, loadConnect]);

  // Keep the header live while the page is open and the window is visible.
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') loadStatus(); }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [phase, loadStatus]);

  // Main tells us when the server status changes (on/off, a client connects, Stop all AI).
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    const off = softglazeApi.ai.onStatusChanged(() => { loadStatus(); });
    return () => { if (typeof off === 'function') off(); };
  }, [phase, loadStatus]);

  // The port can change in Settings; the snippets carry it.
  const port = status && status.port;
  const firstPort = useRef(port);
  useEffect(() => {
    if (port == null) return;
    if (firstPort.current == null) { firstPort.current = port; return; }
    if (firstPort.current !== port) { firstPort.current = port; loadConnect(); }
  }, [port, loadConnect]);

  // The command palette's "Stop all AI" lands here with ?confirmStop=1.
  useEffect(() => {
    if (phase === 'ready' && params.get('confirmStop') === '1') {
      setStop((s) => ({ ...s, open: true, result: null, error: '' }));
      setParams((p) => { const n = new URLSearchParams(p); n.delete('confirmStop'); return n; }, { replace: true });
    }
  }, [phase, params, setParams]);

  async function toggleServer(next) {
    setToggling(true);
    setToggleErr('');
    try {
      const s = await softglazeApi.ai.setEnabled(next);
      if (s && typeof s === 'object') setStatus(s); else await loadStatus();
      if (next) loadConnect();
    } catch (e) {
      setToggleErr(t('header.toggleError', { message: errorText(e) }));
    } finally {
      setToggling(false);
    }
  }

  async function stopAll() {
    setStop((s) => ({ ...s, busy: true, error: '' }));
    try {
      // Stop all AI also switches SoftGlaze AI off (engine); the banner below offers "Turn on".
      const r = await softglazeApi.ai.stopAll();
      approvals.clearAll();
      await loadStatus();
      setStop({ open: false, busy: false, result: r || {}, error: '' });
    } catch (e) {
      setStop((s) => ({ ...s, busy: false, error: errorText(e) }));
    }
  }

  const clients = useMemo(() => buildClientList(snippets, status), [snippets, status]);
  const openCreate = useCallback((opts = {}) => {
    const form = defaultTokenForm({ me, members, clientTitle: opts.client ? opts.client.title : '', automation: Boolean(opts.automation) });
    dispatch({ type: 'open', form, client: opts.client || null });
  }, [me, members]);

  const pending = approvals.canList ? approvals.queue.length : Math.max(approvals.queue.length, Number(status && status.pendingApprovals) || 0);
  const liveTokens = tokens.filter((tok) => ['active', 'expiring'].includes(tokenState(tok))).length;

  // ---- States that replace the page -----------------------------------------------------------

  const header = (
    <PageHeader
      className="mb-5"
      title={<span className="inline-flex items-center gap-2.5">{t('title')}<BetaPill /></span>}
      description={<span className={SUBTLE_TEXT}>{t('description')}</span>}
      actions={phase === 'ready' ? (
        <>
          <ServerSwitch status={status} busy={toggling} onToggle={toggleServer} />
          <DangerButton size="lg" onClick={() => setStop((s) => ({ ...s, open: true, result: null, error: '' }))}>
            <OctagonX className="h-[18px] w-[18px]" strokeWidth={2} /> {t('header.stopAll')}
          </DangerButton>
        </>
      ) : phase === 'loading' ? <div className="h-10 w-[21rem] max-w-full animate-pulse rounded-lg bg-card motion-reduce:animate-none" aria-hidden="true" /> : null}
    />
  );

  if (phase !== 'ready') {
    return (
      <div className="pb-6">
        {header}
        {phase === 'loading' && <LoadingSkeleton label={t('loading')} />}
        {phase === 'unavailable' && (
          <StatePanel
            icon={Sparkles}
            tone="info"
            title={t('states.unavailableTitle')}
            body={t('states.unavailableBody')}
            actions={(
              <>
                <a href={DOCS_BASE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-elevated">
                  {t('learnMore')} <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <Button variant="ghost" onClick={() => { setPhase('loading'); loadStatus(); }}><RefreshCw className="h-4 w-4" /> {t('retry')}</Button>
              </>
            )}
          />
        )}
        {phase === 'forbidden' && (
          <StatePanel icon={Lock} tone="muted" title={t('states.forbiddenTitle')} body={t('states.forbiddenBody')} />
        )}
        {phase === 'error' && (
          <StatePanel
            icon={TriangleAlert}
            tone="danger"
            title={t('states.errorTitle')}
            body={loadError}
            actions={<Button variant="secondary" onClick={() => { setPhase('loading'); loadStatus(); }}><RefreshCw className="h-4 w-4" /> {t('retry')}</Button>}
          />
        )}
      </div>
    );
  }

  const state = serverState(status);

  return (
    <div className="pb-6">
      {header}

      {toggleErr && <p role="alert" className="mb-4 text-[12.5px]" style={toneText('danger')}>{toggleErr}</p>}
      {stop.result && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-[13px]" style={{ ...toneSurface('success', 10, 30) }}>
          <span className="flex min-w-0 flex-1 items-start gap-2 text-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: AI_TONE.success }} />
            <span className="min-w-0">
              <span className="block">{t('stop.result', {
                runs: Number(stop.result.stoppedRuns) || 0,
                profiles: Number(stop.result.stoppedProfiles) || 0,
                calls: Number(stop.result.abortedCalls) || 0,
                sessions: Number(stop.result.revokedSessions) || 0,
                approvals: Number(stop.result.deniedApprovals) || 0
              })}</span>
              {!(status && status.enabled) && <span className="mt-0.5 block font-semibold">{t('stop.nowOff')}</span>}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {!(status && status.enabled) && (
              <PrimaryButton size="sm" isLoading={toggling} onClick={async () => { await toggleServer(true); setStop((s) => ({ ...s, result: null })); }}>
                {t('stop.turnOn')}
              </PrimaryButton>
            )}
            <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setStop((s) => ({ ...s, result: null }))}>{t('close')}</button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={Cpu}
          label={t('status.server')}
          tone={state === 'running' ? 'success' : state === 'error' ? 'danger' : 'muted'}
          value={(
            <span className="inline-flex items-center gap-2">
              <StatusDot tone={state === 'running' ? 'success' : state === 'error' ? 'danger' : 'muted'} pulse={state === 'running'} />
              {state === 'running' ? t('status.running') : state === 'error' ? t('status.error') : t('status.off')}
            </span>
          )}
          sub={state === 'running'
            ? <span className="font-mono">{serverAddress(status)}</span>
            : state === 'error'
              ? (status && status.error ? t('status.errorHint', { message: status.error }) : t('status.errorHintNoMessage'))
              : t('status.offHint')}
        />
        <ConnectedAppsTile clients={Array.isArray(status && status.clients) ? status.clients : []} lang={lang} />
        <Tile
          icon={ShieldCheck}
          label={t('status.waiting')}
          tone={pending > 0 ? 'warning' : 'muted'}
          value={<span className="tabular-nums">{pending}</span>}
          sub={pending > 0 ? t('status.waitingSome', { count: pending }) : t('status.waitingNone')}
          onClick={() => setTab('approvals')}
          actionLabel={t('status.openApprovals')}
        />
        <Tile
          icon={Activity}
          label={t('status.sessions')}
          tone={Number(status && status.runningAiSessions) > 0 ? 'info' : 'muted'}
          value={<span className="tabular-nums">{Number(status && status.runningAiSessions) || 0}</span>}
          sub={t('status.sessionsHint')}
        />
      </div>

      <TabBar tab={tab} setTab={setTab} counts={{ approvals: pending }} />

      <div className="mt-5">
        {TABS.map((key) => (visited.has(key) || key === tab) && (
          <div key={key} role="tabpanel" id={`ai-panel-${key}`} aria-labelledby={`ai-tab-${key}`} hidden={key !== tab} tabIndex={-1} className="outline-none">
            {key === 'connect' && (
              <AiConnectTab
                status={status}
                clients={clients}
                loading={!connectLoaded}
                bridge={bridge}
                error={connectErr}
                onRetry={loadConnect}
                isOwner={owner}
                tokensCount={liveTokens}
                tokensLoaded={!tokensState.loading}
                onToggleServer={() => toggleServer(true)}
                toggling={toggling}
                onCreateToken={openCreate}
              />
            )}
            {key === 'tokens' && (
              <AiTokensTab
                tokens={tokens}
                state={tokensState}
                groups={groups}
                lang={lang}
                onReload={loadTokens}
                onCreate={() => openCreate()}
              />
            )}
            {key === 'approvals' && <AiApprovalsTab lang={lang} onOpenSettings={() => setTab('settings')} />}
            {key === 'activity' && <AiActivityTab lang={lang} clients={Array.isArray(status && status.clients) ? status.clients : []} />}
            {key === 'memory' && <AiMemoryTab lang={lang} />}
            {key === 'prompts' && <AiPromptsTab />}
            {key === 'settings' && <AiSettingsTab isOwner={owner} status={status} onPortChanged={() => { loadStatus(); }} />}
          </div>
        ))}
      </div>

      <CreateTokenDialog
        flow={flow}
        dispatch={dispatch}
        me={me}
        members={members}
        groups={groups}
        isOwner={owner}
        hostOs={(typeof window !== 'undefined' && window.softglaze && window.softglaze.hostOs) || 'Windows'}
        onCreated={loadTokens}
      />

      <ConfirmDialog
        open={stop.open}
        title={t('stop.title')}
        body={t('stop.body')}
        confirmLabel={t('stop.confirm')}
        busy={stop.busy}
        onConfirm={stopAll}
        onCancel={() => setStop((s) => ({ ...s, open: false, error: '' }))}
      >
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-foreground">
          <li>{t('stop.point1')}</li>
          <li>{t('stop.point2')}</li>
          <li>{t('stop.point3')}</li>
          <li>{t('stop.point4')}</li>
        </ul>
        {stop.error && <p role="alert" className="text-[12.5px]" style={toneText('danger')}>{t('stop.error', { message: stop.error })}</p>}
      </ConfirmDialog>
    </div>
  );
}

function ServerSwitch({ status, busy, onToggle }) {
  const { t } = useTranslation('ai');
  const on = Boolean(status && status.enabled);
  return (
    <div className="flex h-10 items-center gap-2.5 rounded-lg border border-border bg-card px-3">
      <Switch checked={on} disabled={busy} onChange={onToggle} label={t('header.switchLabel')} />
      <span className="min-w-[7.5rem] text-[13px] font-medium text-foreground">
        {busy ? (on ? t('header.turningOff') : t('header.turningOn')) : `${t('header.switchShort')}: ${on ? t('header.on') : t('header.off')}`}
      </span>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, tone = 'muted', onClick, actionLabel }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground" title={label}>{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ ...toneSurface(tone, 14, 0), color: AI_TONE[tone] }}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>
      <div className="mt-2 font-display text-[22px] font-semibold leading-tight text-foreground">{value}</div>
      <div className="mt-1 line-clamp-3 text-[12px] leading-snug text-muted-foreground">{sub}</div>
    </>
  );
  const cls = 'flex h-full min-h-[150px] w-full flex-col justify-start rounded-xl border border-border bg-card p-4 text-left';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={`${label}: ${actionLabel}`} className={cn(cls, 'transition-colors hover:border-border-strong hover:bg-elevated/40')}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function ConnectedAppsTile({ clients, lang }) {
  const { t } = useTranslation('ai');
  const now = Date.now();
  const shown = clients.slice(0, 2);
  const more = clients.length - shown.length;
  return (
    <Tile
      icon={AppWindow}
      label={t('status.apps')}
      tone={clients.length ? 'success' : 'muted'}
      value={<span className="tabular-nums">{clients.length}</span>}
      sub={clients.length === 0 ? t('status.appsNone') : (
        <span className="block">
          {shown.map((c, i) => (
            <span key={`${c.tokenId}-${i}`} className="block truncate" title={`${clientLabel(t, c.clientName) || t('approval.unknownApp')} (${c.tokenName || '-'})`}>
              {t('status.appSeen', { name: clientLabel(t, c.clientName) || c.tokenName || t('approval.unknownApp'), when: relativeTime(c.lastSeenAt, now, lang) || t('unknown') })}
            </span>
          ))}
          {more > 0 && <span className="block">{t('status.appsMore', { count: more })}</span>}
        </span>
      )}
    />
  );
}

function TabBar({ tab, setTab, counts }) {
  const { t } = useTranslation('ai');
  const refs = useRef({});
  function onKey(e) {
    // From the focused tab, not the `tab` prop: fast repeats can arrive before the re-render.
    const focused = String((e.target && e.target.id) || '').replace('ai-tab-', '');
    const i = TABS.includes(focused) ? TABS.indexOf(focused) : TABS.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    // Every tab button is always mounted, so focus can move right away.
    if (refs.current[next]) refs.current[next].focus();
    setTab(next);
  }
  return (
    <div role="tablist" aria-label={t('tabs.label')} className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-border" onKeyDown={onKey}>
      {TABS.map((key) => {
        const Icon = TAB_ICONS[key];
        const on = key === tab;
        const count = counts[key];
        return (
          <button
            key={key}
            ref={(el) => { refs.current[key] = el; }}
            id={`ai-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`ai-panel-${key}`}
            tabIndex={on ? 0 : -1}
            onClick={() => setTab(key)}
            className={cn('relative -mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors',
              key === 'approvals' && 'pr-10',
              on ? 'border-primary text-foreground' : cn('border-transparent hover:text-foreground', SUBTLE_TEXT))}
          >
            <Icon className={cn('h-4 w-4', on && 'text-primary')} strokeWidth={1.75} />
            {t(`tabs.${key}`)}
            {/* The count sits in a slot the tab always reserves (pr-10), so it never pushes the other tabs. */}
            {key === 'approvals' && count > 0 && (
              <span className="absolute right-3 top-1/2 min-w-[1.25rem] -translate-y-1/2 rounded-full px-1.5 text-center text-[10.5px] font-bold leading-[18px]" style={{ background: AI_TONE.warning, color: '#111827' }}>
                {count}<span className="sr-only"> {t('tabs.waiting')}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function StatePanel({ icon: Icon, tone, title, body, actions }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <span className="mb-4 grid h-12 w-12 place-items-center rounded-full" style={{ ...toneSurface(tone, 14, 0), color: AI_TONE[tone] }}>
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      {body && <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-muted-foreground">{body}</p>}
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

function LoadingSkeleton({ label }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[150px] animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" />)}
      </div>
      <div className="mt-6 h-11 animate-pulse rounded-lg bg-card motion-reduce:animate-none" aria-hidden="true" />
      <div className="mt-5 h-72 animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" aria-hidden="true" />
    </div>
  );
}
