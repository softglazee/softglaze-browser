import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Boxes, ExternalLink, KeyRound, Loader2, Check, Activity, RefreshCw, ShieldCheck, Zap, X, Globe2,
  Plus, Gauge, MapPin, SlidersHorizontal, Layers
} from 'lucide-react';
import { softglazeApi } from '@/lib/softglazeApi.js';
import { usePermissions } from '@/lib/usePermissions.js';
import { getLogo } from '@/lib/providerLogos.js';
import { countryOptions } from '@/lib/countries.mjs';
import { geoForPool, lifeBlankLabel, lifeOptionsFor } from '@/lib/gatewayPull.mjs';
import i18n from '@/i18n/index.js';
import cmpSettingsCEn from '@/i18n/locales/en/cmpSettingsC.json';
import cmpSettingsCEs from '@/i18n/locales/es/cmpSettingsC.json';

// Registers cmpSettingsC without touching the central i18n config; the guard keeps it safe across
// hot reloads and IpProvidersSettings' identical registration.
if (!i18n.hasResourceBundle('en', 'cmpSettingsC')) i18n.addResourceBundle('en', 'cmpSettingsC', cmpSettingsCEn);
if (!i18n.hasResourceBundle('es', 'cmpSettingsC')) i18n.addResourceBundle('es', 'cmpSettingsC', cmpSettingsCEs);

// PacketStream's dashboard Location list. Its password takes the country's dashboard name, and an
// unknown one is ignored (the exit lands anywhere), so the picker offers only these. Mirrors
// PACKETSTREAM_COUNTRIES in src/main/proxyVendorUtils.js.
const PACKETSTREAM_COUNTRY_CODES = [
  'US', 'CA', 'AF', 'AL', 'DZ', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ', 'BS', 'BH', 'BD', 'BY', 'BE', 'BA', 'BR', 'VG', 'BN',
  'BG', 'KH', 'CM', 'CL', 'CN', 'CO', 'CR', 'HR', 'CU', 'CY', 'CZ', 'DK', 'DO', 'EC', 'EG', 'SV', 'EE', 'ET', 'FI', 'FR',
  'GE', 'DE', 'GH', 'GR', 'GT', 'GY', 'JO', 'HK', 'HU', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IL', 'IT', 'JM', 'JP', 'KZ', 'KE',
  'KW', 'LV', 'LI', 'LU', 'MK', 'MG', 'MY', 'MU', 'MX', 'MN', 'ME', 'MA', 'MZ', 'MM', 'NP', 'NL', 'NZ', 'NG', 'NO', 'OM',
  'PK', 'PS', 'PA', 'PG', 'PY', 'PE', 'PH', 'PL', 'PT', 'PR', 'QA', 'LT', 'MD', 'RO', 'RU', 'SA', 'SN', 'RS', 'SC', 'SG',
  'SK', 'SI', 'SO', 'ZA', 'KR', 'ES', 'LK', 'SD', 'SR', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TH', 'TT', 'TN', 'TR', 'UG', 'UA',
  'AE', 'GB', 'UZ', 'VE', 'VN', 'ZM'
];

