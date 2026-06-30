import React from 'react';

// Shadcn-style toggle switch (no external dependency). Controlled:
//   <Switch checked={bool} onChange={(next) => …} />
// `onChange` receives the NEXT boolean value.
export default function Switch({ checked, onChange, disabled = false, label, className = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={{ background: checked ? 'var(--primary)' : 'var(--switch-background, var(--border))' }}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
