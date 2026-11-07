import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppWindow, Cable, Check, CodeXml, ExternalLink, FileCode2, KeyRound, Plug, RefreshCw, SquareTerminal, TriangleAlert, Wind, Workflow
} from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { AI_TONE, CodeBlock, CopyField, InlineError, PrimaryButton, TonePill, toneSurface, toneText } from '@/components/ai/AiShared.jsx';
import { STDIO_CLIENTS, envVarCommand, hasPlaceholder, n8nEndpoints } from '@/lib/aiCore.mjs';
import { cn } from '@/lib/utils.js';

const ICONS = {
  'claude-desktop': AppWindow,
  'claude-code': SquareTerminal,
  cursor: CodeXml,
  vscode: CodeXml,
  'gemini-cli': SquareTerminal,
  codex: SquareTerminal,
  windsurf: Wind,
  cline: CodeXml,
  n8n: Workflow,
  other: Plug
};
const iconFor = (key) => ICONS[key] || Plug;

export default function AiConnectTab({ status, clients, loading, bridge, error, onRetry, isOwner, tokensCount, tokensLoaded = true, onToggleServer, toggling, onCreateToken }) {
  const { t } = useTranslation('ai');
  const [selected, setSelected] = useState(null);
  const picked = useRef(false);
  const refs = useRef({});
  const pick = (key) => { picked.current = true; setSelected(key); };

  // Until the user picks an app, the first one in the list is shown.
  useEffect(() => {
    if (loading || !clients.length) return;
    if (!picked.current || !clients.some((c) => c.key === selected)) setSelected(clients[0].key);
  }, [clients, selected, loading]);

  const enabled = Boolean(status && status.enabled);
  const connected = Array.isArray(status && status.clients) && status.clients.length > 0;
  const steps = [
    { done: enabled, label: t('start.step1') },
    { done: tokensCount > 0, label: t('start.step2') },
    { done: connected, label: t('start.step3') }
  ];
  const allDone = steps.every((s) => s.done);
  const current = clients.find((c) => c.key === selected) || null;

  function onListKey(e) {
    const focused = String((e.target && e.target.id) || '').replace('ai-client-', '');
    const i = Math.max(0, clients.findIndex((c) => c.key === (focused || selected)));
    let n = null;
    if (e.key === 'ArrowDown') n = (i + 1) % clients.length;
    else if (e.key === 'ArrowUp') n = (i - 1 + clients.length) % clients.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = clients.length - 1;
    if (n == null) return;
    e.preventDefault();
    const key = clients[n].key;
    if (refs.current[key]) refs.current[key].focus();
    pick(key);
  }

  return (
    <div className="space-y-5">
      {!allDone && tokensLoaded && (
        <section aria-labelledby="ai-start-title" className="rounded-xl border p-4" style={toneSurface('info', 6, 22)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="ai-start-title" className="text-[14px] font-semibold text-foreground">{t('start.title')}</h2>
            {!enabled && <PrimaryButton size="sm" onClick={onToggleServer} isLoading={toggling}>{t('start.turnOn')}</PrimaryButton>}
          </div>
          <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-[13px]">
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-bold"
                  style={s.done ? { background: AI_TONE.success, color: 'var(--background)' } : { ...toneSurface('muted', 14, 30), color: 'var(--foreground)', border: '1px solid' }}
                >
                  {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={s.done ? 'text-muted-foreground line-through decoration-1' : 'text-foreground'}>{s.label}</span>
                {s.done && <span className="sr-only">{t('start.done')}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {error && (
        <InlineError>
          <span className="flex flex-wrap items-center justify-between gap-2">
            {t('connect.loadError', { message: error })}
            <Button size="sm" variant="secondary" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> {t('retry')}</Button>
          </span>
        </InlineError>
      )}

      {loading ? (
        <div key="skeleton" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)]" aria-busy="true">
          <div className="h-[330px] animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" />
          <div className="h-[520px] animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" />
        </div>
      ) : clients.length === 0 ? (
        !error && (
          <EmptyState title={t('connect.empty')} description={enabled ? t('connect.emptyOn') : t('connect.emptyBody')} />
        )
      ) : (
        <div key="clients" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
          <div role="tablist" aria-orientation="vertical" aria-label={t('connect.appsLabel')} onKeyDown={onListKey} className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5 lg:flex-col lg:overflow-visible">
            {clients.map((c) => {
              const Icon = iconFor(c.key);
              const on = c.key === selected;
              return (
                <button
                  key={c.key}
                  ref={(el) => { refs.current[c.key] = el; }}
                  id={`ai-client-${c.key}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="ai-client-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => pick(c.key)}
                  className={cn('flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition-colors',
                    on ? 'text-foreground' : 'border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground')}
                  style={on ? { background: 'color-mix(in srgb, var(--primary) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--primary) 26%, transparent)' } : undefined}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', on && 'text-primary')} strokeWidth={1.75} />
                  <span className="truncate">{clientTitle(t, c)}</span>
                </button>
              );
            })}
          </div>

          <div id="ai-client-panel" role="tabpanel" aria-labelledby={current ? `ai-client-${current.key}` : undefined} className="min-w-0 rounded-xl border border-border bg-card">
            {current && (current.key === 'n8n'
              ? <N8nPanel status={status} entry={current} isOwner={isOwner} onCreateToken={onCreateToken} />
              : <ClientPanel entry={current} bridge={bridge} onCreateToken={onCreateToken} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function clientTitle(t, c) {
  return c.known ? t(`connect.clients.${c.key}.title`, { defaultValue: c.title }) : c.title;
}

function PanelHeader({ entry, children }) {
  const { t } = useTranslation('ai');
  const Icon = iconFor(entry.key);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ ...toneSurface('info', 12, 0), color: AI_TONE.info }}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[16px] font-semibold text-foreground font-display break-words">{clientTitle(t, entry)}</h2>
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {entry.appDocsUrl && (
          <a href={entry.appDocsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-primary hover:underline">
            {t('connect.appDocs')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{t('opensInBrowser')}</span>
          </a>
        )}
        <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-elevated">
          {t('connect.guide')} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t('opensInBrowser')}</span>
        </a>
      </div>
    </div>
  );
}

function Steps({ items, title }) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ol className="space-y-2">
        {items.map((s, i) => (
          <li key={i} className="flex items-start gap-3 text-[13px] leading-relaxed text-foreground">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ ...toneSurface('info', 14, 0), ...toneText('info') }}>{i + 1}</span>
            <span className="min-w-0 break-words">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ClientPanel({ entry, bridge, onCreateToken }) {
  const { t } = useTranslation('ai');
  const base = entry.known ? `connect.clients.${entry.key}` : 'connect.clients.custom';
  // Claude Desktop: mention the one-click .mcpb only when this build ships one.
  const step2Key = entry.key === 'claude-desktop' && !(bridge && bridge.mcpbPath) ? `${base}.step2NoMcpb` : `${base}.step2`;
  const steps = [t(`${base}.step1`), t(step2Key), t(`${base}.step3`)];
  const kindLabel = t(`connect.kind.${entry.kind}`, { defaultValue: entry.kind });
  const hostOs = (typeof window !== 'undefined' && window.softglaze && window.softglaze.hostOs) || 'Windows';
  const showBridge = STDIO_CLIENTS.has(entry.key) || !entry.known;

  return (
    <>
      <PanelHeader entry={entry}>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <TonePill tone="muted">{kindLabel}</TonePill>
        </div>
      </PanelHeader>

      <div className="space-y-5 px-5 py-4">
        <Steps items={steps} title={t('connect.steps')} />

        {/* Step 1 points at this button, so it sits right under the steps, above the snippet. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 px-4 py-3">
          <PrimaryButton onClick={() => onCreateToken({ client: entry })}>
            <KeyRound className="h-4 w-4" /> {t('connect.createToken')}
          </PrimaryButton>
          <p className="min-w-[14rem] flex-1 text-[12.5px] text-muted-foreground">{t('connect.createTokenHint')}</p>
        </div>

        {entry.where && (
          <div className="flex items-start gap-2 text-[12.5px]">
            <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="min-w-0 break-words text-foreground">
              <span className="font-semibold">{t('connect.where')}: </span>
              {/\s/.test(entry.where) ? entry.where : <code className="font-mono text-[12px]">{entry.where}</code>}
            </p>
          </div>
        )}

        {entry.text ? (
          <div className="space-y-2">
            <CodeBlock text={entry.text} label={t('connect.snippet', { app: clientTitle(t, entry) })} kindLabel={kindLabel} />
            {hasPlaceholder(entry.text) && <p className="text-[12px] text-muted-foreground">{t('connect.placeholderHint')}</p>}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">{t('connect.noSnippet')}</p>
        )}

        {entry.key === 'codex' && (
          <div className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('connect.envVar.title')}</h3>
            <p className="text-[12.5px] text-muted-foreground">{t('connect.envVar.body')}</p>
            <CodeBlock text={envVarCommand(hostOs)} label={t('connect.envVar.title')} kindLabel={hostOs === 'Windows' ? t('connect.envVar.windows') : t('connect.envVar.unix')} />
          </div>
        )}

        {showBridge &&<BridgeBox bridge={bridge} claudeDesktop={entry.key === 'claude-desktop'} />}
      </div>
    </>
  );
}

function BridgeBox({ bridge, claudeDesktop }) {
  const { t } = useTranslation('ai');
  const env = bridge && bridge.env && typeof bridge.env === 'object' ? Object.entries(bridge.env) : [];
  const args = bridge && Array.isArray(bridge.args) ? bridge.args : [];
  return (
    <section aria-labelledby="ai-bridge-title" className="rounded-lg border border-border">
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
        <Cable className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h3 id="ai-bridge-title" className="text-[13px] font-semibold text-foreground">{t('connect.bridge.title')}</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{t('connect.bridge.body')}</p>
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {!bridge || !bridge.command ? (
          <p className="text-[12.5px] text-muted-foreground">{t('connect.bridge.unavailable')}</p>
        ) : (
          <>
            {claudeDesktop && bridge.mcpbPath && <CopyField label={t('connect.bridge.mcpb')} value={String(bridge.mcpbPath)} />}
            <CopyField label={t('connect.bridge.command')} value={String(bridge.command)} />
            {args.length > 0 && <CopyField label={t('connect.bridge.args')} value={JSON.stringify(args)} />}
            {env.length > 0 && (
              <div className="space-y-2">
                <span className="text-[11.5px] font-medium text-muted-foreground">{t('connect.bridge.env')}</span>
                {env.map(([k, v]) => <CopyField key={k} value={`${k}=${v == null ? '' : String(v)}`} />)}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function N8nPanel({ status, entry, isOwner, onCreateToken }) {
  const { t } = useTranslation('ai');
  const ep = n8nEndpoints(status);
  return (
    <>
      <PanelHeader entry={entry}>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t('connect.n8n.subtitle')}</p>
      </PanelHeader>
      <div className="space-y-5 px-5 py-4">
        <div className="flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[12.5px]" style={{ ...toneSurface('warning', 9, 30) }}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: AI_TONE.warning }} aria-hidden="true" />
          <span className="text-foreground">{t('connect.n8n.selfHosted')}</span>
        </div>

        <section aria-labelledby="n8n-a" className="space-y-3">
          <h3 id="n8n-a" className="text-[14px] font-semibold text-foreground">{t('connect.n8n.a.title')}</h3>
          <Steps items={[t('connect.n8n.a.step1'), t('connect.n8n.a.step2'), t('connect.n8n.a.step3')]} title={t('connect.steps')} />
          {ep ? (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              <CopyField label={t('connect.n8n.a.sse')} value={ep.sse} />
              <CopyField label={t('connect.n8n.a.sseDocker')} value={ep.sseDocker} />
            </div>
          ) : <p className="text-[12.5px] text-muted-foreground">{t('connect.n8n.noPort')}</p>}
          <p className="text-[12px] text-muted-foreground">{t('connect.n8n.a.dockerNote')}</p>
        </section>

        <section aria-labelledby="n8n-b" className="space-y-3 border-t border-border pt-4">
          <h3 id="n8n-b" className="text-[14px] font-semibold text-foreground">{t('connect.n8n.b.title')}</h3>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('connect.n8n.b.body')}</p>
          {ep && <CodeBlock text={`${ep.apiStart}\n${ep.authHeader}`} label={t('connect.n8n.b.title')} kindLabel={t('connect.n8n.b.kind')} />}
        </section>

        <section aria-labelledby="n8n-c" className="space-y-3 border-t border-border pt-4">
          <h3 id="n8n-c" className="text-[14px] font-semibold text-foreground">{t('connect.n8n.c.title')}</h3>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('connect.n8n.c.body')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={() => onCreateToken({ client: entry, automation: isOwner })}>
              <KeyRound className="h-4 w-4" /> {isOwner ? t('connect.n8n.c.create') : t('connect.createToken')}
            </PrimaryButton>
            {!isOwner && <span className="text-[12px]" style={toneText('muted')}>{t('connect.n8n.c.ownerOnly')}</span>}
          </div>
        </section>
      </div>
    </>
  );
}
