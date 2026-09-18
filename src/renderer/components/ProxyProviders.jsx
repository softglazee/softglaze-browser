import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Boxes, ExternalLink, KeyRound, Loader2, Check, Activity, RefreshCw, ShieldCheck, Zap, X, Globe2,
  Plus, Gauge, MapPin, SlidersHorizontal, Layers
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import i18n from '@/i18n/index.js';
import cmpSettingsCEn from '@/i18n/locales/en/cmpSettingsC.json';
import cmpSettingsCEs from '@/i18n/locales/es/cmpSettingsC.json';

// Register the "cmpSettingsC" namespace without touching the central i18n config.
// addResourceBundle is a no-op if the bundle already exists, so this is safe
// across hot reloads (and IpProvidersSettings performing the same registration).
if (!i18n.hasResourceBundle('en', 'cmpSettingsC')) i18n.addResourceBundle('en', 'cmpSettingsC', cmpSettingsCEn);
if (!i18n.hasResourceBundle('es', 'cmpSettingsC')) i18n.addResourceBundle('es', 'cmpSettingsC', cmpSettingsCEs);

// ---------------------------------------------------------------------------
// Softglaze Provider Core - integrated proxy-vendor marketplace.
//
// A static catalog of partner vendors. `referral` links out through our platform
// (replace the ?ref=softglaze placeholder with each partner's real affiliate URL
// when the programs are live). `tokenSync` providers hide the host form and show
// a secure "Proxy Token" + Sync mechanic; the rest show the rotating-engine form.
// lucide ships no brand logos, so each card uses a branded initials tile.
// ---------------------------------------------------------------------------
export const PROVIDERS = [
  { key: 'ipfoxy', name: 'IPFoxy', unavailable: true, initials: 'IF', color: '#f97316', referral: 'https://www.ipfoxy.com/?ref=softglaze', gateway: null },
  { key: 'brightdata', name: 'Bright Data', initials: 'BD', color: '#00b4d8', bdpm: true, apiSync: true, referral: 'https://brightdata.com/?ref=softglaze', gateway: { host: 'brd.superproxy.io', port: 22225, type: 'HTTP' } },
  { key: 'oxylabs', name: 'Oxylabs', initials: 'OX', color: '#7c5cff', apiSync: true, ipv6: true, referral: 'https://oxylabs.io/?ref=softglaze', gateway: { host: 'pr.oxylabs.io', port: 7777, type: 'HTTP' } },
  { key: 'smartproxy', name: 'Smartproxy', initials: 'SP', color: '#ff6b35', apiSync: true, referral: 'https://smartproxy.com/?ref=softglaze', gateway: { host: 'gate.smartproxy.com', port: 7000, type: 'HTTP' } },
  { key: 'lumiproxy', name: 'LumiProxy', unavailable: true, initials: 'LP', color: '#22c55e', referral: 'https://www.lumiproxy.com/?ref=softglaze', gateway: null },
  { key: 'proxy302', name: 'Proxy302', unavailable: true, initials: '302', color: '#3b82f6', referral: 'https://www.proxy302.com/?ref=softglaze', gateway: null },
  { key: 'mangoproxy', name: 'MangoProxy', unavailable: true, initials: 'MP', color: '#f59e0b', referral: 'https://www.mangoproxy.com/?ref=softglaze', gateway: null },
  { key: 'kookeey', name: 'kookeey', unavailable: true, initials: 'KK', color: '#ec4899', referral: 'https://www.kookeey.net/?ref=softglaze', gateway: null },
  { key: 'luna', name: 'Luna Proxy', unavailable: true, initials: 'LN', color: '#8b5cf6', referral: 'https://luna-proxy.com/?ref=softglaze', gateway: null },
  { key: 'ipburger', name: 'IP Burger', unavailable: true, initials: 'IB', color: '#ef4444', referral: 'https://www.ipburger.com/?ref=softglaze', gateway: null },
  { key: 'tisocks', name: 'TiSocks', unavailable: true, initials: 'TS', color: '#14b8a6', referral: 'https://tisocks.net/?ref=softglaze', gateway: null },
  { key: 'shopsocks5', name: 'ShopSocks5', initials: 'SS', color: '#6366f1', referral: 'https://shopsocks5.com/?ref=softglaze', gateway: { host: 'gate.shopsocks5.com', port: 1080, type: 'SOCKS5' }, geoSync: { creds: ['username', 'token'], count: true, geo: true, shop: true } },
  { key: 'apify', name: 'Apify Residential', initials: 'AP', color: '#22c55e', referral: 'https://apify.com/?fpr=softglaze', gateway: { host: 'proxy.apify.com', port: 8000, type: 'HTTP' }, geoSync: { creds: ['password'], count: true } },
  { key: 'smartproxyorg', name: 'Smartproxy.org', initials: 'SO', color: '#2563eb', referral: 'https://www.smartproxy.org/?ref=softglaze', gateway: { host: 'isp.smartproxy.net', port: 3100, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, geo: true, gateway: true, life: true } },
  { key: 'anyip', name: 'AnyIP', initials: 'AN', color: '#0ea5e9', referral: 'https://anyip.io/?ref=softglaze', gateway: { host: 'portal.anyip.io', port: 1080, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], apiKey: true, count: true, session: true, life: true, gateway: true, poolType: true } },
  // DataImpulse is a real list pull: GET /api/list returns rendered login:password@host:port
  // rows, so `geo` (state/city), `count` and `life` (session_ttl) all map to documented
  // query parameters rather than to an invented username grammar.
  { key: 'dataimpulse', name: 'DataImpulse', initials: 'DI', color: '#a3e635', referral: 'https://dataimpulse.com/?ref=softglaze', gateway: { host: 'gw.dataimpulse.com', port: 823, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, geo: true, life: true, di: true } },
  // Proxy-Seller residential: the API key creates a list (geo + rotation + N ports, each
  // port its own exit IP) and downloads it, or downloads a list made in the dashboard.
  { key: 'proxyseller', name: 'Proxy-Seller', initials: 'PS', color: '#22c55e', referral: 'https://proxy-seller.com/personal/api/', gateway: null, geoSync: { creds: ['token'], count: true, ps: true } },
  // IPRoyal residential: an API token generates ready proxy lines for a sub-user (or the
  // proxy username + password), with country/state/city and sticky lifetime in the password.
  { key: 'iproyal', name: 'IPRoyal', initials: 'IR', color: '#f59e0b', referral: 'https://dashboard.iproyal.com/', gateway: null, geoSync: { creds: ['token'], count: true, ipr: true } },
  // MarsProxies residential: an API token generates a proxy list for a sub-user, sticky by
  // default (an anti-detect profile wants a stable exit IP). Residential only.
  { key: 'marsproxies', name: 'MarsProxies', initials: 'MA', color: '#e11d48', referral: 'https://marsproxies.com/?ref=softglaze', gateway: null, geoSync: { creds: ['token', 'username', 'password'], count: true, geo: true } },
  // NodeMaven: no list endpoint; the app builds each proxy against gate.nodemaven.com with the
  // targeting in the username. Proxy username + password come from the dashboard (Proxy Setup).
  { key: 'nodemaven', name: 'NodeMaven', initials: 'NM', color: '#6366f1', referral: 'https://nodemaven.com/?ref=softglaze', gateway: { host: 'gate.nodemaven.com', port: 8080, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, poolType: true, geo: true, life: true } },
  // Froxy (SOAX reseller): login + password from the dashboard Export Proxy List, targeting in
  // the password against proxy.froxy.com:9000. wifi = residential, or pick Mobile.
  { key: 'froxy', name: 'Froxy', initials: 'FX', color: '#7c3aed', referral: 'https://froxy.com/?ref=softglaze', gateway: { host: 'proxy.froxy.com', port: 9000, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, poolType: [['residential', 'Residential'], ['mobile', 'Mobile'], ['datacenter', 'Datacenter']], geo: true } },
  // Proxidize: a Bearer token. Per-Proxy plans return ready credentials for a per-proxy
  // username; Per-GB plans build from an access point against the gateway host from Proxy Details.
  { key: 'proxidize', name: 'Proxidize', initials: 'PX', color: '#0ea5e9', referral: 'https://proxidize.com/?ref=softglaze', gateway: null, geoSync: { creds: ['token', 'username'], count: true, poolType: true, geo: true, gateway: true } }
];

// IPRoyal sticky lifetimes, in the "{n}m" / "{n}h" format its API takes (1 second to 168 hours).
const IPR_LIFETIME_OPTIONS = [['10m', 10, 'minutes'], ['30m', 30, 'minutes'], ['1h', 1, 'hours'], ['6h', 6, 'hours'], ['24h', 24, 'hours'], ['72h', 72, 'hours'], ['168h', 168, 'hours']];

