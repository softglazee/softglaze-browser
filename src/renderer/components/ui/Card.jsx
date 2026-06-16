import { cn } from '@/lib/utils.js';

export function Card({ className, ...props }) {
  return <section className={cn('rounded-xl border border-slate-800 bg-slate-950/75 shadow-2xl shadow-black/20 backdrop-blur', className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('border-b border-slate-800 p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h2 className={cn('text-base font-semibold text-slate-50', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('mt-1 text-sm text-slate-400', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-5', className)} {...props} />;
}
