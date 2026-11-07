'use strict';
// The client IP behind the host's proxies. X-Forwarded-For is client-controlled except for the
// entries our own proxies append on the right, so the client is the address TRUST_PROXY_HOPS steps
// from the app: hops 1 = the rightmost XFF entry (added by the one proxy in front of us), hops 2 = the
// one before it (an edge/CDN in front of that proxy). This is exactly Express's numeric `trust proxy`
// (socket address first, then XFF right to left), but the hop count is re-read from config/.env, so
// the owner can correct it without a restart (run.sh check-ip measures it).
// Only HMAC hashes of IPs are ever stored (ipHash); IPv6 is counted per /64, which one subscriber
// usually holds whole.
const net = require('node:net');
const { liveEnv } = require('../env');
const { hmacHex } = require('../crypto/derive');

function trustHops() {
  const n = Number.parseInt(liveEnv('TRUST_PROXY_HOPS') || '1', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 5) : 1;
}

// "::ffff:1.2.3.4" -> "1.2.3.4"; strips brackets, ports on IPv4 and zone ids. '' when not an IP.
function normalizeIp(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') > 0 ? s.indexOf(']') : undefined);
  const zone = s.indexOf('%');
  if (zone > 0) s = s.slice(0, zone);
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) s = mapped[1];
  return net.isIP(s) ? s.toLowerCase() : '';
}

// [socket address, then X-Forwarded-For entries from right to left], like proxy-addr.
function forwardedChain(req) {
  const socketAddr = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
  const header = (req.headers && req.headers['x-forwarded-for']) || '';
  const list = String(Array.isArray(header) ? header.join(',') : header).split(',').map((x) => x.trim()).filter(Boolean);
  return [socketAddr, ...list.reverse()];
}

function clientIpFromChain(chain, hops) {
  if (!chain.length) return '';
  return chain[Math.min(Math.max(hops, 0), chain.length - 1)];
}

function clientIp(req) {
  return normalizeIp(clientIpFromChain(forwardedChain(req), trustHops()));
}

// Addresses that cannot be a real subscriber on the public internet. The trial network rule is not
// applied to them (a private or carrier-grade NAT address means the chain is not what we think, or
// many people share it).
const notPublic = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) notPublic.addSubnet(a, p, 'ipv4');
// No ::ffff:0:0/96 rule: BlockList matches IPv4 addresses against it too, and normalizeIp() has already
// turned IPv4-mapped addresses into plain IPv4.
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]) {
  notPublic.addSubnet(a, p, 'ipv6');
}

function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (!v) return false;
  return !notPublic.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

function expandIpv6(ip) {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => x.padStart(4, '0'));
}

// IPv4: the address. IPv6: its /64 prefix.
function networkKey(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ip;
  if (v === 6) return expandIpv6(ip).slice(0, 4).join(':') + '::/64';
  return '';
}

function ipHash(ip) {
  const key = networkKey(normalizeIp(ip));
  return key ? hmacHex('ip-v1', key) : null;
}

module.exports = { trustHops, normalizeIp, forwardedChain, clientIpFromChain, clientIp, isPublicIp, networkKey, ipHash };
