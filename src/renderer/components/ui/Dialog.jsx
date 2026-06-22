import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title = 'Dialog', ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl shadow-black/40 focus:outline-none',
          className
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn('border-b border-border p-5 pr-12', className)} {...props} />;
}
export function DialogTitle({ className, ...props }) {
  return <h2 className={cn('text-base font-semibold text-foreground', className)} {...props} />;
}
export function DialogDescription({ className, ...props }) {
  return <p className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />;
}
export function DialogBody({ className, ...props }) {
  return <div className={cn('p-5', className)} {...props} />;
}
export function DialogFooter({ className, ...props }) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-border p-5', className)} {...props} />;
}
