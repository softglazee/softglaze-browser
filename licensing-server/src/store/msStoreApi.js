'use strict';
// Microsoft Store collection and purchase services, called from our server ("Manage product
// entitlements from a service"): https://learn.microsoft.com/windows/uwp/monetize/view-and-grant-products-from-a-service
//
// Credentials: a Microsoft Entra ID (Azure AD) app registration, associated with the app in Partner
// Center, stored per tenant as TenantPaymentConfig provider 'microsoft_store' (sealed):
// { entraTenantId, clientId, clientSecret }.
//
// Three Entra access tokens (client credentials, resource = audience URI):
//   https://onestore.microsoft.com                                  -> calls the Store APIs below
//   https://onestore.microsoft.com/b2b/keys/create/collections      -> service ticket the APP uses to make a collections ID key
//   https://onestore.microsoft.com/b2b/keys/create/purchase         -> service ticket the APP uses to make a purchase ID key
// The app calls StoreContext.GetCustomerCollectionsIdAsync / GetCustomerPurchaseIdAsync with the two
// tickets and sends the resulting Store ID keys back. "Each Microsoft Store ID key is valid for 30
// days", and a key can only be renewed while it is still valid; after that the app makes new ones.
// Entra tokens last 60 minutes.
//
// Every network call goes through `fetchImpl` (global fetch by default) so tests run without network.
const prisma = require('../db');
const { openJson } = require('../crypto/secrets');

const AUDIENCE = Object.freeze({
  api: 'https://onestore.microsoft.com',
  collectionsKey: 'https://onestore.microsoft.com/b2b/keys/create/collections',
  purchaseKey: 'https://onestore.microsoft.com/b2b/keys/create/purchase'
});

const URLS = Object.freeze({
  token: (entraTenantId) => `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/oauth2/token`,
  collectionsQuery: 'https://collections.mp.microsoft.com/v6.0/collections/query',
  recurrencesQuery: 'https://purchase.mp.microsoft.com/v8.0/b2b/recurrences/query',
  renewCollectionsKey: 'https://collections.mp.microsoft.com/v6.0/b2b/keys/renew',
  renewPurchaseKey: 'https://purchase.mp.microsoft.com/v6.0/b2b/keys/renew'
});

// A Store ID key lives 30 days; the cron renews it when it is older than this.
const KEY_LIFETIME_DAYS = 30;
const KEY_RENEW_AFTER_DAYS = 20;
const TIMEOUT_MS = 20000;

class StoreApiError extends Error {
  constructor(message, { status = null, code = 'store_error' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let fetchImpl = (...args) => fetch(...args);
function setFetchForTests(fn) { fetchImpl = fn || ((...args) => fetch(...args)); }

// Per (tenant, audience) cache of Entra tokens; a token is reused until 5 minutes before it expires.
const tokenCache = new Map();
function clearTokenCacheForTests() { tokenCache.clear(); }

async function loadCredentials(db, tenantId) {
  const cfg = await db.tenantPaymentConfig.findUnique({ where: { tenantId_provider: { tenantId, provider: 'microsoft_store' } } });
  if (!cfg || !cfg.enabled) return null;
  try {
    const c = openJson(cfg.secretsSealed);
    return c && c.entraTenantId && c.clientId && c.clientSecret ? c : null;
  } catch (_) {
    return null;
  }
}

async function requestJson(url, { method = 'POST', headers = {}, body, form } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: form ? { 'content-type': 'application/x-www-form-urlencoded', ...headers } : { 'content-type': 'application/json', ...headers },
      body: form ? new URLSearchParams(form).toString() : JSON.stringify(body || {}),
      signal: ctl.signal
    });
  } catch (e) {
    throw new StoreApiError(`Network error calling ${new URL(url).host}: ${e && e.message ? e.message : e}`, { code: 'store_unreachable' });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = null; }
  if (!res.ok) {
    // Never echo a token or key back: only the status and Microsoft's short error code.
    const msCode = json && (json.error_codes ? json.error : (json.code || json.error));
    // Who is at fault decides what a claim may do (entitlements.js):
    //   store_auth         our Entra ID app was refused (owner's set-up: alert, buyers are not punished)
    //   store_unavailable  Microsoft had a server error (5xx), like store_unreachable
    //   store_rejected     Microsoft refused the request, e.g. a Store ID key that is invalid or expired:
    //                      this can come from the client, so it never grants anything by itself
    const isToken = url.startsWith('https://login.microsoftonline.com/');
    throw new StoreApiError(`${new URL(url).host} answered ${res.status}${msCode ? ` (${String(msCode).slice(0, 80)})` : ''}.`, {
      status: res.status,
      code: isToken ? 'store_auth' : (res.status >= 500 ? 'store_unavailable' : 'store_rejected')
    });
  }
  if (!json) throw new StoreApiError(`${new URL(url).host} sent a reply that is not JSON.`, { code: 'store_unavailable' });
  return json;
}

