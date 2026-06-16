export default function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow ? <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
