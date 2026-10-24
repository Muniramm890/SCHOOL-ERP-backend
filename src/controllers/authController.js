// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne, sql } = require('../config/db');
const { success, badRequest, unauthorized } = require('../utils/response');
const { logAudit } = require('../utils/auditLogger');
const sessions = require('../services/sessionService');

// ── Helpers ────────────────────────────────────────────────────────────────
// Hardcode the secret for testing right now
const secret = process.env.JWT_SECRET; 
const signToken = (payload) => jwt.sign({ ...payload, type: 'access' }, secret, { expiresIn: '24h' });
 // 👈 Direct string for testing

const signRefresh = (payload) => 
  jwt.sign({ ...payload, type: 'refresh' }, secret, { expiresIn: '30d' }); // `type` stops a refresh token being used as an access token

// ── POST /api/auth/login ───────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return badRequest(res, 'Email and password are required');

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

     const user = await queryOne(`
      SELECT id, full_name, email, password, is_active, avatar_url
      FROM users 
      WHERE email = @email AND deleted_at IS NULL
    `, {
      email: { type: sql.NVarChar(255), value: email }
    });

    if (!user) {
      sessions.recordFailure({ req, type: 'staff', identifier: email, reason: 'user_not_found' });
      await logAudit({
        actionType: 'LOGIN_FAILED',
        userName: email,
        ipAddress: ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'user_not_found' },
      });
      return unauthorized(res, 'Invalid email or password');
    }
    if (!user.is_active) { sessions.recordFailure({ req, type: 'staff', identifier: email, reason: 'inactive' }); return unauthorized(res, 'Your account is inactive. Please contact support.'); }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      sessions.recordFailure({ req, type: 'staff', identifier: email, reason: 'wrong_password' });
      await logAudit({
        userId: user.id,
        actionType: 'LOGIN_FAILED',
        userName: email,
        ipAddress: ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'wrong_password' },
      });
      return unauthorized(res, 'Invalid email or password');
    }

    const memberData = await queryOne(`
      SELECT sm.school_id, sm.role, sm.permissions, sm.is_active AS member_active, 
             s.name AS school_name, s.slug AS school_code
      FROM school_members sm
      JOIN schools s ON sm.school_id = s.id
      WHERE sm.user_id = @userId AND sm.deleted_at IS NULL AND s.deleted_at IS NULL AND s.is_active = 1
    `, { userId: { type: sql.UniqueIdentifier, value: user.id } });

    if (!memberData) return unauthorized(res, 'User is not assigned to any active school');
    if (!memberData.member_active) return unauthorized(res, 'Your school access is currently suspended');

    await query(`UPDATE users SET last_login_at = GETUTCDATE() WHERE id = @userId`, { 
      userId: { type: sql.UniqueIdentifier, value: user.id } 
    });

    // login session: device / IP / place, needed for "who is logged in" and remote logout. Never blocks the login if it fails.
    let sid = null;
    try {
      sid = await sessions.createSession({ req, schoolId: memberData.school_id, type: 'staff', userId: user.id, name: user.full_name, role: memberData.role, ttlMs: 30 * 86400000 });
    } catch (e) { console.error('[sessions] create failed (login continues):', e.message); }

    const payload = { userId: user.id, schoolId: memberData.school_id, role: memberData.role, fullName: user.full_name, ...(sid ? { sid } : {}) };
    const token = signToken(payload);
    const refreshToken = signRefresh(payload);

    // 🔴 Audit log — successful login
    await logAudit({
      schoolId: memberData.school_id,
      userId: user.id,
      userName: user.full_name,
      userRole: memberData.role,
      actionType: 'LOGIN',
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });

     return success(res, {
      token,
      refreshToken,
      sessionId: sid,
      userId: user.id,
      name: user.full_name,
      role: memberData.role,
      schoolId: memberData.school_id,
      avatarUrl: user.avatar_url || null,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: memberData.role,
        avatar_url: user.avatar_url || null,
        permissions: memberData.permissions ? JSON.parse(memberData.permissions) : {},
        school: { 
          id: memberData.school_id, 
          name: memberData.school_name, 
          code: memberData.school_code 
        },
      },
    });
  } catch (err) { next(err); }
};

// ── GET /api/auth/me ───────────────────────────────────────────────────────
exports.me = async (req, res, next) => {
  try {
    // JWT Token ke payload se req.user mein data aayega (Middleware se)
    const user = await queryOne(`
      SELECT u.id, u.full_name, u.display_name, u.email, u.phone, u.avatar_url,
             u.date_of_birth, u.gender, u.last_login_at,
             sm.role, sm.permissions, sm.employee_code,
             s.id AS school_id, s.name AS school_name, s.slug AS school_code, s.logo_url
      FROM users u
      JOIN school_members sm ON sm.user_id = u.id AND sm.school_id = @schoolId
      JOIN schools s ON s.id = sm.school_id
      WHERE u.id = @userId AND u.deleted_at IS NULL
    `, {
      userId: { type: sql.UniqueIdentifier, value: req.user.userId },
      schoolId: { type: sql.UniqueIdentifier, value: req.user.schoolId }
    });
    
    if (!user) return unauthorized(res, 'User session invalid or expired');

    // Parse JSON permissions if they exist
    if (user.permissions) user.permissions = JSON.parse(user.permissions);

    return success(res, user);
  } catch (err) { next(err); }
};

