import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Shield, Zap } from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';

// Which site blocked which profile, then what was done about it (rotated, switched, or why not).
function blockedToastText(tx, d) {
  const k = 'browser.switchProxyOnBlock.toast';
  const kind = tx(`${k}.kind.${d.kind}`, { defaultValue: tx(`${k}.kind.unknown`) });
  const head = tx(`${k}.blocked`, { site: d.site || '?', profile: d.title || `#${d.profileId}`, kind });
  let tail;
  if (d.action === 'rotated') tail = tx(`${k}.rotated`, { proxy: d.proxyName || '' });
  else if (d.action === 'switched') tail = tx(d.reason === 'notReopened' ? `${k}.notReopened` : `${k}.switched`, { proxy: d.newProxyName || '' });
  else tail = tx(`${k}.none.${d.reason}`, { limit: d.limit, defaultValue: tx(`${k}.none.failed`) });
  return `${head} ${tail}`;
}

// Transient toasts for crash, block-page and memory-pressure notifications pushed from main.
export default function ResilienceToasts() {
  const { t: tx } = useTranslation('settingsExtra');
  const txRef = useRef(tx);
  txRef.current = tx;
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  useEffect(() => {
    const add = (kind, text, ms = 6500) => {
      const id = ++idRef.current;
      setToasts((t) => [...t, { id, kind, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
    };
    const offs = [];
    if (softglazeApi.sessions.onCrash) offs.push(softglazeApi.sessions.onCrash((d) => {
      if (!d) return;
      add('crash', `${d.title || 'A profile'} stopped unexpectedly${d.restarted ? ' - restarting…' : ''}.`);
    }));
    if (softglazeApi.sessions.onBlocked) offs.push(softglazeApi.sessions.onBlocked((d) => {
      if (!d) return;
      add('blocked', blockedToastText(txRef.current, d), 10000);
    }));
    if (softglazeApi.sessions.onMemoryPressure) offs.push(softglazeApi.sessions.onMemoryPressure((d) => {
      if (!d) return;
      add('memory', `Low memory - closed ${d.closed} profile${d.closed === 1 ? '' : 's'} (free ${d.freePct}%).`);
    }));
    return () => offs.forEach((off) => { if (typeof off === 'function') off(); });
  }, []);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg animate-fade-up" style={{ background: 'var(--card)', borderColor: 'color-mix(in srgb, var(--destructive) 35%, transparent)' }}>
          {t.kind === 'crash'
            ? <Zap className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }} />
            : t.kind === 'blocked'
              ? <Shield className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--warning)' }} aria-hidden="true" />
              : <Cpu className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--destructive)' }} />}
          <p className="text-[12.5px] text-foreground">{t.text}</p>
        </div>
      ))}
    </div>
  );
}
