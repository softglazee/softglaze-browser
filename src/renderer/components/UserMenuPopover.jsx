import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Check, UserCog, Users, Lock, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Account / member-switcher popover for the sidebar user button.
//
// Positioning: fixed to the viewport and computed from the anchor button's rect
// so it opens directly ABOVE the user button (aligned to the sidebar), never
// over the Dark-mode toggle. When there isn't enough room above (short windows),
// it falls back to a centered sheet/dialog. Being `position: fixed` it is never
// clipped by the sidebar's overflow. All actions are owned by AppShell and passed
// in as callbacks — this component only handles layout, polish and close affordances.
const PANEL_W = 276;
const GAP = 10;          // gap between the button and the popover
const MIN_ROOM_ABOVE = 280; // below this, use the centered sheet instead

export default function UserMenuPopover({
  open, onClose, anchorRef,
  me, members, roleLabel, vault,
  onSwitch, pinFor, pin, setPin, pwFor, pw, setPw, err,
  onLock, onLogout, onAccount, onManageMembers,
}) {
  const { t } = useTranslation();
  const panelRef = useRef(null);
  const [layout, setLayout] = useState(null); // { mode: 'popover' | 'sheet', style? }

  // Measure the anchor and decide popover-above vs centered sheet.
  useLayoutEffect(() => {
    if (!open) return undefined;
    function compute() {
      const el = anchorRef?.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!el) { setLayout({ mode: 'sheet' }); return; }
      const r = el.getBoundingClientRect();
      const roomAbove = r.top - 16;
      if (roomAbove < MIN_ROOM_ABOVE || vh < 420) { setLayout({ mode: 'sheet' }); return; }
      const width = Math.min(PANEL_W, vw - 24);
      const left = Math.max(12, Math.min(r.left, vw - width - 12));
      setLayout({
        mode: 'popover',
        style: {
          position: 'fixed',
          left,
          bottom: vh - r.top + GAP, // anchor the panel's bottom just above the button
          width,
          maxHeight: roomAbove,
          transformOrigin: 'bottom left',
        },
      });
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, anchorRef]);

  // Escape closes (outside-click is handled by AppShell's document listener).
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus into the panel for keyboard users, unless a PIN/password input
  // has already auto-focused.
  useEffect(() => {
    if (open && panelRef.current && !panelRef.current.querySelector('input:focus')) {
      panelRef.current.focus();
    }
  }, [open, layout?.mode]);

  if (!open || !layout) return null;
  const sheet = layout.mode === 'sheet';

  const rowBtn = 'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left text-[12.5px] transition-colors';

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={sheet ? 'true' : 'false'}
      aria-label={t('shell.accountMenu', { defaultValue: 'Account menu' })}
      tabIndex={-1}
      className={`z-[60] flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl shadow-black/20 outline-none animate-scale-in ${sheet ? 'w-full max-w-sm max-h-[85vh]' : ''}`}
      style={sheet ? undefined : layout.style}
    >
      {/* Header: avatar, name, role, close */}
      <div className="flex items-center gap-3 px-3.5 py-3 border-b border-border shrink-0">
        <span
          className="w-9 h-9 rounded-full grid place-items-center font-semibold text-[12px] shrink-0"
          style={{ background: me?.color ? me.color + '22' : 'color-mix(in srgb, var(--accent) 22%, transparent)', color: me?.color || 'var(--accent)' }}
        >{me?.initials || 'SG'}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-foreground leading-tight truncate">{me?.name || t('shell.localWorkspace')}</span>
          <span className="block text-[11px] text-muted-foreground truncate">{roleLabel(me?.role)}</span>
        </span>
        <button
          onClick={onClose}
          aria-label={t('shell.close', { defaultValue: 'Close' })}
          className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        ><X className="w-4 h-4" strokeWidth={2} /></button>
      </div>

      {/* Member switcher */}
      <div className="px-3.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 shrink-0">{t('shell.switchMember')}</div>
      <div className="px-1.5 overflow-y-auto flex-1 min-h-0">
        {members.length === 0 && <div className="px-2 py-2 text-[12px] text-muted-foreground">{t('shell.noMembersYet')}</div>}
        {members.map((m) => (
          <div key={m.id}>
            <button onClick={() => onSwitch(m)} className={`${rowBtn} hover:bg-secondary`}>
              <span className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-semibold shrink-0" style={{ background: (m.color || '#6366f1') + '22', color: m.color || '#6366f1' }}>{m.initials}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] truncate text-foreground">{m.name}</span>
                <span className="block text-[10.5px] text-muted-foreground truncate">{roleLabel(m.role)}</span>
              </span>
              {m.isCurrent && <Check className="w-4 h-4 text-primary shrink-0" />}
            </button>
            {pinFor === m.id && pwFor !== m.id && (
              <div className="px-2 pb-2 flex items-center gap-2">
                <input type="password" value={pin} autoFocus onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSwitch(m); }} placeholder={t('shell.pin')} className="flex-1 h-8 bg-input-background border border-border rounded-md px-2 text-[12px] text-foreground outline-none focus:border-primary" />
                <button onClick={() => onSwitch(m)} className="h-8 px-3 rounded-md bg-primary hover:bg-primary-hover text-primary-foreground text-[12px] font-semibold">{t('shell.go')}</button>
              </div>
            )}
            {pwFor === m.id && (
              <div className="px-2 pb-2 flex items-center gap-2">
                <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSwitch(m); }} placeholder={t('shell.memberPasswordPlaceholder', { name: m.name })} className="flex-1 h-8 bg-input-background border border-border rounded-md px-2 text-[12px] text-foreground outline-none focus:border-primary" />
                <button onClick={() => onSwitch(m)} className="h-8 px-3 rounded-md bg-primary hover:bg-primary-hover text-primary-foreground text-[12px] font-semibold">{t('shell.go')}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {err && <div className="px-3.5 py-1.5 text-[11px] text-destructive shrink-0">{err}</div>}

      {/* Account actions */}
      <div className="border-t border-border p-1.5 shrink-0">
        <button onClick={onAccount} className={`${rowBtn} text-muted-foreground hover:bg-secondary hover:text-foreground`}><UserCog className="w-4 h-4 shrink-0" />{t('shell.accountSettings')}</button>
        <button onClick={onManageMembers} className={`${rowBtn} text-muted-foreground hover:bg-secondary hover:text-foreground`}><Users className="w-4 h-4 shrink-0" />{t('shell.manageMembers')}</button>
        {vault?.enabled && <button onClick={onLock} className={`${rowBtn} text-muted-foreground hover:bg-secondary hover:text-foreground`}><Lock className="w-4 h-4 shrink-0" />{t('shell.lockWorkspace')}</button>}
      </div>
      <div className="border-t border-border p-1.5 shrink-0">
        <button onClick={onLogout} className={`${rowBtn} text-destructive hover:bg-destructive/10`}><LogOut className="w-4 h-4 shrink-0" />{t('shell.logOut')}</button>
      </div>
    </div>
  );

  if (!sheet) return panel;

  // Short windows: a centered (bottom on phones) sheet with its own backdrop.
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 bg-black/40 animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {panel}
    </div>
  );
}
