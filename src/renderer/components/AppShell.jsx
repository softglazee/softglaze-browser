import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Globe, Settings, Users, Monitor, FileSpreadsheet, Puzzle, FolderHeart, Trash2 } from 'lucide-react';

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
    <div className="flex h-screen w-full bg-[#131519] text-[#d1d5db] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-[#181a1f] border-r border-[#2d3039] flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-[#2d3039]">
          <div className="flex items-center gap-2 text-white font-bold text-lg tracking-wide">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Monitor className="w-5 h-5 text-white" />
            </div>
            SoftGlaze
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            // Highlight logic
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-[14px] font-medium ${
                  isActive 
                    ? 'bg-blue-600/10 text-blue-500' 
                    : 'text-[#9ca3af] hover:bg-[#24272e] hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-500' : 'text-[#9ca3af]'}`} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#2d3039]">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#24272e] border border-[#3b3e48]">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
              AD
            </div>
            <div className="flex flex-col">
              <span className="text-white text-[13px] font-medium leading-none">Admin</span>
              <span className="text-[#9ca3af] text-[11px] mt-1">Free Plan</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#131519]">
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
}