import React from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, X, Cpu, Monitor, Globe, ShieldCheck, Clock, Network } from 'lucide-react';
import { useDialog } from '@/lib/useDialog.js';
import { doNotTrackChoice } from '@/lib/doNotTrack.mjs';
import { webrtcMode, hardwareAccelerationChoice, chromeVersionPin, geolocationPermission, parseFontList, parseMediaCounts, webgpuChoice, webglSpoofed, webgpuInfoFromWebgl } from '@/lib/profileOptions.mjs';

// Build a representative User-Agent string from the profile's OS + version, so
// the overview shows what sites will see. Mirrors the launch engine's logic.
function buildUa(p) {
  const os = String(p.os || 'Windows').toLowerCase();
  let platform = 'Windows NT 10.0; Win64; x64';
  if (os.includes('mac')) platform = 'Macintosh; Intel Mac OS X 10_15_7';
  else if (os.includes('linux')) platform = 'X11; Linux x86_64';
  else if (os.includes('android')) platform = 'Linux; Android 13; Pixel 7';
  // A UA picked in the editor (userAgentMode "Custom") is what the launch applies. On Auto the engine
  // uses the launched Chrome's own version (a picked version, else whatever Auto opens), so the version
  // shows as ‹engine› unless one is picked. Brand tokens mirror the engine: the Chromium major stays real,
  // only the vendor token differs.
  if (p.userAgentMode === 'Custom' && p.userAgent && p.userAgent !== 'Auto') return String(p.userAgent);
  const brandTokens = (m) => {
    const b = String(p.browserBrand || '').toLowerCase();
    if (b.includes('edge')) return { infix: '', suffix: ` Edg/${m}.0.0.0` };
    if (b.includes('opera') || b === 'opr') return { infix: '', suffix: ` OPR/${Math.max(1, m - 14)}.0.0.0` };
    if (b.includes('yandex')) return { infix: ' YaBrowser/24.12.0.0 Yowser/2.5', suffix: '' };
    return { infix: '', suffix: '' }; // Chrome / Brave / Vivaldi present a stock Chrome UA
  };
  const major = chromeVersionPin(p.browserVersion);
  if (major) {
    const t = brandTokens(major);
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0${t.infix} Safari/537.36${t.suffix}`;
  }
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/‹engine›.0.0.0 Safari/537.36`;
}

function Row({ label, value, mono, accent, note }) {
  return (
    <div className="flex gap-3 py-2 border-b border-border/50 last:border-b-0 text-sm">
      <div className="w-40 shrink-0 text-muted">{label}</div>
      <div className="flex-1 min-w-0">
        <div className={`break-all ${accent || 'text-foreground'} ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value ?? '-'}</div>
        {note && <p className="mt-0.5 text-xs text-muted leading-snug">{note}</p>}
      </div>
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
  // What the launch does with each choice (src/main/profileOptions.js mirrors).
  const isFirefox = String(p.browserCore || '').toLowerCase() === 'firefox';
  const pin = chromeVersionPin(p.browserVersion);
  const versionText = isFirefox ? (p.browserVersion || '') : (pin ? `Chrome ${pin}` : t('envOverview.valAuto'));
  const uaText = isFirefox
    ? ((p.userAgentMode === 'Custom' && /firefox\//i.test(String(p.userAgent || ''))) ? p.userAgent : t('envOverview.uaFirefoxOwn'))
    : buildUa(p);
  const webrtcText = isFirefox ? t('envOverview.webrtcFirefoxOff') : webrtcMode(p.webrtc);
  const permission = geolocationPermission(p);
  const locationText = permission === 'denied' ? t('envOverview.locBlocked')
    : `${p.locationType === 'Custom' ? `${p.locationLat || '?'}, ${p.locationLng || '?'}` : (p.locationType || t('envOverview.basedOnIp'))} · ${t(`envOverview.locPerm_${permission}`)}`;
  const displayText = p.displayLangType === 'Custom' ? (p.displayLangCustom || '?')
    : (p.displayLangType === 'Real' ? t('envOverview.displayReal') : t('envOverview.basedOnLanguage'));
  const fontsText = String(p.fontsType || '') === 'Custom'
    ? t('envOverview.fontsCustom', { count: parseFontList(p.fontsList || []).length || t('envOverview.fontsOsStandard') })
    : (p.fontsType || t('envOverview.valDefault'));
  const mediaText = String(p.mediaDevice || '') === 'Edit' ? t('envOverview.mediaCounts', parseMediaCounts(p.mediaDeviceCounts)) : (p.mediaDevice || t('envOverview.valAuto'));
  const hostOs = (typeof window !== 'undefined' && window.softglaze && window.softglaze.hostOs) || 'Windows';
  const webgpuText = (() => {
    const choice = webgpuChoice(p.webgpu);
    if (choice !== 'Based on WebGL') return choice;
    const info = webglSpoofed(p, hostOs) ? webgpuInfoFromWebgl(p.webglVendor, p.webglRenderer) : null;
    return info ? `${t('envOverview.basedOnWebgl')} (${info.vendor}${info.architecture ? ` ${info.architecture}` : ''})` : t('envOverview.webgpuSameAsWebgl');
  })();
  const hw = hardwareAccelerationChoice(p.hardwareAcceleration);

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
            <Row label={t('envOverview.rowBrowser')} value={`${p.browserCore || 'Chromium'}${versionText ? ` ${versionText}` : ''}`} />
            {p.browserBrand && /^(edge|brave|opera|vivaldi|yandex)/i.test(String(p.browserBrand)) && (
              <Row label={t('envOverview.rowIdentity')} value={t('envOverview.presentsAs', { brand: p.browserBrand })} />
            )}
            <Row label={t('envOverview.rowOs')} value={`${p.os || 'Windows'}${p.osVersion ? ` ${p.osVersion}` : ''}`} />
            <Row label={t('envOverview.rowUserAgent')} value={uaText} mono />
            <Row label={t('envOverview.rowUaMode')} value={p.userAgentMode === 'Custom' ? t('envOverview.uaCustom') : t('envOverview.uaAuto')} />
          </Section>

          <Section icon={Network} title={t('envOverview.sectionProxy')}>
            <Row label={t('envOverview.rowProxy')} value={proxyText} />
            <Row label={t('envOverview.rowBehavior')} value={p.systemProxyBehavior} />
            <Row label={t('envOverview.rowWebrtc')} value={webrtcText} />
            <Row label={t('envOverview.rowPortScan')} value={p.portScanProtection || t('envOverview.valEnable')} />
          </Section>

          <Section icon={Clock} title={t('envOverview.sectionLocale')}>
            <Row label={t('envOverview.rowTimezone')} value={p.timezoneType === 'Custom' ? p.timezoneCustom : (p.timezoneType || t('envOverview.basedOnIp'))} />
            <Row label={t('envOverview.rowLocation')} value={locationText} />
            <Row label={t('envOverview.rowLanguage')} value={p.languageType === 'Custom' ? p.languageCustom : (p.languageType || t('envOverview.basedOnIp'))} />
            <Row label={t('envOverview.rowDisplayLanguage')} value={displayText} />
          </Section>

          <Section icon={Monitor} title={t('envOverview.sectionScreen')}>
            <Row label={t('envOverview.rowResolution')} value={res} />
            <Row label={t('envOverview.rowFonts')} value={fontsText} />
            {/* No green/amber here: on the standard engine 2D canvas is the same either way. */}
            <Row label={t('envOverview.rowCanvas')} value={noise(t, p.canvasNoise)} note={t('envOverview.canvasEngineNote')} />
            <Row label={t('envOverview.rowWebglImage')} value={noise(t, p.webglImageNoise)} accent={p.webglImageNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowAudioContext')} value={noise(t, p.audioContextNoise)} accent={p.audioContextNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowClientRects')} value={noise(t, p.clientRectsNoise)} accent={p.clientRectsNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowSpeechVoices')} value={noise(t, p.speechVoicesNoise)} accent={p.speechVoicesNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label={t('envOverview.rowMediaDevice')} value={mediaText} />
          </Section>

          <Section icon={Cpu} title={t('envOverview.sectionHardware')}>
            <Row label={t('envOverview.rowWebglVendor')} value={p.webglVendor} />
            <Row label={t('envOverview.rowWebglRenderer')} value={p.webglRenderer} mono />
            <Row label={t('envOverview.rowWebgpu')} value={webgpuText} />
            <Row label={t('envOverview.rowCpuCores')} value={p.cpuCores ? t('envOverview.coresValue', { count: p.cpuCores }) : t('envOverview.valAuto')} />
            <Row label={t('envOverview.rowRam')} value={p.ramGb ? t('envOverview.gbValue', { gb: p.ramGb }) : t('envOverview.valAuto')} />
            <Row label={t('envOverview.rowDeviceMemory')} value={p.ramGb ? t('envOverview.deviceMemoryValue', { gb: Math.min(8, Number(p.ramGb) || 8) }) : t('envOverview.valAuto')} accent="text-muted" />
          </Section>

          <Section icon={ShieldCheck} title={t('envOverview.sectionDevice')}>
            {/* No website can read either; Firefox profiles use the device name (see the editor's help). */}
            <Row label={t('envOverview.rowDeviceName')} value={p.deviceNameType === 'Real' ? t('envOverview.noiseReal') : (p.deviceName || '-')} note={t('envOverview.deviceNameNote')} />
            <Row label={t('envOverview.rowMacAddress')} value={p.macAddressType === 'Real' ? t('envOverview.noiseReal') : (p.macAddress || '-')} mono note={t('envOverview.macNote')} />
            <Row label={t('envOverview.rowDoNotTrack')} value={doNotTrackChoice(p.doNotTrack) === 'Default' ? t('envOverview.valDefault') : doNotTrackChoice(p.doNotTrack)} />
            <Row label={t('envOverview.rowHardwareAccel')} value={t(`envOverview.hw${hw}`)} />
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
