import { NavLink } from 'react-router-dom';
import { Database, FileSpreadsheet, Globe2, Layers3, Settings, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const navItems = [
  { label: 'Profiles', to: '/profiles', icon: Layers3 },
  { label: 'Proxy Pool', to: '/proxies', icon: Globe2 },
  { label: 'Batch Import', to: '/batch-import', icon: FileSpreadsheet },
  { label: 'Settings', to: '/settings', icon: Settings }
];

export default function AppShell({ children }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950/90">
        <div className="flex h-20 items-center gap-3 border-b border-slate-800 px-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900">
            <ShieldCheck className="h-5 w-5 text-slate-100" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide text-white">SoftGlaze Browser</div>
            <div className="text-xs text-slate-500">Local profile manager</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-slate-100 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-900 hover:text-white')}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Database className="h-4 w-4" />
              Local-first storage
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">Profiles, proxies, notes, and imports are stored locally through SQLite.</p>
          </div>
        </div>
      </aside>

      <main className="h-full min-w-0 flex-1 overflow-y-auto">
        <div className="w-full p-6">{children}</div>
      </main>
    </div>
  );
}
