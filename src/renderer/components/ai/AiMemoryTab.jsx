import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronDown, ChevronRight, Lock, RotateCcw, Save, Undo2 } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import Textarea from '@/components/ui/Textarea.jsx';
import { AI_TONE, ConfirmDialog, InlineError, SaveNote, SectionCard, toneText } from '@/components/ai/AiShared.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { MEMORY_LIMIT_BYTES, errorText, formatKb, memoryUsage, relativeTime } from '@/lib/aiCore.mjs';
import { formatDateTime } from '@/lib/utils.js';

// The built-in guides the AI reads first (spec §6). Their text comes from the engine when it sends
// `guides`; otherwise the page names them and links to the online guide.
const BUILT_IN = [
  { uri: 'softglaze://guide/how-softglaze-works', key: 'howItWorks' },
  { uri: 'softglaze://guide/acceptable-use', key: 'acceptableUse' }
];

export default function AiMemoryTab({ lang }) {
  const { t } = useTranslation('ai');
  const editorId = useId();
  const meterId = useId();
  const [mem, setMem] = useState(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [save, setSave] = useState({ state: '', error: '' });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr('');
    try {
      const m = await softglazeApi.ai.memories.get();
      setMem(m || {});
      setDraft((m && m.markdown) || '');
    } catch (e) {
      setLoadErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saved = (mem && mem.markdown) || '';
  const dirty = draft !== saved;
  const usage = memoryUsage(draft);
  const now = Date.now();

  async function doSave() {
    if (usage.over || !dirty) return;
    setSave({ state: 'saving', error: '' });
    try {
      const m = await softglazeApi.ai.memories.set(draft);
      const next = m && typeof m === 'object' && typeof m.markdown === 'string' ? m : { ...mem, markdown: draft, updatedAt: new Date().toISOString() };
      setMem(next);
      setDraft(next.markdown);
      setSave({ state: 'saved', error: '' });
    } catch (e) {
      setSave({ state: 'error', error: errorText(e) });
    }
  }

  async function doReset() {
    setResetBusy(true);
    try {
      const m = await softglazeApi.ai.memories.reset();
      const next = m && typeof m === 'object' && typeof m.markdown === 'string' ? m : { ...mem, markdown: (mem && mem.defaultMarkdown) || '' };
      setMem(next);
      setDraft(next.markdown);
      setSave({ state: 'saved', error: '' });
      setResetOpen(false);
    } catch (e) {
      setSave({ state: 'error', error: errorText(e) });
      setResetOpen(false);
    } finally {
      setResetBusy(false);
    }
  }

  const guides = mem && Array.isArray(mem.guides) && mem.guides.length ? mem.guides : null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <SectionCard
        icon={BookOpen}
        title={t('memory.title')}
        description={t('memory.description')}
        actions={mem && mem.updatedAt ? <span className="text-[12px] text-muted-foreground" title={formatDateTime(mem.updatedAt)}>{t('memory.updated', { when: relativeTime(mem.updatedAt, now, lang) })}</span> : null}
      >
        {loadErr ? (
          <InlineError>
            <span className="flex flex-wrap items-center justify-between gap-2">{t('memory.loadError', { message: loadErr })}<Button size="sm" variant="secondary" onClick={load}>{t('retry')}</Button></span>
          </InlineError>
        ) : (
          <div className="space-y-3">
            <label htmlFor={editorId} className="sr-only">{t('memory.editorLabel')}</label>
            <Textarea
              id={editorId}
              rows={20}
              spellCheck={false}
              disabled={loading}
              value={draft}
              aria-describedby={meterId}
              aria-invalid={usage.over}
              onChange={(e) => { setDraft(e.target.value); if (save.state) setSave({ state: '', error: '' }); }}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); } }}
              placeholder={loading ? t('loading') : t('memory.placeholder')}
              className="min-h-[420px] font-mono text-[12.5px] leading-relaxed"
            />
            <div id={meterId} className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                <div className="h-full rounded-full transition-[width]" style={{ width: `${usage.fraction * 100}%`, background: usage.over ? AI_TONE.danger : usage.fraction > 0.85 ? AI_TONE.warning : AI_TONE.info }} />
              </div>
              <p className="text-[12px] tabular-nums" style={usage.over ? toneText('danger') : undefined}>
                <span className={usage.over ? '' : 'text-muted-foreground'}>
                  {t('memory.usage', { used: formatKb(usage.bytes), limit: formatKb(MEMORY_LIMIT_BYTES), chars: draft.length.toLocaleString(lang) })}
                </span>
                {usage.over && <> {t('memory.over')}</>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={doSave} disabled={!dirty || usage.over || loading} isLoading={save.state === 'saving'}><Save className="h-4 w-4" /> {t('save')}</Button>
              <Button variant="secondary" onClick={() => { setDraft(saved); setSave({ state: '', error: '' }); }} disabled={!dirty}><Undo2 className="h-4 w-4" /> {t('memory.discard')}</Button>
              <Button variant="ghost" onClick={() => setResetOpen(true)} disabled={loading || !mem}><RotateCcw className="h-4 w-4" /> {t('memory.reset')}</Button>
              <span className="ml-auto inline-flex items-center gap-3">
                {dirty && save.state !== 'saving' && <span className="text-[12px]" style={toneText('warning')}>{t('memory.unsaved')}</span>}
                <SaveNote state={save.state} error={save.error} />
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground">{t('memory.tip')}</p>
          </div>
        )}
      </SectionCard>

      <SectionCard icon={Lock} title={t('memory.guidesTitle')} description={t('memory.guidesDescription')}>
        <ul className="space-y-2">
          {(guides || BUILT_IN).map((g, i) => <GuideItem key={g.uri || i} guide={g} />)}
        </ul>
      </SectionCard>

      <ConfirmDialog
        open={resetOpen}
        title={t('memory.resetTitle')}
        body={t('memory.resetBody')}
        confirmLabel={t('memory.reset')}
        busy={resetBusy}
        onConfirm={doReset}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}

function GuideItem({ guide }) {
  const { t } = useTranslation('ai');
  const [open, setOpen] = useState(false);
  const id = useId();
  const builtIn = BUILT_IN.find((b) => b.uri === guide.uri);
  const title = guide.title || (builtIn ? t(`memory.guides.${builtIn.key}.title`) : guide.uri);
  const desc = guide.description || (builtIn ? t(`memory.guides.${builtIn.key}.body`) : '');
  const text = typeof guide.markdown === 'string' ? guide.markdown : (typeof guide.text === 'string' ? guide.text : '');
  return (
    <li className="rounded-lg border border-border">
      <div className="px-3.5 py-3">
        <p className="text-[13px] font-semibold text-foreground">{title}</p>
        {desc && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{desc}</p>}
        {guide.uri && <code className="mt-1.5 block truncate font-mono text-[11px] text-muted-foreground" title={guide.uri}>{guide.uri}</code>}
        {text ? (
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? t('memory.hideGuide') : t('memory.readGuide')}
          </button>
        ) : (
          <p className="mt-2 text-[11.5px] text-muted-foreground">{t('memory.guideReadOnly')}</p>
        )}
      </div>
      {text && open && (
        <pre id={id} tabIndex={0} aria-label={title} className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-border bg-surface px-3.5 py-3 font-mono text-[11.5px] leading-relaxed text-foreground">{text}</pre>
      )}
    </li>
  );
}
