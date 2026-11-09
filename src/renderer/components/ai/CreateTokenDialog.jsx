import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, CircleCheck, Eye, ShieldAlert, TriangleAlert, Workflow, Zap } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import Input from '@/components/ui/Input.jsx';
import NumberInput from '@/components/ui/NumberInput.jsx';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog.jsx';
import { AI_TONE, CodeBlock, CopyButton, PrimaryButton, Segmented, TonePill, toneSurface, toneText } from '@/components/ai/AiShared.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import {
  AUTOMATION_LIMITS, EXPIRY_OPTIONS, NAME_MAX, SCOPES, automationActive, buildTokenInput,
  canFinishReveal, envVarCommand, fillToken, groupPreapprovable, hasPlaceholder, preapprovableNames, validateTokenForm
} from '@/lib/aiCore.mjs';
import { cn } from '@/lib/utils.js';

const SCOPE_ICON = { read: Eye, operate: Zap, full: ShieldAlert };
const numCls = 'w-24 rounded border border-border bg-input-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary';

export default function CreateTokenDialog({ flow, dispatch, me, members, groups, isOwner, preTools = null, hostOs, onCreated }) {
  const { t } = useTranslation('ai');
  const open = flow.step !== 'closed';
  const reveal = flow.step === 'reveal';
  const [showErrors, setShowErrors] = useState(false);
  // A freshly opened form starts clean; errors show after the first Create click.
  useEffect(() => { if (flow.step === 'closed') setShowErrors(false); }, [flow.step]);

  const activeMembers = (Array.isArray(members) ? members : []).filter((m) => m && m.status !== 'banned' && m.status !== 'suspended');
  const hasMembers = activeMembers.length > 0;
  const form = flow.form;
  const toolGroups = useMemo(() => groupPreapprovable(preTools), [preTools]);
  const allowedTools = useMemo(() => preapprovableNames(toolGroups), [toolGroups]);
  const errors = form ? validateTokenForm(form, { isOwner, hasMembers, allowedTools }) : {};
  const hasErrors = Object.keys(errors).length > 0;
  const clientName = !flow.client ? ''
    : flow.client.known ? t(`connect.clients.${flow.client.key}.title`, { defaultValue: flow.client.title }) : flow.client.title;

  async function submit() {
    setShowErrors(true);
    if (hasErrors || !form) return;
    dispatch({ type: 'submit' });
    try {
      const r = await softglazeApi.ai.tokens.create(buildTokenInput(form, { isOwner, allowedTools }));
      dispatch({ type: 'created', token: r && r.token, id: r && r.id });
      if (onCreated) onCreated();
    } catch (e) {
      dispatch({ type: 'failed', error: (e && e.message) || String(e) });
    }
  }

  const edit = (patch) => dispatch({ type: 'edit', patch });
  const title = reveal ? t('create.revealTitle') : (clientName ? t('create.titleFor', { app: clientName }) : t('create.title'));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dispatch({ type: 'close' }); }}>
      <DialogContent title={title} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reveal && <CircleCheck className="h-5 w-5" style={{ color: AI_TONE.success }} aria-hidden="true" />}
            {title}
          </DialogTitle>
          <DialogDescription>{reveal ? t('create.revealDescription') : t('create.description')}</DialogDescription>
        </DialogHeader>

        {form && !reveal && (
          <form
            noValidate
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <DialogBody className="max-h-[min(64vh,640px)] space-y-5 overflow-y-auto">
              <Field label={t('create.name')} hint={t('create.nameHint')} error={showErrors && errors.name ? t(errors.name, { max: NAME_MAX }) : ''}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={Boolean(showErrors && errors.name)}
                    value={form.name}
                    maxLength={NAME_MAX + 10}
                    autoFocus
                    placeholder={t('create.namePlaceholder')}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                )}
              </Field>

              {hasMembers && (
                <Field label={t('create.member')} hint={t('create.memberHint')} error={showErrors && errors.memberId ? t(errors.memberId) : ''}>
                  {(id, describedBy) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      value={form.memberId == null ? '' : String(form.memberId)}
                      onChange={(e) => {
                        const m = activeMembers.find((x) => String(x.id) === e.target.value);
                        edit({ memberId: m ? m.id : null });
                      }}
                      className="w-full cursor-pointer rounded border border-border bg-input-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      {activeMembers.map((m) => (
                        <option key={m.id} value={String(m.id)}>
                          {`${m.name || m.email || `#${m.id}`} (${t(`roles.${m.role}`, { defaultValue: m.role })})${me && me.id === m.id ? ` · ${t('create.you')}` : ''}`}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}

              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-foreground">{t('create.scope')}</legend>
                <div role="radiogroup" aria-label={t('create.scope')} className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  {SCOPES.map((s) => {
                    const Icon = SCOPE_ICON[s];
                    const on = form.scope === s;
                    return (
                      <label
                        key={s}
                        className={cn('flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 transition-colors', on ? '' : 'border-border hover:border-border-strong')}
                        style={on ? { ...toneSurface(s === 'full' ? 'warning' : 'info', 10, 45) } : undefined}
                      >
                        <span className="flex items-center gap-2">
                          <input type="radio" name="ai-scope" value={s} checked={on} onChange={() => edit({ scope: s })} className="h-4 w-4 accent-[var(--primary)]" />
                          <Icon className="h-4 w-4" style={{ color: s === 'full' ? AI_TONE.warning : AI_TONE.info }} aria-hidden="true" />
                          <span className="text-[13px] font-semibold text-foreground">{t(`scope.${s}.title`)}</span>
                        </span>
                        <span className="text-[12px] leading-relaxed text-muted-foreground">{t(`scope.${s}.body`)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="space-y-2">
                <span id="ai-expiry-label" className="block text-[13px] font-medium text-foreground">{t('create.expiry')}</span>
                <Segmented
                  label={t('create.expiry')}
                  value={form.expiresInDays}
                  onChange={(v) => edit({ expiresInDays: v })}
                  options={EXPIRY_OPTIONS.map((d) => ({ value: d, label: d == null ? t('create.expiryNever') : t('create.expiryDays', { count: d }) }))}
                />
                {form.expiresInDays == null && <p className="text-[12px]" style={toneText('warning')}>{t('create.expiryNeverWarn')}</p>}
              </div>

              <div className="space-y-2">
                <span className="block text-[13px] font-medium text-foreground">{t('create.profiles')}</span>
                <Segmented
                  label={t('create.profiles')}
                  value={form.groupMode}
                  onChange={(v) => edit({ groupMode: v })}
                  options={[{ value: 'all', label: t('create.profilesAll') }, { value: 'some', label: t('create.profilesSome') }]}
                />
                <p className="text-[12px] text-muted-foreground">{form.groupMode === 'all' ? t('create.profilesAllHint') : t('create.profilesSomeHint')}</p>
                {form.groupMode === 'some' && (
                  groups.length === 0 ? (
                    <p className="text-[12.5px]" style={toneText('warning')}>{t('create.noGroups')}</p>
                  ) : (
                    <fieldset className="max-h-44 overflow-y-auto rounded-lg border border-border p-2">
                      <legend className="sr-only">{t('create.pickGroups')}</legend>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {groups.map((g) => {
                          const checked = form.groupIds.includes(g.id);
                          return (
                            <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground hover:bg-secondary">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[var(--primary)]"
                                checked={checked}
                                onChange={() => edit({ groupIds: checked ? form.groupIds.filter((x) => x !== g.id) : [...form.groupIds, g.id] })}
                              />
                              {g.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} aria-hidden="true" />}
                              <span className="min-w-0 flex-1 truncate">{g.name}</span>
                              {g.profileCount != null && <span className="text-[11px] tabular-nums text-muted-foreground">{g.profileCount}</span>}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  )
                )}
                {showErrors && errors.groupIds && <p role="alert" className="text-[12px]" style={toneText('danger')}>{t(errors.groupIds)}</p>}
              </div>

              {isOwner && <AutomationSection form={form} edit={edit} errors={showErrors ? errors : {}} toolGroups={toolGroups} />}

              {flow.error && (
                <p role="alert" className="text-[12.5px]" style={toneText('danger')}>
                  {String(flow.error).startsWith('errors.') ? t(flow.error) : t('errors.createFailed', { message: flow.error })}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => dispatch({ type: 'close' })}>{t('cancel')}</Button>
              <PrimaryButton type="submit" isLoading={flow.step === 'saving'}>{t('create.submit')}</PrimaryButton>
            </DialogFooter>
          </form>
        )}

        {flow.step === 'saving' && !form && <DialogBody>{t('saving')}</DialogBody>}

        {reveal && <RevealStep flow={flow} dispatch={dispatch} clientName={clientName} hostOs={hostOs} />}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, error, children }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-foreground">{label}</label>
      {children(id, describedBy)}
      {hint && <p id={hintId} className="text-[12px] text-muted-foreground">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-[12px]" style={toneText('danger')}>{error}</p>}
    </div>
  );
}

function AutomationSection({ form, edit, errors, toolGroups }) {
  const { t } = useTranslation('ai');
  const panelId = useId();
  const readOnly = form.scope === 'read';
  const active = automationActive(form, { isOwner: true });

  function toggleTool(tool) {
    const has = form.preApprovedTools.includes(tool);
    const next = has ? form.preApprovedTools.filter((x) => x !== tool) : [...form.preApprovedTools, tool];
    // Pre-approved tools need a group limit, so ticking the first one switches to "Only some groups".
    edit(next.length && form.groupMode !== 'some' ? { preApprovedTools: next, groupMode: 'some' } : { preApprovedTools: next });
  }

  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={form.automation}
        aria-controls={panelId}
        onClick={() => edit({ automation: !form.automation })}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
      >
        {form.automation ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Workflow className="h-4 w-4" style={{ color: AI_TONE.accent }} aria-hidden="true" />
        <span className="flex-1 text-[13px] font-semibold text-foreground">{t('automation.title')}</span>
        <TonePill tone="accent">{t('automation.ownerOnly')}</TonePill>
        {active && <TonePill tone="warning">{t('automation.count', { count: form.preApprovedTools.length })}</TonePill>}
      </button>
      {form.automation && (
        <div id={panelId} className="space-y-4 border-t border-border px-3.5 py-3.5">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('automation.intro')}</p>
          {readOnly ? (
            <p className="text-[12.5px]" style={toneText('warning')}>{t('automation.needsOperate')}</p>
          ) : (
            <>
              <div className="flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5" style={toneSurface('warning', 10, 35)}>
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: AI_TONE.warning }} aria-hidden="true" />
                <p className="text-[12.5px] font-medium text-foreground">{t('automation.warning')}</p>
              </div>
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-foreground">{t('automation.tools')}</legend>
                <div className="space-y-3">
                  {toolGroups.map((g) => (
                    <div key={g.group}>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`automation.groups.${g.group}`)}</p>
                      <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
                        {g.tools.map((tool) => (
                          <label key={tool.name} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-secondary">
                            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]" checked={form.preApprovedTools.includes(tool.name)} onChange={() => toggleTool(tool.name)} />
                            <span className="min-w-0">
                              <span className="block text-[12.5px] text-foreground">
                                {t(`tools.${tool.name}`, { defaultValue: tool.title || tool.name })}
                                {tool.destructive && <TonePill tone="warning" className="ml-1.5 align-middle">{t('automation.destructive')}</TonePill>}
                              </span>
                              <span className="block font-mono text-[11px] text-muted-foreground">{tool.name}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {errors.preApprovedTools && <p role="alert" className="mt-1 text-[12px]" style={toneText('danger')}>{t(errors.preApprovedTools)}</p>}
              </fieldset>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <LimitField
                  label={t('automation.maxProfiles')}
                  hint={t('automation.maxProfilesHint')}
                  value={form.maxProfilesPerCall}
                  range={AUTOMATION_LIMITS.maxProfilesPerCall}
                  onCommit={(v) => edit({ maxProfilesPerCall: v })}
                  error={errors.maxProfilesPerCall ? t(errors.maxProfilesPerCall, { min: AUTOMATION_LIMITS.maxProfilesPerCall[0], max: AUTOMATION_LIMITS.maxProfilesPerCall[1] }) : ''}
                />
                <LimitField
                  label={t('automation.maxCalls')}
                  hint={t('automation.maxCallsHint')}
                  value={form.maxCallsPerHour}
                  range={AUTOMATION_LIMITS.maxCallsPerHour}
                  onCommit={(v) => edit({ maxCallsPerHour: v })}
                  error={errors.maxCallsPerHour ? t(errors.maxCallsPerHour, { min: AUTOMATION_LIMITS.maxCallsPerHour[0], max: AUTOMATION_LIMITS.maxCallsPerHour[1] }) : ''}
                />
              </div>
              <p className="text-[12px] text-muted-foreground">{t('automation.groupsNote')}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function LimitField({ label, hint, value, range, onCommit, error }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[12.5px] font-medium text-foreground">{label}</label>
      <NumberInput id={id} className={numCls} value={value} min={range[0]} max={range[1]} fallback={value} onCommit={onCommit} />
      <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      {error && <p role="alert" className="text-[12px]" style={toneText('danger')}>{error}</p>}
    </div>
  );
}

function RevealStep({ flow, dispatch, clientName, hostOs }) {
  const { t } = useTranslation('ai');
  const client = flow.client;
  const filled = client && client.text && hasPlaceholder(client.text) ? fillToken(client.text, flow.token) : '';
  const canFinish = canFinishReveal(flow);
  return (
    <>
      <DialogBody className="max-h-[min(64vh,640px)] space-y-4 overflow-y-auto">
        <div className="flex items-start gap-2.5 rounded-lg border px-3.5 py-3" style={toneSurface('warning', 10, 35)}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: AI_TONE.warning }} aria-hidden="true" />
          <p className="text-[13px] font-medium text-foreground">{t('create.onceWarning')}</p>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('create.yourToken')}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-surface px-3 py-2.5 font-mono text-[13px] text-foreground" aria-label={t('create.yourToken')}>{flow.token}</code>
            <CopyButton text={flow.token} tag="token" label={t('create.yourToken')} size="md" variant="primary" onCopied={() => dispatch({ type: 'copied' })} />
          </div>
        </div>

        {filled && (
          <div className="space-y-1.5">
            <span className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('create.filledSetup', { app: clientName })}</span>
            <CodeBlock text={filled} label={t('create.filledSetup', { app: clientName })} kindLabel={t(`connect.kind.${client.kind}`, { defaultValue: client.kind })} onCopied={() => dispatch({ type: 'copied' })} />
          </div>
        )}
        {client && client.key === 'codex' && (
          <div className="space-y-1.5">
            <span className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{t('connect.envVar.title')}</span>
            <CodeBlock text={envVarCommand(hostOs, flow.token)} label={t('connect.envVar.title')} kindLabel={hostOs === 'Windows' ? t('connect.envVar.windows') : t('connect.envVar.unix')} onCopied={() => dispatch({ type: 'copied' })} />
          </div>
        )}
        {client && client.key === 'n8n' && <p className="text-[12.5px] text-muted-foreground">{t('create.n8nHint')}</p>}
        {client && client.key === 'claude-code' && <p className="text-[12.5px] text-muted-foreground">{t('create.claudeCodeHint')}</p>}
        {client && client.key === 'claude-desktop' && <p className="text-[12.5px] text-muted-foreground">{t('create.claudeDesktopHint')}</p>}

        <label className="flex items-center gap-2.5 text-[13px] text-foreground">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={flow.acknowledged} onChange={(e) => dispatch({ type: 'acknowledge', value: e.target.checked })} />
          {t('create.acknowledge')}
        </label>
        {flow.closeWarning && <p role="alert" className="text-[12.5px] font-medium" style={toneText('danger')}>{t('create.closeWarning')}</p>}
      </DialogBody>
      <DialogFooter>
        <PrimaryButton onClick={() => dispatch({ type: 'close' })} disabled={!canFinish}>{t('create.done')}</PrimaryButton>
      </DialogFooter>
    </>
  );
}
