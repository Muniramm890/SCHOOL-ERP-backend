// src/controllers/inboxController.js
// ══════════════════════════════════════════════════
// STAFF INBOX (chat view of announcements) — what a RECIPIENT is allowed to see:
//   - announcements addressed to ME only
//   - MY private thread with the admin side
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

// Admin-side unread: the person replied after the admin side last opened the thread
const ADMIN_UNREAD_SQL = `(r.last_recipient_reply_at IS NOT NULL AND (r.admin_last_read_at IS NULL OR r.last_recipient_reply_at > r.admin_last_read_at))`;
// Threads I handle as the SENDER side: school_admin -> every thread in the school, others -> threads of announcements they sent.
// (my own recipient row is excluded: that one is a normal "announcement to me" conversation.)
const THREAD_SCOPE_SQL = `r.school_id=@sid AND r.reply_count > 0 AND m.deleted_at IS NULL
                          AND (@isAdmin = 1 OR m.created_by = @uid)
                          AND NOT (r.recipient_type='staff' AND r.user_id = @uid)`;

// GET /api/inbox?limit=30&before=<ISO last_activity_at>
exports.list = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
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
         WHERE r.school_id=@sid AND r.recipient_type='staff' AND r.user_id=@uid AND m.deleted_at IS NULL
       )
       SELECT TOP (@limit) * FROM c
       WHERE (@before IS NULL OR last_activity_at < @before)
       ORDER BY last_activity_at DESC`,
      { sid: U(schoolId), uid: U(userId), limit: { type: sql.Int, value: limit }, before: { type: sql.DateTime2, value: before } }
    );

    // private threads on announcements I sent (admin side) — shown as personal chats
    const th = await query(
      `;WITH c AS (
         SELECT m.id AS message_id, r.id AS recipient_id, m.title, m.category, m.source_module, m.kind, m.created_at,
                CASE WHEN r.recipient_type='staff' THEN su.full_name ELSE LTRIM(RTRIM(CONCAT(st.first_name, ' ', st.last_name))) END AS person_name,
                r.recipient_type, r.reply_count,
                la.body AS last_reply_body, la.sender_side AS last_reply_side,
                CASE WHEN ${ADMIN_UNREAD_SQL} THEN 1 ELSE 0 END AS unread,
                (SELECT MAX(x) FROM (VALUES (r.last_recipient_reply_at), (r.last_admin_reply_at)) v(x)) AS last_activity_at
         FROM comm_recipients r
         JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
         LEFT JOIN users su ON su.id = r.user_id
         LEFT JOIN students st ON st.id = r.student_id
         OUTER APPLY (SELECT TOP 1 ${LAST_REPLY_PREVIEW} AS body, cr.sender_side FROM comm_replies cr
                      WHERE cr.school_id=r.school_id AND cr.recipient_id=r.id AND cr.deleted_at IS NULL
                      ORDER BY cr.seq DESC) la
         WHERE ${THREAD_SCOPE_SQL}
       )
       SELECT TOP (@limit) * FROM c
       WHERE (@before IS NULL OR last_activity_at < @before)
       ORDER BY last_activity_at DESC`,
      { sid: U(schoolId), uid: U(userId), isAdmin: { type: sql.Bit, value: chat.isSchoolAdmin(req.user) ? 1 : 0 },
        limit: { type: sql.Int, value: limit }, before: { type: sql.DateTime2, value: before } }
    );

    // this app is awake and just received the list -> mark messages delivered (✓✓)
    const asRecipient = { schoolId, userId };
    chat.markDeliveredForRecipient(asRecipient).catch(() => {});
    chat.markDeliveredForSender({ schoolId, userId, isAdmin: chat.isSchoolAdmin(req.user) }).catch(() => {});

    const items = [
      ...rows.recordset.map((r) => ({ ...r, type: 'announcement' })),
      ...th.recordset.map((r) => ({ ...r, type: 'thread' })),
    ].sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at)).slice(0, limit);
    return success(res, items);
  } catch (err) { next(err); }
};

// GET /api/inbox/unread-count   -> unread conversations (new announcement OR new admin reply)
exports.unreadCount = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
    const r = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM comm_recipients r
       JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
       WHERE r.school_id=@sid AND r.recipient_type='staff' AND r.user_id=@uid AND m.deleted_at IS NULL AND ${UNREAD_SQL}`,
      { sid: U(schoolId), uid: U(userId) }
    );
    chat.markDeliveredForRecipient({ schoolId, userId }).catch(() => {});
    chat.markDeliveredForSender({ schoolId, userId, isAdmin: chat.isSchoolAdmin(req.user) }).catch(() => {});
    const t = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM comm_recipients r
       JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
       WHERE ${THREAD_SCOPE_SQL} AND ${ADMIN_UNREAD_SQL}`,
      { sid: U(schoolId), uid: U(userId), isAdmin: { type: sql.Bit, value: chat.isSchoolAdmin(req.user) ? 1 : 0 } }
    );
    return success(res, { count: (r?.cnt || 0) + (t?.cnt || 0) });
  } catch (err) { next(err); }
};

async function markOpened(schoolId, userId, recipientId, messageId) {
  await query(
    `UPDATE comm_recipients SET seen_at = COALESCE(seen_at, SYSUTCDATETIME()), recipient_last_read_at = SYSUTCDATETIME()
     WHERE id=@rid AND school_id=@sid`,
    { rid: U(recipientId), sid: U(schoolId) }
  );
  // keep the old bell badge (staff_notifications) in sync
  await query(
    `UPDATE staff_notifications SET is_read=1 WHERE school_id=@sid AND user_id=@uid AND related_id=@mid AND is_read=0`,
    { sid: U(schoolId), uid: U(userId), mid: U(messageId) }
  );
}

// GET /api/inbox/:messageId  -> announcement + my thread (marks it read, like a chat app)
exports.getConversation = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
    const { messageId } = req.params;
    const rcp = await chat.getMyRecipient(schoolId, userId, messageId);
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
    await markOpened(schoolId, userId, rcp.id, messageId);
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

// GET /api/inbox/:messageId/replies?since_seq=N  -> light polling while the chat is open (+ ticks of my sent messages)
exports.pollReplies = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
    const { messageId } = req.params;
    const since = parseInt(req.query.since_seq, 10) || 0;
    const rcp = await chat.getMyRecipient(schoolId, userId, messageId);
    if (!rcp) return notFound(res, 'Conversation not found');

    const replies = await chat.selectReplies({ schoolId, recipientId: rcp.id, sinceSeq: since });
    if (replies.some((r) => r.sender_side === 'admin')) {
      await markOpened(schoolId, userId, rcp.id, messageId);
    }
    await chat.markRead({ schoolId, recipientId: rcp.id, senderSide: 'admin' });
    return success(res, { replies, receipts: await chat.receiptsFor({ schoolId, recipientId: rcp.id, mySide: 'recipient' }) });
  } catch (err) { next(err); }
};

// POST /api/inbox/:messageId/reply   { body, client_msg_id }   or multipart: file + body(caption) + width/height/duration
exports.reply = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.user;
    const { messageId } = req.params;
    const body = chat.cleanBody(req.body?.body);
    if (!body && !req.file) return badRequest(res, 'Reply cannot be empty');
    if (body.length > chat.MAX_REPLY_LEN) return badRequest(res, `Reply is too long (max ${chat.MAX_REPLY_LEN} characters)`);
    const clientMsgId = req.body?.client_msg_id ? String(req.body.client_msg_id).slice(0, 40) : null;

    const rcp = await chat.getMyRecipient(schoolId, userId, messageId);
    if (!rcp) return notFound(res, 'Conversation not found');

    const msg = await queryOne(
      `SELECT id, title, created_by, allow_replies, replies_close_at FROM comm_messages WHERE id=@mid AND school_id=@sid`,
      { mid: U(messageId), sid: U(schoolId) }
    );
    if (!chat.canReplyNow(msg)) return forbidden(res, 'Replies are not allowed (or have been closed) for this announcement');

    const media = await chat.prepareMedia(req, { schoolId, recipientId: rcp.id, isStudent: false });
    const reply = await chat.addReply({
      schoolId, messageId, recipientId: rcp.id, side: 'recipient', senderUserId: userId, body, clientMsgId, media,
    });
    if (!reply.duplicate) {
      await chat.pingAdminSide({ schoolId, messageId, recipientId: rcp.id, createdBy: msg.created_by, excludeUserId: userId,
        title: msg.title, preview: chat.previewOf(reply.kind, body) });
    }
    return created(res, reply, 'Reply sent');
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════════════════════
// SENDER SIDE of a private thread:  one announcement <-> one person.
// school_admin or the sender only. Unlimited back-and-forth (until replies_close_at for the recipient).
// ══════════════════════════════════════════════════════════════════
async function loadSenderThread(req) {
  const { schoolId } = req.user;
  const { messageId, recipientId } = req.params;
  const msg = await chat.getManagedMessage(req.user, messageId);
  if (!msg) return null;
  const rcp = await chat.getThreadRecipient(schoolId, messageId, recipientId);
  if (!rcp) return null;
  if (rcp.recipient_type === 'staff' && String(rcp.user_id).toLowerCase() === String(req.user.userId).toLowerCase()) return null; // my own row
  return { msg, rcp };
}

// GET /api/inbox/thread/:messageId/:recipientId
exports.getSenderThread = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const t = await loadSenderThread(req);
    if (!t) return notFound(res, 'Conversation not found');
    const { messageId, recipientId } = req.params;

    const full = await queryOne(
      `SELECT m.id AS message_id, m.title, m.category, m.source_module, m.kind, m.allow_replies, m.replies_close_at, m.created_at,
              u.full_name AS created_by_name, COALESCE(r.personal_body, m.body) AS body
       FROM comm_recipients r
       JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
       JOIN users u ON u.id = m.created_by
       WHERE r.id=@rid AND r.school_id=@sid`,
      { rid: U(recipientId), sid: U(schoolId) }
    );
    const attachments = await query(
      `SELECT id, file_name, file_url, file_type, file_size_bytes FROM comm_message_attachments WHERE message_id=@mid AND school_id=@sid`,
      { mid: U(messageId), sid: U(schoolId) }
    );
    const replies = await chat.selectReplies({ schoolId, recipientId, nameAll: true });
    await query(`UPDATE comm_recipients SET admin_last_read_at = SYSUTCDATETIME() WHERE id=@rid AND school_id=@sid`,
      { rid: U(recipientId), sid: U(schoolId) });
    await chat.markRead({ schoolId, recipientId, senderSide: 'recipient' });

    return success(res, {
      ...full,
      person: { recipient_id: recipientId, name: t.rcp.name, recipient_type: t.rcp.recipient_type },
      can_reply: true, // sender side can always answer an existing thread
      attachments: attachments.recordset,
      replies,
      receipts: await chat.receiptsFor({ schoolId, recipientId, mySide: 'admin' }),
      last_seq: replies.length ? replies[replies.length - 1].seq : 0,
    });
  } catch (err) { next(err); }
};

// GET /api/inbox/thread/:messageId/:recipientId/replies?since_seq=N
exports.pollSenderThread = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const t = await loadSenderThread(req);
    if (!t) return notFound(res, 'Conversation not found');
    const since = parseInt(req.query.since_seq, 10) || 0;
    const { recipientId } = req.params;
    const replies = await chat.selectReplies({ schoolId, recipientId, sinceSeq: since, nameAll: true });
    if (replies.length) {
      await query(`UPDATE comm_recipients SET admin_last_read_at = SYSUTCDATETIME() WHERE id=@rid AND school_id=@sid`,
        { rid: U(recipientId), sid: U(schoolId) });
    }
    await chat.markRead({ schoolId, recipientId, senderSide: 'recipient' });
    return success(res, { replies, receipts: await chat.receiptsFor({ schoolId, recipientId, mySide: 'admin' }) });
  } catch (err) { next(err); }
};

// POST /api/inbox/thread/:messageId/:recipientId/reply   { body, client_msg_id }
exports.replySenderThread = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const body = chat.cleanBody(req.body?.body);
    if (!body && !req.file) return badRequest(res, 'Reply cannot be empty');
    if (body.length > chat.MAX_REPLY_LEN) return badRequest(res, `Reply is too long (max ${chat.MAX_REPLY_LEN} characters)`);
    const clientMsgId = req.body?.client_msg_id ? String(req.body.client_msg_id).slice(0, 40) : null;

    const t = await loadSenderThread(req);
    if (!t) return notFound(res, 'Conversation not found');
    const { messageId, recipientId } = req.params;
    if (!t.msg.allow_replies && !t.rcp.reply_count) return forbidden(res, 'Replies are not enabled for this announcement');

    const media = await chat.prepareMedia(req, { schoolId, recipientId, isStudent: false });
    const reply = await chat.addReply({ schoolId, messageId, recipientId, side: 'admin', senderUserId: userId, body, clientMsgId, media });
    if (!reply.duplicate) await chat.pingRecipient({ schoolId, recipient: t.rcp, messageId, title: t.msg.title, preview: chat.previewOf(reply.kind, body) });
    return created(res, reply, 'Reply sent');
  } catch (err) { next(err); }
};
