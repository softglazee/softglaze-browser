'use strict';
// Microsoft Store purchases from the Store build of the app (src/store/entitlements.js).
//
// POST /v1/store/session { tenantId, installId, installSecret, machineHash, appVersion? }
//   -> { products: [{ productId, plan, tier, name }],
//        verification: { mode: 'verified', collectionsTicket, purchaseTicket, publisherUserId }
//                    | { mode: 'unverified' | 'pending_review', note? } }
//   The tickets are short-lived Entra ID tokens the app passes to StoreContext.GetCustomerCollectionsIdAsync
//   / GetCustomerPurchaseIdAsync; they only let the app create Store ID keys for this publisher.
//
// POST /v1/store/claim { tenantId, installId, installSecret, machineHash, appVersion?,
//                        licenseRead, addOns: [{ inAppOfferToken, skuStoreId, isActive, expiresAtMs }],
//                        prices: { <productId>: { formatted, formattedRecurrence, currencyCode } },
//                        keys?: { collections, purchase }, purchase?: { productId, status }, move? }
//   -> 200 { ok, mode: 'verified' | 'unverified' | 'pending_review', verified, verifyNote, licensed, conflicts,
//            entitlements: [{ id, productId, plan, tier, status, verified, accessUntil, expiresAt, autoRenew }] }
//   -> 409 store_in_use (the subscription is on another computer: send move: true to take it over)
//   -> 429 store_move_limit, 404 store_not_owned (Microsoft does not list it yet), and the install /
//      machine errors of installRequest.js. Then the app fetches its lease from /v1/license as usual.
const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { installRequest } = require('./installRequest');
const { claimStore, storeSession } = require('../store/entitlements');

const router = express.Router();

router.post('/session', asyncHandler(async (req, res) => {
  const ctx = await installRequest(req, res, { requireMachine: true });
  if (!ctx) return;
  res.json(await storeSession(prisma, ctx.tenant, ctx.install, { settings: ctx.settings }));
}));

router.post('/claim', asyncHandler(async (req, res) => {
  const ctx = await installRequest(req, res, { requireMachine: true });
  if (!ctx) return;
  const { status, body } = await claimStore(prisma, ctx.tenant, ctx.install, req.body || {}, { settings: ctx.settings });
  res.status(status).json(body);
}));

module.exports = router;
