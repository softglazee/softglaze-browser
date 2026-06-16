import { Navigate, Route, Routes } from 'react-router-dom';

import AppShell from '@/components/AppShell.jsx';
import ProfilesPage from '@/pages/ProfilesPage.jsx';
import ProxyPoolPage from '@/pages/ProxyPoolPage.jsx';
import BatchImportPage from '@/pages/BatchImportPage.jsx';
import SettingsPage from '@/pages/SettingsPage.jsx';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/profiles" replace />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/proxies" element={<ProxyPoolPage />} />
        <Route path="/batch-import" element={<BatchImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppShell>
  );
}
