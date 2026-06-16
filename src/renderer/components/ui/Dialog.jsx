import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title = 'Dialog', ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2',
          'rounded-xl border border-slate-800 bg-slate-950 p-0 text-slate-50 shadow-2xl shadow-black/40 focus:outline-none',
          className
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-slate-400 transition hover:bg-slate-900 hover:text-white">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn('border-b border-slate-800 p-5 pr-12', className)} {...props} />;
}
export function DialogTitle({ className, ...props }) {
  return <h2 className={cn('text-base font-semibold text-slate-50', className)} {...props} />;
}
export function DialogDescription({ className, ...props }) {
  return <p className={cn('mt-1 text-sm text-slate-400', className)} {...props} />;
}
export function DialogBody({ className, ...props }) {
  return <div className={cn('p-5', className)} {...props} />;
}
export function DialogFooter({ className, ...props }) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-slate-800 p-5', className)} {...props} />;
}
