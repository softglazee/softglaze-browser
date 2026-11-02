// Dependency-free SVG area chart, themed by the --chart-* CSS variables.
import { useId } from 'react';

const AXIS = 'var(--muted-foreground)';
const GRID = 'color-mix(in srgb, var(--foreground) 7%, transparent)';

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
