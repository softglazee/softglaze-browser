// Sticky or rotating, for the connectors whose pull builds proxies on a gateway with Keep same IP and a
// session name. Mirrors gatewayPullPlan in src/main/ipcHandlers.js, so the form says what main does:
// one proxy with no session name and Keep same IP blank is one rotating proxy ("Different IP each
// time"); a session name, a Keep same IP time, or How many above 1 makes sticky proxies, and with Keep
// same IP blank each keeps its IP for the vendor's default time.
export function gatewayPullIsSticky({ count, session, life } = {}) {
  const n = Number.parseInt(String(count == null ? '' : count), 10);
  const minutes = Number.parseInt(String(life == null ? '' : life), 10);
  return Boolean(String(session == null ? '' : session).trim())
    || (Number.isFinite(minutes) && minutes > 0)
    || (Number.isFinite(n) && n > 1);
}

// What Keep same IP left blank means on a sticky pull, per connector: minutes the vendor (or the
// username the app builds) holds the IP; { upTo } is "as long as the vendor can, up to"; null is the
// vendor's own default, which its docs do not give; 'rotating' means blank always rotates, because
// each proxy is its own purchase. A connector with Keep same IP must have an entry (test/connectorsShared).
export const LIFE_BLANK_DEFAULTS = Object.freeze({
  ipfoxy: 30, // IPFoxy's default ttl (no -ttl- is sent)
  proxy302: 'rotating', // Standard line: blank buys a rotating proxy, one per row
  mangoproxy: 30, // the app sends sessionDuration 30 for more than one row
  ipburger: 30, // ipBurgerUsername sends sesstime 30
  anyip: 10080, // AnyIP's default session, 7 days
  nodemaven: { upTo: 1440 }, // no -ttl-: as long as possible, up to 24 hours
  catproxies: 30, // the app sends 30 minutes
  rapidproxy: null, // no -stime-: RapidProxy's own default, not documented
  novada: 10, // novadaUsername sends sessTime 10
  proxmint: 30, // proxmintUsername sends sessttl 30
  databay: 30, // databayUsername sends sessionLength 30
  twoextract: 10, // 2extract's default
  gonzoproxy: 4320, // the app sends 72h, the dashboard generator's default
  simplyproxies: 120, // 2 hours, extended while in use
  marsproxies: 1440, // no lifetime is sent: MarsProxies' default of 24 hours
  simplynode: 30, // the app sends ttl 1800 seconds
  proxyempire: null, // sticky "Same IP": held until ProxyEmpire rotates it or its device goes offline
  massive: 15 // no sessionttl is sent: Massive's default of 15 minutes
});

// Every Keep same IP time the form can offer, in minutes; a connector shows those up to its maxLife
// (24 hours when unset), a pool's own maximum (maxLifeByPool, for example NOVADA's Rotating ISP), or
// its own lifeOptions list.
export const LIFE_OPTIONS = Object.freeze([5, 10, 30, 60, 120, 360, 720, 1440, 4320, 10080]);
export function lifeOptionsFor(geoSync = {}, poolType = '') {
  if (Array.isArray(geoSync.lifeOptions) && geoSync.lifeOptions.length) return geoSync.lifeOptions.slice();
  const byPool = geoSync.maxLifeByPool && Number(geoSync.maxLifeByPool[poolType]) > 0 ? Number(geoSync.maxLifeByPool[poolType]) : 0;
  const max = byPool || (Number(geoSync.maxLife) > 0 ? Number(geoSync.maxLife) : 1440);
  return LIFE_OPTIONS.filter((m) => m <= max);
}

// Whether State, City and the other place filters apply to the chosen pool: a connector whose pools
// differ lists the ones that take them in geoSync.geoPools (MangoProxy, Proxy302).
export function geoForPool(geoSync = {}, poolType = '') {
  if (!geoSync.geo) return false;
  return !Array.isArray(geoSync.geoPools) || geoSync.geoPools.includes(poolType);
}

// The text of the blank Keep same IP option, as an i18n key and its values: "Different IP each time"
// only when the pull is really rotating.
export function lifeBlankLabel(providerKey, { count, session } = {}) {
  const def = Object.prototype.hasOwnProperty.call(LIFE_BLANK_DEFAULTS, providerKey) ? LIFE_BLANK_DEFAULTS[providerKey] : null;
  if (def === 'rotating' || !gatewayPullIsSticky({ count, session })) return { key: 'lifeDifferent' };
  if (def && typeof def === 'object' && Number(def.upTo) > 0) return { key: 'lifeDefaultUpTo', minutes: Number(def.upTo) };
  if (Number(def) > 0) return { key: 'lifeDefaultTime', minutes: Number(def) };
  return { key: 'lifeProviderDefault' };
}
