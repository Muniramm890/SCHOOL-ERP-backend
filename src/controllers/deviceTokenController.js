// src/controllers/deviceTokenController.js — FCM token register/unregister for staff (users) and students.
const { query, sql } = require('../config/db');
const { success, badRequest } = require('../utils/response');

const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

const make = (getOwner, defaultApp) => ({
  // POST  { fcm_token, platform?, device_id? }
  register: async (req, res, next) => {
    try {
      const { schoolId, userId, studentId } = getOwner(req);
      const token = String(req.body?.fcm_token || '').trim();
      if (!token || token.length > 500) return badRequest(res, 'fcm_token is required');
      const platform = String(req.body?.platform || 'android').slice(0, 20);
      const deviceId = req.body?.device_id ? String(req.body.device_id).slice(0, 100) : null;
      const params = {
        sid: U(schoolId), uid: U(userId || null), stid: U(studentId || null),
        t: { type: sql.NVarChar(500), value: token }, plat: { type: sql.VarChar(20), value: platform },
        dev: { type: sql.VarChar(100), value: deviceId }, app: { type: sql.VarChar(20), value: defaultApp },
      };
      // one FCM token = one row: if the phone logs in as someone else, the row simply changes owner
      const upd = await query(
        `UPDATE device_tokens SET school_id=@sid, user_id=@uid, student_id=@stid, app=@app, platform=@plat, device_id=@dev,
                is_active=1, last_used_at=SYSUTCDATETIME() WHERE fcm_token=@t`, params);
      if (!upd.rowsAffected || !upd.rowsAffected[0]) {
        await query(
          `INSERT INTO device_tokens (school_id, user_id, student_id, app, fcm_token, platform, device_id)
           VALUES (@sid, @uid, @stid, @app, @t, @plat, @dev)`, params);
      }
      return success(res, { registered: true });
    } catch (err) { next(err); }
  },
  // DELETE { fcm_token }   (logout)
  unregister: async (req, res, next) => {
    try {
      const { schoolId, userId, studentId } = getOwner(req);
      const token = String(req.body?.fcm_token || req.query?.fcm_token || '').trim();
      if (!token) return badRequest(res, 'fcm_token is required');
      await query(
        `UPDATE device_tokens SET is_active=0 WHERE fcm_token=@t AND school_id=@sid AND (user_id=@uid OR student_id=@stid)`,
        { t: { type: sql.NVarChar(500), value: token }, sid: U(schoolId), uid: U(userId || null), stid: U(studentId || null) }
      );
      return success(res, { unregistered: true });
    } catch (err) { next(err); }
  },
});

exports.staff = make((req) => ({ schoolId: req.user.schoolId, userId: req.user.userId }), 'admin');
exports.student = make((req) => ({ schoolId: req.student.schoolId, studentId: req.student.studentId }), 'student');
