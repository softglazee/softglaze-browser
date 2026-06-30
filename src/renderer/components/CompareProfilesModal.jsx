import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';

// Side-by-side comparison of 2–3 profiles. Renderer-only — uses the profile objects
// already loaded on the Profiles page. Rows where the values differ are highlighted
// so config drift (e.g. a mismatched timezone or UA) is obvious at a glance.
export default function CompareProfilesModal({ profiles = [], onClose }) {
  const { t } = useTranslation('cmpModalsA');
  const { dialogRef } = useDialog({ onClose });
  const ROWS = [
    [t('compare.rowName'), (p) => p.title],
    [t('compare.rowBrowser'), (p) => p.browserBrand || p.browserCore || '—'],
    [t('compare.rowVersion'), (p) => p.browserVersion || t('compare.auto')],
    [t('compare.rowOS'), (p) => [p.os, p.osVersion].filter(Boolean).join(' ') || '—'],
    [t('compare.rowDevice'), (p) => p.deviceClass || t('compare.desktop')],
    [t('compare.rowUserAgent'), (p) => p.userAgent || t('compare.auto')],
    [t('compare.rowProxy'), (p) => p.proxyInfoString || (p.proxy && p.proxy.name) || t('compare.direct')],
    [t('compare.rowProxyHealth'), (p) => (p.proxy && p.proxy.lastStatus) ? p.proxy.lastStatus : '—'],
    [t('compare.rowTimezone'), (p) => p.timezoneType === 'Custom' ? (p.timezoneCustom || t('compare.custom')) : (p.timezoneType || t('compare.real'))],
    [t('compare.rowLanguage'), (p) => p.languageType === 'Custom' ? (p.languageCustom || t('compare.custom')) : (p.languageType || t('compare.real'))],
    [t('compare.rowResolution'), (p) => p.resolutionType === 'Custom' ? `${p.resolutionW || '?'}×${p.resolutionH || '?'}` : (p.resolutionType || t('compare.real'))],
    [t('compare.rowWebRTC'), (p) => p.webrtc || t('compare.forward')],
    [t('compare.rowWebglVendor'), (p) => p.webglVendor || '—'],
    [t('compare.rowWebglRenderer'), (p) => p.webglRenderer || '—'],
    [t('compare.rowCpuCores'), (p) => p.cpu ?? '—'],
    [t('compare.rowRam'), (p) => p.ram ?? '—'],
    [t('compare.rowGroup'), (p) => (p.group && p.group.name) || '—'],
    [t('compare.rowTags'), (p) => (Array.isArray(p.tags) && p.tags.length) ? p.tags.join(', ') : '—']
  ];
  if (!profiles.length) return null;
  const val = (get, p) => { try { const v = get(p); return (v === null || v === undefined || v === '') ? '—' : String(v); } catch (e) { return '—'; } };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('compare.header')} tabIndex={-1} className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('compare.header')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('compare.subtitle')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title={t('compare.close')}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-elevated text-muted-foreground text-[10px] uppercase tracking-wider font-semibold border-b border-border sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-40">{t('compare.attribute')}</th>
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
