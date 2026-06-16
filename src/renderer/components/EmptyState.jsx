import { Inbox } from 'lucide-react';

export default function EmptyState({ title = 'No records found', description }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/60 p-10 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 bg-slate-900">
        <Inbox className="h-5 w-5 text-slate-400" />
      </div>
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p> : null}
    </div>
  );
}
