import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { fmtDate, fmtDateTime } from './intl.mjs';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Dates follow the app language (lib/intl.mjs), not the OS locale.
export function formatDate(value) {
  if (!value) return '-';
  const out = fmtDate(value, null);
  return out == null ? String(value) : out;
}

export function formatDateTime(value) {
  if (!value) return '-';
  const out = fmtDateTime(value, null);
  return out == null ? String(value) : out;
}
