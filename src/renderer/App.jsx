import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import AppShell from '@/components/AppShell.jsx';
import Gate from '@/components/Gate.jsx';
import DashboardPage from '@/pages/DashboardPage.jsx';
import ProxyPoolPage from '@/pages/ProxyPoolPage.jsx';
import GroupsPage from '@/pages/GroupsPage.jsx';
import ExtensionsPage from '@/pages/ExtensionsPage.jsx';
import BrowsersPage from '@/pages/BrowsersPage.jsx';
import TrashPage from '@/pages/TrashPage.jsx';
import MembersPage from '@/pages/MembersPage.jsx';
import AccountSettingsPage from '@/pages/AccountSettingsPage.jsx';

// Heavy pages are code-split into their own chunks so they don't bloat the
// initial bundle; each loads on first navigation behind the <Suspense> fallback.
const ProfilesPage = lazy(() => import('@/pages/ProfilesPage.jsx'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage.jsx'));
const AutomationPage = lazy(() => import('@/pages/AutomationPage.jsx'));
const BatchImportPage = lazy(() => import('@/pages/BatchImportPage.jsx'));

function PageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center p-12 text-sm opacity-60">
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <Gate>
      <AppShell>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/proxies" element={<ProxyPoolPage />} />
            <Route path="/extensions" element={<ExtensionsPage />} />
            <Route path="/browsers" element={<BrowsersPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/batch-import" element={<BatchImportPage />} />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/account" element={<AccountSettingsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </AppShell>
    </Gate>
  );
}
