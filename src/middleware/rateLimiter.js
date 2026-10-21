// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Real client IP.
// server.js sets app.set('trust proxy', 1), so Express already works out the client address from the proxy chain
// (it takes the entry added by our own proxy, which the client cannot fake). We must NOT read the X-Forwarded-For header
// ourselves: its left-most value is whatever the client sent, so rotating it would reset every limit.
const clientIp = (req) => {
  let ip = String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').replace(/^::ffff:/, '');
  // Azure App Service appends the client port to IPv4 addresses (157.48.91.6:47412) -> strip it (IPv6 is left untouched)
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(':')[0];
  return ip;
};

// 1. General API Limiter (Standard DDoS Protection for the whole app)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per 15 mins
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' }
});

// 2. Auth Routes Limiter (Brute Force Protection for Login/OTP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 login/auth attempts per 15 mins
  keyGenerator: clientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again after 15 minutes.' }
});

// ── OTP protection ────────────────────────────────────────────────────────────
// A 6-digit OTP has only 1,000,000 combinations, so guessing must be throttled per ACCOUNT (identifier) and not
// only per IP (an attacker can come from many IPs). Counters are in memory (per server instance, reset on restart).
const TEN_MIN = 10 * 60 * 1000;
const identifierOf = (req) =>
  String((req.body && (req.body.identifier || req.body.phone || req.body.email)) || '').toLowerCase().trim();
const limiter = (max, keyGenerator, message) =>
  rateLimit({ windowMs: TEN_MIN, max, keyGenerator, standardHeaders: true, legacyHeaders: false, message: { success: false, message } });

// Asking for a code: max 3 / 10 min per IP and per phone/email (stops WhatsApp/SMS bombing of one person).
const otpSendByIp = limiter(3, clientIp, 'Too many OTP requests. Please try again later.');
const otpSendByIdentifier = limiter(3, (req) => `send:${identifierOf(req) || clientIp(req)}`, 'Too many OTP requests for this account. Please try again later.');
const otpSend = [otpSendByIp, otpSendByIdentifier];

// Guessing a code: max 5 / 10 min per phone/email, and max 30 / 10 min per IP across all accounts.
const otpVerifyByIdentifier = limiter(5, (req) => `verify:${identifierOf(req) || clientIp(req)}`, 'Too many incorrect attempts. Please try again in 10 minutes.');
const otpVerifyByIp = limiter(30, clientIp, 'Too many attempts from this IP. Please try again later.');
const otpVerify = [otpVerifyByIdentifier, otpVerifyByIp];

module.exports = { generalLimiter, authLimiter, clientIp, otpSend, otpVerify, otpVerifyByIp };
