import { useId } from 'react';
import Button from '@/components/ui/Button.jsx';

// A Button the current member may not use is shown disabled, with the reason (which role it needs,
// or that it was turned off for them) as a tooltip. A disabled Button has no pointer events, so the
// tooltip sits on a wrapper; screen readers get the reason through aria-describedby.
// `deny`: the reason from usePermissions(), or null/undefined when the action is allowed.
export default function GuardedButton({ deny, children, ...props }) {
  const id = useId();
  if (!deny) return <Button {...props}>{children}</Button>;
  const { onClick, ...rest } = props; // never fires while denied
  // `relative`: the sr-only reason is absolutely positioned; without a positioned wrapper it escapes a
  // scrolling table and widens the whole page on a narrow window.
  return (
    <span className="relative inline-flex" title={deny}>
      <Button {...rest} disabled aria-describedby={id}>{children}</Button>
      <span id={id} className="sr-only">{deny}</span>
    </span>
  );
}

// The same tooltip for any other control (a plain button, a select, an input). The caller disables
// the control itself when `deny` is set.
export function DenyTip({ deny, className = 'inline-flex', children }) {
  if (!deny) return children;
  return <span className={className} title={deny}>{children}</span>;
}
