// src/controllers/securityController.js
// Login activity for admins: who logged in (staff + students), when, which device / IP / place, remote logout.
//   GET  /api/security/summary
//   GET  /api/security/sessions?type=staff|student&status=active|ended|all&q=&user_id=&student_id=&platform=&from=&to=&page=&limit=
//   POST /api/security/sessions/:id/revoke
//   POST /api/security/revoke-all           { type, user_id | student_id, stop_tracking? }
//   GET  /api/security/failures
//   GET  /api/security/never-logged-in?type=staff|student
// Self-service ("my devices"): GET /api/auth/sessions, POST /api/auth/sessions/:id/revoke  (and the same under /api/student/auth)
const { query, queryOne, sql } = require('../config/db');
const { success, badRequest, notFound } = require('../utils/response');
const { logAudit } = require('../utils/auditLogger');
const sessions = require('../services/sessionService');

const UID = (v) => ({ type: sql.UniqueIdentifier, value: v });
const isGuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const ACTIVE = `(ls.ended_at IS NULL AND (ls.expires_at IS NULL OR ls.expires_at > SYSUTCDATETIME()))`;
const STATUS = `CASE WHEN ls.ended_at IS NOT NULL THEN 'ended' WHEN ls.expires_at IS NOT NULL AND ls.expires_at <= SYSUTCDATETIME() THEN 'expired' ELSE 'active' END`;
const COLS = `ls.id, ls.principal_type, ls.user_id, ls.student_id, ls.display_name, ls.role, ls.device_id, ls.device_name, ls.platform, ls.os, ls.browser, ls.app_version,
  ls.ip_address, ls.geo_city, ls.geo_region, ls.geo_country, ls.latitude, ls.longitude, ls.location_accuracy_m, ls.location_source,
  ls.login_at, ls.last_seen_at, ls.expires_at, ls.ended_at, ls.end_reason, ls.revoked_by_name,
  ${STATUS} AS status, DATEDIFF(SECOND, COALESCE(ls.last_seen_at, ls.login_at), SYSUTCDATETIME()) AS idle_sec`;

const ctxName = (req) => ({ userId: req.user.userId, name: req.user.fullName });
const ipOf = (req) => sessions.clientInfo(req).ip;