// Sticky lifetimes DataImpulse accepts as session_ttl (minutes). Blank keeps the vendor
// default, which their docs give as 30 minutes.
const DI_TTL_OPTIONS = ['5', '10', '15', '30', '60', '120'];
// Proxy-Seller products. Residential is a traffic package pulled as lists; the rest are
// sold per IP and pulled from the orders already on the account.
const PS_PRODUCTS = [
  ['residential', 'Residential'], ['ipv6', 'IPv6'], ['ipv4', 'IPv4'], ['isp', 'ISP'],
  ['mobile', 'Mobile'], ['mix', 'IPv4 Mix'], ['mix_isp', 'ISP Mix']
];
// Proxy-Seller "rotate every N seconds" presets (the API accepts 1 to 3600).
const PS_INTERVAL_OPTIONS = ['60', '300', '600', '1800', '3600'];

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(v / 1024)} KB`;
}

// Country list for the geo-targeted providers (Apify / Smartproxy.org / ShopSocks5).
// Values are ISO 3166-1 alpha-2 codes - the format Apify (country-XX) and
// Smartproxy.org (area-XX) expect; ShopSocks5 receives it as its country filter.
export const PROXY_COUNTRIES = [
  ['', 'Any / Random'],
  ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['IE', 'Ireland'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['BE', 'Belgium'],
  ['CZ', 'Czechia'], ['RO', 'Romania'], ['GR', 'Greece'], ['TR', 'Turkey'], ['RU', 'Russia'],
  ['UA', 'Ukraine'], ['IN', 'India'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['JP', 'Japan'],
  ['KR', 'South Korea'], ['CN', 'China'], ['HK', 'Hong Kong'], ['TW', 'Taiwan'], ['SG', 'Singapore'],
  ['MY', 'Malaysia'], ['TH', 'Thailand'], ['VN', 'Vietnam'], ['PH', 'Philippines'], ['ID', 'Indonesia'],
  ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['IL', 'Israel'], ['EG', 'Egypt'], ['ZA', 'South Africa'],
  ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['CL', 'Chile'], ['CO', 'Colombia'], ['NZ', 'New Zealand']
];

const GEO_HINTS = {
  apify: 'Apify residential routes through one gateway (proxy.apify.com:8000); the country and a sticky session are encoded into the username. Each pull mints that many sticky residential IPs you can assign to profiles. Use the password from Apify Console → Proxy → HTTP settings. Note: this vendor publishes no IPv6 option, so every exit is IPv4. Oxylabs is the one configured provider with a documented IPv6 selector.',
  smartproxyorg: 'Smartproxy.org (Long-Acting ISP) routes through isp.smartproxy.net:3100 and embeds area (country) + optional state/city + a sticky lifetime/session into the proxy username. Enter your sub-account username (smart-…) and its password. "Keep same IP" sets how long one exit IP stays fixed (5 min up to 24 h); leave it on "Different each time" with a blank session to mint several rotating IPs. If your dashboard shows a different host:port, override it below.',
  shopsocks5: 'ShopSocks5 pulls your purchased SOCKS5 (or HTTPS) list via its API, filtered to the chosen country/state/city. The API authenticates with your account username/email + API token TOGETHER - token alone returns “User or Api Token incorrect”. Pick the Plan that matches your subscription (Premium / List / Daily).',
  anyip: 'anyip.io routes through one gateway (portal.anyip.io:1080) and encodes the pool type (Residential/Mobile), country, an optional sticky-session name and lifetime into the proxy username. Connect either by pasting your proxy Username (user_…) + Password from the dashboard (Get Proxy Details), OR by entering an API key + Team ID to auto-provision an account. A blank session with “Different each time” mints rotating IPs; a fixed session name pins one IP. Override the gateway host/port if your dashboard shows a custom port. Note: this vendor publishes no IPv6 option, so every exit is IPv4. Oxylabs is the one configured provider with a documented IPv6 selector.'
};

export default function ProxyProviders({ onSynced }) {
  const { t } = useTranslation('cmpSettingsC');
  const [selectedKey, setSelectedKey] = useState(PROVIDERS[0].key);
  const provider = useMemo(() => PROVIDERS.find((p) => p.key === selectedKey) || PROVIDERS[0], [selectedKey]);

  // Affiliate-link overrides set by the Owner/Super Admin in Settings → Monetization.
  // The marketplace "Purchase" / "Visit dashboard" button uses the configured link
  // when present, otherwise the built-in default below.
  const [affiliateLinks, setAffiliateLinks] = useState({});
  const referral = affiliateLinks[provider.key] || provider.referral;

  const [form, setForm] = useState({ host: '', port: '', username: '', password: '', token: '', bdpm: false, apiToken: '', zone: '', country: '', count: '5', state: '', city: '', session: '', life: '', apiUrl: '', plan: 'premium', proxyType: 'proxy_sock_5', poolType: 'residential', teamId: '', ipv6: false, zip: '', asn: '', excludeCountries: '', excludeAsns: '', listId: '', source: 'new', orderId: '', subuserHash: '' });
  // Read-only account view (traffic left, saved lists, live locations) for the vendors
  // that expose one. Cleared whenever the provider changes.
  const [account, setAccount] = useState(null);
  const [lookingUp, setLookingUp] = useState('');
  const [geoOptions, setGeoOptions] = useState({ state: [], city: [], region: [], country: [] });
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [err, setErr] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);

  // Pull the Owner-configured affiliate links once (best-effort; falls back to
  // built-in referral URLs if unavailable).
  useEffect(() => {
    softglazeApi.monetization.getLinks()
      .then((r) => setAffiliateLinks(r && r.links ? r.links : {}))
      .catch(() => {});
  }, []);

  // Re-prime the workspace whenever the active provider changes.
  useEffect(() => {
    const gw = provider.gateway || { host: '', port: '' };
    // DataImpulse labels these three selects with its own vocabulary (product /
    // rotating-sticky / http-socks5), so it needs defaults that its own <option>
    // values actually carry. Sharing one default set renders blank selects.
    // Proxy-Seller shares the protocol and session vocabulary. Sticky is the default for
    // both because an anti-detect profile needs an exit IP that stays put.
    const di = provider.key === 'dataimpulse' || provider.key === 'proxyseller' || provider.key === 'iproyal';
    setForm({ host: gw.host, port: String(gw.port), username: '', password: '', token: '', bdpm: false, apiToken: '', zone: '', country: '', count: '5', state: '', city: '', session: '', life: '', apiUrl: '', plan: di ? 'residential' : 'premium', proxyType: di ? 'http' : 'proxy_sock_5', poolType: di ? 'sticky' : 'residential', teamId: '', ipv6: false, zip: '', asn: '', excludeCountries: '', excludeAsns: '', listId: '', source: 'new', orderId: '', subuserHash: '' });
    setAccount(null);
    setLookingUp('');
    setGeoOptions({ state: [], city: [], region: [], country: [] });
    setCheckResult(null);
    setCredsSaved(false);
    setSyncResult(null);
    setErr('');
  }, [provider]);

  // Pre-fill saved credentials for this provider (sealed at rest with DPAPI). Runs
  // after the reset above so saved values win; guarded so a fast provider switch
  // can't apply stale creds.
  useEffect(() => {
    let live = true;
    try {
      softglazeApi.proxies.getProviderCreds(provider.key)
        .then((c) => {
          if (!live || !c || !c.found) return;
          setForm((f) => ({
            ...f,
            ...(c.username != null ? { username: c.username } : {}),
            ...(c.password != null ? { password: c.password } : {}),
            ...(c.token != null ? { token: c.token } : {}),
            ...(c.apiToken != null ? { apiToken: c.apiToken } : {}),
            ...(c.zone != null ? { zone: c.zone } : {}),
            ...(c.plan != null ? { plan: c.plan } : {}),
            ...(c.host ? { host: c.host } : {}),
            ...(c.port != null ? { port: String(c.port) } : {})
          }));
        })
        .catch(() => {});
    } catch (e) { /* older build without the creds API - ignore */ }
    return () => { live = false; };
  }, [provider]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Remember the entered credentials for this provider so they're pre-filled next
  // time. Best-effort; secrets are DPAPI-sealed in the main process. Empty fields
  // are cleared. Called after a successful pull/sync.
  function persistCreds() {
    try {
      softglazeApi.proxies.saveProviderCreds({
        provider: provider.key,
        username: form.username, password: form.password, token: form.token,
        apiToken: form.apiToken, zone: form.zone, plan: form.plan,
        host: form.host, port: form.port
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // Persist what the operator typed, without needing a pull to hang it off. persistCreds
  // was only ever called from the three sync paths, so anyone using the manual form had
  // no way to save an API key at all.
  async function handleSaveCreds() {
    setSavingCreds(true); setErr('');
    try {
      await softglazeApi.proxies.saveProviderCreds({
        provider: provider.key,
        username: form.username, password: form.password, token: form.token,
        apiToken: form.apiToken, zone: form.zone, plan: form.plan,
        host: form.host, port: form.port
      });
      setCredsSaved(true);
      setTimeout(() => setCredsSaved(false), 2500);
    } catch (e) { setErr(e.message || t('proxyProviders.errors.saveCreds')); }
    finally { setSavingCreds(false); }
  }
  async function handleCheck() {
    setErr(''); setCheckResult(null); setChecking(true);
    try {
      const r = await softglazeApi.proxies.check({
        type: (provider.gateway && provider.gateway.type) || 'HTTP', host: form.host, port: form.port, username: form.username, password: form.password
      });
      setCheckResult(r);
    } catch (e) { setErr(e.message || t('proxyProviders.errors.check')); }
    finally { setChecking(false); }
  }

  async function handleSync() {
    setErr(''); setSyncResult(null);
    if (!form.token.trim()) { setErr(t('proxyProviders.errors.enterProviderToken')); return; }
    setSyncing(true);
    try {
      const r = await softglazeApi.proxies.syncVendorPool({ provider: provider.key, token: form.token.trim(), bdpm: form.bdpm });
      setSyncResult(r);
      persistCreds();
      if (typeof onSynced === 'function') onSynced();
    } catch (e) { setErr(e.message || t('proxyProviders.errors.sync')); }
    finally { setSyncing(false); }
  }

  // Live API sync for wired vendors (Bright Data / Oxylabs / Smartproxy). Bright
  // Data needs its API token (+ zone); Oxylabs/Smartproxy verify the username &
  // password from the rotating form against the vendor gateway.
  async function handleApiSync() {
    setErr(''); setSyncResult(null);
    if (provider.key === 'brightdata' && !form.apiToken.trim()) { setErr(t('proxyProviders.errors.enterBrightDataToken', { provider: 'Bright Data' })); return; }
    if (provider.key !== 'brightdata' && !form.username.trim()) { setErr(t('proxyProviders.errors.enterUsernameFirst')); return; }
    setSyncing(true);
    try {
      const r = await softglazeApi.proxies.syncVendorPool({
        provider: provider.key,
        token: form.apiToken.trim(),
        username: form.username.trim(),
        password: form.password,
        zone: form.zone.trim(),
        bdpm: form.bdpm,
        // '6' asks Oxylabs for IPv6 exits (-ipversion-6). Vendors without a documented
        // selector ignore this rather than receiving an invented flag.
        ipVersion: provider.ipv6 && form.ipv6 ? '6' : ''
      });
      setSyncResult(r);
      persistCreds();
      if (typeof onSynced === 'function') onSynced();
    } catch (e) { setErr(e.message || t('proxyProviders.errors.liveSync')); }
    finally { setSyncing(false); }
  }

  // Country-targeted pull (Apify / Smartproxy.org / ShopSocks5). Sends the chosen
  // country (+ pool size and any geo/session/endpoint overrides) to syncVendorPool,
  // which routes to the matching adapter. Irrelevant fields are ignored per provider.
  async function handleGeoSync() {
    setErr(''); setSyncResult(null);
    const g = provider.geoSync || {};
    const creds = g.creds || [];
    if (creds.includes('token') && !form.token.trim()) { setErr(t('proxyProviders.errors.enterApiToken')); return; }
    if (g.apiKey) {
      // anyip: accept EITHER direct proxy Username + Password OR an API key + Team ID.
      const hasCreds = form.username.trim() && form.password;
      const hasApi = form.token.trim() && form.teamId.trim();
      if (!hasCreds && !hasApi) { setErr(t('proxyProviders.errors.anyipCredsOrApi', 'Enter your proxy Username + Password, or an API key + Team ID to auto-provision.')); return; }
    } else {
      if (creds.includes('username') && !form.username.trim()) { setErr(t('proxyProviders.errors.enterProxyUsername')); return; }
      if (creds.includes('password') && !form.password) { setErr(t('proxyProviders.errors.enterProxyPassword')); return; }
    }
    const fromList = g.ps && form.plan === 'residential' && form.source === 'existing';
    if (fromList && !form.listId) { setErr(t('proxyProviders.ps.pickList', 'Pick one of your saved lists, or switch to New list.')); return; }
    setSyncing(true);
    try {
      const r = await softglazeApi.proxies.syncVendorPool({
        provider: provider.key,
        country: form.country,
        count: form.count,
        zip: form.zip.trim(),
        asn: form.asn.trim(),
        excludeCountries: form.excludeCountries.trim(),
        excludeAsns: form.excludeAsns.trim(),
        listId: fromList ? form.listId : '',
        orderId: g.ps && form.plan !== 'residential' ? form.orderId : '',
        subuserHash: g.ipr ? form.subuserHash : '',
        token: form.token.trim(),
        username: form.username.trim(),
        password: form.password,
        state: form.state.trim(),
        city: form.city.trim(),
        session: form.session.trim(),
        life: form.life,
        apiUrl: form.apiUrl.trim(),
        host: form.host.trim(),
        port: form.port,
        plan: form.plan,
        proxyType: form.proxyType,
        poolType: form.poolType,
        teamId: form.teamId.trim()
      });
      setSyncResult(r);
      persistCreds();
      if (typeof onSynced === 'function') onSynced();
    } catch (e) { setErr(e.message || t('proxyProviders.errors.pull')); }
    finally { setSyncing(false); }
  }

  // Account view: plan traffic plus, on request, the live locations a pull can target.
  // groupby 'state' / 'city' (DataImpulse, for the chosen country) or 'country' / 'region'
  // (Proxy-Seller geo database). Read-only on the vendor side.
  async function handleLookup(groupby = '') {
    setErr('');
    const g = provider.geoSync || {};
    if ((g.ps || g.ipr) && !form.token.trim()) { setErr(t('proxyProviders.errors.enterApiToken')); return; }
    if (g.di && (!form.username.trim() || !form.password)) { setErr(t('proxyProviders.geo.diNeedCreds', 'Enter the plan login and password first.')); return; }
    if ((groupby === 'state' || groupby === 'city' || groupby === 'region') && !form.country) {
      setErr(t('proxyProviders.geo.pickCountryFirst', 'Pick a country first.'));
      return;
    }
    setLookingUp(groupby || 'account');
    try {
      const r = await softglazeApi.proxies.vendorLookup({
        provider: provider.key,
        token: form.token.trim(),
        username: form.username.trim(),
        password: form.password,
        country: form.country,
        groupby
      });
      setAccount(r);
      if (groupby) {
        setGeoOptions((o) => ({
          ...o,
          [groupby]: Array.isArray(r.geo) ? r.geo : [],
          // IPRoyal's region lookup also returns the country's cities that sit outside a state.
          ...(groupby === 'region' && Array.isArray(r.cities) ? { city: r.cities } : {})
        }));
      }
      persistCreds();
    } catch (e) { setErr(e.message || t('proxyProviders.errors.lookup', 'Could not reach the provider account.')); }
    finally { setLookingUp(''); }
  }

  const inputCls = 'w-full h-10 bg-background border border-border rounded px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition';
  // Styled <select>: hide the native arrow, paint an inset chevron (icon not glued to the edge).
  const chevronStyle = { backgroundImage: "url(\"data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa0aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.7rem center', backgroundSize: '1rem' };
  const selectCls = inputCls + ' appearance-none pr-9 cursor-pointer';
  const labelCls = 'mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
  const sectionCls = 'rounded-xl border border-border bg-card/40 p-4 space-y-4';
  const sectionTitleCls = 'flex items-center gap-2 text-[13px] font-semibold text-foreground';
  const hintCls = 'text-[11.5px] text-muted-foreground leading-relaxed';
  const secondaryBtnCls = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg text-[12.5px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground border border-border disabled:opacity-60';
  const primaryBtnCls = 'inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-60 shadow-lg shadow-sky-500/25';
  const segCls = (active) => `flex-1 min-w-[120px] h-10 px-3 rounded-lg text-[12.5px] font-semibold border transition-colors ${active ? 'bg-primary/15 border-primary/40 text-foreground' : 'bg-background border-border text-muted-foreground hover:text-foreground'}`;
  const optMarker = <span className="normal-case font-normal text-muted-foreground/70">{t('proxyProviders.geo.optionalWord', 'optional')}</span>;
  const pullCount = Math.max(1, Number.parseInt(form.count, 10) || 5);
  const spin = (key) => (lookingUp === key ? <Loader2 className="w-4 h-4 animate-spin" /> : null);

  // Plan traffic line shared by the DataImpulse and Proxy-Seller panels.
  const renderAccount = () => (account && account.provider === provider.key ? (
    <div className="space-y-1.5">
      {account.residential !== false && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-[12px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
            <Gauge className="w-3.5 h-3.5" />
            {account.totalBytes > 0
              ? t('proxyProviders.account.leftOf', { left: formatBytes(account.leftBytes), total: formatBytes(account.totalBytes), defaultValue: '{{left}} left of {{total}}' })
              : t('proxyProviders.account.left', { left: formatBytes(account.leftBytes), defaultValue: '{{left}} left' })}
          </span>
          {account.expiresAt && <span className="text-muted-foreground">{t('proxyProviders.account.expires', { date: account.expiresAt, defaultValue: 'Expires {{date}}' })}</span>}
          {Array.isArray(account.lists) && <span className="text-muted-foreground">{t('proxyProviders.account.lists', { count: account.lists.length, defaultValue: '{{count}} saved lists' })}</span>}
        </div>
      )}
      {account.residential === false && (
        <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[12px] text-muted-foreground">{t('proxyProviders.account.noResidential', 'No residential package on this account.')}</div>
      )}
      {Array.isArray(account.products) && account.products.map((p) => (
        <div key={p.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-[12px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400"><Layers className="w-3.5 h-3.5" /> {t('proxyProviders.account.productActive', { count: p.active, product: p.label, defaultValue: '{{count}} active {{product}}' })}</span>
          {p.countries.length > 0 && <span className="text-muted-foreground">{p.countries.join(', ')}</span>}
          {p.expires && <span className="text-muted-foreground">{t('proxyProviders.account.expires', { date: p.expires, defaultValue: 'Expires {{date}}' })}</span>}
        </div>
      ))}
    </div>
  ) : null);

  // ---- DataImpulse: plan login, what to add, where ----
  const renderDataImpulse = () => {
    const sticky = form.poolType === 'sticky';
    return (
      <div className="space-y-4 max-w-2xl">
        <section className={sectionCls}>
          <div className={sectionTitleCls}><KeyRound className="w-4 h-4 text-violet-400" /> {t('proxyProviders.geo.diPlanTitle', 'Plan credentials')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diLoginLabel', 'Plan login')}</label>
              <input value={form.username} onChange={(e) => set('username', e.target.value)} className={inputCls + ' font-mono'} placeholder="login" autoComplete="off" />
            </div>
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.proxyPasswordLabel')}</label>
              <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputCls + ' font-mono'} placeholder="password" autoComplete="off" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diProductLabel', 'Product')}</label>
              <select value={form.plan} onChange={(e) => set('plan', e.target.value)} className={selectCls} style={chevronStyle}>
                <option value="residential">{t('proxyProviders.geo.diResidential', 'Residential')}</option>
                <option value="residential_premium">{t('proxyProviders.geo.diResidentialPremium', 'Residential Premium')}</option>
                <option value="mobile">{t('proxyProviders.geo.diMobile', 'Mobile')}</option>
                <option value="datacenter">{t('proxyProviders.geo.diDatacenter', 'Datacenter')}</option>
              </select>
            </div>
            <button type="button" onClick={() => handleLookup('')} disabled={Boolean(lookingUp)} className={secondaryBtnCls}>
              {spin('account') || <Gauge className="w-4 h-4" />} {t('proxyProviders.account.checkPlan', 'Check plan')}
            </button>
          </div>
          <p className={hintCls}>{t('proxyProviders.geo.diNote', 'Each DataImpulse product has its own login and password, so the product is chosen by the credentials you enter above. Pick the matching name here and the pulled proxies are labelled with it, which keeps several products apart in the pool.')}</p>
          {renderAccount()}
        </section>

        <section className={sectionCls}>
          <div className={sectionTitleCls}><Layers className="w-4 h-4 text-sky-400" /> {t('proxyProviders.geo.diWhatTitle', 'What to add')}</div>
          <div>
            <label className={labelCls}>{t('proxyProviders.geo.diSessionLabel', 'Session')}</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => set('poolType', 'sticky')} className={segCls(sticky)}>{t('proxyProviders.geo.diSticky', 'Sticky')}</button>
              <button type="button" onClick={() => set('poolType', 'rotating')} className={segCls(!sticky)}>{t('proxyProviders.geo.diRotating', 'Rotating')}</button>
            </div>
            <p className={hintCls + ' mt-1.5'}>{sticky
              ? t('proxyProviders.geo.diStickyHelp', 'One proxy per profile. Each one keeps its own exit IP for the time you pick below.')
              : t('proxyProviders.geo.diRotatingHelp', 'One shared endpoint whose exit IP changes on every request. It adds a single proxy, so it suits scraping rather than logged-in profiles.')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diAddLabel', 'How many to add')}</label>
              <input inputMode="numeric" value={sticky ? form.count : '1'} disabled={!sticky} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className={inputCls + ' font-mono disabled:opacity-60'} placeholder="5" />
            </div>
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diTtlLabel', 'Keep each IP for')}</label>
              <select value={form.life} disabled={!sticky} onChange={(e) => set('life', e.target.value)} className={selectCls + ' disabled:opacity-60'} style={chevronStyle}>
                <option value="">{t('proxyProviders.geo.diTtlDefault', 'Default (30 minutes)')}</option>
                {DI_TTL_OPTIONS.map((m) => <option key={m} value={m}>{t('proxyProviders.geo.diTtlMinutes', { count: Number(m), defaultValue: '{{count}} minutes' })}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diProtocolLabel', 'Protocol')}</label>
              <select value={form.proxyType} onChange={(e) => set('proxyType', e.target.value)} className={selectCls} style={chevronStyle}>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>
          </div>
        </section>

        <section className={sectionCls}>
          <div className={sectionTitleCls}><MapPin className="w-4 h-4 text-sky-400" /> {t('proxyProviders.geo.locationTitle', 'Location')}</div>
          <div className="sm:max-w-[320px]">
            <label className={labelCls}><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
            <select value={form.country} onChange={(e) => { set('country', e.target.value); set('state', ''); set('city', ''); setGeoOptions((o) => ({ ...o, state: [], city: [] })); }} className={selectCls} style={chevronStyle}>
              {PROXY_COUNTRIES.map(([code, name]) => <option key={code || 'any'} value={code}>{t(`proxyProviders.countries.${code || 'any'}`, name)}{code ? ` (${code})` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.stateLabel')} {optMarker}</label>
              <input list="sg-di-state" value={form.state} onChange={(e) => set('state', e.target.value)} disabled={!form.country} className={inputCls + ' font-mono disabled:opacity-60'} placeholder={t('proxyProviders.geo.anyState', 'Any state')} />
              <datalist id="sg-di-state">{geoOptions.state.map((o) => <option key={o.key} value={o.key}>{`${o.label} · ${o.count.toLocaleString()} IPs`}</option>)}</datalist>
            </div>
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.cityLabel')} {optMarker}</label>
              <input list="sg-di-city" value={form.city} onChange={(e) => set('city', e.target.value)} disabled={!form.country} className={inputCls + ' font-mono disabled:opacity-60'} placeholder={t('proxyProviders.geo.anyCity', 'Any city')} />
              <datalist id="sg-di-city">{geoOptions.city.map((o) => <option key={o.key} value={o.key}>{`${o.label} · ${o.count.toLocaleString()} IPs`}</option>)}</datalist>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => handleLookup('state')} disabled={Boolean(lookingUp) || !form.country} className={secondaryBtnCls}>{spin('state') || <MapPin className="w-4 h-4" />} {t('proxyProviders.geo.loadStates', 'Load states')}</button>
            <button type="button" onClick={() => handleLookup('city')} disabled={Boolean(lookingUp) || !form.country} className={secondaryBtnCls}>{spin('city') || <MapPin className="w-4 h-4" />} {t('proxyProviders.geo.loadCities', 'Load cities')}</button>
          </div>
          <p className={hintCls}>{t('proxyProviders.geo.diLookupHint', 'Loading shows how many live IPs each state or city has, as suggestions in the fields above. Separate several values with commas.')}</p>
          <details className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <summary className="cursor-pointer select-none text-[12px] font-semibold text-muted-foreground inline-flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> {t('proxyProviders.geo.moreFilters', 'More filters')}</summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <div>
                <label className={labelCls}>{t('proxyProviders.geo.zipLabel', 'ZIP codes')} {optMarker}</label>
                <input value={form.zip} onChange={(e) => set('zip', e.target.value)} className={inputCls + ' font-mono'} placeholder="10001, 10002" />
              </div>
              <div>
                <label className={labelCls}>{t('proxyProviders.geo.asnLabel', 'ASNs')} {optMarker}</label>
                <input value={form.asn} onChange={(e) => set('asn', e.target.value)} className={inputCls + ' font-mono'} placeholder="7922, 701" />
              </div>
              <div>
                <label className={labelCls}>{t('proxyProviders.geo.excludeCountriesLabel', 'Exclude countries')} {optMarker}</label>
                <input value={form.excludeCountries} onChange={(e) => set('excludeCountries', e.target.value)} className={inputCls + ' font-mono'} placeholder="cn, ru" />
              </div>
              <div>
                <label className={labelCls}>{t('proxyProviders.geo.excludeAsnsLabel', 'Exclude ASNs')} {optMarker}</label>
                <input value={form.excludeAsns} onChange={(e) => set('excludeAsns', e.target.value)} className={inputCls + ' font-mono'} placeholder="16509" />
              </div>
            </div>
          </details>
        </section>

        <button onClick={handleGeoSync} disabled={syncing} className={primaryBtnCls}>
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {sticky
            ? t('proxyProviders.geo.diAddSticky', { count: pullCount, defaultValue: 'Add {{count}} sticky proxies' })
            : t('proxyProviders.geo.diAddRotating', 'Add rotating gateway')}
          {form.country ? ` · ${form.country}` : ''}
        </button>
        <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t('proxyProviders.geoHints.dataimpulse', 'Every pull adds new proxies. Sticky proxies sit on their own ports, so asking for 5 when the pool already holds 5 with the same settings adds the next 5 ports instead of returning the same ones. Use the login and password of one DataImpulse product, shown on that product page in the dashboard.')}</p>
      </div>
    );
  };

  // ---- Proxy-Seller residential: API key, new or saved list, where, rotation ----
  const renderProxySeller = () => {
    const lists = account && account.provider === 'proxyseller' && Array.isArray(account.lists) ? account.lists : [];
    const existing = form.source === 'existing';
    const regions = geoOptions.region;
    const regionHit = regions.find((r) => r.key === form.state);
    const cities = regionHit ? regionHit.cities : [];
    const countries = geoOptions.country.length ? geoOptions.country.map((c) => [c.key, c.label]) : PROXY_COUNTRIES.filter(([code]) => code);
    const mode = form.poolType === 'interval' ? 'interval' : form.poolType === 'rotating' ? 'rotating' : 'sticky';
    const residential = form.plan === 'residential';
    const products = account && account.provider === 'proxyseller' && Array.isArray(account.products) ? account.products : [];
    const productInfo = products.find((p) => p.key === form.plan) || null;
    const orderInfo = productInfo && form.orderId ? productInfo.orders.find((o) => o.id === form.orderId) : null;
    const orderCount = orderInfo ? orderInfo.count : (productInfo ? productInfo.active : 0);
    const productLabel = PS_PRODUCTS.find(([k]) => k === form.plan)?.[1] || form.plan;
    return (
      <div className="space-y-4 max-w-2xl">
        <section className={sectionCls}>
          <div className={sectionTitleCls}><KeyRound className="w-4 h-4 text-violet-400" /> {t('proxyProviders.ps.keyTitle', 'API key')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
            <div>
              <label className={labelCls}>{t('proxyProviders.ps.keyLabel', 'Proxy-Seller API key')}</label>
              <input type="password" value={form.token} onChange={(e) => set('token', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.ps.keyPlaceholder', 'Paste the key from Dashboard, API')} autoComplete="off" />
            </div>
            <button type="button" onClick={() => handleLookup('')} disabled={Boolean(lookingUp)} className={secondaryBtnCls}>
              {spin('account') || <Gauge className="w-4 h-4" />} {t('proxyProviders.account.checkAccount', 'Check account')}
            </button>
          </div>
          <p className={hintCls}>{t('proxyProviders.ps.keyHint', 'The key is in your Proxy-Seller dashboard under API. If you limited it to certain IP addresses, add this computer\'s IP there as well. It is stored encrypted on this machine.')}</p>
          {renderAccount()}
        </section>

        <section className={sectionCls}>
          <div className={sectionTitleCls}><Layers className="w-4 h-4 text-sky-400" /> {t('proxyProviders.ps.whatTitle', 'What to pull')}</div>
          <div className="sm:max-w-[320px]">
            <label className={labelCls}>{t('proxyProviders.ps.productLabel', 'Product')}</label>
            <select value={form.plan} onChange={(e) => { set('plan', e.target.value); set('orderId', ''); }} className={selectCls} style={chevronStyle}>
              {PS_PRODUCTS.map(([key, label]) => {
                const p = products.find((x) => x.key === key);
                return <option key={key} value={key}>{p ? `${label} (${p.active})` : label}</option>;
              })}
            </select>
          </div>

          {!residential && (
            <>
              <div>
                <label className={labelCls}>{t('proxyProviders.ps.orderLabel', 'Order')}</label>
                <select value={form.orderId} onChange={(e) => set('orderId', e.target.value)} className={selectCls} style={chevronStyle}>
                  <option value="">{productInfo
                    ? t('proxyProviders.ps.allOrders', { count: productInfo.active, defaultValue: 'All orders ({{count}} IPs)' })
                    : t('proxyProviders.ps.checkForOrders', 'All orders (Check account to see counts)')}</option>
                  {(productInfo ? productInfo.orders : []).map((o) => <option key={o.id} value={o.id}>{`${o.number} · ${o.count} IPs${o.country ? ` · ${o.country}` : ''}${o.expires ? ` · ${o.expires}` : ''}`}</option>)}
                </select>
                <p className={hintCls + ' mt-1.5'}>{t('proxyProviders.ps.orderHint', 'Adds every active IP in the order, each on its own port. Pulling again only adds IPs the pool does not have yet.')}</p>
              </div>
              {form.plan === 'ipv6' && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200/90">{t('proxyProviders.ps.ipv6Note', 'IPv6 exits can only reach websites that have an IPv6 address. Before assigning these to profiles, check that the sites you use support IPv6, or a page may fail to load through them.')}</p>
              )}
            </>
          )}

          {residential && (
          <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => set('source', 'new')} className={segCls(!existing)}>{t('proxyProviders.ps.sourceNew', 'New list')}</button>
            <button type="button" onClick={() => { set('source', 'existing'); if (!lists.length && form.token.trim()) handleLookup(''); }} className={segCls(existing)}>{t('proxyProviders.ps.sourceExisting', 'Existing list')}</button>
          </div>

          {existing ? (
            <div>
              <label className={labelCls}>{t('proxyProviders.ps.savedList', 'Saved list')}</label>
              <select value={form.listId} onChange={(e) => set('listId', e.target.value)} className={selectCls} style={chevronStyle}>
                <option value="">{lists.length ? t('proxyProviders.ps.pickListOption', 'Pick a list') : t('proxyProviders.ps.noListsYet', 'Check account to load your lists')}</option>
                {lists.map((l) => <option key={l.id} value={String(l.id)}>{`${l.title} · ${[l.country, l.region, l.city].filter(Boolean).join(' ') || 'Global'} · ${l.rotation}`}</option>)}
              </select>
              <p className={hintCls + ' mt-1.5'}>{t('proxyProviders.ps.existingHint', 'Downloads every port of that list. Pulling the same list again only adds ports the pool does not have yet.')}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
                <div>
                  <label className={labelCls}><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
                  <select value={form.country} onChange={(e) => { set('country', e.target.value); set('state', ''); set('city', ''); setGeoOptions((o) => ({ ...o, region: [] })); }} className={selectCls} style={chevronStyle}>
                    <option value="">{t('proxyProviders.countries.any')}</option>
                    {countries.map(([code, name]) => <option key={code} value={code}>{`${name} (${code})`}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('proxyProviders.geo.howMany')}</label>
                  <input inputMode="numeric" value={form.count} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className={inputCls + ' font-mono'} placeholder="5" title={t('proxyProviders.ps.portsTitle', 'Ports in the new list, 1 to 1000. Each port is its own exit IP.')} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>{t('proxyProviders.ps.regionLabel', 'Region')} {optMarker}</label>
                  {regions.length ? (
                    <select value={form.state} onChange={(e) => { set('state', e.target.value); set('city', ''); }} className={selectCls} style={chevronStyle}>
                      <option value="">{t('proxyProviders.ps.anyRegion', 'Any region')}</option>
                      {regions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  ) : (
                    <input value={form.state} onChange={(e) => set('state', e.target.value)} disabled={!form.country} className={inputCls + ' disabled:opacity-60'} placeholder={t('proxyProviders.ps.anyRegion', 'Any region')} />
                  )}
                </div>
                <div>
                  <label className={labelCls}>{t('proxyProviders.geo.cityLabel')} {optMarker}</label>
                  {cities.length ? (
                    <select value={form.city} onChange={(e) => set('city', e.target.value)} className={selectCls} style={chevronStyle}>
                      <option value="">{t('proxyProviders.geo.anyCity', 'Any city')}</option>
                      {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  ) : (
                    <input value={form.city} onChange={(e) => set('city', e.target.value)} disabled={!form.state} className={inputCls + ' disabled:opacity-60'} placeholder={t('proxyProviders.geo.anyCity', 'Any city')} />
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => handleLookup('country')} disabled={Boolean(lookingUp) || !form.token.trim()} className={secondaryBtnCls}>{spin('country') || <Globe2 className="w-4 h-4" />} {t('proxyProviders.ps.loadCountries', 'Load all countries')}</button>
                <button type="button" onClick={() => handleLookup('region')} disabled={Boolean(lookingUp) || !form.country || !form.token.trim()} className={secondaryBtnCls}>{spin('region') || <MapPin className="w-4 h-4" />} {t('proxyProviders.ps.loadRegions', 'Load regions and cities')}</button>
              </div>
              <p className={hintCls}>{t('proxyProviders.ps.geoHint', 'Region and city names are case sensitive, so pick them from the loaded lists rather than typing them.')}</p>
              <div>
                <label className={labelCls}>{t('proxyProviders.ps.rotationLabel', 'IP rotation')}</label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => set('poolType', 'sticky')} className={segCls(mode === 'sticky')}>{t('proxyProviders.geo.diSticky', 'Sticky')}</button>
                  <button type="button" onClick={() => set('poolType', 'rotating')} className={segCls(mode === 'rotating')}>{t('proxyProviders.ps.perRequest', 'Every request')}</button>
                  <button type="button" onClick={() => { set('poolType', 'interval'); if (!form.life) set('life', '300'); }} className={segCls(mode === 'interval')}>{t('proxyProviders.ps.interval', 'On a timer')}</button>
                </div>
                {mode === 'interval' && (
                  <select value={form.life || '300'} onChange={(e) => set('life', e.target.value)} className={selectCls + ' mt-2 sm:max-w-[240px]'} style={chevronStyle}>
                    {PS_INTERVAL_OPTIONS.map((s) => <option key={s} value={s}>{t('proxyProviders.ps.everySeconds', { count: Number(s), defaultValue: 'Every {{count}} seconds' })}</option>)}
                  </select>
                )}
                <p className={hintCls + ' mt-1.5'}>{mode === 'sticky'
                  ? t('proxyProviders.ps.stickyHelp', 'Each port keeps its exit IP for as long as that device stays online. Best for logged-in profiles.')
                  : mode === 'rotating'
                    ? t('proxyProviders.ps.perRequestHelp', 'Each port gets a new exit IP on every request. Suits scraping, not logged-in profiles.')
                    : t('proxyProviders.ps.intervalHelp', 'Each port changes its exit IP on the timer you pick.')}</p>
              </div>
            </>
          )}
          </>
          )}
          <div className="sm:max-w-[200px]">
            <label className={labelCls}>{t('proxyProviders.geo.diProtocolLabel', 'Protocol')}</label>
            <select value={form.proxyType} onChange={(e) => set('proxyType', e.target.value)} className={selectCls} style={chevronStyle}>
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </div>
        </section>

        <button onClick={handleGeoSync} disabled={syncing} className={primaryBtnCls}>
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {!residential
            ? (orderCount
              ? t('proxyProviders.ps.addOrderCount', { count: orderCount, product: productLabel, defaultValue: 'Add {{count}} {{product}} proxies' })
              : t('proxyProviders.ps.addOrder', { product: productLabel, defaultValue: 'Add {{product}} proxies' }))
            : existing
              ? t('proxyProviders.ps.pullList', 'Add proxies from this list')
              : t('proxyProviders.ps.createList', { count: pullCount, defaultValue: 'Create list and add {{count}} proxies' })}
          {residential && !existing && form.country ? ` · ${form.country}` : ''}
        </button>
        <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t('proxyProviders.geoHints.proxyseller', 'A Proxy-Seller residential list is one login with up to 1000 ports, and each port is its own exit IP. Every New list pull creates a list on your account named SoftGlaze plus the location and time, so you can see and delete it in the dashboard. Traffic comes out of your residential package.')}</p>
      </div>
    );
  };

  // ---- IPRoyal residential: token, credentials, what to add, where ----
  const renderIpRoyal = () => {
    const sticky = form.poolType === 'sticky';
    const isIpr = account && account.provider === 'iproyal';
    const subusers = isIpr && Array.isArray(account.subusers) ? account.subusers : [];
    const useSub = Boolean(form.subuserHash);
    const countries = geoOptions.country.length ? geoOptions.country.map((c) => [c.key.toUpperCase(), c.label]) : PROXY_COUNTRIES.filter(([code]) => code);
    const states = geoOptions.region;
    const stateHit = states.find((s) => s.key === form.state);
    const cities = stateHit ? stateHit.cities : geoOptions.city;
    return (
      <div className="space-y-4 max-w-2xl">
        <section className={sectionCls}>
          <div className={sectionTitleCls}><KeyRound className="w-4 h-4 text-violet-400" /> {t('proxyProviders.ipr.keyTitle', 'API token')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
            <div>
              <label className={labelCls}>{t('proxyProviders.ipr.keyLabel', 'IPRoyal API token')}</label>
              <input type="password" value={form.token} onChange={(e) => set('token', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.ipr.keyPlaceholder', 'Paste the token from Dashboard, Settings, API')} autoComplete="off" />
            </div>
            <button type="button" onClick={() => handleLookup('')} disabled={Boolean(lookingUp)} className={secondaryBtnCls}>
              {spin('account') || <Gauge className="w-4 h-4" />} {t('proxyProviders.account.checkAccount', 'Check account')}
            </button>
          </div>
          <p className={hintCls}>{t('proxyProviders.ipr.keyHint', 'The token is in the IPRoyal dashboard under Settings, API. It is stored encrypted on this machine.')}</p>
          {renderAccount()}
          {isIpr && <p className={hintCls}>{t('proxyProviders.account.subusers', { count: account.subusersCount, defaultValue: '{{count}} sub-users' })}</p>}
        </section>

        <section className={sectionCls}>
          <div className={sectionTitleCls}><ShieldCheck className="w-4 h-4 text-emerald-400" /> {t('proxyProviders.ipr.credsTitle', 'Proxy credentials')}</div>
          <div>
            <label className={labelCls}>{t('proxyProviders.ipr.subuserLabel', 'Sub-user')}</label>
            <select value={form.subuserHash} onChange={(e) => set('subuserHash', e.target.value)} className={selectCls} style={chevronStyle}>
              <option value="">{t('proxyProviders.ipr.useOwnCreds', 'Use a proxy username and password instead')}</option>
              {subusers.map((s) => <option key={s.hash} value={s.hash}>{`${s.username} · ${s.trafficGb.toFixed(2)} GB${s.shared ? ' (shared)' : ''}`}</option>)}
            </select>
            <p className={hintCls + ' mt-1.5'}>{subusers.length
              ? t('proxyProviders.ipr.subuserHint', 'A sub-user draws traffic from its own balance. Its password stays on IPRoyal; the app only sends its id.')
              : t('proxyProviders.ipr.noSubusers', 'Check account to list your sub-users, or enter the proxy username and password below.')}</p>
          </div>
          {!useSub && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{t('proxyProviders.ipr.usernameLabel', 'Proxy username')}</label>
                <input value={form.username} onChange={(e) => set('username', e.target.value)} className={inputCls + ' font-mono'} placeholder="username" autoComplete="off" />
              </div>
              <div>
                <label className={labelCls}>{t('proxyProviders.geo.proxyPasswordLabel')}</label>
                <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputCls + ' font-mono'} placeholder="password" autoComplete="off" />
              </div>
            </div>
          )}
        </section>

        <section className={sectionCls}>
          <div className={sectionTitleCls}><Layers className="w-4 h-4 text-sky-400" /> {t('proxyProviders.geo.diWhatTitle', 'What to add')}</div>
          <div>
            <label className={labelCls}>{t('proxyProviders.geo.diSessionLabel', 'Session')}</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => set('poolType', 'sticky')} className={segCls(sticky)}>{t('proxyProviders.geo.diSticky', 'Sticky')}</button>
              <button type="button" onClick={() => set('poolType', 'rotating')} className={segCls(!sticky)}>{t('proxyProviders.geo.diRotating', 'Rotating')}</button>
            </div>
            <p className={hintCls + ' mt-1.5'}>{sticky
              ? t('proxyProviders.ipr.stickyHelp', 'Each proxy gets its own session and keeps its exit IP for the time you pick below. Every pull adds new sessions.')
              : t('proxyProviders.geo.diRotatingHelp', 'One shared endpoint whose exit IP changes on every request. It adds a single proxy, so it suits scraping rather than logged-in profiles.')}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diAddLabel', 'How many to add')}</label>
              <input inputMode="numeric" value={sticky ? form.count : '1'} disabled={!sticky} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className={inputCls + ' font-mono disabled:opacity-60'} placeholder="5" />
            </div>
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diTtlLabel', 'Keep each IP for')}</label>
              <select value={form.life} disabled={!sticky} onChange={(e) => set('life', e.target.value)} className={selectCls + ' disabled:opacity-60'} style={chevronStyle}>
                <option value="">{t('proxyProviders.ipr.lifetimeDefault', 'Default (24 hours)')}</option>
                {IPR_LIFETIME_OPTIONS.map(([value, n, unit]) => (
                  <option key={value} value={value}>{unit === 'hours'
                    ? t('proxyProviders.ipr.lifetimeHours', { count: n, defaultValue: '{{count}} hours' })
                    : t('proxyProviders.geo.diTtlMinutes', { count: n, defaultValue: '{{count}} minutes' })}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diProtocolLabel', 'Protocol')}</label>
              <select value={form.proxyType} onChange={(e) => set('proxyType', e.target.value)} className={selectCls} style={chevronStyle}>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>
          </div>
        </section>

        <section className={sectionCls}>
          <div className={sectionTitleCls}><MapPin className="w-4 h-4 text-sky-400" /> {t('proxyProviders.geo.locationTitle', 'Location')}</div>
          <div className="sm:max-w-[320px]">
            <label className={labelCls}><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
            <select value={form.country} onChange={(e) => { set('country', e.target.value); set('state', ''); set('city', ''); setGeoOptions((o) => ({ ...o, region: [], city: [] })); }} className={selectCls} style={chevronStyle}>
              <option value="">{t('proxyProviders.countries.any')}</option>
              {countries.map(([code, name]) => <option key={code} value={code}>{`${name} (${code})`}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.stateLabel')} {optMarker}</label>
              <select value={form.state} disabled={!states.length} onChange={(e) => { set('state', e.target.value); set('city', ''); }} className={selectCls + ' disabled:opacity-60'} style={chevronStyle}>
                <option value="">{t('proxyProviders.geo.anyState', 'Any state')}</option>
                {states.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.cityLabel')} {optMarker}</label>
              <select value={form.city} disabled={!cities.length} onChange={(e) => set('city', e.target.value)} className={selectCls + ' disabled:opacity-60'} style={chevronStyle}>
                <option value="">{t('proxyProviders.geo.anyCity', 'Any city')}</option>
                {cities.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => handleLookup('country')} disabled={Boolean(lookingUp) || !form.token.trim()} className={secondaryBtnCls}>{spin('country') || <Globe2 className="w-4 h-4" />} {t('proxyProviders.ps.loadCountries', 'Load all countries')}</button>
            <button type="button" onClick={() => handleLookup('region')} disabled={Boolean(lookingUp) || !form.country || !form.token.trim()} className={secondaryBtnCls}>{spin('region') || <MapPin className="w-4 h-4" />} {t('proxyProviders.ipr.loadStates', 'Load states and cities')}</button>
          </div>
          <p className={hintCls}>{t('proxyProviders.ipr.geoHint', 'The lists come from your IPRoyal account, so they only show locations your plan can use.')}</p>
        </section>

        <button onClick={handleGeoSync} disabled={syncing} className={primaryBtnCls}>
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {sticky
            ? t('proxyProviders.geo.diAddSticky', { count: pullCount, defaultValue: 'Add {{count}} sticky proxies' })
            : t('proxyProviders.geo.diAddRotating', 'Add rotating gateway')}
          {form.country ? ` · ${form.country}` : ''}
        </button>
        <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t('proxyProviders.geoHints.iproyal', 'IPRoyal builds each proxy for you: the location and a sticky session go into the password, on its gateway geo.iproyal.com. Sticky proxies share one host and port, and each keeps its own exit IP for the lifetime you pick. Traffic comes out of your residential balance or the chosen sub-user.')}</p>
      </div>
    );
  };

  return (
    <Card className="bg-surface border-border flex flex-1 min-h-0 rounded shadow-xl overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] flex-1 min-h-0">
        {/* LEFT - provider grid */}
        <div className="border-b lg:border-b-0 lg:border-r border-border bg-card/40 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <Boxes className="w-4 h-4 text-primary" />
            <span className="text-[13px] font-semibold text-foreground">{t('proxyProviders.heading')}</span>
            <span className="ml-auto text-[10.5px] text-muted-foreground">{t('proxyProviders.integratedCount', { connected: PROVIDERS.filter((x) => !x.unavailable).length, total: PROVIDERS.length })}</span>
          </div>
          <div className="overflow-y-auto p-2 grid grid-cols-2 lg:grid-cols-1 gap-1.5">
            {PROVIDERS.map((p) => {
              const active = p.key === selectedKey;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setSelectedKey(p.key)}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors border ${active ? 'bg-primary/10 border-primary/30' : 'border-transparent hover:bg-card'}`}
                >
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${p.color} 16%, transparent)`, color: p.color, border: `1px solid color-mix(in srgb, ${p.color} 28%, transparent)` }}>
                    <ProviderLogo k={p.key} className="w-5 h-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12.5px] font-medium truncate ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{p.name}</span>
                    <span className="block text-[10px] text-muted-foreground/70">{p.unavailable ? t('proxyProviders.kind.notConnected') : p.tokenSync ? t('proxyProviders.kind.tokenSync') : p.geoSync ? t('proxyProviders.kind.geoPull') : t('proxyProviders.kind.rotatingGateway')}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT - dynamic configuration workspace */}
        <div className="overflow-y-auto p-5 min-h-0">
          {/* Promo banner */}
          <div className="rounded-xl p-5 mb-5 relative overflow-hidden" style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${provider.color} 22%, var(--card)), var(--card))`, border: `1px solid color-mix(in srgb, ${provider.color} 30%, transparent)` }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-20" style={{ background: provider.color, filter: 'blur(36px)' }} />
            <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-xl grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${provider.color} 20%, transparent)`, color: provider.color, border: `1px solid color-mix(in srgb, ${provider.color} 34%, transparent)` }}>
                  <ProviderLogo k={provider.key} className="w-7 h-7" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-foreground font-display">{provider.name}</h3>
                  <p className="text-[12px] text-muted-foreground">{t('proxyProviders.banner.subtitle')}</p>
                </div>
              </div>
              <a
                href={referral}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-lg text-[13px] font-semibold text-white shadow-lg shrink-0"
                style={{ background: provider.color, boxShadow: `0 10px 30px -10px ${provider.color}` }}
              >
                <Zap className="w-4 h-4" />
                {provider.tokenSync ? t('proxyProviders.banner.purchaseAt', { provider: provider.name }) : t('proxyProviders.banner.visitDashboard', { provider: provider.name })}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {err && <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-start gap-2"><X className="w-4 h-4 mt-0.5 shrink-0" />{err}</div>}

          {provider.tokenSync ? (
            /* ---- Token Sync mechanic ---- */
            <div className="space-y-4 max-w-2xl">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><KeyRound className="w-3.5 h-3.5 text-violet-400" /> {t('proxyProviders.tokenSync.label')}</label>
                  <span className={`text-[11px] font-mono ${form.token.length > 50 ? 'text-red-400' : 'text-muted-foreground'}`}>{form.token.length} / 50</span>
                </div>
                <input
                  type="password"
                  value={form.token}
                  maxLength={50}
                  autoComplete="off"
                  onChange={(e) => set('token', e.target.value)}
                  placeholder={t('proxyProviders.tokenSync.placeholder', { provider: provider.name })}
                  className={inputCls + ' font-mono'}
                />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSync} disabled={syncing} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-60 shadow-lg shadow-emerald-500/25">
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {t('proxyProviders.tokenSync.sync')}
                </button>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">
                {t('proxyProviders.tokenSync.helpBefore')}<span className="text-foreground font-medium">{t('proxyProviders.tokenSync.sync')}</span>{t('proxyProviders.tokenSync.helpAfter')}
              </p>
            </div>
          ) : provider.geoSync && provider.geoSync.di ? (
            renderDataImpulse()
          ) : provider.geoSync && provider.geoSync.ps ? (
            renderProxySeller()
          ) : provider.geoSync && provider.geoSync.ipr ? (
            renderIpRoyal()
          ) : provider.geoSync ? (
            /* ---- Geo-targeted pull (Apify / Smartproxy.org / ShopSocks5 / AnyIP) ---- */
            <div className="space-y-4 max-w-2xl">
              <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">{t('proxyProviders.geo.badge')}</span>
                  <span className="text-[13px] font-semibold text-foreground">{t('proxyProviders.geo.title')}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
                    <select value={form.country} onChange={(e) => set('country', e.target.value)} className={selectCls} style={chevronStyle}>
                      {PROXY_COUNTRIES.map(([code, name]) => <option key={code || 'any'} value={code}>{t(`proxyProviders.countries.${code || 'any'}`, name)}{code ? ` (${code})` : ''}</option>)}
                    </select>
                  </div>
                  {provider.geoSync.count && (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.howMany')}</label>
                      <input inputMode="numeric" value={form.count} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} className={inputCls + ' font-mono'} placeholder="5" title={t('proxyProviders.geo.howManyTitle', 'How many proxies to mint (up to 500).')} />
                    </div>
                  )}
                </div>

                {provider.geoSync.poolType && (
                  <div className="sm:max-w-[260px]">
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.poolTypeLabel')}</label>
                    <select value={form.poolType} onChange={(e) => set('poolType', e.target.value)} className={selectCls} style={chevronStyle}>
                      {(Array.isArray(provider.geoSync.poolType)
                        ? provider.geoSync.poolType
                        : [['residential', t('proxyProviders.geo.poolResidential')], ['mobile', t('proxyProviders.geo.poolMobile')]]
                      ).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                    </select>
                  </div>
                )}

                {provider.geoSync.apiKey && (
                  <div className="rounded-lg border border-border bg-card/40 p-3.5 space-y-3">
                    <p className="text-[11.5px] text-muted-foreground leading-relaxed">{t('proxyProviders.geo.anyipApiNote', 'Two ways to connect: paste your proxy Username + Password below (anyip dashboard → Get Proxy Details), OR enter an API key + Team ID here to auto-provision a proxy account. The API key is NOT the proxy password.')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><KeyRound className="w-3.5 h-3.5 text-violet-400" /> {t('proxyProviders.geo.apiKeyOptLabel', 'API key')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.optMarker')}</span></label>
                        <input type="password" value={form.token} onChange={(e) => set('token', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.anyipApiKeyPlaceholder', 'anyip API key')} autoComplete="off" />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.teamIdLabel', 'Team ID')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.optMarker')}</span></label>
                        <input value={form.teamId} onChange={(e) => set('teamId', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.teamIdPlaceholder', 'your anyip team id')} autoComplete="off" />
                      </div>
                    </div>
                  </div>
                )}

                {provider.geoSync.creds.includes('username') && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{provider.geoSync.apiKey ? t('proxyProviders.geo.anyipUserLabel', 'Proxy username (user_…)') : (provider.geoSync.shop ? t('proxyProviders.geo.usernameShopLabel') : t('proxyProviders.geo.usernameSubLabel'))}</label>
                    <input value={form.username} onChange={(e) => set('username', e.target.value)} className={inputCls + ' font-mono'} placeholder={provider.geoSync.apiKey ? 'user_XXXX' : (provider.geoSync.shop ? t('proxyProviders.geo.usernameShopPlaceholder') : 'username')} autoComplete="off" />
                  </div>
                )}

                {provider.geoSync.shop && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.planLabel')}</label>
                      <select value={form.plan} onChange={(e) => set('plan', e.target.value)} className={selectCls} style={chevronStyle}>
                        <option value="premium">{t('proxyProviders.geo.planPremium')}</option>
                        <option value="list">{t('proxyProviders.geo.planList')}</option>
                        <option value="daily">{t('proxyProviders.geo.planDaily')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.proxyTypeLabel')}</label>
                      <select value={form.proxyType} onChange={(e) => set('proxyType', e.target.value)} className={selectCls} style={chevronStyle}>
                        <option value="proxy_sock_5">SOCKS5</option>
                        <option value="proxy_https">HTTPS</option>
                      </select>
                    </div>
                  </div>
                )}
                {provider.geoSync.creds.includes('password') && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{provider.key === 'apify' ? t('proxyProviders.geo.apifyPasswordLabel', { provider: 'Apify' }) : t('proxyProviders.geo.proxyPasswordLabel')}</label>
                    <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputCls + ' font-mono'} placeholder="password" autoComplete="off" />
                  </div>
                )}
                {provider.geoSync.creds.includes('token') && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><KeyRound className="w-3.5 h-3.5 text-violet-400" /> {t('proxyProviders.geo.apiTokenLabel')}</label>
                    <input type="password" value={form.token} onChange={(e) => set('token', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.apiTokenPlaceholder', { provider: provider.name })} autoComplete="off" />
                  </div>
                )}

                {provider.geoSync.geo && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.stateLabel')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.optMarker')}</span></label>
                      <input value={form.state} onChange={(e) => set('state', e.target.value)} className={inputCls + ' font-mono'} placeholder="California" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.cityLabel')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.optMarker')}</span></label>
                      <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls + ' font-mono'} placeholder="NewYork" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.stickySessionLabel')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.optMarker')}</span></label>
                      <input value={form.session} onChange={(e) => set('session', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.stickySessionPlaceholder')} />
                    </div>
                  </div>
                )}

                {provider.geoSync.session && (
                  <div className="sm:max-w-[260px]">
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.stickySessionLabel')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.optMarker')}</span></label>
                    <input value={form.session} onChange={(e) => set('session', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.stickySessionPlaceholder')} />
                  </div>
                )}

                {provider.geoSync.life && (
                  <div className="sm:max-w-[260px]">
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.keepSameIpLabel')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.timeMarker')}</span></label>
                    <select value={form.life} onChange={(e) => set('life', e.target.value)} className={selectCls} style={chevronStyle}>
                      <option value="">{t('proxyProviders.geo.lifeDifferent')}</option>
                      <option value="5">{t('proxyProviders.geo.life5')}</option>
                      <option value="10">{t('proxyProviders.geo.life10')}</option>
                      <option value="30">{t('proxyProviders.geo.life30')}</option>
                      <option value="60">{t('proxyProviders.geo.life60')}</option>
                      <option value="120">{t('proxyProviders.geo.life120')}</option>
                      <option value="360">{t('proxyProviders.geo.life360')}</option>
                      <option value="720">{t('proxyProviders.geo.life720')}</option>
                      <option value="1440">{t('proxyProviders.geo.life1440')}</option>
                    </select>
                  </div>
                )}

                {provider.geoSync.gateway && (
                  <div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.gatewayHostLabel')}</label>
                        <input value={form.host} onChange={(e) => set('host', e.target.value)} className={inputCls + ' font-mono'} placeholder="isp.smartproxy.net" />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.geo.portLabel')}</label>
                        <input value={form.port} onChange={(e) => set('port', e.target.value)} className={inputCls + ' font-mono'} placeholder="3100" />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground/90">{t('proxyProviders.geo.gatewayHint')}</p>
                  </div>
                )}

                {provider.geoSync.apiUrl && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-amber-400">{t('proxyProviders.geo.apiUrlLabel')}</label>
                    <input value={form.apiUrl} onChange={(e) => set('apiUrl', e.target.value)} className={inputCls + ' font-mono text-[12px]'} placeholder="https://shopsocks5.com/api/...  (paste from SOCKS5 API guide)" autoComplete="off" />
                    <p className="mt-1 text-[11px] text-amber-400/90">{t('proxyProviders.geo.apiUrlHintBefore')}<span className="font-mono text-foreground">{'{country}'}</span>{t('proxyProviders.geo.apiUrlHintAfter')}</p>
                  </div>
                )}

                <button onClick={handleGeoSync} disabled={syncing} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-60 shadow-lg shadow-sky-500/25">
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe2 className="w-4 h-4" />} {t('proxyProviders.geo.pullProxies')}{form.country ? ` · ${form.country}` : ''}
                </button>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t(`proxyProviders.geoHints.${provider.key}`, GEO_HINTS[provider.key])}</p>
            </div>
          ) : (
            /* ---- Rotating engine configuration form ---- */
            <div className="space-y-4 max-w-2xl">
              {/* No automatic pull for this vendor yet. Say so, then let the operator
                  enter the real details their dashboard gives them. Storing the API key
                  here means it is already in place the day the connector lands. */}
              {provider.unavailable && (
                <>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12.5px] text-amber-200/90">
                    {t('proxyProviders.notConnected.body', { provider: provider.name })}
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <KeyRound className="w-3.5 h-3.5 text-violet-400" />
                      {t('proxyProviders.notConnected.apiKeyLabel')}
                      <span className="normal-case text-muted-foreground/60">{t('proxyProviders.geo.optMarker')}</span>
                    </label>
                    <input
                      type="password"
                      value={form.token}
                      onChange={(e) => set('token', e.target.value)}
                      className={inputCls + ' font-mono'}
                      placeholder={t('proxyProviders.notConnected.apiKeyPlaceholder', { provider: provider.name })}
                      autoComplete="off"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">{t('proxyProviders.notConnected.apiKeyHint')}</p>
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.rotating.hostPortLabel')}</label>
                  <input value={form.host} onChange={(e) => set('host', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.rotating.hostPlaceholder')} />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.rotating.portLabel')}</label>
                  <input value={form.port} onChange={(e) => set('port', e.target.value)} className={inputCls + ' font-mono'} placeholder="port" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.rotating.usernameLabel')}</label>
                  <input value={form.username} onChange={(e) => set('username', e.target.value)} className={inputCls + ' font-mono'} placeholder="username" autoComplete="off" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.rotating.passwordLabel')}</label>
                  <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputCls + ' font-mono'} placeholder="password" autoComplete="off" />
                </div>
              </div>

              {/* Bright Data BDPM specialized toggle */}
              {provider.bdpm && (
                <label className="flex items-start gap-2.5 text-[12.5px] text-muted-foreground cursor-pointer bg-card border border-border rounded-lg px-3.5 py-3">
                  <input type="checkbox" checked={form.bdpm} onChange={(e) => set('bdpm', e.target.checked)} className="accent-primary mt-0.5" />
                  <span><span className="text-foreground font-medium">{t('proxyProviders.rotating.bdpmLabel')}</span> {t('proxyProviders.rotating.bdpmDesc')}</span>
                </label>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={handleSaveCreds} disabled={savingCreds} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground border border-border disabled:opacity-60">
                  {savingCreds ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('proxyProviders.rotating.saveCreds')}
                </button>
                {credsSaved && <span className="text-[12.5px] font-medium text-emerald-400">{t('proxyProviders.rotating.credsSaved')}</span>}
                <button onClick={handleCheck} disabled={checking} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground border border-border disabled:opacity-60">
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} {t('proxyProviders.rotating.checkProxy')}
                </button>
                {checkResult && (
                  checkResult.success ? (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-400"><ShieldCheck className="w-4 h-4" /> {checkResult.ip || t('proxyProviders.rotating.ok')}{checkResult.country ? ` · ${checkResult.country}` : ''}{typeof checkResult.latencyMs === 'number' ? ` · ${checkResult.latencyMs}ms` : ''}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-red-400" title={checkResult.error}><X className="w-4 h-4" /> {String(checkResult.error || t('proxyProviders.rotating.failed')).slice(0, 60)}</span>
                  )
                )}
              </div>
              <p className="text-[11.5px] text-muted-foreground italic">{t('proxyProviders.rotating.tip')}</p>

              {/* Live API sync for wired vendors */}
              {provider.apiSync && (
                <div className="mt-1 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{t('proxyProviders.apiSync.badge')}</span>
                    <span className="text-[13px] font-semibold text-foreground">{t('proxyProviders.apiSync.title')}</span>
                  </div>
                  {provider.key === 'brightdata' ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.apiSync.apiTokenLabel')}</label>
                          <input type="password" value={form.apiToken} onChange={(e) => set('apiToken', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.apiSync.apiTokenPlaceholder', { provider: 'Bright Data' })} autoComplete="off" />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('proxyProviders.apiSync.zoneLabel')} <span className="normal-case text-muted-foreground/60">{t('proxyProviders.apiSync.optionalMarker')}</span></label>
                          <input value={form.zone} onChange={(e) => set('zone', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.apiSync.zonePlaceholder')} />
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t('proxyProviders.apiSync.brightDataHelp', { provider: 'Bright Data' })}</p>
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground">{t('proxyProviders.apiSync.verifyBefore')}<span className="text-foreground font-medium">{t('proxyProviders.apiSync.verifyCreds')}</span>{t('proxyProviders.apiSync.verifyAfter', { provider: provider.name })}</p>
                  )}
                  {provider.ipv6 && (
                    <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={form.ipv6} onChange={(e) => set('ipv6', e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500 cursor-pointer" />
                        <span>
                          <span className="block text-[12.5px] font-semibold text-foreground">{t('proxyProviders.apiSync.ipv6Label', 'Request IPv6 exits')}</span>
                          <span className="block text-[11.5px] text-muted-foreground leading-relaxed">{t('proxyProviders.apiSync.ipv6Help', 'Appends -ipversion-6 to the username. If the target site publishes no AAAA record, Oxylabs falls back to IPv4 automatically, so an IPv6 pull does not guarantee an IPv6 exit. May need enabling on your Oxylabs account first.')}</span>
                        </span>
                      </label>
                    </div>
                  )}
                  <button onClick={handleApiSync} disabled={syncing} className="mt-3 inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold text-white bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-60 shadow-lg shadow-emerald-500/25">
                    {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {t('proxyProviders.apiSync.syncViaApi')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Sync result */}
          {syncResult && (
            <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 max-w-2xl">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-400 mb-1.5"><Check className="w-4 h-4" /> {t('proxyProviders.result.syncedInto', { provider: syncResult.provider })}</div>
              <div className="grid grid-cols-3 gap-3 text-[12px] font-mono text-muted-foreground">
                <div>{t('proxyProviders.result.returned', { count: syncResult.total })}</div>
                <div className="text-emerald-400">{t('proxyProviders.result.added', { count: syncResult.created?.length ?? 0 })}</div>
                <div className="text-amber-400">{t('proxyProviders.result.existing', { count: syncResult.skipped?.length ?? 0 })}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// Local lightweight Card wrapper to avoid an extra import cycle; mirrors the
// page's card surface.
function Card({ className = '', children }) {
  return <div className={className}>{children}</div>;
}

// Distinctive, ORIGINAL stylized marks per provider (not the vendors' actual
// trademarked logos). They inherit the tile's brand color via `currentColor`, so
// dropping in a real brand SVG later is a one-spot swap per provider.
export function ProviderLogo({ k, className = 'w-6 h-6' }) {
  const line = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const solid = { className, viewBox: '0 0 24 24', fill: 'currentColor', stroke: 'none' };
  switch (k) {
    case 'brightdata': // globe + meridian orbit
      return (<svg {...line}><circle cx="12" cy="12" r="7.5" /><path d="M4.5 12h15" /><path d="M12 4.5c2.6 2.2 2.6 12.8 0 15M12 4.5c-2.6 2.2-2.6 12.8 0 15" /></svg>);
    case 'oxylabs': // ring + node
      return (<svg {...line}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" /></svg>);
    case 'smartproxy': // shield check
      return (<svg {...line}><path d="M12 3l7 2.5V11c0 4.2-2.9 7.3-7 8.5C7.9 18.3 5 15.2 5 11V5.5z" /><path d="M9 12l2 2 4-4" /></svg>);
    case 'ipfoxy': // fox head
      return (<svg {...line}><path d="M5 4l3.6 3M19 4l-3.6 3" /><path d="M6 7l6 12 6-12-6 2.4z" /><path d="M10.6 12.4h2.8" /></svg>);
    case 'lumiproxy': // sun / lumen
      return (<svg {...line}><circle cx="12" cy="12" r="4" /><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8" /></svg>);
    case 'proxy302': // bolt
      return (<svg {...solid}><path d="M13 2L5 13h5l-1 9 8-12h-5z" /></svg>);
    case 'mangoproxy': // mango + leaf
      return (<svg {...line}><path d="M12 3.5c5 2 6.8 6.5 5.3 11C16 18.7 12 21 8.2 19.4 4.7 17.9 4.2 12.6 6.6 8.7 8 6.2 10 4.4 12 3.5z" /><path d="M12 4.5c1 2.4 1 4.8 0 7.2" /></svg>);
    case 'kookeey': // key
      return (<svg {...line}><circle cx="8.5" cy="8.5" r="4" /><path d="M11.3 11.3L20 20M16.5 16.5l2-2" /></svg>);
    case 'luna': // crescent
      return (<svg {...solid}><path d="M20 13.6A8 8 0 1 1 10.4 4a6.5 6.5 0 0 0 9.6 9.6z" /></svg>);
    case 'ipburger': // burger
      return (<svg {...line}><path d="M4 9c1-3.2 4.2-5 8-5s7 1.8 8 5" /><path d="M4 12.5h16" /><path d="M5 16h14a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 16z" /></svg>);
    case 'tisocks': // sock
      return (<svg {...line}><path d="M10 3v8l-3.2 3.2a3.6 3.6 0 0 0 5.1 5.1l4.1-4.1-3-3V3z" /><path d="M10 3h5" /></svg>);
    case 'shopsocks5': // shopping bag
      return (<svg {...line}><path d="M6.5 8h11l-1 11.5H7.5z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>);
    case 'apify': // crawler node + spokes
      return (<svg {...line}><circle cx="12" cy="12" r="3" /><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M5 5l2.4 2.4M16.6 16.6L19 19M19 5l-2.4 2.4M7.4 16.6L5 19" /></svg>);
    case 'smartproxyorg': // location pin
      return (<svg {...line}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>);
    case 'anyip': // concentric rings
      return (<svg {...line}><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="9" /></svg>);
    case 'dataimpulse': // pulse line
      return (<svg {...line}><path d="M3 12h4l2.5-6 5 12 2.5-6H21" /></svg>);
    case 'iproyal': // crown
      return (<svg {...line}><path d="M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z" /><path d="M5 20h14" /></svg>);
    case 'proxyseller': // stacked list rows
      return (<svg {...line}><rect x="4" y="4.5" width="16" height="4" rx="1.2" /><rect x="4" y="10" width="16" height="4" rx="1.2" /><rect x="4" y="15.5" width="16" height="4" rx="1.2" /></svg>);
    default:
      return (<svg {...line}><circle cx="12" cy="12" r="7" /></svg>);
  }
}
