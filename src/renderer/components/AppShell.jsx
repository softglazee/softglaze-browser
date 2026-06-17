import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Globe, Settings, Monitor, FileSpreadsheet, Puzzle, FolderHeart, Trash2 } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/profiles', label: 'Profiles', icon: Monitor },
  { path: '/groups', label: 'Groups', icon: FolderHeart },
  { path: '/proxies', label: 'Proxy Pool', icon: Globe },
  { path: '/extensions', label: 'Extensions', icon: Puzzle },
  { path: '/batch-import', label: 'Batch Import', icon: FileSpreadsheet },
  { path: '/trash', label: 'Trash', icon: Trash2 },
  { path: '/settings', label: 'Global Settings', icon: Settings },
];

export default function AppShell({ children }) {
  const location = useLocation();

  return (
    <div className="flex h-screen w-full bg-background text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-border flex flex-col shrink-0 relative z-20 shadow-2xl shadow-black/50">
        
        {/* Brand / Logo Area */}
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-3 text-zinc-100 font-bold text-lg tracking-wide">
            <div className="w-8 h-8 bg-primary/20 border border-primary/30 rounded-lg flex items-center justify-center shadow-glow">
              <Monitor className="w-4 h-4 text-primary" />
            </div>
            SoftGlaze
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            // Highlight logic
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-sm font-medium ${
                  isActive 
                    ? 'bg-primary/10 text-primary shadow-[inset_2px_0_0_var(--color-primary)]' 
                    : 'text-muted hover:bg-card hover:text-zinc-200'
                }`}
              >
                <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-primary' : 'text-muted group-hover:text-zinc-300'}`} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom User Area */}
        <div className="p-4 border-t border-border bg-surface">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-border/50 shadow-sm transition-colors hover:border-border cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xs shadow-glow">
              AD
            </div>
            <div className="flex flex-col">
              <span className="text-zinc-200 text-sm font-medium leading-none">Admin</span>
              <span className="text-muted text-xs mt-1">Free Plan</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background relative z-10">
        {/* Subtle top glare effect for depth */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent pointer-events-none" />
        
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}