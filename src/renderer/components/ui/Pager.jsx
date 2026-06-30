import React from 'react';
import Button from '@/components/ui/Button.jsx';

// Universal pagination bar: "Showing X–Y of Z" + an Items-per-page selector
// (25 / 50 / 100 / All) + Prev/Next. `pageSize` is a finite number, or Infinity
// for "All"; `onPageSizeChange` is called with a number or Infinity.
const PAGE_SIZES = [25, 50, 100];

export default function Pager({ total, page, pageSize, onPageChange, onPageSizeChange, className = '' }) {
  const all = !Number.isFinite(pageSize);
  const pageCount = all ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (all ? 1 : (safePage - 1) * pageSize + 1);
  const to = all ? total : Math.min(safePage * pageSize, total);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12px] text-muted-foreground ${className}`}>
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Per page</span>
          <select
            value={all ? 'all' : String(pageSize)}
            onChange={(e) => onPageSizeChange(e.target.value === 'all' ? Infinity : Number(e.target.value))}
            className="h-7 rounded-md border border-border bg-card px-1.5 text-[12px] text-foreground outline-none focus:border-primary cursor-pointer"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="all">All</option>
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => onPageChange(Math.max(1, safePage - 1))} disabled={all || safePage <= 1} className="px-2.5">Prev</Button>
          <span className="px-1 tabular-nums">Page {safePage} / {pageCount}</span>
          <Button size="sm" variant="ghost" onClick={() => onPageChange(Math.min(pageCount, safePage + 1))} disabled={all || safePage >= pageCount} className="px-2.5">Next</Button>
        </div>
      </div>
    </div>
  );
}
