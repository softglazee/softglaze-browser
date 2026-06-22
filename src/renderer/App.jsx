import { Navigate, Route, Routes } from 'react-router-dom';

import AppShell from '@/components/AppShell.jsx';
import Gate from '@/components/Gate.jsx';
import DashboardPage from '@/pages/DashboardPage.jsx';
import ProfilesPage from '@/pages/ProfilesPage.jsx';
import ProxyPoolPage from '@/pages/ProxyPoolPage.jsx';
import BatchImportPage from '@/pages/BatchImportPage.jsx';
import SettingsPage from '@/pages/SettingsPage.jsx';
import GroupsPage from '@/pages/GroupsPage.jsx';
import ExtensionsPage from '@/pages/ExtensionsPage.jsx';
import BrowsersPage from '@/pages/BrowsersPage.jsx';
import TrashPage from '@/pages/TrashPage.jsx';
import MembersPage from '@/pages/MembersPage.jsx';
import AutomationPage from '@/pages/AutomationPage.jsx';
import AccountSettingsPage from '@/pages/AccountSettingsPage.jsx';

export default function App() {
  return (
    <Gate>
      <AppShell>
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
      </AppShell>
    </Gate>
  );
}