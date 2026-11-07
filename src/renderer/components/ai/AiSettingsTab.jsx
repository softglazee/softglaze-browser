import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Network, Plus, ServerCog, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import Input from '@/components/ui/Input.jsx';
import Switch from '@/components/ui/Switch.jsx';
import {
  AI_TONE, ChipList, ConfirmDialog, InlineError, SaveNote, SectionCard, Segmented, TonePill, toneSurface, toneText
} from '@/components/ai/AiShared.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import {
  PORT_RANGE, SCOPES, addToList, approvalModeOptions, coerceApprovalMode, errorText, normalizeDomain, normalizeHostName, validPort
} from '@/lib/aiCore.mjs';

const DOCKER_HOST = 'host.docker.internal';

export default function AiSettingsTab({ isOwner, status, onPortChanged }) {
  const { t } = useTranslation('ai');
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [saves, setSaves] = useState({}); // section -> { state, error }

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr('');
    try {
      const v = await softglazeApi.ai.getSettings();
      setS(v || {});
    } catch (e) {
      setLoadErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Saves one change; keeps the old value on screen if main refuses it.
  const apply = useCallback(async (section, patch) => {
    setSaves((m) => ({ ...m, [section]: { state: 'saving', error: '' } }));
    const before = s;
    setS((cur) => ({ ...cur, ...patch }));
    try {
      const next = await softglazeApi.ai.setSettings(patch);
      if (next && typeof next === 'object' && !Array.isArray(next) && Object.keys(next).length) setS((cur) => ({ ...cur, ...next }));
      setSaves((m) => ({ ...m, [section]: { state: 'saved', error: '' } }));
      return true;
    } catch (e) {
      setS(before);
      setSaves((m) => ({ ...m, [section]: { state: 'error', error: errorText(e) } }));
      return false;
    }
  }, [s]);

  if (loading) return <div className="h-96 animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" aria-busy="true" />;
  if (loadErr) {
    return (
      <InlineError>
        <span className="flex flex-wrap items-center justify-between gap-2">{t('settings.loadError', { message: loadErr })}<Button size="sm" variant="secondary" onClick={load}>{t('retry')}</Button></span>
      </InlineError>
    );
  }

  const modes = (s && s.approvalMode) || {};
  const save = (k) => saves[k] || { state: '', error: '' };

  return (
    <div className="max-w-[920px] space-y-4">
      <SectionCard icon={ShieldCheck} title={t('settings.approvals.title')} description={t('settings.approvals.description')} actions={<SaveNote {...save('approvals')} />}>
        <div className="divide-y divide-border">
          {SCOPES.map((scope) => {
            const value = coerceApprovalMode(scope, modes[scope]);
            return (
              <div key={scope} className="grid grid-cols-1 items-center gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">{t(`settings.approvals.${scope}.title`)}</p>
                  <p className="text-[12px] text-muted-foreground">{t(`settings.approvals.${scope}.body`)}</p>
                </div>
                <Segmented
                  label={t(`settings.approvals.${scope}.title`)}
                  value={value}
                  onChange={(v) => apply('approvals', { approvalMode: { ...modes, [scope]: v } })}
                  options={approvalModeOptions(scope).map((m) => ({ value: m, label: t(`settings.modes.${m}`) }))}
                />
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">{t('settings.approvals.alwaysAsk')}</p>
      </SectionCard>

      <ListSetting
        icon={Globe}
        section="domains"
        title={t('settings.domains.title')}
        description={t('settings.domains.description')}
        items={Array.isArray(s.pageDomainAllowList) ? s.pageDomainAllowList : []}
        normalize={normalizeDomain}
        placeholder={t('settings.domains.placeholder')}
        invalidText={t('settings.domains.invalid')}
        emptyText={t('settings.domains.empty')}
        addLabel={t('settings.domains.add')}
        save={save('domains')}
        onChange={(list) => apply('domains', { pageDomainAllowList: list })}
      />

      <ListSetting
        icon={Network}
        section="hosts"
        title={t('settings.hosts.title')}
        description={t('settings.hosts.description')}
        badge={<TonePill tone="accent">{t('settings.ownerOnly')}</TonePill>}
        items={Array.isArray(s.extraAllowedHosts) ? s.extraAllowedHosts : []}
        normalize={normalizeHostName}
        placeholder={DOCKER_HOST}
        invalidText={t('settings.hosts.invalid')}
        emptyText={t('settings.hosts.empty')}
        addLabel={t('settings.hosts.add')}
        disabled={!isOwner}
        disabledText={t('settings.ownerOnlyHint')}
        suggestion={DOCKER_HOST}
        save={save('hosts')}
        onChange={(list) => apply('hosts', { extraAllowedHosts: list })}
      />

      <ExpertMode isOwner={isOwner} on={Boolean(s.expertMode)} save={save('expert')} onChange={(v) => apply('expert', { expertMode: v })} />

      <PortSetting
        port={Number(s.port) || Number(status && status.port) || null}
        save={save('port')}
        onSave={async (p) => { const ok = await apply('port', { port: p }); if (ok && onPortChanged) onPortChanged(p); return ok; }}
      />
    </div>
  );
}

function ListSetting({ icon, title, description, badge, items, normalize, placeholder, invalidText, emptyText, addLabel, disabled = false, disabledText, suggestion, save, onChange }) {
  const { t } = useTranslation('ai');
  const inputId = useId();
  const errId = useId();
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  function add(value) {
    const v = normalize(value);
    if (!v) { setInvalid(true); return; }
    setInvalid(false);
    setDraft('');
    const next = addToList(items, v);
    if (next !== items) onChange(next);
  }

  return (
    <SectionCard icon={icon} title={<span className="inline-flex flex-wrap items-center gap-2">{title}{badge}</span>} description={description} actions={<SaveNote {...save} />}>
      <div className="space-y-3">
        <ChipList items={items} disabled={disabled} onRemove={(v) => onChange(items.filter((x) => x !== v))} removeLabel={(v) => t('settings.remove', { value: v })} emptyText={emptyText} />
        {disabled ? (
          <p className="text-[12px] text-muted-foreground">{disabledText}</p>
        ) : (
          <form className="flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
            <div className="w-full max-w-sm">
              <label htmlFor={inputId} className="sr-only">{addLabel}</label>
              <Input
                id={inputId}
                value={draft}
                placeholder={placeholder}
                aria-invalid={invalid}
                aria-describedby={invalid ? errId : undefined}
                onChange={(e) => { setDraft(e.target.value); if (invalid) setInvalid(false); }}
                className="font-mono"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={!draft.trim()}><Plus className="h-4 w-4" /> {addLabel}</Button>
            {suggestion && !items.includes(suggestion) && (
              <Button type="button" variant="ghost" onClick={() => add(suggestion)}><Plus className="h-4 w-4" /> <span className="font-mono text-[12.5px]">{suggestion}</span></Button>
            )}
          </form>
        )}
        {invalid && <p id={errId} role="alert" className="text-[12px]" style={toneText('danger')}>{invalidText}</p>}
      </div>
    </SectionCard>
  );
}

function ExpertMode({ isOwner, on, save, onChange }) {
  const { t } = useTranslation('ai');
  const [confirm, setConfirm] = useState({ open: false, ack: false });
  return (
    <SectionCard
      icon={Wrench}
      title={<span className="inline-flex flex-wrap items-center gap-2">{t('settings.expert.title')}<TonePill tone="accent">{t('settings.ownerOnly')}</TonePill></span>}
      description={t('settings.expert.description')}
      actions={<SaveNote {...save} />}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-lg border px-3.5 py-3" style={toneSurface('danger', 9, 35)}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: AI_TONE.danger }} aria-hidden="true" />
          <p className="text-[12.5px] font-medium leading-relaxed text-foreground">{t('settings.expert.warning')}</p>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 px-3.5 py-2.5">
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-foreground">{t('settings.expert.switch')}</span>
            <span className="block text-[12px] text-muted-foreground">{isOwner ? (on ? t('settings.expert.isOn') : t('settings.expert.isOff')) : t('settings.ownerOnlyHint')}</span>
          </span>
          <Switch
            checked={on}
            disabled={!isOwner}
            label={t('settings.expert.switch')}
            onChange={(v) => { if (v) setConfirm({ open: true, ack: false }); else onChange(false); }}
          />
        </label>
      </div>
      <ConfirmDialog
        open={confirm.open}
        title={t('settings.expert.confirmTitle')}
        body={t('settings.expert.confirmBody')}
        confirmLabel={t('settings.expert.confirm')}
        confirmDisabled={!confirm.ack}
        onConfirm={() => { setConfirm({ open: false, ack: false }); onChange(true); }}
        onCancel={() => setConfirm({ open: false, ack: false })}
      >
        <label className="flex items-start gap-2.5 text-[13px] text-foreground">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--destructive)]" checked={confirm.ack} onChange={(e) => setConfirm((c) => ({ ...c, ack: e.target.checked }))} />
          {t('settings.expert.ack')}
        </label>
      </ConfirmDialog>
    </SectionCard>
  );
}

function PortSetting({ port, save, onSave }) {
  const { t } = useTranslation('ai');
  const id = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(port == null ? '' : String(port));
  useEffect(() => { setDraft(port == null ? '' : String(port)); }, [port]);
  const valid = validPort(draft);
  const changed = valid && Number(draft) !== port;
  return (
    <SectionCard icon={ServerCog} title={t('settings.port.title')} description={t('settings.port.description')} actions={<SaveNote {...save} />}>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (changed) onSave(Number(draft)); }}>
        <div className="space-y-1">
          <label htmlFor={id} className="block text-[12.5px] font-medium text-foreground">{t('settings.port.label')}</label>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={PORT_RANGE[0]}
            max={PORT_RANGE[1]}
            value={draft}
            aria-describedby={hintId}
            aria-invalid={draft !== '' && !valid}
            onChange={(e) => setDraft(e.target.value)}
            className="w-32 rounded border border-border bg-input-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!changed} isLoading={save.state === 'saving'}>{t('save')}</Button>
      </form>
      <p id={hintId} className="mt-2 text-[12px]" style={draft !== '' && !valid ? toneText('danger') : undefined}>
        <span className={draft !== '' && !valid ? '' : 'text-muted-foreground'}>
          {draft !== '' && !valid ? t('settings.port.invalid', { min: PORT_RANGE[0], max: PORT_RANGE[1] }) : t('settings.port.hint')}
        </span>
      </p>
    </SectionCard>
  );
}
