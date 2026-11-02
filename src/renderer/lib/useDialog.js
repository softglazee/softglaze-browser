import { useEffect, useRef } from 'react';

// Adds modal a11y to an existing hand-rolled modal: put dialogRef on the panel (role="dialog",
// aria-modal, aria-label, tabIndex -1). Escape closes, Tab is trapped, focus moves in and is
// restored, body scroll locks. Backdrop clicks stay with the modal's own overlay.
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialog({ onClose, closeOnEscape = true } = {}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = dialogRef.current;
    const prevActive = document.activeElement;

    const focusables = () => {
      if (!node) return [];
      return Array.from(node.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
    };

    // Move focus in - but respect an input that already auto-focused on mount.
    if (node && !node.contains(document.activeElement)) {
      const f = focusables();
      (f[0] || node).focus({ preventScroll: true });
    }

    function onKey(e) {
      if (e.key === 'Escape' && closeOnEscape) { e.stopPropagation(); if (onCloseRef.current) onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = focusables();
      if (!items.length) { e.preventDefault(); node.focus({ preventScroll: true }); return; }
      const idx = items.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      } else if (idx === items.length - 1 || idx === -1) {
        e.preventDefault(); items[0].focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      try { if (prevActive && typeof prevActive.focus === 'function') prevActive.focus({ preventScroll: true }); } catch (e) { /* element gone */ }
    };
  }, [closeOnEscape]);

  return { dialogRef };
}
