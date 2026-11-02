import { useTranslation } from 'react-i18next';
import { ageParts, isWarmed, warmRuns } from '@/lib/profileAge.mjs';

const AGE_KEY = { d: 'row.ageDays', mo: 'row.ageMonths', y: 'row.ageYears' };

// Small age tag beside a profile's creation date. It turns green once the warm-up has run often enough to
// count as browsing history; the tooltip says how often and when it last ran.
export default function ProfileAgeBadge({ createdAt, stat, formatAgo }) {
  const { t } = useTranslation('profiles');
  const age = ageParts(createdAt);
  if (!age) return null;
  const runs = warmRuns(stat);
  const created = age.days === 0 ? t('row.createdToday') : t('row.createdDaysAgo', { count: age.days });
  const warmed = runs > 0 ? t('row.warmedTimes', { count: runs, last: formatAgo(stat.lastAt) }) : t('row.neverWarmed');
  const title = `${created} · ${warmed}`;
  const tone = isWarmed(stat) ? 'bg-success/10 text-success border-success/25' : 'bg-secondary text-muted-foreground border-border';
  return (
    <span title={title} className={`shrink-0 inline-flex items-center rounded-full border px-1 py-0.5 text-[10px] font-semibold tabular-nums ${tone}`}>
      {t(AGE_KEY[age.unit], { count: age.count })}
    </span>
  );
}
