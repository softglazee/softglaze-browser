import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bug, ChevronDown, ExternalLink, Eye, EyeOff, RefreshCw, TriangleAlert } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import { AI_TONE, CodeBlock, CopyButton, InlineError, TonePill, toneSurface, toneText } from '@/components/ai/AiShared.jsx';
import { errorText } from '@/lib/aiCore.mjs';
import {
  DEVTOOLS_CLIENTS, DEVTOOLS_DOCS_URL, DEVTOOLS_SERVER_NAMES, DEVTOOLS_TOOL_LABELS, DEVTOOLS_TOOLS, MASKED_ENDPOINT, SESSION_POLL_MS,
  currentSnippet, devtoolsReducer, hasChromium, initialDevtools
} from '@/lib/aiDevtools.mjs';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { cn } from '@/lib/utils.js';

// "Use a profile with Playwright MCP or Chrome DevTools MCP (advanced)": the Owner picks a running
// Chromium profile, presses Show, and copies a setup that attaches one of those MCP servers to it.
// AiConnectTab renders it for the Owner only; main refuses everyone else as well (ai/ipc.js).
export default function AiDevtoolsCard({ defaultOpen = false }) {
  const { t } = useTranslation('ai');
  const [open, setOpen] = useState(defaultOpen);
  const [state, dispatch] = useReducer(devtoolsReducer, initialDevtools);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const list = await softglazeApi.ai.devtools.sessions();
      if (live.current) dispatch({ type: 'sessions', list });
    } catch (e) {
      if (live.current) dispatch({ type: 'loadFailed', message: errorText(e) });
    }
  }, []);

  // While open: read the running profiles now and every few seconds, and clear a shown address
  // the moment its profile stops.
  useEffect(() => {
    if (!open) return undefined;
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, SESSION_POLL_MS);
    const off = softglazeApi.ai.devtools.onSessionEnded((d) => { if (d && d.profileId != null) dispatch({ type: 'ended', profileId: d.profileId }); });
    return () => { clearInterval(id); if (typeof off === 'function') off(); };
  }, [open, load]);

  function toggle() {
    if (open) dispatch({ type: 'closed' });
    setOpen(!open);
  }

  async function show() {
    const { profileId, tool, client } = state;
    if (profileId == null) return;
    dispatch({ type: 'showStart' });
    try {
      const result = await softglazeApi.ai.devtools.endpoint({ profileId, tool, client });
      if (live.current) dispatch({ type: 'showDone', profileId, result, emptyMessage: t('connect.devtools.noAddress') });
    } catch (e) {
      if (live.current) dispatch({ type: 'showFailed', profileId, message: errorText(e) });
    }
  }

  return (
    <section aria-labelledby="ai-devtools-title" data-ai-devtools-card="" className="rounded-xl border border-border bg-card">
      <h2 id="ai-devtools-title" className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="ai-devtools-body"
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-xl px-5 py-4 text-left transition-colors hover:bg-elevated/40"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ ...toneSurface('warning', 12, 0), color: AI_TONE.warning }}>
            <Bug className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-foreground break-words">{t('connect.devtools.title')}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{t('connect.devtools.subtitle')}</span>
          </span>
          <TonePill tone="muted" className="hidden sm:inline-flex">{t('connect.devtools.ownerOnly')}</TonePill>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div id="ai-devtools-body" className="border-t border-border px-5 py-4">
          <DevtoolsCardBody state={state} dispatch={dispatch} onShow={show} onRetry={load} />
        </div>
      )}
    </section>
  );
}

