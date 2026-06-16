import { cn } from '@/lib/utils.js';

const variants = {
  default: 'border-slate-700 bg-slate-900 text-slate-200',
  green: 'border-emerald-700/60 bg-emerald-950/60 text-emerald-300',
  amber: 'border-amber-700/60 bg-amber-950/60 text-amber-300',
  red: 'border-red-700/60 bg-red-950/60 text-red-300',
  blue: 'border-blue-700/60 bg-blue-950/60 text-blue-300'
};

export default function Badge({ className, variant = 'default', ...props }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', variants[variant], className)} {...props} />;
}
