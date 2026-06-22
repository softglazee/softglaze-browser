import React from 'react';
import { Fingerprint, X, Cpu, MemoryStick, Monitor, Globe, ShieldCheck, Languages, Clock, MapPin, Network } from 'lucide-react';

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

function noise(flag, label) {
  return flag === false ? 'Real' : `Noise${label ? ` [${label}]` : ''}`;
}

export default function EnvironmentOverviewModal({ profile, onClose }) {
  const p = profile || {};
  const proxy = p.proxy;
  const proxyText = proxy
    ? `${proxy.type} · ${proxy.host}:${proxy.port}${proxy.lastCountry ? ` · ${proxy.lastCountry}` : ''}`
    : (p.systemProxyBehavior === 'SYSTEM_PROXY' ? 'System proxy' : 'Direct (no proxy)');
  const res = (p.resolutionType && p.resolutionType !== 'Real' && p.resolutionW)
    ? `${p.resolutionW} x ${p.resolutionH}` : 'Based on User-Agent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-1.5 rounded border border-primary/20"><Fingerprint className="w-5 h-5 text-primary" /></div>
            <div>
              <h2 className="text-foreground font-bold text-sm uppercase tracking-wide">Environment Overview</h2>
              <p className="text-xs text-muted mt-0.5">{p.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground rounded hover:bg-muted-dark transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid gap-4 md:grid-cols-2">
          <Section icon={Globe} title="Browser">
            <Row label="Browser" value={`${p.browserCore || 'Chrome'}${p.browserVersion ? ` ${p.browserVersion}` : ''}`} />
            {p.browserBrand && /^(edge|brave|opera|vivaldi|yandex)/i.test(String(p.browserBrand)) && (
              <Row label="Identity" value={`Presents as ${p.browserBrand}`} />
            )}
            <Row label="OS" value={`${p.os || 'Windows'}${p.osVersion ? ` ${p.osVersion}` : ''}`} />
            <Row label="User-Agent" value={buildUa(p)} mono />
            <Row label="UA mode" value={(!p.userAgent || p.userAgent === 'Auto') ? 'Auto (matches engine)' : 'Custom'} />
          </Section>

          <Section icon={Network} title="Proxy / Network">
            <Row label="Proxy" value={proxyText} />
            <Row label="Behavior" value={p.systemProxyBehavior} />
            <Row label="WebRTC" value={p.webrtc || 'Forward'} />
            <Row label="Port scan protection" value={p.portScanProtection || 'Enable'} />
          </Section>

          <Section icon={Clock} title="Locale">
            <Row label="Timezone" value={p.timezoneType === 'Custom' ? p.timezoneCustom : (p.timezoneType || 'Based on IP')} />
            <Row label="Location" value={p.locationType === 'Custom' ? `${p.locationLat || '?'}, ${p.locationLng || '?'}` : (p.locationType || 'Based on IP')} />
            <Row label="Language" value={p.languageType === 'Custom' ? p.languageCustom : (p.languageType || 'Based on IP')} />
            <Row label="Display language" value={p.displayLangType || 'Based on Language'} />
          </Section>

          <Section icon={Monitor} title="Screen & Fonts">
            <Row label="Resolution" value={res} />
            <Row label="Fonts" value={p.fontsType || 'Default'} />
            <Row label="Canvas" value={noise(p.canvasNoise)} accent={p.canvasNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label="WebGL image" value={noise(p.webglImageNoise)} accent={p.webglImageNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label="AudioContext" value={noise(p.audioContextNoise)} accent={p.audioContextNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label="ClientRects" value={noise(p.clientRectsNoise)} accent={p.clientRectsNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label="SpeechVoices" value={noise(p.speechVoicesNoise)} accent={p.speechVoicesNoise === false ? 'text-amber-400' : 'text-emerald-400'} />
            <Row label="Media device" value={p.mediaDevice || 'Auto'} />
          </Section>

          <Section icon={Cpu} title="Hardware">
            <Row label="WebGL vendor" value={p.webglVendor} />
            <Row label="WebGL renderer" value={p.webglRenderer} mono />
            <Row label="WebGPU" value={p.webgpu || 'Based on WebGL'} />
            <Row label="CPU cores" value={p.cpuCores ? `${p.cpuCores} cores` : 'Auto'} />
            <Row label="RAM" value={p.ramGb ? `${p.ramGb} GB` : 'Auto'} />
            <Row label="Device memory" value={p.ramGb ? `${Math.min(8, Number(p.ramGb) || 8)} GB — what sites see (Chrome caps navigator.deviceMemory at 8)` : 'Auto'} accent="text-muted" />
          </Section>

          <Section icon={ShieldCheck} title="Device & Privacy">
            <Row label="Device name" value={p.deviceName || 'Auto'} />
            <Row label="MAC address" value={p.macAddress || 'Auto'} mono />
            <Row label="Do Not Track" value={p.doNotTrack || 'Default'} />
            <Row label="Hardware accel." value={p.hardwareAcceleration || 'Default'} />
            <Row label="Disable TLS features" value={p.disableTls || 'Close'} />
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-border bg-surface text-xs text-muted">
          Values reflect the profile configuration. <span className="text-muted-foreground">User-Agent “‹engine›” means the version follows the bundled Chromium for fingerprint consistency.</span>
        </div>
      </div>
    </div>
  );
}
