import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import AppShell from '@/components/AppShell.jsx';
import DbGate from '@/components/DbGate.jsx';
import ErrorBoundary from '@/components/ErrorBoundary.jsx';
import Gate from '@/components/Gate.jsx';
import FeatureRoute from '@/components/FeatureRoute.jsx';
import { AiApprovalsProvider } from '@/components/ai/AiApprovalsProvider.jsx';
import DashboardPage from '@/pages/DashboardPage.jsx';
import ProxyPoolPage from '@/pages/ProxyPoolPage.jsx';
import GroupsPage from '@/pages/GroupsPage.jsx';
import ExtensionsPage from '@/pages/ExtensionsPage.jsx';
import BrowsersPage from '@/pages/BrowsersPage.jsx';
import TrashPage from '@/pages/TrashPage.jsx';
import MembersPage from '@/pages/MembersPage.jsx';
import AccountSettingsPage from '@/pages/AccountSettingsPage.jsx';
import StartLinksPage from '@/pages/StartLinksPage.jsx';

// Heavy pages are code-split and load on first navigation behind the Suspense fallback.
const ProfilesPage = lazy(() => import('@/pages/ProfilesPage.jsx'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage.jsx'));
const AutomationPage = lazy(() => import('@/pages/AutomationPage.jsx'));
const BatchImportPage = lazy(() => import('@/pages/BatchImportPage.jsx'));
const BillingPage = lazy(() => import('@/pages/BillingPage.jsx'));
const PersonasPage = lazy(() => import('@/pages/PersonasPage.jsx'));
const ProxyProvidersPage = lazy(() => import('@/pages/ProxyProvidersPage.jsx'));
const FreeProxiesPage = lazy(() => import('@/pages/FreeProxiesPage.jsx'));
const ProviderStatusPage = lazy(() => import('@/pages/ProviderStatusPage.jsx'));
const AiPage = lazy(() => import('@/pages/AiPage.jsx'));

function PageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center p-12 text-sm opacity-60">
      Loading…
    </div>
  );
}

export default function App() {
  const location = useLocation();
  return (
    <DbGate>
      <Gate>
        {/* One AI approvals queue for the whole app: the dialog pops up on any page. */}
        <AiApprovalsProvider>
          <AppShell>
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<PageFallback />}>
                {/* Pages under "Visible features" stay closed to a member who has them turned off. */}
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<FeatureRoute feature="dashboard" redirectTo="/profiles"><DashboardPage /></FeatureRoute>} />
                  <Route path="/ai" element={<AiPage />} />
                  <Route path="/start-links" element={<StartLinksPage />} />
                  <Route path="/profiles" element={<FeatureRoute feature="profiles"><ProfilesPage /></FeatureRoute>} />
                  <Route path="/groups" element={<FeatureRoute feature="groups"><GroupsPage /></FeatureRoute>} />
                  <Route path="/proxies" element={<FeatureRoute feature="proxies"><ProxyPoolPage /></FeatureRoute>} />
                  <Route path="/free-proxies" element={<FeatureRoute feature="proxies"><FreeProxiesPage /></FeatureRoute>} />
                  <Route path="/proxy-providers" element={<FeatureRoute feature="proxies"><ProxyProvidersPage /></FeatureRoute>} />
                  <Route path="/provider-status" element={<ProviderStatusPage />} />
                  <Route path="/extensions" element={<FeatureRoute feature="extensions"><ExtensionsPage /></FeatureRoute>} />
                  <Route path="/personas" element={<PersonasPage />} />
                  <Route path="/browsers" element={<FeatureRoute feature="browsers"><BrowsersPage /></FeatureRoute>} />
                  <Route path="/trash" element={<FeatureRoute feature="trash"><TrashPage /></FeatureRoute>} />
                  <Route path="/batch-import" element={<FeatureRoute feature="batchImport"><BatchImportPage /></FeatureRoute>} />
                  <Route path="/automation" element={<AutomationPage />} />
                  <Route path="/members" element={<FeatureRoute feature="members"><MembersPage /></FeatureRoute>} />
                  <Route path="/account" element={<AccountSettingsPage />} />
                  <Route path="/billing" element={<BillingPage />} />
                  <Route path="/settings" element={<FeatureRoute feature="settings"><SettingsPage /></FeatureRoute>} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </AppShell>
        </AiApprovalsProvider>
      </Gate>
    </DbGate>
  );
}
