// Clean, dependency-free SVG chart kit for the Dashboard.
//
// Zero install (no recharts/d3) and strictly on-brand: every colour is a design
// token (var(--chart-1..5), var(--success|warning|destructive), var(--foreground),
// var(--muted-foreground), var(--border), var(--elevated)) so the charts re-theme
// with the app in BOTH light and dark. No decorative gradients, no glow/blur -
// the only gradient is a functional area fade under a line (standard data-viz).
// Each chart carries an accessible role="img" + aria-label summary.
import { useId } from 'react';

const GRID = 'color-mix(in srgb, var(--foreground) 9%, transparent)';
const AXIS = 'var(--muted-foreground)';

// ---- Sparkline: line + subtle functional area fill ----------------------
export function Sparkline({ data = [], color = 'var(--chart-1)', height = 150, labels = [], ariaLabel }) {
  const gid = useId().replace(/:/g, '');
  const vals = data.length ? data : [0];
  const W = 600, H = height, padT = 10, padB = labels.length ? 20 : 8, padL = 6, padR = 6;
  const innerH = H - padT - padB, innerW = W - padL - padR;
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const span = max - min || 1;
  const n = vals.length;
  const xAt = (i) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => padT + innerH - ((v - min) / span) * innerH;
  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const area = `${line} L${xAt(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${xAt(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const grid = [0, 0.5, 1].map((t) => padT + t * innerH);
  const step = Math.ceil(n / 7) || 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {grid.map((y, i) => <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth="1" />)}
      <path d={area} fill={`url(#spark-${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      {n <= 14 && vals.map((v, i) => <circle key={i} cx={xAt(i)} cy={yAt(v)} r="2.25" fill={color} />)}
      {labels.length > 0 && vals.map((v, i) => (i % step === 0) && (
        <text key={`l${i}`} x={xAt(i)} y={H - 6} fontSize="11" fill={AXIS} textAnchor="middle" style={{ fontFamily: 'var(--font-mono)' }}>{labels[i]}</text>
      ))}
    </svg>
  );
}

// ---- Vertical bars (e.g. a 7-day series) --------------------------------
export function Bars({ data = [], labels = [], color = 'var(--chart-1)', height = 150, ariaLabel, formatValue }) {
  const vals = data.length ? data : [0];
  const W = 600, H = height, padT = 12, padB = labels.length ? 22 : 8, padL = 6, padR = 6;
  const innerH = H - padT - padB, innerW = W - padL - padR;
  const max = Math.max(1, ...vals);
  const n = vals.length;
  const slot = innerW / n;
  const bw = Math.min(46, slot * 0.6);
  const grid = [0, 0.5, 1].map((t) => padT + t * innerH);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
      {grid.map((y, i) => <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth="1" />)}
      {vals.map((v, i) => {
        const h = (v / max) * innerH;
        const x = padL + i * slot + (slot - bw) / 2;
        const y = padT + innerH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(2, h)} rx="4" fill={color} opacity={v === 0 ? 0.25 : 1}>
              <title>{`${labels[i] || i}: ${formatValue ? formatValue(v) : v}`}</title>
            </rect>
            {labels.length > 0 && <text x={x + bw / 2} y={H - 7} fontSize="11" fill={AXIS} textAnchor="middle" style={{ fontFamily: 'var(--font-mono)' }}>{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ---- Donut: proportional segments + centre label ------------------------
export function Donut({ segments = [], size = 160, thickness = 20, centerLabel, centerSub, ariaLabel }) {
  const total = segments.reduce((s, d) => s + (d.value || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2, cy = size / 2;
  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--elevated)" strokeWidth={thickness} />
        {total > 0 && segments.map((d, i) => {
          const frac = (d.value || 0) / total;
          const dash = frac * c;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} strokeLinecap="butt" />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-bold leading-none text-foreground">{centerLabel ?? total}</span>
        {centerSub && <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{centerSub}</span>}
      </div>
    </div>
  );
}

export function Legend({ items = [], total }) {
  return (
    <ul className="space-y-2">
      {items.map((d) => (
        <li key={d.label} className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden="true" />
          <span className="flex-1 truncate text-muted-foreground">{d.label}</span>
          <span className="font-semibold text-foreground tabular-nums">{d.value}</span>
          {total > 0 && <span className="w-9 text-right text-muted-foreground tabular-nums">{Math.round((d.value / total) * 100)}%</span>}
        </li>
      ))}
    </ul>
  );
}

// ---- Horizontal bars (e.g. top countries) -------------------------------
export function HBars({ rows = [], color = 'var(--chart-1)', ariaLabel, emptyLabel }) {
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2.5" role="img" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[4.75rem_1fr_1.75rem] items-center gap-2.5">
          <span className="truncate text-[11px] font-medium text-foreground" title={r.title || r.label}>{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-elevated">
            <span className="block h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${((r.value || 0) / max) * 100}%`, background: r.color || color }} />
          </span>
          <span className="text-right text-xs font-semibold tabular-nums text-foreground">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- Progress meter (solid fill, token colour) --------------------------
export function Meter({ label, value = 0, color = 'var(--chart-1)', suffix = '%', caption }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{Math.round(value)}{suffix}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: color }} />
      </div>
      {caption && <p className="mt-1 text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}
