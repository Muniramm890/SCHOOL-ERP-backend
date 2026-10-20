// src/controllers/studentInboxController.js
// ══════════════════════════════════════════════════
// STUDENT INBOX (chat view of announcements) — same model as the staff inbox:
//   - announcements addressed to ME only
//   - MY private thread with the sender / school admins (unlimited back-and-forth)
//   - never: other recipients, seen/delivery stats, other people's replies
// ══════════════════════════════════════════════════
const { query, queryOne, sql } = require('../config/db');
const { success, created, notFound, badRequest, forbidden } = require('../utils/response');
const chat = require('../services/chatService');

const U = (v) => ({ type: sql.UniqueIdentifier, value: v });
// "📷 Photo" etc. when the last reply is only a file
const LAST_REPLY_PREVIEW = `COALESCE(NULLIF(cr.body, ''), CASE cr.kind WHEN 'image' THEN N'📷 Photo' WHEN 'video' THEN N'🎥 Video' WHEN 'file' THEN N'📄 Document' ELSE cr.body END)`;
const UNREAD_SQL = `(r.seen_at IS NULL OR (r.last_admin_reply_at IS NOT NULL
                     AND (r.recipient_last_read_at IS NULL OR r.last_admin_reply_at > r.recipient_last_read_at)))`;