// ── PUT /api/auth/me ────────────────────────────────────────────────────────
exports.updateProfile = async (req, res, next) => {
  try {
    const { fullName, displayName, phone, avatarUrl, dateOfBirth, gender } = req.body;

    // Whitelisted fields only — email, role, id, permissions cannot be changed here
    await query(`
      UPDATE users SET
        full_name = COALESCE(@fullName, full_name),
        display_name = COALESCE(@displayName, display_name),
        phone = COALESCE(@phone, phone),
        avatar_url = COALESCE(@avatarUrl, avatar_url),
        date_of_birth = COALESCE(@dateOfBirth, date_of_birth),
        gender = COALESCE(@gender, gender)
      WHERE id = @userId AND deleted_at IS NULL
    `, {
      fullName: { type: sql.NVarChar(255), value: fullName || null },
      displayName: { type: sql.NVarChar(255), value: displayName || null },
      phone: { type: sql.NVarChar(20), value: phone || null },
      avatarUrl: { type: sql.NVarChar(sql.MAX), value: avatarUrl || null },
      dateOfBirth: { type: sql.Date, value: dateOfBirth || null },
      gender: { type: sql.NVarChar(20), value: gender || null },
      userId: { type: sql.UniqueIdentifier, value: req.user.userId }
    });

    // Return the freshly updated profile, same shape as GET /me
    const user = await queryOne(`
      SELECT u.id, u.full_name, u.display_name, u.email, u.phone, u.avatar_url,
             u.date_of_birth, u.gender, u.last_login_at,
             sm.role, sm.permissions, sm.employee_code,
             s.id AS school_id, s.name AS school_name, s.slug AS school_code, s.logo_url
      FROM users u
      JOIN school_members sm ON sm.user_id = u.id AND sm.school_id = @schoolId
      JOIN schools s ON s.id = sm.school_id
      WHERE u.id = @userId AND u.deleted_at IS NULL
    `, {
      userId: { type: sql.UniqueIdentifier, value: req.user.userId },
      schoolId: { type: sql.UniqueIdentifier, value: req.user.schoolId }
    });

    if (user.permissions) user.permissions = JSON.parse(user.permissions);

    await logAudit({
      schoolId: req.user.schoolId,
      userId: req.user.userId,
      userName: user.full_name,
      userRole: req.user.role,
      actionType: 'PROFILE_UPDATED',
      details: { fields: Object.keys(req.body) },
    });

    return success(res, user, 'Profile updated successfully');
  } catch (err) { next(err); }
};

// ── POST /api/auth/change-password ────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return badRequest(res, 'Both current and new passwords are required');
    
    const user = await queryOne(`SELECT password FROM users WHERE id = @userId`, { 
      userId: { type: sql.UniqueIdentifier, value: req.user.userId } 
    });

    // Check old password
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return badRequest(res, 'Current password is incorrect');

    // Hash and update new password
    const newHash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE users SET password = @hash WHERE id = @userId`, { 
      hash: { type: sql.NVarChar(255), value: newHash }, 
      userId: { type: sql.UniqueIdentifier, value: req.user.userId } 
    });
    // password changed -> every OTHER device is logged out
    await sessions.revokeAllFor({ type: 'staff', userId: req.user.userId, exceptSid: req.sid || null, reason: 'password_changed' }).catch(() => {});

    return success(res, null, 'Password updated successfully');
  } catch (err) { next(err); }
};

// ── POST /api/auth/refresh ─────────────────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return badRequest(res, 'Refresh token required');

    const decoded = jwt.verify(refreshToken, secret);
    // An access token must never be able to renew itself forever. (Refresh tokens issued before this change have no `type`
    // and keep working until they expire.)
    if (decoded.type === 'access') return unauthorized(res, 'Invalid refresh token');
    // session must still be alive (checked in the DB, not the cache): remote logout / logout / password change stop the refresh too
    if (decoded.sid && !(await sessions.check(decoded.sid, { fresh: true }))) return unauthorized(res, 'Session ended. Please log in again.');
    if (decoded.sid) sessions.touch(decoded.sid, true);
    const token = signToken({ userId: decoded.userId, schoolId: decoded.schoolId, role: decoded.role, fullName: decoded.fullName, ...(decoded.sid ? { sid: decoded.sid } : {}) });
    
    return success(res, { token });
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Refresh token expired. Please log in again.');
    if (err.name === 'JsonWebTokenError') return unauthorized(res, 'Invalid refresh token');
    next(err);
  }
};

exports.logout = async (req, res) => {
   if (req.sid) await sessions.endSession(req.sid, 'logout');
   await logAudit({
    schoolId: req.user?.schoolId,
    userId: req.user?.userId,
    userName: req.user?.fullName,
    userRole: req.user?.role,
    actionType: 'LOGOUT',
    ipAddress: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress,
  });
  return success(res, null, 'Logged out');
};

//ok
