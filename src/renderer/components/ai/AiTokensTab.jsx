import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Plus, RefreshCw, Search, Workflow } from 'lucide-react';

import Button from '@/components/ui/Button.jsx';
import Input from '@/components/ui/Input.jsx';
import Pager from '@/components/ui/Pager.jsx';
import Switch from '@/components/ui/Switch.jsx';
import EmptyState from '@/components/EmptyState.jsx';
import { ConfirmDialog, InlineError, TonePill, toneText } from '@/components/ai/AiShared.jsx';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { filterTokens, isAutomationToken, relativeTime, sortTokens, tokenState } from '@/lib/aiCore.mjs';
import { formatDate, formatDateTime } from '@/lib/utils.js';
import { cn } from '@/lib/utils.js';

const SCOPE_TONE = { read: 'info', operate: 'success', full: 'warning' };
const STATE_TONE = { revoked: 'muted', expired: 'danger', expiring: 'warning' };

export default function AiTokensTab({ tokens, state, groups, lang, onReload, onCreate }) {
  const { t } = useTranslation('ai');
  const [query, setQuery] = useState('');
  const [showRevoked, setShowRevoked] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [revoke, setRevoke] = useState({ token: null, busy: false, error: '' });

  const now = Date.now();
  const groupName = useMemo(() => new Map((groups || []).map((g) => [g.id, g.name])), [groups]);
  const rows = filterTokens(sortTokens(tokens, now), { query, showRevoked }, now);
  const revokedCount = tokens.filter((tok) => tok.revoked).length;
  const pageRows = Number.isFinite(pageSize) ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;

  async function doRevoke() {
    const tok = revoke.token;
    if (!tok) return;
    setRevoke((r) => ({ ...r, busy: true, error: '' }));
    try {
      await softglazeApi.ai.tokens.revoke(tok.id);
      setRevoke({ token: null, busy: false, error: '' });
      onReload();
    } catch (e) {
      setRevoke((r) => ({ ...r, busy: false, error: (e && e.message) || String(e) }));
    }
  }

  function groupsText(tok) {
    const ids = Array.isArray(tok.groupIds) ? tok.groupIds : [];
    if (!ids.length) return t('tokens.allProfiles');
    const names = ids.map((id) => groupName.get(id) || `#${id}`);
    return names.length > 2 ? t('tokens.groupsMore', { names: names.slice(0, 2).join(', '), count: names.length - 2 }) : names.join(', ');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xs">
          <Input icon={Search} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder={t('tokens.search')} aria-label={t('tokens.search')} />
        </div>
        {revokedCount > 0 && (
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Switch checked={showRevoked} onChange={(v) => { setShowRevoked(v); setPage(1); }} label={t('tokens.showRevoked')} />
            {t('tokens.showRevokedCount', { count: revokedCount })}
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onReload}><RefreshCw className="h-3.5 w-3.5" /> {t('refresh')}</Button>
          <Button size="sm" onClick={onCreate}><Plus className="h-4 w-4" /> {t('tokens.create')}</Button>
        </div>
      </div>

      <p className="text-[12.5px] text-muted-foreground">{t('tokens.intro')}</p>

      {state.error && <InlineError>{t('tokens.loadError', { message: state.error })}</InlineError>}

      {state.loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-card motion-reduce:animate-none" />)}
        </div>
      ) : tokens.length === 0 && !state.error ? (
        <EmptyState title={t('tokens.emptyTitle')} description={t('tokens.emptyBody')} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{t('tokens.caption')}</caption>
              <thead className="bg-surface text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('tokens.colName')}</th>
                  <th scope="col" className="px-4 py-3">{t('tokens.colMember')}</th>
                  <th scope="col" className="px-4 py-3">{t('tokens.colScope')}</th>
                  <th scope="col" className="px-4 py-3">{t('tokens.colGroups')}</th>
                  <th scope="col" className="px-4 py-3">{t('tokens.colExpires')}</th>
                  <th scope="col" className="px-4 py-3">{t('tokens.colLastUsed')}</th>
                  <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">{t('tokens.colActions')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((tok) => {
                  const st = tokenState(tok, now);
                  const dead = st === 'revoked' || st === 'expired';
                  const auto = isAutomationToken(tok);
                  return (
                    <tr key={tok.id} className={cn('align-top', dead && 'opacity-60')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="max-w-[14rem] truncate text-[13px] font-medium text-foreground" title={tok.name}>{tok.name}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1 pl-5">
                          {st !== 'active' && <TonePill tone={STATE_TONE[st]}>{t(`tokens.state.${st}`)}</TonePill>}
                          {auto && (
                            <TonePill tone="accent" title={tok.preApprovedTools.join(', ')}>
                              <Workflow className="h-3 w-3" aria-hidden="true" />
                              {t('tokens.automation', { count: tok.preApprovedTools.length })}
                            </TonePill>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-foreground"><span className="block max-w-[10rem] truncate" title={tok.memberName || ''}>{tok.memberName || '-'}</span></td>
                      <td className="px-4 py-3"><TonePill tone={SCOPE_TONE[tok.scope] || 'muted'}>{t(`scope.${tok.scope}.title`, { defaultValue: tok.scope })}</TonePill></td>
                      <td className="px-4 py-3 text-[12.5px] text-muted-foreground"><span className="block max-w-[12rem] truncate" title={groupsText(tok)}>{groupsText(tok)}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-[12.5px]" style={st === 'expiring' || st === 'expired' ? toneText(STATE_TONE[st]) : undefined}>
                        {tok.expiresAt
                          ? <span title={formatDateTime(tok.expiresAt)}>{st === 'expired' ? formatDate(tok.expiresAt) : relativeTime(tok.expiresAt, now, lang)}</span>
                          : <span className="text-muted-foreground">{t('never')}</span>}
                      </td>
                      <td className="px-4 py-3 text-[12.5px]">
                        {tok.lastUsedAt ? (
                          <>
                            <span className="block whitespace-nowrap text-foreground" title={formatDateTime(tok.lastUsedAt)}>{relativeTime(tok.lastUsedAt, now, lang)}</span>
                            {tok.lastClientName && <span className="block max-w-[10rem] truncate text-[11.5px] text-muted-foreground" title={tok.lastClientName}>{tok.lastClientName}</span>}
                          </>
                        ) : <span className="text-muted-foreground">{t('tokens.neverUsed')}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {st !== 'revoked' && (
                          <Button size="sm" variant="danger" onClick={() => setRevoke({ token: tok, busy: false, error: '' })} aria-label={t('tokens.revokeAria', { name: tok.name })}>
                            {t('tokens.revoke')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-[13px] text-muted-foreground">{t('tokens.noMatch')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > 25 && (
            <div className="border-t border-border px-4 py-2.5">
              <Pager total={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(revoke.token)}
        title={t('tokens.revokeTitle', { name: revoke.token ? revoke.token.name : '' })}
        body={t('tokens.revokeBody')}
        confirmLabel={t('tokens.revoke')}
        busy={revoke.busy}
        onConfirm={doRevoke}
        onCancel={() => setRevoke({ token: null, busy: false, error: '' })}
      >
        {revoke.error ? <p role="alert" className="text-[12.5px]" style={toneText('danger')}>{t('tokens.revokeError', { message: revoke.error })}</p> : null}
      </ConfirmDialog>
    </div>
  );
}
