import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2, X } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog.jsx';
import { cn } from '@/lib/utils.js';
import { splitSnippet } from '@/lib/aiCore.mjs';

// Status colours from the theme tokens; text is tinted toward the foreground so it keeps contrast
// in light and dark (same approach as lib/providerStates.js).
export const AI_TONE = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--destructive)',
  info: 'var(--primary)',
  accent: 'var(--chart-2)',
  muted: 'var(--muted-foreground)'
};
export const toneText = (tone) => ({ color: `color-mix(in srgb, ${AI_TONE[tone] || AI_TONE.muted} 72%, var(--foreground))` });
export const toneSurface = (tone, bg = 10, border = 28) => ({
  background: `color-mix(in srgb, ${AI_TONE[tone] || AI_TONE.muted} ${bg}%, transparent)`,
  borderColor: `color-mix(in srgb, ${AI_TONE[tone] || AI_TONE.muted} ${border}%, transparent)`
});

export function TonePill({ tone = 'muted', className = '', children, ...rest }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4', className)}
      style={{ ...toneSurface(tone, 12, 30), ...toneText(tone) }}
      {...rest}
    >
      {children}
    </span>
  );
}

export function BetaPill({ className = '' }) {
  const { t } = useTranslation('ai');
  return <TonePill tone="accent" className={cn('uppercase tracking-wider text-[10px]', className)}>{t('beta')}</TonePill>;
}

export function StatusDot({ tone = 'muted', pulse = false }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: AI_TONE[tone] }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: AI_TONE[tone] }} />
    </span>
  );
}

// Clipboard with a fallback for windows where navigator.clipboard is blocked.
export function useCopy() {
  const [copied, setCopied] = useState('');
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text, tag = 'x') => {
    setFailed(false);
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(String(text)); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = String(text);
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
    }
    if (ok) {
      setCopied(tag);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(''), 1800);
    } else setFailed(true);
    return ok;
  }, []);
  return { copied, failed, copy };
}

export function CopyButton({ text, tag = 'x', label, size = 'sm', variant = 'secondary', onCopied, className = '' }) {
  const { t } = useTranslation('ai');
  const { copied, failed, copy } = useCopy();
  const done = copied === tag;
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn('shrink-0 min-w-[5.5rem]', className)}
        onClick={async () => { if (await copy(text, tag) && onCopied) onCopied(); }}
        aria-label={label ? `${t('copy')}: ${label}` : t('copy')}
      >
        {done ? <Check className="h-3.5 w-3.5" style={{ color: AI_TONE.success }} /> : <Copy className="h-3.5 w-3.5" />}
        {done ? t('copied') : t('copy')}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">{done ? t('copied') : failed ? t('copyFailed') : ''}</span>
      {failed && <span className="text-[11.5px]" style={toneText('danger')}>{t('copyFailed')}</span>}
    </>
  );
}

// A code block with a Copy button; the token placeholder is highlighted so it is hard to miss.
export function CodeBlock({ text, label, kindLabel, copyText, onCopied, className = '' }) {
  const segs = splitSnippet(text);
  return (
    <div className={cn('rounded-lg border border-border bg-surface overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{kindLabel || label}</span>
        <CopyButton text={copyText != null ? copyText : text} label={label} tag="code" onCopied={onCopied} variant="ghost" />
      </div>
      <pre tabIndex={0} aria-label={label} className="max-h-72 overflow-auto whitespace-pre px-3.5 py-3 font-mono text-[12px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {segs.map((s, i) => (s.placeholder
          ? <mark key={i} className="rounded px-0.5 font-semibold" style={{ ...toneSurface('warning', 22, 0), ...toneText('warning') }}>{s.text}</mark>
          : <span key={i}>{s.text}</span>))}
      </pre>
    </div>
  );
}