// GET /api/student/inbox?limit=30&before=<ISO last_activity_at>
exports.list = async (req, res, next) => {
  try {
    const { studentId, schoolId } = req.student;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && isNaN(before.getTime())) return badRequest(res, 'Invalid before');

    const rows = await query(
      `;WITH c AS (
         SELECT m.id AS message_id, m.title, m.category, m.source_module, m.kind, m.allow_replies, m.replies_close_at,
                m.created_at, u.full_name AS created_by_name,
                LEFT(COALESCE(r.personal_body, m.body), 160) AS preview,
                r.id AS recipient_id, r.seen_at, r.reply_count,
                la.body AS last_reply_body, la.sender_side AS last_reply_side,
                CASE WHEN ${UNREAD_SQL} THEN 1 ELSE 0 END AS unread,
                (SELECT MAX(x) FROM (VALUES (m.created_at), (r.last_admin_reply_at), (r.last_recipient_reply_at)) v(x)) AS last_activity_at
         FROM comm_recipients r
         JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
         JOIN users u ON u.id = m.created_by
         OUTER APPLY (SELECT TOP 1 ${LAST_REPLY_PREVIEW} AS body, cr.sender_side FROM comm_replies cr
                      WHERE cr.school_id=r.school_id AND cr.recipient_id=r.id AND cr.deleted_at IS NULL
                      ORDER BY cr.seq DESC) la
         WHERE r.school_id=@sid AND r.recipient_type='student' AND r.student_id=@stid AND m.deleted_at IS NULL
       )
       SELECT TOP (@limit) * FROM c
       WHERE (@before IS NULL OR last_activity_at < @before)
       ORDER BY last_activity_at DESC`,
      { sid: U(schoolId), stid: U(studentId), limit: { type: sql.Int, value: limit }, before: { type: sql.DateTime2, value: before } }
    );
    chat.markDeliveredForRecipient({ schoolId, studentId }).catch(() => {}); // app is awake -> ✓✓
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

// GET /api/student/inbox/unread-count
exports.unreadCount = async (req, res, next) => {
  try {
    const { studentId, schoolId } = req.student;
    chat.markDeliveredForRecipient({ schoolId, studentId }).catch(() => {});
    const r = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM comm_recipients r
       JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
       WHERE r.school_id=@sid AND r.recipient_type='student' AND r.student_id=@stid AND m.deleted_at IS NULL AND ${UNREAD_SQL}`,
      { sid: U(schoolId), stid: U(studentId) }
    );
    return success(res, { count: r?.cnt || 0 });
  } catch (err) { next(err); }
};

async function markOpened(schoolId, studentId, recipientId, messageId) {
  await query(
    `UPDATE comm_recipients SET seen_at = COALESCE(seen_at, SYSUTCDATETIME()), recipient_last_read_at = SYSUTCDATETIME()
     WHERE id=@rid AND school_id=@sid`,
    { rid: U(recipientId), sid: U(schoolId) }
  );
  // keep the old notification list / dashboard badge (student_notifications) in sync
  await query(
    `UPDATE student_notifications SET is_read=1 WHERE school_id=@sid AND student_id=@stid AND related_id=@mid AND is_read=0`,
    { sid: U(schoolId), stid: U(studentId), mid: U(messageId) }
  );
}

// GET /api/student/inbox/:messageId  -> announcement + my thread (marks it read, like a chat app)
exports.getConversation = async (req, res, next) => {
  try {
    const { studentId, schoolId } = req.student;
    const { messageId } = req.params;
    const rcp = await chat.getMyStudentRecipient(schoolId, studentId, messageId);
    if (!rcp) return notFound(res, 'Conversation not found');

    const msg = await queryOne(
      `SELECT m.id AS message_id, m.title, m.category, m.source_module, m.kind, m.allow_replies, m.replies_close_at,
              m.created_at, u.full_name AS created_by_name, COALESCE(r.personal_body, m.body) AS body
       FROM comm_recipients r
       JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
       JOIN users u ON u.id = m.created_by
       WHERE r.id=@rid AND r.school_id=@sid`,
      { rid: U(rcp.id), sid: U(schoolId) }
    );
    const attachments = await query(
      `SELECT id, file_name, file_url, file_type, file_size_bytes FROM comm_message_attachments
       WHERE message_id=@mid AND school_id=@sid`,
      { mid: U(messageId), sid: U(schoolId) }
    );
    const replies = await chat.selectReplies({ schoolId, recipientId: rcp.id });

    await markOpened(schoolId, studentId, rcp.id, messageId);
    await chat.markRead({ schoolId, recipientId: rcp.id, senderSide: 'admin' });

    return success(res, {
      ...msg,
      can_reply: chat.canReplyNow(msg),
      attachments: attachments.recordset,
      replies,
      receipts: await chat.receiptsFor({ schoolId, recipientId: rcp.id, mySide: 'recipient' }),
      last_seq: replies.length ? replies[replies.length - 1].seq : 0,
    });
  } catch (err) { next(err); }
};

// GET /api/student/inbox/:messageId/replies?since_seq=N  -> light polling while the chat is open
exports.pollReplies = async (req, res, next) => {
  try {
    const { studentId, schoolId } = req.student;
    const { messageId } = req.params;
    const since = parseInt(req.query.since_seq, 10) || 0;
    const rcp = await chat.getMyStudentRecipient(schoolId, studentId, messageId);
    if (!rcp) return notFound(res, 'Conversation not found');

    const replies = await chat.selectReplies({ schoolId, recipientId: rcp.id, sinceSeq: since });
    if (replies.some((r) => r.sender_side === 'admin')) await markOpened(schoolId, studentId, rcp.id, messageId);
    await chat.markRead({ schoolId, recipientId: rcp.id, senderSide: 'admin' });
    return success(res, { replies, receipts: await chat.receiptsFor({ schoolId, recipientId: rcp.id, mySide: 'recipient' }) });
  } catch (err) { next(err); }
};

// POST /api/student/inbox/:messageId/reply   { body, client_msg_id }
exports.reply = async (req, res, next) => {
  try {
    const { studentId, schoolId } = req.student;
    const { messageId } = req.params;
    const body = chat.cleanBody(req.body?.body);
    if (!body && !req.file) return badRequest(res, 'Reply cannot be empty');
    if (body.length > chat.MAX_REPLY_LEN) return badRequest(res, `Reply is too long (max ${chat.MAX_REPLY_LEN} characters)`);
    const clientMsgId = req.body?.client_msg_id ? String(req.body.client_msg_id).slice(0, 40) : null;

    const rcp = await chat.getMyStudentRecipient(schoolId, studentId, messageId);
    if (!rcp) return notFound(res, 'Conversation not found');

    const msg = await queryOne(
      `SELECT id, title, created_by, allow_replies, replies_close_at FROM comm_messages WHERE id=@mid AND school_id=@sid`,
      { mid: U(messageId), sid: U(schoolId) }
    );
    if (!chat.canReplyNow(msg)) return forbidden(res, 'Replies are not allowed (or have been closed) for this message');

    // students are not rows in `users` -> sender_user_id stays NULL (allowed for the recipient side)
    const media = await chat.prepareMedia(req, { schoolId, recipientId: rcp.id, isStudent: true });
    const reply = await chat.addReply({
      schoolId, messageId, recipientId: rcp.id, side: 'recipient', senderUserId: null, body, clientMsgId, media,
    });
    if (!reply.duplicate) {
      await chat.pingAdminSide({ schoolId, messageId, recipientId: rcp.id, createdBy: msg.created_by, excludeUserId: null,
        title: msg.title, preview: chat.previewOf(reply.kind, body) });
    }
    return created(res, reply, 'Reply sent');
  } catch (err) { next(err); }
};
