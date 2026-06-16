import React from 'react';
import { cn } from '@/lib/utils.js';

const variants = {
  default: 'bg-slate-100 text-slate-950 hover:bg-white border border-slate-200 shadow-sm',
  secondary: 'bg-slate-900 text-slate-100 hover:bg-slate-800 border border-slate-700',
  ghost: 'bg-transparent text-slate-300 hover:bg-slate-900 hover:text-white border border-transparent',
  outline: 'bg-transparent text-slate-100 hover:bg-slate-900 border border-slate-700',
  destructive: 'bg-red-600 text-white hover:bg-red-500 border border-red-500'
};

const sizes = { sm: 'h-8 px-3 text-xs', default: 'h-10 px-4 text-sm', lg: 'h-11 px-5 text-sm' };

const Button = React.forwardRef(({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
      'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
      variants[variant],
      sizes[size],
      className
    )}
    {...props}
  />
));

Button.displayName = 'Button';
export default Button;
