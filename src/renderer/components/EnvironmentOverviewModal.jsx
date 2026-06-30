import React from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, X, Cpu, MemoryStick, Monitor, Globe, ShieldCheck, Languages, Clock, MapPin, Network } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';

// Build a representative User-Agent string from the profile's OS + version, so
// the overview shows what sites will see. Mirrors the launch engine's logic.
function buildUa(p) {
  const os = String(p.os || 'Windows').toLowerCase();
  let platform = 'Windows NT 10.0; Win64; x64';
  if (os.includes('mac')) platform = 'Macintosh; Intel Mac OS X 10_15_7';
  else if (os.includes('linux')) platform = 'X11; Linux x86_64';
  else if (os.includes('android')) platform = 'Linux; Android 13; Pixel 7';
  // The launch engine uses the REAL Chrome binary matching browserVersion, so the
  // version shown here must follow browserVersion — NOT any stale stored userAgent
  // string (which the engine ignores). Prefer browserVersion; fall back to an
  // explicit custom UA only when no numeric version is set.
  // Chromium-family identity token, mirroring the launch engine. The Chromium
  // major stays the real binary's; only the vendor token differs.
  const brandTokens = (m) => {
    const b = String(p.browserBrand || '').toLowerCase();
    if (b.includes('edge')) return { infix: '', suffix: ` Edg/${m}.0.0.0` };
    if (b.includes('opera') || b === 'opr') return { infix: '', suffix: ` OPR/${Math.max(1, m - 14)}.0.0.0` };
    if (b.includes('yandex')) return { infix: ' YaBrowser/24.12.0.0 Yowser/2.5', suffix: '' };
    return { infix: '', suffix: '' }; // Chrome / Brave / Vivaldi present a stock Chrome UA
  };
  const major = String(p.browserVersion || '').trim();
  if (major && /^\d+$/.test(major)) {
    const t = brandTokens(Number(major));
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0${t.infix} Safari/537.36${t.suffix}`;
  }
  const explicit = String(p.userAgent || '').trim();
  if (explicit && /mozilla/i.test(explicit)) return explicit;
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/‹engine›.0.0.0 Safari/537.36`;
}

function Row({ label, value, mono, accent }) {
  return (
    <div className="flex gap-3 py-2 border-b border-border/50 last:border-b-0 text-sm">
      <div className="w-40 shrink-0 text-muted">{label}</div>
      <div className={`flex-1 break-all ${accent || 'text-foreground'} ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value ?? '—'}</div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/40">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</h3>
      </div>
      <div className="px-4 py-1">{children}</div>
    </div>
  );
}

function noise(t, flag, label) {
  return flag === false ? t('envOverview.noiseReal') : (label ? t('envOverview.noiseLabeled', { label }) : t('envOverview.noise'));
}

export default function EnvironmentOverviewModal({ profile, onClose }) {
  const { t } = useTranslation('cmpModalsB');
  const { dialogRef } = useDialog({ onClose });
  const p = profile || {};
  const proxy = p.proxy;
  const proxyText = proxy
    ? `${proxy.type} · ${proxy.host}:${proxy.port}${proxy.lastCountry ? ` · ${proxy.lastCountry}` : ''}`
    : (p.systemProxyBehavior === 'SYSTEM_PROXY' ? t('envOverview.systemProxy') : t('envOverview.directNoProxy'));
  const res = (p.resolutionType && p.resolutionType !== 'Real' && p.resolutionW)
    ? `${p.resolutionW} x ${p.resolutionH}` : t('envOverview.basedOnUserAgent');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('envOverview.dialogLabel')} tabIndex={-1} className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-1.5 rounded border border-primary/20"><Fingerprint className="w-5 h-5 text-primary" /></div>
            <div>
              <h2 className="text-foreground font-bold text-sm uppercase tracking-wide">{t('envOverview.title')}</h2>
              <p className="text-xs text-muted mt-0.5">{p.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground rounded hover:bg-muted-dark transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid gap-4 md:grid-cols-2">
          <Section icon={Globe} title={t('envOverview.sectionBrowser')}>
            <Row label={t('envOverview.rowBrowser')} value={`${p.browserCore || 'Chrome'}${p.browserVersion ? ` ${p.browserVersion}` : ''}`} />
            {p.browserBrand && /^(edge|brave|opera|vivaldi|yandex)/i.test(String(p.browserBrand)) && (
              <Row label={t('envOverview.rowIdentity')} value={t('envOverview.presentsAs', { brand: p.browserBrand })} />
            )}
            <Row label={t('envOverview.rowOs')} value={`${p.os || 'Windows'}${p.osVersion ? ` ${p.osVersion}` : ''}`} />
            <Row label={t('envOverview.rowUserAgent')} value={buildUa(p)} mono />
            <Row label={t('envOverview.rowUaMode')} value={(!p.userAgent || p.userAgent === 'Auto') ? t('envOverview.uaAuto') : t('envOverview.uaCustom')} />
          </Section>

          <Section icon={Network} title={t('envOverview.sectionProxy')}>
            <Row label={t('envOverview.rowProxy')} value={proxyText} />
            <Row label={t('envOverview.rowBehavior')} value={p.systemProxyBehavior} />
            <Row label={t('envOverview.rowWebrtc')} value={p.webrtc || t('envOverview.valForward')} />
            <Row label={t('envOverview.rowPortScan')} value={p.portScanProtection || t('envOverview.valEnable')} />
          </Section>

          <Section icon={Clock} title={t('envOverview.sectionLocale')}>
            <Row label={t('envOverview.rowTimezone')} value={p.timezoneType === 'Custom' ? p.timezoneCustom : (p.timezoneType || t('envOverview.basedOnIp'))} />
            <Row label={t('envOverview.rowLocation')} value={p.locationType === 'Custom' ? `${p.locationLat || '?'}, ${p.locationLng || '?'}` : (p.locationType || t('envOverview.basedOnIp'))} />
            <Row label={t('envOverview.rowLanguage')} value={p.languageType === 'Custom' ? p.languageCustom : (p.languageType || t('envOverview.basedOnIp'))} />
            <Row label={t('envOverview.rowDisplayLanguage')} value={p.displayLangType || t('envOverview.basedOnLanguage')} />
          </Section>

          <Section icon={Monitor} title={t('envOverview.sectionScreen')}>
            <Row label={t('envOverview.rowResolution')} value={res} />
            <Row label={t('envOverview.rowFonts')} value={p.fontsType || t('envOverview.valDefault')} />
            <Row label={t('envOverview.rowCanvas')} value={noise(t, p.canvasNoise)} accent={p.canvasNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowWebglImage')} value={noise(t, p.webglImageNoise)} accent={p.webglImageNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowAudioContext')} value={noise(t, p.audioContextNoise)} accent={p.audioContextNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowClientRects')} value={noise(t, p.clientRectsNoise)} accent={p.clientRectsNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowSpeechVoices')} value={noise(t, p.speechVoicesNoise)} accent={p.speechVoicesNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowMediaDevice')} value={p.mediaDevice || t('envOverview.valAuto')} />
          </Section>

          <Section icon={Cpu} title={t('envOverview.sectionHardware')}>
            <Row label={t('envOverview.rowWebglVendor')} value={p.webglVendor} />
            <Row label={t('envOverview.rowWebglRenderer')} value={p.webglRenderer} mono />
            <Row label={t('envOverview.rowWebgpu')} value={p.webgpu || t('envOverview.basedOnWebgl')} />
            <Row label={t('envOverview.rowCpuCores')} value={p.cpuCores ? t('envOverview.coresValue', { count: p.cpuCores }) : t('envOverview.valAuto')} />
            <Row label={t('envOverview.rowRam')} value={p.ramGb ? t('envOverview.gbValue', { gb: p.ramGb }) : t('envOverview.valAuto')} />
            <Row label={t('envOverview.rowDeviceMemory')} value={p.ramGb ? t('envOverview.deviceMemoryValue', { gb: Math.min(8, Number(p.ramGb) || 8) }) : t('envOverview.valAuto')} accent="text-muted" />
          </Section>

          <Section icon={ShieldCheck} title={t('envOverview.sectionDevice')}>
            <Row label={t('envOverview.rowDeviceName')} value={p.deviceName || t('envOverview.valAuto')} />
            <Row label={t('envOverview.rowMacAddress')} value={p.macAddress || t('envOverview.valAuto')} mono />
            <Row label={t('envOverview.rowDoNotTrack')} value={p.doNotTrack || t('envOverview.valDefault')} />
            <Row label={t('envOverview.rowHardwareAccel')} value={p.hardwareAcceleration || t('envOverview.valDefault')} />
            <Row label={t('envOverview.rowDisableTls')} value={p.disableTls || t('envOverview.valClose')} />
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-border bg-surface text-xs text-muted">
          {t('envOverview.footerValues')} <span className="text-muted-foreground">{t('envOverview.footerEngineNote')}</span>
        </div>
      </div>
    </div>
  );
}
