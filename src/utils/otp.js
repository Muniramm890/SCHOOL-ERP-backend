// src/utils/otp.js
const crypto = require('crypto');

// Cryptographically secure 6-digit OTP (100000-999999).
// Math.random() is predictable and must never be used to generate secrets.
exports.generateOtp = () => String(crypto.randomInt(100000, 1000000));
