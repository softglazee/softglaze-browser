import { useState } from 'react';
import { useDialog } from '@/lib/useDialog.js';

// In-app "enter a name" dialog. Electron returns null from window.prompt(), so any
// flow that used it silently did nothing. Same look and a11y wiring as the macro
// SaveRecordingModal (useDialog: Escape, focus trap, scroll lock). The caller passes
// already-translated strings so this stays namespace-agnostic.
export default function NameDialog({ title, label, initialValue = '', placeholder = '', saveLabel, cancelLabel, maxLength = 80, onSave, onClose }) {
  const [value, setValue] = useState(initialValue);
  const { dialogRef } = useDialog({ onClose });
  const trimmed = value.trim();
  const submit = () => { if (trimmed) onSave(trimmed); };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <div className="p-5">
          <label className="block text-[12px] text-muted-foreground mb-1.5" htmlFor="sg-name-dialog-input">{label}</label>
          <input
            id="sg-name-dialog-input"
            autoFocus
            value={value}
            maxLength={maxLength}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={placeholder}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg text-[12.5px] font-semibold border border-border text-foreground hover:bg-secondary">{cancelLabel}</button>
          <button type="button" onClick={submit} disabled={!trimmed} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 disabled:opacity-50">{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
