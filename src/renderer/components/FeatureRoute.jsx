import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/EmptyState.jsx';
import { useCurrentMember } from '@/lib/usePermissions.js';
import { featureVisible } from '@/lib/memberPermissions.mjs';

// A page turned off for this member under "Visible features" (Members > permissions). The sidebar
// already hides it; this keeps a link, the command palette or a typed address from opening it. Main
// refuses the page's actions on its own (src/main/featureGate.js). `redirectTo` sends the member to
// another page instead (the Dashboard, which is the start page). Nothing renders until the member is
// known, so a hidden page never mounts and calls main.
export default function FeatureRoute({ feature, redirectTo = null, children }) {
  const me = useCurrentMember();
  const { t } = useTranslation('common');
  if (me === undefined) return null;
  if (featureVisible(me, feature)) return children;
  if (redirectTo) return <Navigate to={redirectTo} replace />;
  return <EmptyState title={t('perm.featureOffTitle')} description={t('perm.featureOffBody')} />;
}