// Static partner-vendor catalog. tokenSync providers show a Proxy Token + Sync form instead of
// the host form; cards use initials tiles because lucide has no brand logos.
// referral is the Dashboard button: the owner's affiliate link where the vendor's program is live,
// otherwise the vendor's plain site or dashboard (never a made-up ref parameter). The Owner can
// override any of them in Settings, Monetization.
// geoSync.labels names the i18n keys (proxyProviders.geo.*) of a connector's credential fields when
// the vendor calls them something else; geoSync.optional lists credential fields that may stay blank.
// geoSync.geoPools lists the pools that take State, City and ASN when the others target a country
// only; maxLifeByPool gives a pool its own longest Keep same IP time (it also cuts a lifeOptions list);
// countryRequired drops Any / Random for a vendor that needs a country; sessionDigits limits
// the sticky session to that many digits; protoHttps adds HTTPS (TLS to the proxy) to Protocol;
// regions lists the pools whose gateway region is picked in a Gateway select (sent as zone, saved
// with the credentials). gateway.socksPort is a separate SOCKS5 port on the same host, shown on the
// provider page.
export const PROVIDERS = [
  // IPFoxy holds a sticky IP for 30 or 60 minutes (its -ttl- takes those two), so only they are offered.
  { key: 'ipfoxy', name: 'IPFoxy', initials: 'IF', color: '#f97316', referral: 'https://app.ipfoxy.com/', gateway: { host: 'gate-us.ipfoxy.io', port: 58688, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, geo: true, session: true, life: true, lifeOptions: [30, 60], proto: true, gateway: true } },
  // apiMint: the API Sync box also mints sticky or rotating usernames on the gateway (zone adds
  // Bright Data's dedicated-IP list; life and proto add a session lifetime and SOCKS5; stateCode means
  // the vendor takes a US state as its two-letter code).
  { key: 'brightdata', name: 'Bright Data', initials: 'BD', color: '#00b4d8', apiSync: true, apiMint: { zone: true, stateCode: true }, referral: 'https://brightdata.com/', gateway: { host: 'brd.superproxy.io', port: 44445, type: 'HTTP' } },
  { key: 'oxylabs', name: 'Oxylabs', initials: 'OX', color: '#7c5cff', apiSync: true, apiMint: { life: true, proto: true }, ipv6: true, referral: 'https://oxylabs.io/', gateway: { host: 'pr.oxylabs.io', port: 7777, type: 'HTTP' } },
  // Decodo, formerly Smartproxy, whose docs name gate.decodo.com. The key stays smartproxy because
  // stored proxies and saved settings use it; the name carries both so a search finds either.
  { key: 'smartproxy', name: 'Decodo (Smartproxy)', initials: 'DC', color: '#ff6b35', apiSync: true, apiMint: { life: true, proto: true }, referral: 'https://dashboard.decodo.com/', gateway: { host: 'gate.decodo.com', port: 7000, type: 'HTTP' } },
  // Proxy302: real Open API. The API key (id + secret) signs in; each proxy is bought ready, and its
  // host and port come back from the API (no fixed gateway). Premium line takes state/city and keeps
  // Proxy302's fixed session time or rotates; Standard line takes rotating or a sticky time.
  { key: 'proxy302', name: 'Proxy302', initials: '302', color: '#3b82f6', referral: 'https://proxy302.com/register?ref=0abaab08fed00be49a', gateway: null, geoSync: { creds: ['username', 'password'], labels: { username: 'apiKeyIdLabel', password: 'apiKeySecretLabel' }, poolType: [['premium', 'Premium line'], ['standard', 'Standard line']], count: true, geo: true, geoPools: ['premium'], noSession: true, life: true, lifeOptions: [10, 30, 60, 120], proto: true } },
  // MangoProxy: Residential Light and dynamic datacenter target a country only.
  { key: 'mangoproxy', name: 'MangoProxy', initials: 'MP', color: '#f59e0b', referral: 'https://my.mangoproxy.com/', gateway: null, geoSync: { creds: ['token', 'username'], optional: ['username'], labels: { token: 'apiKeyLabel', username: 'usernameSubLabel' }, poolType: [['residential', 'Residential'], ['residential_light', 'Residential light'], ['datacenter', 'Datacenter'], ['isp', 'ISP']], count: true, geo: true, asn: true, geoPools: ['residential', 'isp'], countryLookup: true, noSession: true, life: true, maxLife: 120, proto: true } },
  // IP Burger: rotating residential, gateway-minted on residential.ipb.cloud:7777 (HTTP only -
  // no SOCKS5 on their residential network). Country (or one city/state narrowing token) and a
  // sticky session (up to 30 min) ride in the username.
  { key: 'ipburger', name: 'IP Burger', initials: 'IB', color: '#ef4444', referral: 'https://secure.ipburger.com/aff.php?aff=3283', gateway: { host: 'residential.ipb.cloud', port: 7777, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, geo: true, session: true, life: true, maxLife: 30, gateway: true } },
  // Apify: a US state rides in the country flag (country-US_CA), so only a state code is offered.
  { key: 'apify', name: 'Apify Residential', initials: 'AP', color: '#22c55e', referral: 'https://apify.com/', gateway: { host: 'proxy.apify.com', port: 8000, type: 'HTTP' }, geoSync: { creds: ['password'], count: true, usState: true } },
  // AnyIP: countries from its location reference (dashboard.anyip.io/api/data/country).
  { key: 'anyip', name: 'AnyIP', initials: 'AN', color: '#0ea5e9', referral: 'https://anyip.io/account', gateway: { host: 'portal.anyip.io', port: 1080, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], apiKey: true, count: true, geo: true, session: true, life: true, gateway: true, poolType: true, proto: true, maxLife: 10080, countries: ['AE', 'AF', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BN', 'BO', 'BR', 'BT', 'BW', 'BY', 'CA', 'CD', 'CG', 'CH', 'CI', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CY', 'CZ', 'DE', 'DK', 'DO', 'DZ', 'EC', 'EE', 'EG', 'ES', 'ET', 'FI', 'FR', 'GA', 'GB', 'GE', 'GH', 'GR', 'GT', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IN', 'IQ', 'IR', 'IT', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LK', 'LR', 'LT', 'LU', 'LV', 'LY', 'MA', 'MD', 'ME', 'MG', 'MK', 'ML', 'MM', 'MN', 'MR', 'MT', 'MU', 'MW', 'MX', 'MY', 'MZ', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NZ', 'OM', 'PA', 'PE', 'PH', 'PK', 'PL', 'PR', 'PS', 'PT', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SD', 'SE', 'SI', 'SK', 'SN', 'SO', 'SS', 'SV', 'SY', 'TG', 'TH', 'TJ', 'TL', 'TN', 'TR', 'TT', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VE', 'VN', 'XK', 'YE', 'ZA', 'ZM', 'ZW'] } },
  // DataImpulse is a real list pull: GET /api/list returns login:password@host:port rows, so geo
  // (state/city), count and life (session_ttl) map to documented query parameters.
  { key: 'dataimpulse', name: 'DataImpulse', initials: 'DI', color: '#a3e635', referral: 'https://dataimpulse.com/?aff=e2951081-05fc-4c8e-946b-d92baee174c1', gateway: { host: 'gw.dataimpulse.com', port: 823, type: 'HTTP', socksPort: 824 }, geoSync: { creds: ['username', 'password'], count: true, geo: true, life: true, di: true } },
  // Proxy-Seller residential: the API key creates a list (geo + rotation + N ports, each
  // port its own exit IP) and downloads it, or downloads a list made in the dashboard.
  { key: 'proxyseller', name: 'Proxy-Seller', initials: 'PS', color: '#22c55e', referral: 'https://proxy-seller.com/personal/api/', gateway: null, geoSync: { creds: ['token'], count: true, ps: true } },
  // IPRoyal residential: an API token generates ready proxy lines for a sub-user (or the
  // proxy username + password), with country/state/city and sticky lifetime in the password.
  { key: 'iproyal', name: 'IPRoyal', initials: 'IR', color: '#f59e0b', referral: 'https://dashboard.iproyal.com/', gateway: null, geoSync: { creds: ['token'], count: true, ipr: true } },
  // MarsProxies residential: an API token generates a proxy list for a sub-user. One proxy with Keep
  // same IP blank rotates; more, or a Keep same IP time (up to 7 days), are sticky. Residential only.
  { key: 'marsproxies', name: 'MarsProxies', initials: 'MA', color: '#e11d48', referral: 'https://dashboard.marsproxies.com/', gateway: null, geoSync: { creds: ['token', 'username', 'password'], labels: { username: 'subUserLabel', password: 'subUserPasswordLabel' }, count: true, geo: true, noSession: true, life: true, maxLife: 10080, proto: true } },
  // NodeMaven: no list endpoint; the app builds each proxy against gate.nodemaven.com with the
  // targeting in the username. Proxy username + password come from the dashboard (Proxy Setup).
  // A city with a space ("New York") becomes new_york, which NodeMaven matches; "NewYork" does not.
  { key: 'nodemaven', name: 'NodeMaven', initials: 'NM', color: '#6366f1', referral: 'https://nodemaven.com/', gateway: { host: 'gate.nodemaven.com', port: 8080, type: 'HTTP', socksPort: 1080 }, geoSync: { creds: ['username', 'password'], count: true, poolType: true, geo: true, cityPlaceholder: 'New York', life: true, proto: true } },
  // Froxy (SOAX reseller): login + password from the dashboard Export Proxy List, targeting in
  // the password against proxy.froxy.com. The password's type word (wifi, mobile, shared) sets the
  // Pool type. Each port from 9000 up is its own sticky exit IP, so there is no session field.
  { key: 'froxy', name: 'Froxy', initials: 'FX', color: '#7c3aed', referral: 'https://froxy.com/?fpr=qwsg97', gateway: { host: 'proxy.froxy.com', port: 9000, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, poolType: [['residential', 'Residential'], ['mobile', 'Mobile'], ['datacenter', 'Datacenter']], geo: true, noSession: true, proto: true } },
  // Proxidize: a Bearer token. Per-Proxy plans return ready credentials for a per-proxy
  // username; Per-GB plans build from an access point on pg.proxi.es, with country, state, city
  // and a sticky session in the username. The username is the Per-Proxy plan's; leave it blank for Per GB.
  { key: 'proxidize', name: 'Proxidize', initials: 'PX', color: '#0ea5e9', referral: 'https://proxidize.com/get/23265/', gateway: { host: 'pg.proxi.es', port: 20000, type: 'HTTP', socksPort: 20002 }, geoSync: { creds: ['token', 'username'], optional: ['username'], labels: { username: 'perProxyUsernameLabel' }, count: true, geo: true, poolType: true, gateway: true, proto: true } },
  // Live Proxies: proxies are built on its B2B gateway from the account username (LV...) and
  // password under Proxy Information. Every line needs a country, and a sticky session is 1 to 8
  // digits. Static residential and mobile are not offered: the public docs give no way for a B2B
  // gateway login to ask for them.
  { key: 'liveproxies', name: 'Live Proxies', initials: 'LV', color: '#10b981', referral: 'https://liveproxies.io/dashboard/overview', gateway: null, geoSync: { creds: ['username', 'password'], count: true, session: true, sessionDigits: 8, countryRequired: true, proto: true } },
  // PacketStream: one residential gateway. Username + auth key from the dashboard Proxy Access page;
  // country + sticky session ride in the auth key. No state/city. HTTPS (31111, TLS to the proxy) is
  // the one PacketStream recommends; HTTP (31112) and SOCKS5 (31113) too.
  { key: 'packetstream', name: 'PacketStream', initials: 'PK', color: '#3b82f6', referral: 'https://packetstream.io/?psr=kkmtnsnqag', gateway: { host: 'proxy.packetstream.io', port: 31112, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], labels: { password: 'authKeyLabel' }, count: true, session: true, proto: true, protoHttps: true, countries: PACKETSTREAM_COUNTRY_CODES } },
  // Airproxy: dedicated mobile proxies, all in Italy. The API key lists the proxies already on the
  // account (GET /api/proxy/list/); location is fixed by the SIM, so no country control.
  { key: 'airproxy', name: 'Airproxy', initials: 'AR', color: '#fb923c', referral: 'https://airproxy.io/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true, proto: true } },
  // CatProxies: the cp_ API key + a Plan ID (from Active Plans) fetch that plan's proxy
  // credentials; targeting rides in the username (the password on Premium Residential). Each of those
  // pools has a US, a Europe and an Asia gateway (regions). Mobile holds a sticky IP for at most 4 hours
  // (its ttl steps include 3 and 4 hours) and Premium for 7 days. ISP and Datacenter plans have fixed IPs
  // and import as a list;
  // Datacenter can filter by country.
  { key: 'catproxies', name: 'CatProxies', initials: 'CP', color: '#eab308', referral: 'https://catproxies.com/?ref=hrkymfu', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, planId: true, poolType: [['residential', 'Standard Residential'], ['residential_premium', 'Premium Residential'], ['mobile', 'Rotating Mobile'], ['isp', 'Dedicated or Custom ISP'], ['datacenter', 'Datacenter']], regions: ['residential', 'residential_premium', 'mobile'], count: true, geo: true, session: true, life: true, lifeOptions: [5, 10, 30, 60, 120, 180, 240, 360, 720, 1440, 4320, 10080], maxLifeByPool: { residential: 1440, mobile: 240, isp: 1440, datacenter: 1440 }, proto: true } },
  // RapidProxy: no management API, so rows are minted on us.rapidproxy.io:5001 (HTTP and SOCKS5) from a
  // dashboard sub-account; country/state/city and a sticky session (up to 180 min) ride in the username.
  { key: 'rapidproxy', name: 'RapidProxy', initials: 'RP', color: '#06b6d4', referral: 'https://www.rapidproxy.io/?code=ZCHGKEK10', gateway: { host: 'us.rapidproxy.io', port: 5001, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], labels: { username: 'usernameSubLabel' }, count: true, geo: true, life: true, lifeOptions: [5, 10, 30, 60, 120, 180], proto: true, gateway: true } },
  // NOVADA: a proxy user (not the login email) on super.novada.pro:7777; zone, country, state,
  // city and a sticky session (up to 120 min, 360 on Rotating ISP) ride in the username. Hosts are
  // per account, so the gateway is overridable.
  { key: 'novada', name: 'NOVADA', initials: 'NV', color: '#2563eb', referral: 'https://www.novada.com/?referral_code=tdNnxS', gateway: { host: 'super.novada.pro', port: 7777, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], poolType: [['residential', 'Residential'], ['isp', 'Rotating ISP'], ['mobile', 'Mobile']], count: true, geo: true, life: true, maxLife: 120, maxLifeByPool: { isp: 360 }, gateway: true } },
  // Proxies.sx: the API key reads the gateway login + proxy password; rows pin one pool and
  // failover-strict so a country without stock fails instead of exiting elsewhere, so a country is
  // required. State (2-letter code) and city are Residential only; SOCKS5 is port 7001. Residential is
  // listed first because a new form starts on poolType 'residential', so the select shows what a pull
  // will use. Keep same IP is the session record's -ttl-.
  { key: 'proxiessx', name: 'Proxies.sx', initials: 'SX', color: '#7c3aed', referral: 'https://client.proxies.sx/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, poolType: [['residential', 'Residential (peers)'], ['mobile', 'Mobile (modems)']], countryRequired: true, count: true, geo: true, session: true, life: true, maxLife: 10080, proto: true } },
  // MobileProxy.Space: dedicated mobile proxies listed from the account with an API token.
  { key: 'mobileproxyspace', name: 'MobileProxy.Space', initials: 'MS', color: '#16a34a', referral: 'https://mobileproxy.space/', gateway: null, geoSync: { creds: ['token'], noCountry: true, count: true, list: true, proto: true } },
  // Proxy-Solutions: the Integration token (API for developers page, not the API key) lists the
  // proxies on the account; Country filters that list and How many caps it.
  { key: 'proxysolutions', name: 'Proxy-Solutions', initials: 'PN', color: '#dc2626', referral: 'https://proxy-solutions.net/?rc=t4TYHBATIR', gateway: null, geoSync: { creds: ['token'], labels: { token: 'integrationTokenLabel' }, count: true, list: true, proto: true } },
  // Proxmint: a read-only pmk_ key returns each product's gateway and login (GET /api/v1/account);
  // country, state or city and a sticky session (1-120 min) ride in the username.
  { key: 'proxmint', name: 'Proxmint', initials: 'PM', color: '#10b981', referral: 'https://proxmint.com/r/K4EHJHMP', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, poolType: [['residential', 'Residential'], ['residential_premium', 'Premium residential'], ['mobile', 'Mobile'], ['datacenter', 'Datacenter']], count: true, geo: true, session: true, life: true, maxLife: 120, proto: true } },
  // Databay: proxy user + password on gw.databay.co:8888 (HTTP and SOCKS5 on one port); zone,
  // country, state or city and a sticky session (max 120 min, 30 on Residential Flex) ride in the
  // username. State and City show on Residential only (geoPools), the one pool that takes them.
  { key: 'databay', name: 'Databay', initials: 'DB', color: '#0ea5e9', referral: 'https://app.databay.com/', gateway: { host: 'gw.databay.co', port: 8888, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], poolType: [['residential', 'Residential'], ['residential_FLEX', 'Residential Flex'], ['mobile', 'Mobile'], ['datacenter', 'Datacenter']], count: true, geo: true, geoPools: ['residential'], session: true, life: true, maxLife: 120, maxLifeByPool: { residential_FLEX: 30 }, proto: true, gateway: true } },
  // 2extract: the proxy username + password from Connection Details on proxy.2extract.net:5555;
  // country, state, city, ZIP or an ASN and a sticky session ride in the username. Built from the
  // docs, no API call. Countries: docs.2extract.com/data/countries, less "en" (England, not ISO; GB covers it).
  // Protocol offers HTTPS too, 2extract's default for a new proxy (TLS to the gateway).
  { key: 'twoextract', name: '2extract', initials: '2X', color: '#14b8a6', referral: 'https://2extract.com/app/signup?ref=AbaSqU', gateway: { host: 'proxy.2extract.net', port: 5555, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], count: true, geo: true, zip: true, asn: true, session: true, life: true, proto: true, protoHttps: true, gateway: true, countries: 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ') } },
  // GonzoProxy: login + password on connect.gonzoproxy.app:10000 (HTTP and SOCKS5 on one port);
  // country (required: the login needs one), numeric region, city and a sticky session (up to 7 days)
  // ride in the login.
  { key: 'gonzoproxy', name: 'GonzoProxy', initials: 'GZ', color: '#f43f5e', referral: 'https://gonzoproxy.com/', gateway: { host: 'connect.gonzoproxy.app', port: 10000, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], countryRequired: true, count: true, geo: true, session: true, life: true, maxLife: 10080, proto: true, gateway: true } },
  // Simply Proxies: UK mobile, no customer API. Username + password on proxy.simplyproxies.com:6890
  // (SOCKS5); the network and a sticky session (5 min to 12 h) ride in the username.
  { key: 'simplyproxies', name: 'Simply Proxies', initials: 'SY', color: '#8b5cf6', referral: 'https://simplyproxies.com/', gateway: { host: 'proxy.simplyproxies.com', port: 6890, type: 'SOCKS5' }, geoSync: { creds: ['username', 'password'], noCountry: true, count: true, poolType: [['any', 'Any network'], ['ee', 'EE'], ['o2', 'O2'], ['vodafone', 'Vodafone'], ['three', 'Three']], session: true, life: true, maxLife: 720 } },
  // Coronium: dedicated mobile proxies listed from the account with an API key. The SIM fixes the
  // location, and no rotation link is stored (a fetch of one changes the IP).
  { key: 'coronium', name: 'Coronium', initials: 'CO', color: '#0891b2', referral: 'https://dashboard.coronium.io/en/sign-up#d181ec35501bba9c002f49c388bef30e', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true, proto: true } },
  // Singapore Mobile Proxy: dedicated mobile proxies listed from the account with a client API key
  // (GET /api/v1/proxies/my); each keeps its modem rotation link for Rotate IP.
  { key: 'singaporemobileproxy', name: 'Singapore Mobile Proxy', initials: 'SG', color: '#e11d48', referral: 'https://singaporemobileproxy.com/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true, proto: true } },
  // Gsocks: an API key lists the residential or mobile proxies on the account and imports each one's
  // text export. Read-only; targeting is set when the list is created in the Gsocks panel. HTTP and
  // SOCKS5 share each proxy's host and port.
  { key: 'gsocks', name: 'Gsocks', initials: 'GS', color: '#65a30d', referral: 'https://gsocks.net/ref/dzsdxicb', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true, proto: true, poolType: [['residential', 'Residential'], ['mobile', 'Mobile']] } },
  // Proxy Bonanza: one API key lists every proxy IP on the account's active plans; Country filters
  // that list and How many caps it.
  { key: 'proxybonanza', name: 'Proxy Bonanza', initials: 'PB', color: '#d97706', referral: 'https://proxybonanza.com/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, count: true, list: true, proto: true } },
  // PROXY6: static IPv4 and IPv6 listed from the account with an API key; Country filters that list
  // and How many caps it. MTProto lines are left out.
  { key: 'proxy6', name: 'PROXY6', initials: 'P6', color: '#4f46e5', referral: 'https://proxy6.net/?r=1061960', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, count: true, list: true, proto: true } },
  // ProxyBrazil: dedicated 4G mobile proxies in Brazil, listed with a pb_live_ key from Integrations
  // (the Partner API for profile browsers). Each keeps its rotation link for Rotate IP.
  { key: 'proxybrazil', name: 'ProxyBrazil', initials: 'BR', color: '#009c3b', referral: 'https://proxybrazil.com/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true, proto: true } },
  // ProxyUDP: mobile 4G/5G ports listed with an API token (Dashboard, API Access); each port's login
  // comes from its detail call. Rotate IP asks the API with the saved token (no link is stored).
  { key: 'proxyudp', name: 'ProxyUDP', initials: 'PU', color: '#0891b2', referral: 'https://proxyudp.com/', gateway: null, geoSync: { creds: ['token'], noCountry: true, count: true, list: true, proto: true } },
  // Zokol: French mobile proxies (Orange, SFR, Bouygues, Free) listed with a Bearer API key. Dedicated
  // lines keep their rotation link for Rotate IP; shared lines have none.
  { key: 'zokol', name: 'Zokol', initials: 'ZK', color: '#2563eb', referral: 'https://zokol.fr/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true, proto: true } },
  // ResiProx: an API token generates each proxy string on go.resiprox.com:5000 (HTTP or SOCKS5);
  // Residential and Mobile have separate traffic. How many 1 rotates; more are sticky (up to 50).
  { key: 'resiprox', name: 'ResiProx', initials: 'RX', color: '#059669', referral: 'https://resiprox.com?ref=n2m3ztm', gateway: null, geoSync: { creds: ['token'], poolType: [['residential', 'Residential'], ['mobile', 'Mobile']], count: true, geo: true, countryLookup: true, noSession: true, proto: true } },
  // SimplyNode: an API key and one sub-account (typed, or the first of the pool with traffic); each
  // proxy string comes from POST /proxy. Essential and Core are the dashboard's residential solutions.
  { key: 'simplynode', name: 'SimplyNode', initials: 'SN', color: '#0d9488', referral: 'https://simplynode.io/', gateway: null, geoSync: { creds: ['token', 'username'], optional: ['username'], labels: { token: 'apiKeyLabel', username: 'subaccountLabel' }, poolType: [['residential_essential', 'Residential Essential'], ['residential_core', 'Residential Core'], ['mobile', 'Mobile']], count: true, geo: true, countryLookup: true, noSession: true, life: true, maxLife: 60, proto: true } },
  // Node4: an n4k_ API key (Account Settings, API & Webhooks; read:proxies only). Residential, Rotating
  // Datacenter and Rotating Unmetered logins are built by Node4 (POST /gateways/endpoint); Static
  // Datacenter lists the IPs the account owns (GET /proxies/list). State, city and ASN are Residential only.
  { key: 'node4', name: 'Node4', initials: 'N4', color: '#0f766e', referral: 'https://node4.io?ref=REF-7643BU', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, poolType: [['residential', 'Residential'], ['rotating_datacenter', 'Rotating Datacenter'], ['rotating_unmetered', 'Rotating Unmetered'], ['static', 'Static Datacenter']], count: true, geo: true, asn: true, countryLookup: true, noSession: true, proto: true } },
  // ProxyEmpire: a Bearer API token from Settings, API Tokens; POST /proxy-list (panel.proxyempire.io/api/v2)
  // returns ready user:pass@host:port lines with the location and the rotation in the username.
  { key: 'proxyempire', name: 'ProxyEmpire', initials: 'PE', color: '#7c3aed', referral: 'https://proxyempire.io/', gateway: null, geoSync: { creds: ['token'], poolType: [['residential', 'Rotating Residential'], ['mobile', 'Rotating Mobile'], ['datacenter', 'Rotating Datacenter'], ['static-resi', 'Static Residential (ISP)']], count: true, geo: true, zip: true, asn: true, countryLookup: true, noSession: true, life: true, maxLife: 120, proto: true } },
  // MountProxies: dedicated US 4G and 5G modems listed with the account API key (it travels in the query
  // string, so errors never echo the URL). HTTP only: the API gives no SOCKS5 port. Rotate IP asks the
  // API with the saved key; no rotation link is stored.
  { key: 'mountproxies', name: 'MountProxies', initials: 'MT', color: '#475569', referral: 'https://mountproxies.com/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true } },
  // Massive: residential gateway network.joinmassive.com (HTTP 65534, SOCKS5 65533) with the targeting in
  // the username; the proxy password is the account's API token (dashboard, Profile). ISP is
  // isp.joinmassive.com:8000 with no targeting.
  { key: 'massive', name: 'Massive', initials: 'MV', color: '#4f46e5', referral: 'https://www.joinmassive.com/', gateway: { host: 'network.joinmassive.com', port: 65534, type: 'HTTP' }, geoSync: { creds: ['username', 'password'], labels: { password: 'apiTokenPasswordLabel' }, poolType: [['residential', 'Residential'], ['residential_mobile', 'Residential mobile'], ['isp', 'ISP (US)']], count: true, geo: true, zip: true, asn: true, session: true, life: true, maxLife: 1440, proto: true, gateway: true } },
  // iProxy.online: the user's own Android phones as mobile proxies. A user API key (dashboard) lists every
  // proxy access (host, port, login) and each phone's change-IP link, kept as the proxy's Rotate IP link.
  { key: 'iproxy', name: 'iProxy.online', initials: 'IP', color: '#f59e0b', referral: 'https://iproxy.online/', gateway: null, geoSync: { creds: ['token'], labels: { token: 'apiKeyLabel' }, noCountry: true, count: true, list: true, proto: true } },
  // ARNPROXY: no connector yet (its customer API is not confirmed for logins). Its list is pasted in the
  // Proxy pool's Batch Add with Provider ARNPROXY, so this page counts those proxies.
  { key: 'arnproxy', name: 'ARNPROXY', initials: 'AX', color: '#b91c1c', referral: 'https://www.arnproxy.com/', gateway: null, unavailable: true }
];

// Notice codes a pull result may carry (syncVendorPool's result.notice), each a proxyProviders.result key.
const RESULT_NOTICES = ['noChangeIpLink'];

// The token field's placeholder follows its label (geoSync.labels.token), and so does the username's.
const TOKEN_PLACEHOLDERS = { apiKeyLabel: 'apiKeyPlaceholder', integrationTokenLabel: 'integrationTokenPlaceholder' };
const USERNAME_PLACEHOLDERS = { subaccountLabel: 'subaccountPlaceholder' };

// IPRoyal sticky lifetimes, in the "{n}m" / "{n}h" format its API takes (1 second to 168 hours).
const IPR_LIFETIME_OPTIONS = [['10m', 10, 'minutes'], ['30m', 30, 'minutes'], ['1h', 1, 'hours'], ['6h', 6, 'hours'], ['24h', 24, 'hours'], ['72h', 72, 'hours'], ['168h', 168, 'hours']];

// What an API Sync pull adds: N sticky sessions, one rotating endpoint, or Bright Data's dedicated
// zone IPs. Sticky is the default for every vendor: a profile needs an exit IP that stays put, and it
// works with the proxy login alone (Zone IPs also needs Bright Data's API token).
function apiMintModes(provider) {
  return provider && provider.apiMint && provider.apiMint.zone ? ['sticky', 'rotating', 'zone'] : ['sticky', 'rotating'];
}
function apiMintMode(provider, poolType) {
  const modes = apiMintModes(provider);
  return modes.includes(poolType) ? poolType : 'sticky';
}
// Oxylabs sesstime and Decodo sessionduration both run from 1 to 1440 minutes.
const API_MINT_LIFE_OPTIONS = ['10', '30', '60', '120', '360', '720', '1440'];

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

// Per-provider form drafts for this app session. Module scope, so they survive the panel
// unmounting when the user opens another tab, and switching between providers.
const FORM_DRAFTS = new Map();

// The English hints are the fallback, so the two never drift apart.
const GEO_HINTS = cmpSettingsCEn.proxyProviders.geoHints;
// Froxy password type words and the Pool type each one belongs to (fast, the separate Fast product,
// has no Pool type here).
const FROXY_TYPE_POOLS = { wifi: 'residential', mobile: 'mobile', shared: 'datacenter' };
// Proxy-Seller residential entry servers (the export's host parameter); blank is Europe.
const PS_RESIDENT_HOSTS = [['', 'psHostEurope'], ['us.res.proxy-seller.com', 'psHostUs'], ['asia.res.proxy-seller.com', 'psHostAsia']];

// `selectedKey` + `embedded` let the Proxy providers page drive which connector is on screen
// and render only the connector workspace (it draws its own provider list and header).
// The pool a fresh form starts on: the vendor's first listed pool, so the select shows what a pull uses.
function firstPoolType(provider) {
  const pools = provider && provider.geoSync && provider.geoSync.poolType;
  return Array.isArray(pools) && pools.length ? pools[0][0] : 'residential';
}
// The Gateway region select shows for the pools in geoSync.regions.
function regionForPool(geoSync, poolType) {
  return Boolean(geoSync && Array.isArray(geoSync.regions) && geoSync.regions.includes(poolType));
}
// The Protocol select's value: HTTPS only where the vendor offers it, else HTTP or SOCKS5.
function protocolValue(geoSync, proxyType) {
  if (proxyType === 'socks5') return 'socks5';
  return proxyType === 'https' && geoSync && geoSync.protoHttps ? 'https' : 'http';
}

export default function ProxyProviders({ onSynced, onCredsChanged, selectedKey: controlledKey, embedded = false }) {
  const { t, i18n } = useTranslation('cmpSettingsC');
  // Saved vendor credentials are the Owner's (main's saveProxyProviderCreds); others may still pull
  // with keys they type, which are not saved.
  const denyCreds = usePermissions().denyOwner();
  const [ownSelectedKey, setSelectedKey] = useState(PROVIDERS[0].key);
  const selectedKey = controlledKey || ownSelectedKey;
  const provider = useMemo(() => PROVIDERS.find((p) => p.key === selectedKey) || PROVIDERS[0], [selectedKey]);
  // Each pull is tagged with its provider key; a late result or error after a provider switch
  // is not shown on the new panel and does not clear its spinner.
  const activeKeyRef = useRef(provider.key);
  activeKeyRef.current = provider.key;

  // Owner/Super Admin affiliate overrides (Settings > Monetization); the Purchase / Visit dashboard
  // button falls back to the built-in referral.
  const [affiliateLinks, setAffiliateLinks] = useState({});
  const referral = affiliateLinks[provider.key] || provider.referral;

  const [form, setForm] = useState({ host: '', port: '', username: '', password: '', token: '', apiToken: '', zone: '', country: '', count: '5', state: '', city: '', session: '', life: '', apiUrl: '', plan: 'premium', proxyType: 'http', poolType: 'residential', teamId: '', ipv6: false, zip: '', asn: '', excludeCountries: '', excludeAsns: '', listId: '', source: 'new', orderId: '', subuserHash: '' });
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
    // DataImpulse, Proxy-Seller and IPRoyal use their own select vocabulary, so they need defaults
    // their <option> values carry (shared defaults render blank). Sticky is the default because an
    // anti-detect profile needs an exit IP that stays put.
    const di = provider.key === 'dataimpulse' || provider.key === 'proxyseller' || provider.key === 'iproyal';
    // Restore what was typed for this provider earlier in the session, including keys pasted
    // before a failed pull.
    const draft = FORM_DRAFTS.get(provider.key);
    // A vendor that needs a country (countryRequired) starts on United States, since its list has no
    // Any / Random.
    const needCountry = Boolean(provider.geoSync && provider.geoSync.countryRequired);
    if (draft) setForm({ ...draft, ...(needCountry && !draft.country ? { country: 'US' } : {}) });
    else setForm({ host: gw.host, port: String(gw.port), username: '', password: '', token: '', apiToken: '', zone: '', country: needCountry ? 'US' : '', count: provider.geoSync && provider.geoSync.list ? '' : '5', state: '', city: '', session: '', life: '', apiUrl: '', plan: di ? 'residential' : 'premium', proxyType: 'http', poolType: di ? 'sticky' : firstPoolType(provider), teamId: '', ipv6: false, zip: '', asn: '', excludeCountries: '', excludeAsns: '', listId: '', source: 'new', orderId: '', subuserHash: '' });
    setAccount(null);
    setLookingUp('');
    setGeoOptions({ state: [], city: [], region: [], country: [] });
    setCheckResult(null);
    setCredsSaved(false);
    setSyncResult(null);
    setSyncing(false);
    setErr('');
  }, [provider]);

  // A country list loaded from the vendor belongs to one pool, so another pool drops it.
  useEffect(() => {
    if (provider.geoSync && provider.geoSync.countryLookup) setGeoOptions((o) => (o.country.length ? { ...o, country: [] } : o));
  }, [form.poolType, provider]);

  // Pre-fill DPAPI-sealed saved credentials. Runs after the reset above so saved values win; the
  // live guard stops a fast provider switch from applying stale creds.
  useEffect(() => {
    let live = true;
    try {
      softglazeApi.proxies.getProviderCreds(provider.key)
        .then((c) => {
          // A session draft holds what the user typed most recently, so it wins over saved creds.
          if (!live || !c || !c.found || FORM_DRAFTS.has(provider.key)) return;
          setForm((f) => ({
            ...f,
            ...(c.username != null ? { username: c.username } : {}),
            ...(c.password != null ? { password: c.password } : {}),
            ...(c.token != null ? { token: c.token } : {}),
            ...(c.apiToken != null ? { apiToken: c.apiToken } : {}),
            ...(c.zone != null ? { zone: c.zone } : {}),
            ...(c.plan != null ? { plan: c.plan } : {}),
            ...(c.host ? { host: c.host } : {}),
            ...(c.port != null ? { port: String(c.port) } : {}),
            ...(c.apiUrl != null ? { apiUrl: c.apiUrl } : {}),
            ...(c.orderId != null ? { orderId: c.orderId } : {}),
            ...(c.teamId != null ? { teamId: c.teamId } : {}),
            ...(c.proxyType != null ? { proxyType: c.proxyType } : {})
          }));
        })
        .catch(() => {});
    } catch (e) { /* older build without the creds API - ignore */ }
    return () => { live = false; };
  }, [provider]);

  const set = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    FORM_DRAFTS.set(provider.key, next);
    return next;
  });

  // Froxy: a password pasted from the dashboard starts with its subscription's type word (wifi, mobile,
  // shared), so the Pool type follows it. Main keeps the word as pasted and stops a Pool type picked
  // against it, because Froxy would refuse the proxies.
  useEffect(() => {
    if (provider.key !== 'froxy') return;
    const pool = FROXY_TYPE_POOLS[String(form.password || '').split(';')[0].trim().toLowerCase()];
    if (pool && pool !== form.poolType) set('poolType', pool);
    // Only a new password moves the select; choosing a Pool type by hand afterwards is left alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.key, form.password]);

  // Saves the entered credentials for pre-fill next time (secrets DPAPI-sealed in main, empty
  // fields cleared). Best-effort; called after a successful pull or sync.
  function persistCreds() {
    try {
      softglazeApi.proxies.saveProviderCreds({
        provider: provider.key,
        username: form.username, password: form.password, token: form.token,
        apiToken: form.apiToken, zone: form.zone, plan: form.plan,
        host: form.host, port: form.port, apiUrl: form.apiUrl, orderId: form.orderId,
        teamId: form.teamId, proxyType: form.proxyType
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // Saves typed credentials without a pull, so manual-form users can store an API key.
  async function handleSaveCreds() {
    setSavingCreds(true); setErr('');
    try {
      const r = await softglazeApi.proxies.saveProviderCreds({
        provider: provider.key,
        username: form.username, password: form.password, token: form.token,
        apiToken: form.apiToken, zone: form.zone, plan: form.plan,
        host: form.host, port: form.port, apiUrl: form.apiUrl, orderId: form.orderId,
        teamId: form.teamId, proxyType: form.proxyType
      });
      // Saving with every key and login empty removes what was saved (main drops the entry).
      setCredsSaved(r && r.saved === false ? 'cleared' : 'saved');
      if (typeof onCredsChanged === 'function') onCredsChanged(provider.key);
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
    const pullKey = provider.key;
    setSyncing(true);
    try {
      const r = await softglazeApi.proxies.syncVendorPool({ provider: provider.key, token: form.token.trim() });
      persistCreds();
      // The pool changed either way, so the list refreshes even if the provider changed.
      if (typeof onSynced === 'function') onSynced(r, pullKey);
      if (activeKeyRef.current === pullKey) setSyncResult(r);
    } catch (e) { if (activeKeyRef.current === pullKey) setErr(e.message || t('proxyProviders.errors.sync')); }
    finally { if (activeKeyRef.current === pullKey) setSyncing(false); }
  }

  // Live API sync for wired vendors (Bright Data / Oxylabs / Decodo). Bright Data's zone list
  // needs its API token (+ zone); sticky and rotating pulls mint usernames from the proxy login,
  // and the first one is checked against the gateway in Host : Port.
  async function handleApiSync() {
    setErr(''); setSyncResult(null);
    const mode = apiMintMode(provider, form.poolType);
    if (mode === 'zone' && !form.apiToken.trim()) { setErr(t('proxyProviders.errors.enterBrightDataToken', { provider: 'Bright Data' })); return; }
    if (mode !== 'zone' && !form.username.trim()) { setErr(t('proxyProviders.errors.enterUsernameFirst')); return; }
    const pullKey = provider.key;
    setSyncing(true);
    try {
      const r = await softglazeApi.proxies.syncVendorPool({
        provider: provider.key,
        token: form.apiToken.trim(),
        username: form.username.trim(),
        password: form.password,
        zone: form.zone.trim(),
        // Host : Port above is the gateway the pulled proxies use, not only what Check Proxy tests.
        host: form.host.trim(),
        port: form.port,
        // '6' asks Oxylabs for IPv6 exits (-ipversion-6). Vendors without a documented
        // selector ignore this rather than receiving an invented flag.
        ipVersion: provider.ipv6 && form.ipv6 ? '6' : '',
        poolType: mode,
        country: form.country,
        state: mode === 'zone' ? '' : form.state.trim(),
        city: mode === 'zone' ? '' : form.city.trim(),
        count: mode === 'sticky' ? form.count : '',
        life: mode === 'sticky' && provider.apiMint && provider.apiMint.life ? form.life : '',
        proxyType: provider.apiMint && provider.apiMint.proto && form.proxyType === 'socks5' ? 'socks5' : 'http'
      });
      persistCreds();
      if (typeof onSynced === 'function') onSynced(r, pullKey);
      if (activeKeyRef.current === pullKey) setSyncResult(r);
    } catch (e) { if (activeKeyRef.current === pullKey) setErr(e.message || t('proxyProviders.errors.liveSync')); }
    finally { if (activeKeyRef.current === pullKey) setSyncing(false); }
  }

  // Country-targeted pull: sends country, pool size and any geo/session/endpoint overrides to
  // syncVendorPool, which routes to the matching adapter and ignores irrelevant fields.
  async function handleGeoSync() {
    setErr(''); setSyncResult(null);
    const g = provider.geoSync || {};
    const creds = g.creds || [];
    if (creds.includes('token') && !form.token.trim()) {
      // A vendor's own name for the field (API key, Integration token) is the one the error asks for.
      const tokenLabel = (g.labels || {}).token;
      setErr(tokenLabel ? t('proxyProviders.errors.enterNamedToken', { field: t(`proxyProviders.geo.${tokenLabel}`) }) : t('proxyProviders.errors.enterApiToken'));
      return;
    }
    if (g.apiKey) {
      // anyip: accept either proxy Username + Password or an API key + Team ID.
      const hasCreds = form.username.trim() && form.password;
      const hasApi = form.token.trim() && form.teamId.trim();
      if (!hasCreds && !hasApi) { setErr(t('proxyProviders.errors.anyipCredsOrApi', 'Enter your proxy Username + Password, or an API key + Team ID to auto-provision.')); return; }
    } else {
      const optional = g.optional || [];
      if (creds.includes('username') && !optional.includes('username') && !form.username.trim()) { setErr(t('proxyProviders.errors.enterProxyUsername')); return; }
      if (creds.includes('password') && !form.password) { setErr(t('proxyProviders.errors.enterProxyPassword')); return; }
    }
    const fromList = g.ps && form.plan === 'residential' && form.source === 'existing';
    if (fromList && !form.listId) { setErr(t('proxyProviders.ps.pickList', 'Pick one of your saved lists, or switch to New list.')); return; }
    if (g.countryRequired && !form.country) { setErr(t('proxyProviders.geo.pickCountryFirst', 'Pick a country first.')); return; }
    const sessionText = form.session.trim();
    if (g.sessionDigits && sessionText && !new RegExp(`^\\d{1,${g.sessionDigits}}$`).test(sessionText)) {
      setErr(t('proxyProviders.geo.sessionDigitsError', { max: g.sessionDigits }));
      return;
    }
    // A pool that targets a country only (geoPools) gets no State, City or ASN, even if one was typed
    // on another pool before switching.
    const placeOn = !Array.isArray(g.geoPools) || g.geoPools.includes(form.poolType);
    const pullKey = provider.key;
    setSyncing(true);
    // Save what was typed as soon as Pull is clicked, so a failed pull keeps the pasted keys.
    persistCreds();
    try {
      const r = await softglazeApi.proxies.syncVendorPool({
        provider: provider.key,
        country: form.country,
        // Proxy-Seller per-IP products import every active IP of the order: the How many field sits in
        // the residential form only, so its hidden default must not cap them.
        count: g.ps && form.plan !== 'residential' ? '' : form.count,
        zip: form.zip.trim(),
        asn: placeOn ? form.asn.trim() : '',
        excludeCountries: form.excludeCountries.trim(),
        excludeAsns: form.excludeAsns.trim(),
        listId: fromList ? form.listId : '',
        orderId: (g.ps && form.plan !== 'residential') || g.planId ? form.orderId : '',
        subuserHash: g.ipr ? form.subuserHash : '',
        token: form.token.trim(),
        username: form.username.trim(),
        password: form.password,
        state: placeOn ? form.state.trim() : '',
        city: placeOn ? form.city.trim() : '',
        session: sessionText,
        life: form.life,
        apiUrl: form.apiUrl.trim(),
        host: form.host.trim(),
        port: form.port,
        plan: form.plan,
        proxyType: form.proxyType,
        poolType: form.poolType,
        teamId: form.teamId.trim(),
        // CatProxies' gateway region (US when blank), as the Gateway select shows it.
        zone: regionForPool(g, form.poolType) && ['eu', 'asia'].includes(form.zone) ? form.zone : ''
      });
      persistCreds();
      if (typeof onSynced === 'function') onSynced(r, pullKey);
      if (activeKeyRef.current === pullKey) setSyncResult(r);
    } catch (e) { if (activeKeyRef.current === pullKey) setErr(e.message || t('proxyProviders.errors.pull')); }
    finally { if (activeKeyRef.current === pullKey) setSyncing(false); }
  }


  // Account view: plan traffic plus, on request, the live locations a pull can target.
  // groupby 'state' / 'city' (DataImpulse, for the chosen country) or 'country' / 'region'
  // (Proxy-Seller geo database). Read-only on the vendor side.
  async function handleLookup(groupby = '') {
    setErr('');
    const g = provider.geoSync || {};
    if ((g.ps || g.ipr || g.countryLookup) && !form.token.trim()) { setErr(t('proxyProviders.errors.enterApiToken')); return; }
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
        groupby,
        poolType: form.poolType
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
  // Styled <select>: hide the native arrow and paint an inset chevron.
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
  // A vendor shows a sticky-session field when it reads one: either a standalone session
  // (session: true) or one implied by its geo targeting, unless it explicitly takes none.
  const showSession = Boolean(provider.geoSync && !provider.geoSync.noSession && (provider.geoSync.session || provider.geoSync.geo));
  // A long country name is cut by the select in a narrow window; its title shows it in full.
  const countryTitle = form.country ? `${countryOptions(provider, i18n.language).find(([code]) => code === form.country)?.[1] || ''} (${form.country})` : undefined;
  // A credential field's label: the connector's own name for it (geoSync.labels), else the shared one.
  const credLabel = (field, fallbackKey) => t(`proxyProviders.geo.${((provider.geoSync && provider.geoSync.labels) || {})[field] || fallbackKey}`);
  // Keep same IP left blank: "Different IP each time" only when the pull really rotates; otherwise the
  // vendor's default time, as main mints it (gatewayPullPlan).
  const lifeBlank = lifeBlankLabel(provider.key, { count: form.count, session: showSession ? form.session : '' });
  // Proxy302's Premium line keeps a session time Proxy302 sets, so there Keep same IP chooses between
  // that time (blank) and a new IP each time ('rotating'); elsewhere the vendor's times (lifeOptionsFor)
  // follow the blank option.
  const premium302 = provider.key === 'proxy302' && form.poolType !== 'standard';
  const lifeBlankText = premium302
    ? t('proxyProviders.geo.lifeVendorFixed', { provider: provider.name })
    : lifeBlank.minutes
      ? t(`proxyProviders.geo.${lifeBlank.key}`, { time: t(`proxyProviders.geo.life${lifeBlank.minutes}`) })
      : t(`proxyProviders.geo.${lifeBlank.key}`);
  const lifeValuesFor = (poolType) => (provider.key === 'proxy302' && poolType !== 'standard'
    ? ['rotating']
    : lifeOptionsFor(provider.geoSync || {}, poolType).map(String));
  const lifeOptionLabel = (m) => (m === 'rotating' ? t('proxyProviders.geo.lifeDifferent') : t(`proxyProviders.geo.life${m}`));
  // State, City and ASN show only for a pool that takes them (geoSync.geoPools).
  const geoOn = Boolean(provider.geoSync) && geoForPool(provider.geoSync, form.poolType);
  // Another Pool type clears a Keep same IP time it does not offer, so the select never shows one
  // time while main sends another.
  const choosePool = (value) => {
    set('poolType', value);
    if (form.life && !lifeValuesFor(value).includes(String(form.life))) set('life', '');
  };
  // Shared Save credentials row: persists through the DPAPI-sealed pull path (never logs the
  // secret) with a ready-to-pull confirmation distinct from the pull spinner.
  const renderSaveRow = () => (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={handleSaveCreds} disabled={savingCreds || Boolean(denyCreds)} title={denyCreds || undefined} className={secondaryBtnCls}>
        {savingCreds ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} {t('proxyProviders.creds.save', 'Save credentials')}
      </button>
      {credsSaved && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-400"><Check className="w-4 h-4" /> {credsSaved === 'cleared' ? t('proxyProviders.creds.cleared', 'Saved credentials removed') : t('proxyProviders.creds.saved', 'Credentials saved - ready to pull')}</span>}
    </div>
  );

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
    // Loaded from the live pool (most IPs first). A label that is only the code falls back to the
    // country's own name.
    const diCountries = geoOptions.country
      .filter((c) => /^[A-Za-z]{2}$/.test(String(c.key)))
      .map((c) => ({ key: c.key, label: c.label && String(c.label).toUpperCase() !== String(c.key).toUpperCase() ? `${c.label} · ${c.count.toLocaleString()} IPs` : '' }));
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
                <option value="residential_premium">{t('proxyProviders.geo.diResidentialPremium', 'Premium Residential')}</option>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diAddLabel', 'How many to add')}</label>
              <input inputMode="numeric" value={sticky ? form.count : '1'} disabled={!sticky} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className={inputCls + ' font-mono disabled:opacity-60'} placeholder="5" title={t('proxyProviders.geo.diCountTitle')} />
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
          <div>
            <label className={labelCls}><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
            <select value={form.country} title={countryTitle} onChange={(e) => { set('country', e.target.value); set('state', ''); set('city', ''); setGeoOptions((o) => ({ ...o, state: [], city: [] })); }} className={selectCls} style={chevronStyle}>
              <option value="">{t('proxyProviders.countries.any', 'Any / Random')}</option>
              {countryOptions(provider, i18n.language, diCountries).map(([code, name]) => <option key={code} value={code}>{`${name} (${code})`}</option>)}
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
            <button type="button" onClick={() => handleLookup('country')} disabled={Boolean(lookingUp)} className={secondaryBtnCls}>{spin('country') || <Globe2 className="w-4 h-4" />} {t('proxyProviders.ps.loadCountries', 'Load all countries')}</button>
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

        {renderSaveRow()}
        <button onClick={handleGeoSync} disabled={syncing} className={primaryBtnCls}>
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {sticky
            ? t('proxyProviders.geo.diAddSticky', { count: pullCount, defaultValue: 'Add {{count}} sticky proxies' })
            : t('proxyProviders.geo.diAddRotating', 'Add rotating gateway')}
          {form.country ? ` · ${form.country}` : ''}
        </button>
        <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t('proxyProviders.geoHints.dataimpulse', 'Every pull adds new proxies. Sticky proxies sit on their own ports, so asking for 5 when the pool already holds 5 with the same settings adds the next 5 ports instead of returning the same ones. A pull adds up to 1000, and one login has 10,001 sticky ports in all. Use the login and password of one DataImpulse product, shown on that product page in the dashboard.')}</p>
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
    const countries = geoOptions.country.length ? geoOptions.country.map((c) => [c.key, c.label]) : countryOptions(provider, i18n.language);
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
                    : t('proxyProviders.ps.checkForOrders', 'All orders')}</option>
                  {(productInfo ? productInfo.orders : []).map((o) => <option key={o.id} value={o.id}>{`${o.number} · ${o.count} IPs${o.country ? ` · ${o.country}` : ''}${o.expires ? ` · ${o.expires}` : ''}`}</option>)}
                </select>
                <p className={hintCls + ' mt-1.5'}>{t('proxyProviders.ps.orderHint', 'Adds every active IP in the order, each on its own port. Pulling again only adds IPs the pool does not have yet. Check account lists each order with its IPs.')}</p>
              </div>
              {form.plan === 'ipv6' && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-[color-mix(in_srgb,var(--color-amber-500)_45%,var(--foreground))]">{t('proxyProviders.ps.ipv6Note', 'IPv6 exits can only reach websites that have an IPv6 address. Before assigning these to profiles, check that the sites you use support IPv6, or a page may fail to load through them.')}</p>
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
                  <select value={form.country} title={countryTitle} onChange={(e) => { set('country', e.target.value); set('state', ''); set('city', ''); setGeoOptions((o) => ({ ...o, region: [] })); }} className={selectCls} style={chevronStyle}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diProtocolLabel', 'Protocol')}</label>
              <select value={form.proxyType} onChange={(e) => set('proxyType', e.target.value)} className={selectCls} style={chevronStyle}>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>
            {residential && (
              <div>
                <label className={labelCls}>{t('proxyProviders.ps.hostLabel', 'Entry server')}</label>
                <select value={PS_RESIDENT_HOSTS.some(([h]) => h === form.host) ? form.host : ''} onChange={(e) => set('host', e.target.value)} className={selectCls} style={chevronStyle}>
                  {PS_RESIDENT_HOSTS.map(([h, key]) => <option key={key} value={h}>{t(`proxyProviders.ps.${key}`)}</option>)}
                </select>
              </div>
            )}
          </div>
          {residential && <p className={hintCls}>{t('proxyProviders.ps.hostHint', 'The server the proxies connect through: res.proxy-seller.com in Europe, us.res.proxy-seller.com in the United States or asia.res.proxy-seller.com in Asia. Pick the one nearest to this computer.')}</p>}
        </section>

        {renderSaveRow()}
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
        <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t('proxyProviders.geoHints.proxyseller', 'Residential is a traffic package: each New list pull creates a list on your account named SoftGlaze plus the location and time, with up to 1000 ports (the most the API allows in one list), and each port is its own exit IP. For more, pull again to create another list. IPv6, IPv4, ISP and Mobile are sold per IP: the pull reads your orders page by page and adds at most 5000 addresses you already own, each on its own port, and needs nothing created.')}</p>
      </div>
    );
  };

  // ---- IPRoyal residential: token, credentials, what to add, where ----
  const renderIpRoyal = () => {
    const sticky = form.poolType === 'sticky';
    const isIpr = account && account.provider === 'iproyal';
    const subusers = isIpr && Array.isArray(account.subusers) ? account.subusers : [];
    const useSub = Boolean(form.subuserHash);
    const countries = geoOptions.country.length ? geoOptions.country.map((c) => [c.key.toUpperCase(), c.label]) : countryOptions(provider, i18n.language);
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
              <option value="">{t('proxyProviders.ipr.useOwnCreds', 'No sub-user')}</option>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.diAddLabel', 'How many to add')}</label>
              <input inputMode="numeric" value={sticky ? form.count : '1'} disabled={!sticky} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className={inputCls + ' font-mono disabled:opacity-60'} placeholder="5" title={t('proxyProviders.ipr.countTitle')} />
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
          <div>
            <label className={labelCls}><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
            <select value={form.country} title={countryTitle} onChange={(e) => { set('country', e.target.value); set('state', ''); set('city', ''); setGeoOptions((o) => ({ ...o, region: [], city: [] })); }} className={selectCls} style={chevronStyle}>
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

        {renderSaveRow()}
        <button onClick={handleGeoSync} disabled={syncing} className={primaryBtnCls}>
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {sticky
            ? t('proxyProviders.geo.diAddSticky', { count: pullCount, defaultValue: 'Add {{count}} sticky proxies' })
            : t('proxyProviders.geo.diAddRotating', 'Add rotating gateway')}
          {form.country ? ` · ${form.country}` : ''}
        </button>
        <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t('proxyProviders.geoHints.iproyal', 'IPRoyal builds each proxy for you: the location and a sticky session go into the password, on its gateway geo.iproyal.com. Sticky proxies share one host and port, and each keeps its own exit IP for the lifetime you pick. A sticky pull adds up to 1000. Traffic comes out of your residential balance or the chosen sub-user.')}</p>
      </div>
    );
  };

  // ---- API Sync targeting (Bright Data, Oxylabs, Decodo): what to add and where ----
  const renderApiMint = () => {
    const m = provider.apiMint || {};
    const mode = apiMintMode(provider, form.poolType);
    const modes = apiMintModes(provider);
    const modeLabel = { zone: t('proxyProviders.apiSync.modeZone'), sticky: t('proxyProviders.apiSync.modeSticky'), rotating: t('proxyProviders.apiSync.modeRotating') };
    const modeHelp = { zone: t('proxyProviders.apiSync.modeZoneHelp'), sticky: t('proxyProviders.apiSync.modeStickyHelp'), rotating: t('proxyProviders.apiSync.modeRotatingHelp') };
    const minted = mode !== 'zone';
    return (
      <div className="mt-3 space-y-3">
        <div>
          <label className={labelCls}>{t('proxyProviders.apiSync.modeLabel')}</label>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('proxyProviders.apiSync.modeLabel')}>
            {modes.map((k) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => set('poolType', k)} className={segCls(mode === k)}>{modeLabel[k]}</button>
            ))}
          </div>
          <p className={hintCls + ' mt-1.5'}>{modeHelp[mode]}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
            <select value={form.country} title={countryTitle} onChange={(e) => set('country', e.target.value)} className={selectCls} style={chevronStyle}>
              <option value="">{t('proxyProviders.countries.any', 'Any / Random')}</option>
              {countryOptions(provider, i18n.language).map(([code, name]) => <option key={code} value={code}>{`${name} (${code})`}</option>)}
            </select>
          </div>
          {minted && (
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.stateLabel')} {optMarker}</label>
              {/* Bright Data takes a US state as its two-letter code (-state-ny); the others take the name. */}
              <input value={form.state} onChange={(e) => set('state', e.target.value)} className={inputCls + ' font-mono'} placeholder={m.stateCode ? 'NY' : 'California'} />
            </div>
          )}
          {minted && (
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.cityLabel')} {optMarker}</label>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls + ' font-mono'} placeholder="New York" />
            </div>
          )}
          {mode === 'sticky' && (
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.howMany')}</label>
              <input inputMode="numeric" value={form.count} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className={inputCls + ' font-mono'} placeholder="5" title={t('proxyProviders.apiSync.countTitle')} />
            </div>
          )}
          {mode === 'sticky' && m.life && (
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.keepSameIpLabel')}</label>
              <select value={form.life} onChange={(e) => set('life', e.target.value)} className={selectCls} style={chevronStyle}>
                <option value="">{t('proxyProviders.apiSync.lifeDefault')}</option>
                {API_MINT_LIFE_OPTIONS.map((v) => <option key={v} value={v}>{t(`proxyProviders.geo.life${v}`)}</option>)}
              </select>
            </div>
          )}
          {minted && m.proto && (
            <div>
              <label className={labelCls}>{t('proxyProviders.geo.protocolLabel', 'Protocol')}</label>
              <select value={form.proxyType === 'socks5' ? 'socks5' : 'http'} onChange={(e) => set('proxyType', e.target.value)} className={selectCls} style={chevronStyle}>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>
          )}
        </div>
        {minted && <p className={hintCls}>{t(m.stateCode ? 'proxyProviders.apiSync.geoHintCode' : 'proxyProviders.apiSync.geoHint')}</p>}
      </div>
    );
  };

  return (
    <Card className={embedded ? '' : 'bg-surface border-border flex flex-1 min-h-0 rounded shadow-xl overflow-hidden'}>
      <div className={embedded ? '' : 'grid grid-cols-1 lg:grid-cols-[300px_1fr] flex-1 min-h-0'}>
        {!embedded && <div className="border-b lg:border-b-0 lg:border-r border-border bg-card/40 flex flex-col min-h-0">
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
        </div>}

        <div className={embedded ? '' : 'overflow-y-auto p-5 min-h-0'}>
          {/* Promo banner (the Proxy providers page shows its own header instead) */}
          {!embedded && <div className="rounded-xl p-5 mb-5 relative overflow-hidden" style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${provider.color} 22%, var(--card)), var(--card))`, border: `1px solid color-mix(in srgb, ${provider.color} 30%, transparent)` }}>
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
          </div>}

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
              {renderSaveRow()}
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
            /* ---- Geo-targeted pull: one consistent grid for every vendor ---- */
            <div className="space-y-4 max-w-2xl">
              <section className={sectionCls}>
                <div className={sectionTitleCls}><KeyRound className="w-4 h-4 text-violet-400" /> {t('proxyProviders.creds.connectionTitle', 'Connection')}</div>

                {provider.geoSync.apiKey && (
                  <div className="rounded-lg border border-border bg-background/40 p-3.5 space-y-3">
                    <p className="text-[11.5px] text-muted-foreground leading-relaxed">{t('proxyProviders.geo.anyipApiNote', 'Two ways to connect: paste your proxy Username + Password below (anyip dashboard → Get Proxy Details), OR enter an API key + Team ID here to auto-provision a proxy account. The API key is NOT the proxy password.')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}><KeyRound className="w-3.5 h-3.5 text-violet-400" /> {t('proxyProviders.geo.apiKeyOptLabel', 'API key')} {optMarker}</label>
                        <input type="password" value={form.token} onChange={(e) => set('token', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.anyipApiKeyPlaceholder', 'anyip API key')} autoComplete="off" />
                      </div>
                      <div>
                        <label className={labelCls}>{t('proxyProviders.geo.teamIdLabel', 'Team ID')} {optMarker}</label>
                        <input value={form.teamId} onChange={(e) => set('teamId', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.teamIdPlaceholder', 'your anyip team id')} autoComplete="off" />
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {provider.geoSync.creds.includes('username') && (
                    <div>
                      <label className={labelCls}>{provider.geoSync.apiKey ? t('proxyProviders.geo.anyipUserLabel', 'Proxy username (user_…)') : credLabel('username', 'usernameLabel')}{(provider.geoSync.optional || []).includes('username') && <> {optMarker}</>}</label>
                      <input value={form.username} onChange={(e) => set('username', e.target.value)} className={inputCls + ' font-mono'} placeholder={provider.geoSync.apiKey ? 'user_XXXX' : (USERNAME_PLACEHOLDERS[(provider.geoSync.labels || {}).username] ? t(`proxyProviders.geo.${USERNAME_PLACEHOLDERS[(provider.geoSync.labels || {}).username]}`) : 'username')} autoComplete="off" />
                    </div>
                  )}
                  {provider.geoSync.creds.includes('password') && (
                    <div>
                      <label className={labelCls}>{provider.key === 'apify' ? t('proxyProviders.geo.apifyPasswordLabel', { provider: 'Apify' }) : credLabel('password', 'proxyPasswordLabel')}</label>
                      <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputCls + ' font-mono'} placeholder="password" autoComplete="off" />
                    </div>
                  )}
                  {provider.geoSync.creds.includes('token') && (
                    <div>
                      <label className={labelCls}><KeyRound className="w-3.5 h-3.5 text-violet-400" /> {credLabel('token', 'apiTokenLabel')}</label>
                      <input type="password" value={form.token} onChange={(e) => set('token', e.target.value)} className={inputCls + ' font-mono'} placeholder={t(`proxyProviders.geo.${TOKEN_PLACEHOLDERS[(provider.geoSync.labels || {}).token] || 'apiTokenPlaceholder'}`, { provider: provider.name })} autoComplete="off" />
                    </div>
                  )}
                  {provider.geoSync.planId && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.planIdLabel', 'Plan ID')}</label>
                      <input value={form.orderId} onChange={(e) => set('orderId', e.target.value)} className={inputCls + ' font-mono'} placeholder={t('proxyProviders.geo.planIdPlaceholder', 'Active Plans → Plan ID')} autoComplete="off" />
                    </div>
                  )}
                </div>

                {provider.geoSync.gateway && (
                  <div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
                      <div>
                        <label className={labelCls}>{t('proxyProviders.geo.gatewayHostLabel')}</label>
                        <input value={form.host} onChange={(e) => set('host', e.target.value)} className={inputCls + ' font-mono'} placeholder="proxy.example.com" />
                      </div>
                      <div>
                        <label className={labelCls}>{t('proxyProviders.geo.portLabel')}</label>
                        <input value={form.port} onChange={(e) => set('port', e.target.value)} className={inputCls + ' font-mono'} placeholder="3100" />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground/90">{!provider.gateway ? t('proxyProviders.geo.gatewayHintNone', { provider: provider.name }) : t('proxyProviders.geo.gatewayHintGeneric', { provider: provider.name, gateway: [(provider.gateway || {}).host, (provider.gateway || {}).port].filter(Boolean).join(':') })}</p>
                  </div>
                )}

                {renderSaveRow()}
              </section>

              <section className={sectionCls}>
                <div className={sectionTitleCls}><MapPin className="w-4 h-4 text-sky-400" /> {t('proxyProviders.creds.targetingTitle', 'Targeting')}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {!provider.geoSync.noCountry && (
                    <div className="sm:col-span-2">
                      <label className={labelCls}><Globe2 className="w-3.5 h-3.5 text-sky-400" /> {t('proxyProviders.geo.country')}</label>
                      <select value={form.country} title={countryTitle} onChange={(e) => set('country', e.target.value)} className={selectCls} style={chevronStyle}>
                        {/* A vendor whose every proxy carries a country (countryRequired) has no Any / Random. */}
                        {!provider.geoSync.countryRequired && <option value="">{t('proxyProviders.countries.any', 'Any / Random')}</option>}
{countryOptions(provider, i18n.language, geoOptions.country).map(([code, name]) => <option key={code} value={code}>{`${name} (${code})`}</option>)}
                      </select>
                      {provider.geoSync.countryLookup && (
                        <button type="button" onClick={() => handleLookup('country')} disabled={Boolean(lookingUp) || !form.token.trim()} className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-primary hover:underline disabled:opacity-60 disabled:no-underline">
                          {spin('country') || <Globe2 className="w-3.5 h-3.5" />} {geoOptions.country.length ? t('proxyProviders.geo.countriesLoaded', { count: geoOptions.country.length, defaultValue: '{{count}} countries for this pool' }) : t('proxyProviders.ps.loadCountries', 'Load all countries')}
                        </button>
                      )}
                    </div>
                  )}
                  {(geoOn || provider.geoSync.usState) && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.stateLabel')} {optMarker}</label>
                      <input value={form.state} onChange={(e) => set('state', e.target.value)} className={inputCls + ' font-mono'} placeholder={provider.geoSync.usState ? 'CA' : 'California'} maxLength={provider.geoSync.usState ? 2 : undefined} />
                    </div>
                  )}
                  {geoOn && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.cityLabel')} {optMarker}</label>
                      <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls + ' font-mono'} placeholder={provider.geoSync.cityPlaceholder || 'NewYork'} />
                    </div>
                  )}
                  {provider.geoSync.zip && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.zipOneLabel', 'ZIP code')} {optMarker}</label>
                      <input value={form.zip} onChange={(e) => set('zip', e.target.value)} className={inputCls + ' font-mono'} placeholder="90210" />
                    </div>
                  )}
                  {provider.geoSync.asn && geoOn && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.asnOneLabel', 'ASN')} {optMarker}</label>
                      <input value={form.asn} onChange={(e) => set('asn', e.target.value)} className={inputCls + ' font-mono'} placeholder="7922" />
                    </div>
                  )}
                  {/* "All / Leave blank for all" only where the pull lists proxies the account owns (list);
                      a gateway connector mints them, with or without a country picker. */}
                  {provider.geoSync.count && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.howMany')}</label>
                      <input inputMode="numeric" value={form.count} onChange={(e) => set('count', e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} className={inputCls + ' font-mono'} placeholder={provider.geoSync.list ? t('proxyProviders.geo.howManyAll', 'All') : '5'} title={provider.geoSync.list ? t('proxyProviders.geo.howManyListTitle') : t('proxyProviders.geo.howManyCapTitle', 'How many proxies to add. Each provider has its own maximum per pull (usually 100).')} />
                    </div>
                  )}
                  {provider.geoSync.proto && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.protocolLabel', 'Protocol')}</label>
                      <select value={protocolValue(provider.geoSync, form.proxyType)} onChange={(e) => set('proxyType', e.target.value)} className={selectCls} style={chevronStyle}>
                        <option value="http">HTTP</option>
                        {provider.geoSync.protoHttps && <option value="https">HTTPS</option>}
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </div>
                  )}
                  {provider.geoSync.poolType && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.poolTypeLabel')}</label>
                      <select value={form.poolType} onChange={(e) => choosePool(e.target.value)} className={selectCls} style={chevronStyle}>
                        {(Array.isArray(provider.geoSync.poolType)
                          ? provider.geoSync.poolType
                          : [['residential', t('proxyProviders.geo.poolResidential')], ['mobile', t('proxyProviders.geo.poolMobile')]]
                        ).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                      </select>
                    </div>
                  )}
                  {regionForPool(provider.geoSync, form.poolType) && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.gatewayRegionLabel')}</label>
                      <select value={['eu', 'asia'].includes(form.zone) ? form.zone : ''} onChange={(e) => set('zone', e.target.value)} className={selectCls} style={chevronStyle}>
                        <option value="">{t('proxyProviders.geo.regionUs')}</option>
                        <option value="eu">{t('proxyProviders.geo.regionEu')}</option>
                        <option value="asia">{t('proxyProviders.geo.regionAsia')}</option>
                      </select>
                    </div>
                  )}
                  {showSession && (() => {
                    // A digits-only session (sessionDigits, Live Proxies) says so, and shows what is wrong
                    // instead of dropping the other characters.
                    const digits = Number(provider.geoSync.sessionDigits) || 0;
                    const bad = digits > 0 && form.session.trim() !== '' && !new RegExp(`^\\d{1,${digits}}$`).test(form.session.trim());
                    return (
                      <div>
                        <label className={labelCls} htmlFor="sg-geo-session">{t('proxyProviders.geo.stickySessionLabel')} {optMarker}</label>
                        <input id="sg-geo-session" value={form.session} onChange={(e) => set('session', e.target.value)} inputMode={digits ? 'numeric' : undefined} aria-invalid={bad || undefined} aria-describedby={bad ? 'sg-geo-session-error' : undefined} className={inputCls + ' font-mono' + (bad ? ' border-red-500/70 focus:border-red-500 focus:ring-red-500' : '')} placeholder={digits ? t('proxyProviders.geo.stickySessionDigitsPlaceholder', { max: digits }) : t('proxyProviders.geo.stickySessionPlaceholder')} />
                        {bad && <p id="sg-geo-session-error" className="mt-1 text-[11px] text-red-400">{t('proxyProviders.geo.sessionDigitsError', { max: digits })}</p>}
                      </div>
                    );
                  })()}
                  {provider.geoSync.life && (
                    <div>
                      <label className={labelCls}>{t('proxyProviders.geo.keepSameIpLabel')} <span className="normal-case font-normal text-muted-foreground/70">{t('proxyProviders.geo.timeMarker')}</span></label>
                      <select value={form.life} onChange={(e) => set('life', e.target.value)} className={selectCls} style={chevronStyle}>
                        <option value="">{lifeBlankText}</option>
                        {/* Only offer lifetimes the vendor (and the chosen pool) accepts, so a pick is never silently clamped. */}
                        {lifeValuesFor(form.poolType).map((m) => (
                          <option key={m} value={m}>{lifeOptionLabel(m)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <button onClick={handleGeoSync} disabled={syncing} className={primaryBtnCls}>
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe2 className="w-4 h-4" />} {t('proxyProviders.geo.pullProxies')}{form.country ? ` · ${form.country}` : ''}
                </button>
              </section>
              <p className="text-[12px] text-muted-foreground leading-relaxed bg-card border border-border rounded-lg px-3.5 py-3">{t(`proxyProviders.geoHints.${provider.key}`, GEO_HINTS[provider.key])}</p>
            </div>
          ) : (
            /* ---- Rotating engine configuration form ---- */
            <div className="space-y-4 max-w-2xl">
              {/* No automatic pull yet: say so, and let the operator store real details for when it lands. */}
              {provider.unavailable && (
                <>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12.5px] text-[color-mix(in_srgb,var(--color-amber-500)_45%,var(--foreground))]">
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

              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={handleSaveCreds} disabled={savingCreds || Boolean(denyCreds)} title={denyCreds || undefined} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-secondary hover:bg-secondary/70 text-foreground border border-border disabled:opacity-60">
                  {savingCreds ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t('proxyProviders.creds.save', 'Save credentials')}
                </button>
                {credsSaved && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-400"><Check className="w-4 h-4" /> {credsSaved === 'cleared' ? t('proxyProviders.creds.cleared', 'Saved credentials removed') : t('proxyProviders.creds.saved', 'Credentials saved - ready to pull')}</span>}
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

              {provider.apiSync && (
                <div className="mt-1 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-[color-mix(in_srgb,var(--color-emerald-500)_65%,var(--foreground))]">{t('proxyProviders.apiSync.badge')}</span>
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
                  {provider.apiMint && renderApiMint()}
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

          {syncResult && (
            <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 max-w-2xl">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-400 mb-1.5"><Check className="w-4 h-4" /> {t('proxyProviders.result.syncedInto', { provider: syncResult.provider })}</div>
              <div className="grid grid-cols-3 gap-3 text-[12px] font-mono text-muted-foreground">
                <div>{t('proxyProviders.result.returned', { count: syncResult.total })}</div>
                <div className="text-emerald-400">{t('proxyProviders.result.added', { count: syncResult.created?.length ?? 0 })}</div>
                <div className="text-amber-400">{t('proxyProviders.result.existing', { count: syncResult.skipped?.length ?? 0 })}</div>
              </div>
              {/* A connector's note on what it added (iProxy.online: phones without a change-IP link). */}
              {syncResult.notice && RESULT_NOTICES.includes(syncResult.notice.code) && (
                <p className="mt-2 text-[12px] text-[color-mix(in_srgb,var(--color-amber-500)_55%,var(--foreground))]">{t(`proxyProviders.result.${syncResult.notice.code}`, { count: syncResult.notice.count })}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// Local Card wrapper to avoid an import cycle.
function Card({ className = '', children }) {
  return <div className={className}>{children}</div>;
}

// Bundled vendor logo (assets/providers/) when one exists, else the stylized fallback mark.
export function ProviderLogo({ k, className = 'w-6 h-6' }) {
  const logo = getLogo(k);
  if (logo) {
    return <img src={logo} alt="" aria-hidden="true" className={`${className} object-contain`} loading="lazy" />;
  }
  return <ProviderIcon k={k} className={className} />;
}

// Original stylized fallback marks; they inherit the tile's brand color via currentColor.
function ProviderIcon({ k, className = 'w-6 h-6' }) {
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
    case 'proxy302': // bolt
      return (<svg {...solid}><path d="M13 2L5 13h5l-1 9 8-12h-5z" /></svg>);
    case 'mangoproxy': // mango + leaf
      return (<svg {...line}><path d="M12 3.5c5 2 6.8 6.5 5.3 11C16 18.7 12 21 8.2 19.4 4.7 17.9 4.2 12.6 6.6 8.7 8 6.2 10 4.4 12 3.5z" /><path d="M12 4.5c1 2.4 1 4.8 0 7.2" /></svg>);
    case 'luna': // crescent
      return (<svg {...solid}><path d="M20 13.6A8 8 0 1 1 10.4 4a6.5 6.5 0 0 0 9.6 9.6z" /></svg>);
    case 'ipburger': // burger
      return (<svg {...line}><path d="M4 9c1-3.2 4.2-5 8-5s7 1.8 8 5" /><path d="M4 12.5h16" /><path d="M5 16h14a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 16z" /></svg>);
    case 'tisocks': // sock
      return (<svg {...line}><path d="M10 3v8l-3.2 3.2a3.6 3.6 0 0 0 5.1 5.1l4.1-4.1-3-3V3z" /><path d="M10 3h5" /></svg>);
    case 'apify': // crawler node + spokes
      return (<svg {...line}><circle cx="12" cy="12" r="3" /><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M5 5l2.4 2.4M16.6 16.6L19 19M19 5l-2.4 2.4M7.4 16.6L5 19" /></svg>);
    case 'anyip': // concentric rings
      return (<svg {...line}><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="9" /></svg>);
    case 'dataimpulse': // pulse line
      return (<svg {...line}><path d="M3 12h4l2.5-6 5 12 2.5-6H21" /></svg>);
    case 'liveproxies': // live signal waves
      return (<svg {...line}><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /><path d="M8.5 15.5a5 5 0 0 1 0-7" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M5.8 18.2a9 9 0 0 1 0-12.4" /><path d="M18.2 5.8a9 9 0 0 1 0 12.4" /></svg>);
    case 'iproyal': // crown
      return (<svg {...line}><path d="M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z" /><path d="M5 20h14" /></svg>);
    case 'proxyseller': // stacked list rows
      return (<svg {...line}><rect x="4" y="4.5" width="16" height="4" rx="1.2" /><rect x="4" y="10" width="16" height="4" rx="1.2" /><rect x="4" y="15.5" width="16" height="4" rx="1.2" /></svg>);
    default: {
      // No logo file and no mark of its own: the catalog's initials, so new connectors tell apart.
      const initials = (PROVIDERS.find((p) => p.key === k) || {}).initials;
      if (initials) {
        return (<svg {...solid} viewBox="0 0 16 16" overflow="visible"><text x="8" y="8.6" textAnchor="middle" dominantBaseline="central" fontSize={initials.length > 2 ? 7 : 9.5} fontWeight="700" fontFamily="inherit">{initials}</text></svg>);
      }
      return (<svg {...line}><circle cx="12" cy="12" r="7" /></svg>);
    }
  }
}