// The open card. Pure view of the reducer state, exported for test/aiDevtoolsCard.test.js.
export function DevtoolsCardBody({ state, dispatch, onShow, onRetry }) {
  const { t } = useTranslation('ai');
  const chromium = hasChromium(state.sessions);
  const selected = state.sessions.find((s) => s.profileId === state.profileId) || null;
  const shown = Boolean(state.reveal && selected && state.reveal.profileId === selected.profileId);
  const snippet = shown ? currentSnippet(state) : null;
  const toolLabel = DEVTOOLS_TOOL_LABELS[state.tool];
  const clientLabel = t(`connect.clients.${state.client}.title`);

  return (
    <div className="space-y-5">
      {/* The warning comes first, before any profile or address. */}
      <div role="note" className="flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed" style={toneSurface('warning', 9, 30)}>
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: AI_TONE.warning }} aria-hidden="true" />
        <p className="min-w-0 text-foreground" data-devtools-warning="">{t('connect.devtools.warning')}</p>
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('connect.devtools.intro')}</p>

      <section aria-labelledby="ai-devtools-profile" className="space-y-2">
        <h3 id="ai-devtools-profile" className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('connect.devtools.profile')}</h3>
        {!state.loaded ? (
          <p className="text-[12.5px] text-muted-foreground" aria-busy="true">{t('connect.devtools.loading')}</p>
        ) : state.loadError ? (
          <InlineError>
            <span className="flex flex-wrap items-center justify-between gap-2">
              {t('connect.devtools.loadError', { message: state.loadError })}
              <Button size="sm" variant="secondary" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> {t('retry')}</Button>
            </span>
          </InlineError>
        ) : (
          <>
            {state.sessions.length > 0 && (
              <select
                aria-labelledby="ai-devtools-profile"
                value={state.profileId == null ? '' : String(state.profileId)}
                onChange={(e) => dispatch({ type: 'select', profileId: e.target.value })}
                className="w-full max-w-xl cursor-pointer rounded border border-border bg-input-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="" disabled>{t('connect.devtools.choose')}</option>
                {state.sessions.map((s) => (
                  <option key={s.profileId} value={String(s.profileId)} disabled={s.engine !== 'chromium'}>
                    {s.engine === 'chromium'
                      ? t('connect.devtools.option', { name: s.name, id: s.profileId })
                      : t('connect.devtools.optionFirefox', { name: s.name, id: s.profileId })}
                  </option>
                ))}
              </select>
            )}
            {!chromium && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-[12.5px]">
                <span className="text-foreground">{t('connect.devtools.empty')}</span>
                <Link to="/profiles" className="font-medium text-primary hover:underline">{t('connect.devtools.openProfiles')}</Link>
              </div>
            )}
          </>
        )}
        {state.stopped && (
          <p role="status" className="text-[12.5px] font-medium" style={toneText('warning')}>{t('connect.devtools.stopped', { name: state.stopped.name })}</p>
        )}
      </section>

      {selected && (
        <section aria-labelledby="ai-devtools-address" className="space-y-2">
          <h3 id="ai-devtools-address" className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('connect.devtools.address')}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <code
              className="min-w-0 grow basis-full break-all rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[12px] text-foreground sm:basis-0"
              aria-label={shown ? t('connect.devtools.address') : t('connect.devtools.hiddenLabel')}
              data-devtools-endpoint={shown ? 'shown' : 'masked'}
            >
              {shown ? state.reveal.wsEndpoint : MASKED_ENDPOINT}
            </code>
            {shown ? (
              <>
                <CopyButton text={state.reveal.wsEndpoint} tag="endpoint" label={t('connect.devtools.address')} />
                <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'hide' })}>
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> {t('connect.devtools.hide')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={onShow} isLoading={state.busy} aria-label={t('connect.devtools.showLabel', { name: selected.name })}>
                <Eye className="h-3.5 w-3.5" aria-hidden="true" /> {t('connect.devtools.show')}
              </Button>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">{t('connect.devtools.addressNote')}</p>
          {state.error && <InlineError>{state.error}</InlineError>}
        </section>
      )}

      {selected && (
        <section aria-labelledby="ai-devtools-setup" className="space-y-3">
          <h3 id="ai-devtools-setup" className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('connect.devtools.setup')}</h3>
          <TabRow
            idPrefix="ai-devtools-tool"
            label={t('connect.devtools.toolsLabel')}
            items={DEVTOOLS_TOOLS.map((k) => ({ key: k, label: DEVTOOLS_TOOL_LABELS[k] }))}
            value={state.tool}
            onChange={(k) => dispatch({ type: 'tool', tool: k })}
          />
          <TabRow
            idPrefix="ai-devtools-client"
            label={t('connect.devtools.clientsLabel')}
            items={DEVTOOLS_CLIENTS.map((k) => ({ key: k, label: t(`connect.clients.${k}.title`) }))}
            value={state.client}
            onChange={(k) => dispatch({ type: 'client', client: k })}
          />
          <div id="ai-devtools-panel" role="tabpanel" aria-labelledby={`ai-devtools-client-${state.client}`} className="space-y-2">
            <p className="text-[12.5px] text-foreground">
              <span className="font-semibold">{t('connect.where')}: </span>
              {t(`connect.devtools.where.${state.client}`, { name: DEVTOOLS_SERVER_NAMES[state.tool] })}
            </p>
            {snippet ? (
              <CodeBlock
                text={snippet.text}
                label={t('connect.devtools.snippet', { tool: toolLabel, app: clientLabel })}
                kindLabel={t(`connect.kind.${snippet.kind}`, { defaultValue: snippet.kind })}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-[12.5px] text-muted-foreground">{t('connect.devtools.pressShow')}</p>
            )}
          </div>
          {state.tool === 'chrome-devtools' && (
            <label className="flex items-start gap-2.5 text-[13px] text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                checked={state.noUsageStats}
                onChange={(e) => dispatch({ type: 'usageStats', off: e.target.checked })}
              />
              <span>
                {t('connect.devtools.usageStats')}
                <span className="block text-[12px] text-muted-foreground">{t('connect.devtools.usageStatsHint')}</span>
              </span>
            </label>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-[12.5px]">
        <p className="text-foreground">{t('connect.devtools.footer')}</p>
        <a href={DEVTOOLS_DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          {t('connect.devtools.guide')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{t('opensInBrowser')}</span>
        </a>
      </div>
    </div>
  );
}

// A row of tabs with the AI page's TabBar keyboard pattern (arrows, Home, End; roving tabindex).
// Both rows drive the one setup panel below them.
function TabRow({ idPrefix, label, items, value, onChange }) {
  const refs = useRef({});
  function onKey(e) {
    const i = Math.max(0, items.findIndex((it) => it.key === value));
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n == null) return;
    e.preventDefault();
    const key = items[n].key;
    if (refs.current[key]) refs.current[key].focus();
    onChange(key);
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex flex-wrap gap-1 rounded-lg border border-border bg-elevated/60 p-1">
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            ref={(el) => { refs.current[it.key] = el; }}
            id={`${idPrefix}-${it.key}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls="ai-devtools-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(it.key)}
            className={cn('rounded-md border px-3 py-1.5 text-[12.5px] font-semibold transition-colors whitespace-nowrap',
              on ? 'border-border bg-card text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
