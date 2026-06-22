import React from 'react';
import { cn } from '@/lib/utils.js';

const Textarea = React.forwardRef(({ className, rows = 5, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(
      'w-full resize-y rounded-md border border-border bg-input-background px-3 py-2 text-sm text-foreground',
      'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
));

Textarea.displayName = 'Textarea';
export default Textarea;
