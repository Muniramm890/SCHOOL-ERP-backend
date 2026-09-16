//src/controllers/notificationsController.js
const { query, sql } = require('../config/db');
const { success } = require('../utils/response');

// GET /api/notifications
exports.list = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
    const rows = await query(
      `SELECT TOP 30 id, type, title, message, related_id, is_read, created_at
       FROM staff_notifications
       WHERE school_id=@sid AND user_id=@uid
       ORDER BY created_at DESC`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, uid: { type: sql.UniqueIdentifier, value: userId } }
    );
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

// GET /api/notifications/unread-count
exports.unreadCount = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
    const r = await query(
      `SELECT COUNT(*) AS cnt FROM staff_notifications WHERE school_id=@sid AND user_id=@uid AND is_read=0`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, uid: { type: sql.UniqueIdentifier, value: userId } }
    );
    return success(res, { count: r.recordset[0].cnt });
  } catch (err) { next(err); }
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res, next) => {
  try {
    const { userId } = req.user;
    await query(
      `UPDATE staff_notifications SET is_read=1 WHERE id=@id AND user_id=@uid`,
      { id: { type: sql.UniqueIdentifier, value: req.params.id }, uid: { type: sql.UniqueIdentifier, value: userId } }
    );
    return success(res, null, 'Marked read');
  } catch (err) { next(err); }
};

// PATCH /api/notifications/read-all
exports.markAllRead = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
    await query(
      `UPDATE staff_notifications SET is_read=1 WHERE school_id=@sid AND user_id=@uid AND is_read=0`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, uid: { type: sql.UniqueIdentifier, value: userId } }
    );
    return success(res, null, 'All marked read');
  } catch (err) { next(err); }
};
