import { Gift, X } from 'lucide-react';

// The seasonal offer banner picked by lib/promoBanner.mjs. Same place and shape as the licence notice:
// a block in the page flow above the scrolling content, never over it. The link opens the website in
// the default browser (main.js setWindowOpenHandler sends target=_blank links to shell.openExternal).
export default function PromoBanner({ promo, onDismiss }) {
  if (!promo) return null;
  return (
    <div
      role="status"
      data-promo={promo.id}
      className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 sm:px-7 py-2.5 bg-primary/10 border-primary/30 text-foreground"
    >
      <Gift className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="text-[12.5px] flex-1 min-w-[12rem]">{promo.text}</span>
      <a
        href={promo.url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-[12px] font-semibold px-3 py-1 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow shadow-blue-500/25"
      >
        {promo.cta}
      </a>
      <button type="button" onClick={onDismiss} className="shrink-0 opacity-80 hover:opacity-100" title={promo.dismiss} aria-label={promo.dismiss}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
