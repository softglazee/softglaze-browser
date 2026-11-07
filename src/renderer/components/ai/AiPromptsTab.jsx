import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, MessageSquareText, Search } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import Input from '@/components/ui/Input.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { CodeBlock, InlineError, TonePill } from '@/components/ai/AiShared.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { errorText } from '@/lib/aiCore.mjs';
import { cn } from '@/lib/utils.js';

export default function AiPromptsTab() {
  const { t } = useTranslation('ai');
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await softglazeApi.ai.prompts.list();
      setPrompts((Array.isArray(list) ? list : []).filter((p) => p && p.name));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) => [p.name, p.title, p.description].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [prompts, query]);

  useEffect(() => {
    if (!filtered.length) return;
    if (!selected || !filtered.some((p) => p.name === selected)) setSelected(filtered[0].name);
  }, [filtered, selected]);

  const current = prompts.find((p) => p.name === selected) || null;

  return (
    <div className="space-y-4">
      <HowTo />

      {error && (
        <InlineError>
          <span className="flex flex-wrap items-center justify-between gap-2">{t('prompts.loadError', { message: error })}<Button size="sm" variant="secondary" onClick={load}>{t('retry')}</Button></span>
        </InlineError>
      )}

      {loading ? (
        <div className="h-80 animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" aria-busy="true" />
      ) : prompts.length === 0 ? (
        !error && <EmptyState title={t('prompts.emptyTitle')} description={t('prompts.emptyBody')} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border p-2.5">
              <Input icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('prompts.search')} aria-label={t('prompts.search')} />
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-1.5" aria-label={t('prompts.listLabel')}>
              {filtered.map((p) => {
                const on = p.name === selected;
                return (
                  <li key={p.name}>
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => setSelected(p.name)}
                      className={cn('w-full rounded-lg border px-3 py-2 text-left transition-colors', on ? '' : 'border-transparent hover:bg-secondary')}
                      style={on ? { background: 'color-mix(in srgb, var(--primary) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--primary) 26%, transparent)' } : undefined}
                    >
                      <span className={cn('block truncate text-[13px] font-medium', on ? 'text-primary' : 'text-foreground')}>{p.title || p.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.name}</span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">{t('prompts.noMatch')}</li>}
            </ul>
          </div>

          {current && <PromptDetail prompt={current} />}
        </div>
      )}
    </div>
  );
}

function PromptDetail({ prompt }) {
  const { t } = useTranslation('ai');
  const args = Array.isArray(prompt.arguments) ? prompt.arguments : [];
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card" aria-labelledby="ai-prompt-title">
      <header className="border-b border-border px-5 py-4">
        <h2 id="ai-prompt-title" className="text-[16px] font-semibold text-foreground font-display">{prompt.title || prompt.name}</h2>
        {prompt.description && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{prompt.description}</p>}
        <p className="mt-2 text-[12px] text-muted-foreground">
          {t('prompts.inClaudeCode')} <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">/softglaze:{prompt.name}</code>
        </p>
      </header>
      <div className="space-y-4 px-5 py-4">
        <section aria-labelledby="ai-prompt-args">
          <h3 id="ai-prompt-args" className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('prompts.arguments')}</h3>
          {args.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">{t('prompts.noArguments')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-[12.5px]">
                <thead className="bg-surface text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t('prompts.argName')}</th>
                    <th scope="col" className="px-3 py-2">{t('prompts.argRequired')}</th>
                    <th scope="col" className="px-3 py-2">{t('prompts.argDescription')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {args.map((a) => (
                    <tr key={a.name}>
                      <td className="px-3 py-2"><code className="font-mono text-foreground">{a.name}</code></td>
                      <td className="px-3 py-2">{a.required ? <TonePill tone="info">{t('prompts.required')}</TonePill> : <span className="text-muted-foreground">{t('prompts.optional')}</span>}</td>
                      <td className="px-3 py-2 text-foreground">{a.description || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section aria-label={t('prompts.text')}>
          <CodeBlock text={prompt.text || ''} label={t('prompts.text')} kindLabel={t('prompts.text')} />
        </section>
      </div>
    </article>
  );
}

function HowTo() {
  const { t } = useTranslation('ai');
  return (
    <section aria-labelledby="ai-prompts-howto" className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-start gap-3">
        <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="ai-prompts-howto" className="text-[14px] font-semibold text-foreground">{t('prompts.howTitle')}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t('prompts.howIntro')}</p>
          <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] text-foreground xl:grid-cols-2">
            <li><span className="font-semibold">Claude Code:</span> {t('prompts.howClaudeCode')}</li>
            <li><span className="font-semibold">Claude Desktop:</span> {t('prompts.howClaudeDesktop')}</li>
            <li><span className="font-semibold">VS Code:</span> {t('prompts.howVsCode')}</li>
            <li><span className="font-semibold">Cursor:</span> {t('prompts.howCursor')}</li>
          </ul>
          <p className="mt-2 inline-flex items-start gap-1.5 text-[12px] text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('prompts.howOther')}</p>
        </div>
      </div>
    </section>
  );
}
