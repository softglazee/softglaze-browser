import { useEffect, useRef, useState } from 'react';
import { clampNumber } from '@/lib/uiGuards.mjs';

// <input type="number"> that keeps the raw text while the user types and only clamps and
// commits on blur (or Enter). Clamping on every keystroke made values impossible to type:
// clearing "30" to type "45" snapped to the fallback, and "1" in a min-3 field jumped to 3.
export default function NumberInput({ value, min, max, fallback, onCommit, onKeyDown, ...rest }) {
  const [raw, setRaw] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  // Follow outside changes (a reload, a preset) while the field is not being edited.
  useEffect(() => { if (!focused.current) setRaw(value == null ? '' : String(value)); }, [value]);

  function commit() {
    focused.current = false;
    const n = clampNumber(raw, {
      min: min == null ? -Infinity : Number(min),
      max: max == null ? Infinity : Number(max),
      fallback: fallback == null ? Number(value) || 0 : fallback
    });
    setRaw(String(n));
    if (n !== Number(value)) onCommit(n);
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={raw}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (onKeyDown) onKeyDown(e); }}
      {...rest}
    />
  );
}