// One line of copyable text (an endpoint, a path).
export function CopyField({ label, value, mono = true }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>}
      <div className="flex items-center gap-2">
        <code className={cn('min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-foreground', mono && 'font-mono')} title={value}>{value}</code>
        <CopyButton text={value} label={label} />
      </div>
    </div>
  );
}

// Radio group that looks like a segmented control. Arrow keys move and select.
export function Segmented({ value, options, onChange, label, disabled = false, className = '' }) {
  const refs = useRef([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  function onKey(e) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    let next = idx;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else next = (idx + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
    onChange(options[next].value);
    if (refs.current[next]) refs.current[next].focus();
  }
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-elevated/60 p-1', disabled && 'opacity-60', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onKeyDown={onKey}
            onClick={() => onChange(o.value)}
            className={cn('rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors whitespace-nowrap',
              on ? 'bg-card text-foreground shadow-sm border border-border' : 'border border-transparent text-muted-foreground hover:text-foreground')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChipList({ items, onRemove, removeLabel, disabled = false, emptyText }) {
  if (!items || items.length === 0) return emptyText ? <p className="text-[12.5px] text-muted-foreground">{emptyText}</p> : null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-live="polite">
      {items.map((v) => (
        <li key={v} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary py-0.5 pl-2.5 pr-1 font-mono text-[12px] text-foreground">
          <span className="max-w-[18rem] truncate" title={v}>{v}</span>
          {!disabled && (
            <button type="button" onClick={() => onRemove(v)} aria-label={removeLabel(v)} className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-elevated hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Solid red action (Stop all AI, Revoke). The Button primitive's danger variant is a soft tint.
export function DangerButton({ children, busy = false, disabled = false, size = 'md', className = '', ...rest }) {
  const sizes = { sm: 'text-xs px-3 py-1.5 gap-1.5', md: 'text-sm px-4 py-2 gap-2', lg: 'text-[14px] px-4 py-2.5 gap-2' };
  return (
    <button
      type="button"
      disabled={busy || disabled}
      className={cn('inline-flex items-center justify-center rounded font-semibold text-white transition-[filter,background-color] duration-150 hover:brightness-110 disabled:pointer-events-none disabled:opacity-50', sizes[size], className)}
      style={{ background: 'var(--destructive)' }}
      {...rest}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// A small confirm dialog in the app's own style (not window.confirm), so it themes and reads well.
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, tone = 'danger', busy = false, confirmDisabled = false, onConfirm, onCancel, children }) {
  const { t } = useTranslation('ai');
  const descId = useId();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent title={title} className="max-w-lg" aria-describedby={body ? descId : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body && <DialogDescription id={descId}>{body}</DialogDescription>}
        </DialogHeader>
        {children && <DialogBody className="space-y-3">{children}</DialogBody>}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel || t('cancel')}</Button>
          {tone === 'danger'
            ? <DangerButton onClick={onConfirm} busy={busy} disabled={confirmDisabled}>{confirmLabel}</DangerButton>
            : <Button onClick={onConfirm} isLoading={busy} disabled={confirmDisabled}>{confirmLabel}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SectionCard({ title, description, icon: Icon, actions, children, className = '', id }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ ...toneSurface('info', 12, 0), color: AI_TONE.info }}>
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </span>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="text-[15px] font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function InlineError({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-lg border px-3.5 py-2.5 text-[12.5px]" style={{ ...toneSurface('danger', 10, 30), ...toneText('danger') }}>
      {children}
    </div>
  );
}

export function SaveNote({ state, error }) {
  const { t } = useTranslation('ai');
  return (
    <span role="status" aria-live="polite" className="inline-flex min-w-[4rem] items-center text-[12px]" style={state === 'error' ? toneText('danger') : state === 'saved' ? toneText('success') : undefined}>
      {state === 'saving' ? <span className="text-muted-foreground">{t('saving')}</span> : state === 'saved' ? t('saved') : state === 'error' ? (error || t('saveFailed')) : ''}
    </span>
  );
}
