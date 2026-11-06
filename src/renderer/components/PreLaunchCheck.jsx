import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Play, Wand2, X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import Button from '@/components/ui/Button.jsx';

function issueText(t, issue) {
  const p = issue.params || {};
  if (issue.key === 'uaOs') return t('prelaunch.issue.uaOs', { ua: t(`prelaunch.os.${p.ua}`, p.ua), os: p.os });
  if (issue.key === 'screen') return t(`prelaunch.issue.screen.${p.device}`, { width: p.width, height: p.height });
  return t(`prelaunch.issue.${issue.key}`, p);
}

// Shown before a launch when profiles have clear mismatches. Resolves with
// { launch, fix, stopAsking }: fix applies the one-click fixes first, then everything launches.
export default function PreLaunchCheckModal({ items, onDecide }) {
  const { t } = useTranslation('captcha');
  const [stopAsking, setStopAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancel = () => { if (!busy) onDecide({ launch: false, fix: false, stopAsking }); };
  const { dialogRef } = useDialog({ onClose: cancel });
  const fixable = items.some((it) => it.issues.some((i) => i.fix));
  // A blocking issue (a SOCKS4 proxy on Chromium) is refused by the browser itself, so when every
  // profile has one there is nothing to launch anyway.
  const launchable = items.some((it) => !it.issues.some((i) => i.blocking));
  const decide = (fix) => { setBusy(true); onDecide({ launch: true, fix, stopAsking }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={cancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prelaunch-title"
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded border border-border bg-card shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <h2 id="prelaunch-title" className="text-sm font-bold text-foreground">{t('prelaunch.title', { count: items.length })}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('prelaunch.subtitle')}</p>
            </div>
          </div>
          <button type="button" onClick={cancel} aria-label={t('prelaunch.cancel')} className="rounded p-1.5 text-muted-foreground transition hover:bg-muted-dark hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {items.map((it) => (
            <section key={it.profile.id} className="rounded border border-warning/30 bg-warning/5 px-4 py-3">
              <h3 className="truncate text-sm font-semibold text-foreground">{it.profile.title}</h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                {it.issues.map((issue) => (
                  <li key={issue.key}>
                    {issueText(t, issue)}
                    {issue.blocking
                      ? <span className="font-medium text-warning"> {t('prelaunch.blocking')}</span>
                      : !issue.fix && <span className="text-muted-foreground/80"> {t('prelaunch.editorOnly')}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={stopAsking} onChange={(e) => setStopAsking(e.target.checked)} className="accent-primary" />
            {t('prelaunch.stopAsking')}
          </label>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-surface px-5 py-4">
          <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>{t('prelaunch.cancel')}</Button>
          {launchable && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(false)}>
              <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t('prelaunch.launchAnyway')}
            </Button>
          )}
          {fixable && launchable && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(true)}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {t('prelaunch.fixAndLaunch')}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