// ── admin: list ──
exports.listSessions = async (req, res, next) => {
  try {
    await sessions.ensureTables();
    const q = req.query; const page = Math.max(1, parseInt(q.page) || 1); const limit = Math.min(100, Math.max(1, parseInt(q.limit) || 25));
    const params = { sid: UID(req.user.schoolId) }; const where = ['ls.school_id = @sid'];
    if (q.type === 'staff' || q.type === 'student') { where.push('ls.principal_type = @type'); params.type = { type: sql.VarChar(10), value: q.type }; }
    const status = q.status || 'active';
    if (status === 'active') where.push(ACTIVE); else if (status === 'ended') where.push(`NOT ${ACTIVE}`);
    if (isGuid(q.user_id)) { where.push('ls.user_id = @uid'); params.uid = UID(q.user_id); }
    if (isGuid(q.student_id)) { where.push('ls.student_id = @stid'); params.stid = UID(q.student_id); }
    if (q.platform) { where.push('ls.platform = @pf'); params.pf = { type: sql.VarChar(20), value: String(q.platform).toLowerCase().slice(0, 20) }; }
    if (q.q) { where.push('(ls.display_name LIKE @q OR ls.device_name LIKE @q OR ls.ip_address LIKE @q)'); params.q = { type: sql.NVarChar(120), value: `%${String(q.q).slice(0, 100)}%` }; }
    if (q.from && !isNaN(Date.parse(q.from))) { where.push('ls.login_at >= @from'); params.from = { type: sql.DateTime2, value: new Date(q.from) }; }
    if (q.to && !isNaN(Date.parse(q.to))) { where.push('ls.login_at <= @to'); params.to = { type: sql.DateTime2, value: new Date(q.to) }; }
    const W = where.join(' AND ');
    const total = (await queryOne(`SELECT COUNT(*) AS n FROM login_sessions ls WHERE ${W}`, params)).n;
    const rows = await query(`SELECT ${COLS} FROM login_sessions ls WHERE ${W} ORDER BY ls.login_at DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
      { ...params, off: { type: sql.Int, value: (page - 1) * limit }, lim: { type: sql.Int, value: limit } });
    return res.json({ success: true, message: 'Success', data: rows.recordset, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

// ── admin: numbers for the top of the screen ──
exports.summary = async (req, res, next) => {
  try {
    await sessions.ensureTables();
    const p = { s: UID(req.user.schoolId) };
    const r = await queryOne(
      `SELECT
         (SELECT COUNT(*) FROM login_sessions ls WHERE ls.school_id=@s AND ${ACTIVE}) AS active_total,
         (SELECT COUNT(*) FROM login_sessions ls WHERE ls.school_id=@s AND ${ACTIVE} AND ls.principal_type='staff') AS active_staff,
         (SELECT COUNT(*) FROM login_sessions ls WHERE ls.school_id=@s AND ${ACTIVE} AND ls.principal_type='student') AS active_students,
         (SELECT COUNT(*) FROM login_sessions ls WHERE ls.school_id=@s AND ${ACTIVE} AND COALESCE(ls.last_seen_at, ls.login_at) > DATEADD(MINUTE, -5, SYSUTCDATETIME())) AS online_now,
         (SELECT COUNT(*) FROM login_sessions ls WHERE ls.school_id=@s AND ls.login_at > DATEADD(HOUR, -24, SYSUTCDATETIME())) AS logins_24h,
         (SELECT COUNT(*) FROM login_failures f WHERE f.school_id=@s AND f.created_at > DATEADD(HOUR, -24, SYSUTCDATETIME())) AS failed_24h,
         (SELECT COUNT(*) FROM school_members sm JOIN users u ON u.id=sm.user_id WHERE sm.school_id=@s AND sm.deleted_at IS NULL AND sm.is_active=1 AND u.last_login_at IS NULL) AS staff_never_logged_in,
         (SELECT COUNT(*) FROM student_credentials sc WHERE sc.school_id=@s AND sc.deleted_at IS NULL AND sc.is_active=1 AND sc.last_login_at IS NULL) AS students_never_logged_in`, p);
    return success(res, r);
  } catch (err) { next(err); }
};

// ── admin: remote logout (one device) ──
exports.revokeSession = async (req, res, next) => {
  try {
    if (!isGuid(req.params.id)) return badRequest(res, 'Invalid session id');
    const s = await queryOne(`SELECT id, display_name, principal_type, device_name, ended_at FROM login_sessions WHERE id=@id AND school_id=@s`, { id: UID(req.params.id), s: UID(req.user.schoolId) });
    if (!s) return notFound(res, 'Session not found');
    if (!s.ended_at) await sessions.endSession(s.id, 'remote', ctxName(req));
    await logAudit({ schoolId: req.user.schoolId, userId: req.user.userId, userName: req.user.fullName, userRole: req.user.role, actionType: 'SESSION_REVOKED',
      ipAddress: ipOf(req), userAgent: req.headers['user-agent'], details: { sessionId: s.id, person: s.display_name, type: s.principal_type, device: s.device_name } });
    return success(res, null, 'Logged out from that device');
  } catch (err) { next(err); }
};

// ── admin: log a person out of ALL devices (optionally also stop a driver's 24x7 tracking) ──
exports.revokeAll = async (req, res, next) => {
  try {
    const { type, user_id, student_id, stop_tracking } = req.body || {};
    if (type !== 'staff' && type !== 'student') return badRequest(res, 'type must be staff or student');
    const pid = type === 'student' ? student_id : user_id;
    if (!isGuid(pid)) return badRequest(res, 'A valid user_id / student_id is required');
    const owns = type === 'student'
      ? await queryOne(`SELECT 1 AS ok FROM students WHERE id=@id AND school_id=@s`, { id: UID(pid), s: UID(req.user.schoolId) })
      : await queryOne(`SELECT 1 AS ok FROM school_members WHERE user_id=@id AND school_id=@s`, { id: UID(pid), s: UID(req.user.schoolId) });
    if (!owns) return notFound(res, 'Person not found in this school');
    const n = await sessions.revokeAllFor({ type, userId: type === 'staff' ? pid : null, studentId: type === 'student' ? pid : null, reason: 'remote', by: ctxName(req) });
    let trackerStopped = false;
    if (type === 'staff' && stop_tracking) {
      try { await query(`UPDATE transport_tracker_tokens SET revoked_at = SYSUTCDATETIME() WHERE user_id=@u AND school_id=@s AND revoked_at IS NULL`, { u: UID(pid), s: UID(req.user.schoolId) }); trackerStopped = true; } catch { /* no tracker table yet */ }
    }
    await logAudit({ schoolId: req.user.schoolId, userId: req.user.userId, userName: req.user.fullName, userRole: req.user.role, actionType: 'SESSION_REVOKED_ALL',
      ipAddress: ipOf(req), userAgent: req.headers['user-agent'], details: { type, target: pid, sessions: n, trackerStopped } });
    return success(res, { sessions_ended: n, tracker_stopped: trackerStopped }, n ? `Logged out from ${n} device(s)` : 'No active sessions');
  } catch (err) { next(err); }
};

// ── admin: failed login attempts ──
exports.failures = async (req, res, next) => {
  try {
    await sessions.ensureTables();
    const page = Math.max(1, parseInt(req.query.page) || 1); const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const params = { s: UID(req.user.schoolId) }; let W = 'f.school_id = @s';
    if (req.query.type === 'staff' || req.query.type === 'student') { W += ' AND f.principal_type=@t'; params.t = { type: sql.VarChar(10), value: req.query.type }; }
    const total = (await queryOne(`SELECT COUNT(*) AS n FROM login_failures f WHERE ${W}`, params)).n;
    const rows = await query(`SELECT f.id, f.principal_type, f.identifier, f.reason, f.ip_address, f.device_name, f.platform, f.created_at FROM login_failures f WHERE ${W}
      ORDER BY f.created_at DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`, { ...params, off: { type: sql.Int, value: (page - 1) * limit }, lim: { type: sql.Int, value: limit } });
    return res.json({ success: true, message: 'Success', data: rows.recordset, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

// ── admin: accounts that never logged in (app adoption) ──
exports.neverLoggedIn = async (req, res, next) => {
  try {
    const p = { s: UID(req.user.schoolId) };
    if (req.query.type === 'student') {
      const r = await query(`SELECT TOP 300 st.id AS student_id, LTRIM(RTRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, '')))) AS name, st.admission_no, sc.login_phone, sc.created_at
        FROM student_credentials sc JOIN students st ON st.id = sc.student_id AND st.deleted_at IS NULL
        WHERE sc.school_id=@s AND sc.deleted_at IS NULL AND sc.is_active=1 AND sc.last_login_at IS NULL ORDER BY st.first_name`, p);
      return success(res, r.recordset);
    }
    const r = await query(`SELECT TOP 300 u.id AS user_id, u.full_name AS name, u.email, u.phone, sm.role, sm.created_at
      FROM school_members sm JOIN users u ON u.id = sm.user_id
      WHERE sm.school_id=@s AND sm.deleted_at IS NULL AND sm.is_active=1 AND u.last_login_at IS NULL ORDER BY u.full_name`, p);
    return success(res, r.recordset);
  } catch (err) { next(err); }
};

// ── self-service: my devices ──
const mine = (type) => ({
  list: async (req, res, next) => {
    try {
      await sessions.ensureTables();
      const col = type === 'student' ? 'student_id' : 'user_id'; const id = type === 'student' ? req.student.studentId : req.user.userId;
      const r = await query(`SELECT ${COLS} FROM login_sessions ls WHERE ls.${col}=@p AND ${ACTIVE} ORDER BY ls.login_at DESC`, { p: UID(id) });
      return success(res, r.recordset.map((s) => ({ ...s, is_current: !!req.sid && String(s.id).toLowerCase() === String(req.sid).toLowerCase() })));
    } catch (err) { next(err); }
  },
  revoke: async (req, res, next) => {
    try {
      if (!isGuid(req.params.id)) return badRequest(res, 'Invalid session id');
      const col = type === 'student' ? 'student_id' : 'user_id'; const id = type === 'student' ? req.student.studentId : req.user.userId;
      const s = await queryOne(`SELECT id FROM login_sessions WHERE id=@id AND ${col}=@p`, { id: UID(req.params.id), p: UID(id) });
      if (!s) return notFound(res, 'Session not found');
      await sessions.endSession(s.id, 'remote', { userId: type === 'staff' ? id : null, name: type === 'student' ? req.student.fullName : req.user.fullName });
      return success(res, null, 'Logged out from that device');
    } catch (err) { next(err); }
  },
});
exports.mineStaff = mine('staff');
exports.mineStudent = mine('student');
