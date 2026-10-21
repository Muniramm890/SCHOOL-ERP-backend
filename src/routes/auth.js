// src/routes/auth.js
const router = require('express').Router();
const ctrl   = require('../controllers/authController');
const signupCtrl = require('../controllers/signupController'); 
const { authenticate } = require('../middleware/auth');
const rateLimit = require('express-rate-limit'); // 
const forgotPasswordCtrl = require('../controllers/forgotPasswordController');

// ── Security: OTP rate limiters (see middleware/rateLimiter.js) ────────────
// otpSend   : max 3 codes / 10 min per IP and per phone/email
// otpVerify : max 5 guesses / 10 min per phone/email and 30 per IP (6-digit codes can otherwise be brute-forced)
const { otpSend, otpVerify, otpVerifyByIp } = require('../middleware/rateLimiter');

// ── Public Routes (Login) ──────────────────────────────────────────────
router.post('/login',           ctrl.login);
router.post('/refresh',         ctrl.refresh);

//==========================================
router.post('/logout', authenticate, ctrl.logout);

// ── Public Routes (School Registration / Signup) ───────────────────────
router.post('/signup/send-otp',   ...otpSend, signupCtrl.sendOtp);
router.post('/signup/verify-otp', ...otpVerify, signupCtrl.verifyOtp);
router.post('/signup/register',   otpVerifyByIp, signupCtrl.registerSchool);

// ── Forgot Password (WhatsApp or Email OTP) ─────────────────────────────

router.post('/forgot-password/send-otp',   ...otpSend, forgotPasswordCtrl.sendResetOtp);
router.post('/forgot-password/verify-otp', ...otpVerify, forgotPasswordCtrl.verifyResetOtp);
router.post('/forgot-password/reset',      otpVerifyByIp, forgotPasswordCtrl.resetPassword);

// ── Protected Routes ───────────────────────────────────────────────────
router.get('/me',               authenticate, ctrl.me);
router.put('/me',                authenticate, ctrl.updateProfile);
router.post('/change-password', authenticate, ctrl.changePassword);

module.exports = router;
