import React from 'react';
import { X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';

// Side-by-side comparison of 2–3 profiles. Renderer-only — uses the profile objects
// already loaded on the Profiles page. Rows where the values differ are highlighted
// so config drift (e.g. a mismatched timezone or UA) is obvious at a glance.
const ROWS = [
  ['Name', (p) => p.title],
  ['Browser', (p) => p.browserBrand || p.browserCore || '—'],
  ['Version', (p) => p.browserVersion || 'Auto'],
  ['OS', (p) => [p.os, p.osVersion].filter(Boolean).join(' ') || '—'],
  ['Device', (p) => p.deviceClass || 'desktop'],
  ['User-Agent', (p) => p.userAgent || 'Auto'],
  ['Proxy', (p) => p.proxyInfoString || (p.proxy && p.proxy.name) || 'Direct'],
  ['Proxy health', (p) => (p.proxy && p.proxy.lastStatus) ? p.proxy.lastStatus : '—'],
  ['Timezone', (p) => p.timezoneType === 'Custom' ? (p.timezoneCustom || 'Custom') : (p.timezoneType || 'Real')],
  ['Language', (p) => p.languageType === 'Custom' ? (p.languageCustom || 'Custom') : (p.languageType || 'Real')],
  ['Resolution', (p) => p.resolutionType === 'Custom' ? `${p.resolutionW || '?'}×${p.resolutionH || '?'}` : (p.resolutionType || 'Real')],
  ['WebRTC', (p) => p.webrtc || 'Forward'],
  ['WebGL vendor', (p) => p.webglVendor || '—'],
  ['WebGL renderer', (p) => p.webglRenderer || '—'],
  ['CPU cores', (p) => p.cpu ?? '—'],
  ['RAM (GB)', (p) => p.ram ?? '—'],
  ['Group', (p) => (p.group && p.group.name) || '—'],
  ['Tags', (p) => (Array.isArray(p.tags) && p.tags.length) ? p.tags.join(', ') : '—']
];

export default function CompareProfilesModal({ profiles = [], onClose }) {
  const { dialogRef } = useDialog({ onClose });
  if (!profiles.length) return null;
  const val = (get, p) => { try { const v = get(p); return (v === null || v === undefined || v === '') ? '—' : String(v); } catch (e) { return '—'; } };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Compare profiles" tabIndex={-1} className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Compare profiles</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Differing values are highlighted.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-elevated text-muted-foreground text-[10px] uppercase tracking-wider font-semibold border-b border-border sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-40">Attribute</th>
                {profiles.map((p) => <th key={p.id} className="px-4 py-3 truncate max-w-[200px]">{p.title}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ROWS.map(([label, get]) => {
                const values = profiles.map((p) => val(get, p));
                const differs = new Set(values).size > 1;
                return (
                  <tr key={label} className={differs ? 'bg-amber-500/5' : ''}>
                    <td className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</td>
                    {values.map((v, i) => (
                      <td key={i} className={`px-4 py-2.5 text-xs ${differs ? 'text-amber-300 font-medium' : 'text-foreground'} truncate max-w-[220px]`} title={v}>{v}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
