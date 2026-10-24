// controllers/studentForgotPasswordController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne, sql } = require('../config/db');
const sessions = require('../services/sessionService');
const { success, badRequest, notFound } = require('../utils/response');
// ⚠️ Aapke signupController.js mein jo WhatsApp OTP sender use ho raha hai wahi yahan import karo
// const { sendWhatsappOtp } = require('../services/whatsappService');

const secret = process.env.JWT_SECRET; // never hardcode: this repo is public
const { generateOtp: genOtp } = require('../utils/otp');

// POST /api/student/auth/forgot-password/send-otp   Body: { phone }
exports.sendResetOtp = async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return badRequest(res, 'Phone is required');

    const cred = await queryOne(`SELECT id FROM student_credentials WHERE login_phone=@ph AND deleted_at IS NULL`, {
      ph: { type: sql.VarChar(20), value: phone.trim() },
    });
    // Same answer whether or not the number is registered (prevents account enumeration)
    const generic = 'If this phone number is registered, an OTP has been sent.';
    if (!cred) return success(res, null, generic);

    const otp = genOtp();
    await query(
      `INSERT INTO OtpVerifications (Phone, Otp, Purpose, ActorType, ExpiresAt, CreatedAt)
       VALUES (@ph, @otp, 'FORGOT_PASSWORD', 'student', DATEADD(MINUTE, 10, GETUTCDATE()), GETUTCDATE())`,
      { ph: { type: sql.VarChar(15), value: phone.trim() }, otp: { type: sql.VarChar(6), value: otp } }
    );

    // await sendWhatsappOtp(phone, otp);
    return success(res, null, generic);
  } catch (err) { next(err); }
};

// POST /api/student/auth/forgot-password/verify-otp   Body: { phone, otp }
exports.verifyResetOtp = async (req, res, next) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return badRequest(res, 'Phone and OTP are required');

    const row = await queryOne(
      `SELECT TOP 1 Id FROM OtpVerifications
       WHERE Phone=@ph AND Otp=@otp AND Purpose='FORGOT_PASSWORD' AND ActorType='student'
         AND ExpiresAt > GETUTCDATE()
       ORDER BY CreatedAt DESC`,
      { ph: { type: sql.VarChar(15), value: phone.trim() }, otp: { type: sql.VarChar(6), value: otp } }
    );
    if (!row) return badRequest(res, 'Invalid or expired OTP');

    // Burn the OTP so one code can only ever produce one reset token
    await query(
      `DELETE FROM OtpVerifications WHERE Phone=@ph AND Purpose='FORGOT_PASSWORD' AND ActorType='student'`,
      { ph: { type: sql.VarChar(15), value: phone.trim() } }
    );

    const resetToken = jwt.sign({ phone: phone.trim(), purpose: 'reset' }, secret, { expiresIn: '10m' });
    return success(res, { resetToken });
  } catch (err) { next(err); }
};

// POST /api/student/auth/forgot-password/reset   Body: { resetToken, newPassword }
exports.resetPassword = async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return badRequest(res, 'resetToken and newPassword are required');

    if (String(newPassword).length < 6) return badRequest(res, 'Password must be at least 6 characters');

    const decoded = jwt.verify(resetToken, secret);
    if (decoded.purpose !== 'reset') return badRequest(res, 'Invalid reset token');

    const hash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE student_credentials SET password_hash=@hash, updated_at=GETUTCDATE() WHERE login_phone=@ph`, {
      hash: { type: sql.NVarChar(255), value: hash },
      ph: { type: sql.VarChar(20), value: decoded.phone },
    });
    await sessions.revokeStudentsByPhone(decoded.phone).catch(() => {});
    return success(res, null, 'Password reset successfully');
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') return badRequest(res, 'Reset session expired or invalid, please request OTP again');
    next(err);
  }
};