async function entraToken(creds, audience, now = Date.now()) {
  const cacheKey = `${creds.entraTenantId}|${creds.clientId}|${audience}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt - 5 * 60000 > now) return hit.token;
  const json = await requestJson(URLS.token(creds.entraTenantId), {
    form: { grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret, resource: audience }
  });
  if (!json.access_token) throw new StoreApiError('Microsoft Entra ID sent no access token.', { code: 'store_auth' });
  // expires_on is seconds since 1970 (v1 endpoint); expires_in is seconds from now.
  const expiresAt = Number(json.expires_on) > 0 ? Number(json.expires_on) * 1000 : now + (Number(json.expires_in) || 3600) * 1000;
  tokenCache.set(cacheKey, { token: json.access_token, expiresAt });
  return json.access_token;
}

// The two service tickets the app turns into Store ID keys. -> { collectionsTicket, purchaseTicket }
async function serviceTickets(creds) {
  const [collectionsTicket, purchaseTicket] = await Promise.all([
    entraToken(creds, AUDIENCE.collectionsKey),
    entraToken(creds, AUDIENCE.purchaseKey)
  ]);
  return { collectionsTicket, purchaseTicket };
}

// Products this customer owns (add-ons included), all states. -> [item]
// item: { productId, skuId, skuType (Trial | Full | Rental), inAppOfferToken, productType, status (Active | Expired |
// Revoked | Banned), acquiredDate, startDate, endDate, orderId, transactionId, ... }
async function queryCollections(creds, collectionsKey, publisherUserId) {
  const token = await entraToken(creds, AUDIENCE.api);
  const items = [];
  let continuationToken;
  for (let page = 0; page < 20; page++) {
    const json = await requestJson(URLS.collectionsQuery, {
      headers: { authorization: `Bearer ${token}` },
      body: {
        beneficiaries: [{ identityType: 'b2b', identityValue: collectionsKey, localTicketReference: String(publisherUserId || '') }],
        productTypes: ['Durable'],
        validityType: 'All',
        maxPageSize: 100,
        ...(continuationToken ? { continuationToken } : {})
      }
    });
    if (Array.isArray(json.items)) items.push(...json.items);
    continuationToken = json.continuationToken;
    if (!continuationToken) break;
  }
  return items;
}

// This customer's subscriptions (recurrences). -> [item]
// item: { id, productId, skuId, recurrenceState (None | Active | Inactive | Canceled | InDunning | Failed), autoRenew,
// expirationTime, expirationTimeWithGrace, startTime, cancellationDate, isTrial, market, ... }
async function queryRecurrences(creds, purchaseKey) {
  const token = await entraToken(creds, AUDIENCE.api);
  const items = [];
  let continuationToken;
  for (let page = 0; page < 20; page++) {
    const json = await requestJson(URLS.recurrencesQuery, {
      headers: { authorization: `Bearer ${token}` },
      body: { b2bKey: purchaseKey, pageSize: 25, ...(continuationToken ? { continuationToken } : {}) }
    });
    if (Array.isArray(json.items)) items.push(...json.items);
    continuationToken = json.continuationToken;
    if (!continuationToken) break;
  }
  return items;
}

// Renews a Store ID key before its 90 days run out. kind: 'collections' | 'purchase'. -> new key
async function renewKey(creds, kind, key) {
  const token = await entraToken(creds, AUDIENCE.api);
  const json = await requestJson(kind === 'collections' ? URLS.renewCollectionsKey : URLS.renewPurchaseKey, {
    body: { serviceTicket: token, key }
  });
  if (!json.key) throw new StoreApiError('The Store did not return a renewed key.');
  return json.key;
}

module.exports = {
  AUDIENCE, URLS, KEY_LIFETIME_DAYS, KEY_RENEW_AFTER_DAYS, StoreApiError,
  loadCredentials: (db, tenantId) => loadCredentials(db || prisma, tenantId),
  entraToken, serviceTickets, queryCollections, queryRecurrences, renewKey,
  setFetchForTests, clearTokenCacheForTests
};
