// Dependency-free SVG chart kit, styled to the SoftGlaze Figma design.
// No recharts/d3 — pure SVG so it ships with zero install and themes via the
// CSS variables (--chart-1..5, --border, --muted-foreground, --foreground).
import { useId } from 'react';

const AXIS = 'var(--muted-foreground)';
const GRID = 'color-mix(in srgb, var(--foreground) 7%, transparent)';

// ---- Area chart (gradient fill + smooth line) ---------------------------
export function AreaChart({ data = [], color = 'var(--chart-1)', height = 200, showAxis = true }) {
  const gid = useId().replace(/:/g, '');
  const W = 600, H = height, padL = showAxis ? 30 : 6, padR = 8, padT = 10, padB = showAxis ? 22 : 8;
  const pts = data.length ? data : [{ x: '', y: 0 }];
  const max = Math.max(1, ...pts.map((p) => p.y));
  const min = Math.min(0, ...pts.map((p) => p.y));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xAt = (i) => padL + (pts.length <= 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const yAt = (v) => padT + innerH - ((v - min) / (max - min || 1)) * innerH;

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${xAt(pts.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${xAt(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => padT + t * innerH);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridLines.map((y, i) => <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth="1" />)}
      {showAxis && pts.map((p, i) => (i % Math.ceil(pts.length / 7 || 1) === 0) && (
        <text key={i} x={xAt(i)} y={H - 6} fontSize="10" fill={AXIS} textAnchor="middle">{p.x}</text>
      ))}
      <path d={area} fill={`url(#area-${gid})`} className="animate-fade-in" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 5px color-mix(in srgb, ${color} 45%, transparent))` }} />
      {pts.length <= 12 && pts.map((p, i) => <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r="2.5" fill={color} />)}
    </svg>
  );
}

// ---- Donut (segments + center label) ------------------------------------
export function Donut({ data = [], size = 168, thickness = 22, centerLabel, centerSub }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const cx = size / 2, cy = size / 2;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--elevated)" strokeWidth={thickness} />
        {total > 0 && data.map((d, i) => {
          const frac = (d.value || 0) / total;
          const dash = frac * c;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset}
              className="transition-all duration-700 ease-out" />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center -rotate-0">
        <span className="text-2xl font-bold text-foreground font-mono leading-none">{centerLabel ?? total}</span>
        {centerSub && <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{centerSub}</span>}
      </div>
    </div>
  );
}

export function Legend({ data = [] }) {
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2 text-xs">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
          <span className="flex-1 text-muted-foreground truncate">{d.label}</span>
          <span className="font-semibold text-foreground">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Grouped vertical bars ----------------------------------------------
export function GroupedBars({ data = [], keys = [], height = 170 }) {
  const W = 480, H = height, padL = 28, padR = 6, padT = 10, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => d[k.key] || 0)));
  const groupW = innerW / (data.length || 1);
  const barW = Math.min(18, (groupW - 8) / (keys.length || 1));
  const gridLines = [0, 0.5, 1].map((t) => padT + t * innerH);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {gridLines.map((y, i) => <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth="1" />)}
      {data.map((d, gi) => {
        const gx = padL + gi * groupW + (groupW - barW * keys.length) / 2;
        return (
          <g key={gi}>
            {keys.map((k, ki) => {
              const v = d[k.key] || 0;
              const h = (v / max) * innerH;
              const x = gx + ki * barW;
              const y = padT + innerH - h;
              return <rect key={k.key} x={x} y={y} width={barW - 3} height={Math.max(1, h)} rx="3" fill={k.color}
                className="transition-all duration-700 ease-out"><title>{`${d.label} ${k.label}: ${v}`}</title></rect>;
            })}
            <text x={gx + (barW * keys.length) / 2} y={H - 8} fontSize="10" fill={AXIS} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---- Animated progress meter --------------------------------------------
export function ProgressMeter({ label, value, max = 100, color = 'var(--chart-1)', suffix = '%' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-bold" style={{ color }}>{value}{suffix}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-elevated">
        <div className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 60%, transparent), ${color})` }} />
      </div>
    </div>
  );
}
