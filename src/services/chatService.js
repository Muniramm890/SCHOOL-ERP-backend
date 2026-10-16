// src/services/chatService.js
// ══════════════════════════════════════════════════
// ANNOUNCEMENT CHAT CORE
//   - Announcement = broadcast (comm_messages -> comm_recipients, one row per person)
//   - Reply        = PRIVATE thread per recipient (comm_replies keyed by comm_recipients.id)
//       recipient side sees only its own thread;  admin side (school_admin or the sender)
//       sees every thread.  Recipients never see each other's replies or any stats.
// All queries are scoped by school_id (taken from the auth token, never from the client).
// ══════════════════════════════════════════════════
const { query, queryOne, withTransaction, sql } = require('../config/db');

const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

const MAX_REPLY_LEN = 2000;
const isSchoolAdmin = (user) => user && user.role === 'school_admin';

const cleanBody = (raw) => String(raw == null ? '' : raw).replace(/\u0000/g, '').trim();

// ── the logged-in STAFF user's own recipient row for a message (null if not a recipient) ──
async function getMyRecipient(schoolId, userId, messageId) {
  return queryOne(
    `SELECT r.id, r.message_id, r.seen_at
     FROM comm_recipients r
     JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
     WHERE r.school_id=@sid AND r.message_id=@mid AND r.recipient_type='staff' AND r.user_id=@uid
       AND m.deleted_at IS NULL`,
    { sid: U(schoolId), mid: U(messageId), uid: U(userId) }
  );
}

// ── message the caller may MANAGE (see stats + all threads): school_admin or the sender ──
async function getManagedMessage(user, messageId) {
  const m = await queryOne(
    `SELECT m.id, m.school_id, m.title, m.created_by, m.allow_replies, m.replies_close_at
     FROM comm_messages m
     WHERE m.id=@mid AND m.school_id=@sid AND m.deleted_at IS NULL`,
    { mid: U(messageId), sid: U(user.schoolId) }
  );
  if (!m) return null;
  if (isSchoolAdmin(user) || String(m.created_by).toLowerCase() === String(user.userId).toLowerCase()) return m;
  return null;
}

// one thread (= one recipient of a message) with the person's display name; null if not in this school/message
async function getThreadRecipient(schoolId, messageId, recipientId) {
  return queryOne(
    `SELECT r.id, r.recipient_type, r.user_id, r.student_id, r.reply_count, r.personal_body,
            CASE WHEN r.recipient_type='staff' THEN u.full_name ELSE (s.first_name + ' ' + s.last_name) END AS name
     FROM comm_recipients r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN students s ON s.id = r.student_id
     WHERE r.id=@rid AND r.message_id=@mid AND r.school_id=@sid`,
    { rid: U(recipientId), mid: U(messageId), sid: U(schoolId) }
  );
}

const canReplyNow = (msg) =>
  !!msg.allow_replies && (!msg.replies_close_at || new Date(msg.replies_close_at) > new Date());

// ── one notification "ping" per (person, message): re-use the unread one instead of spamming ──
async function upsertPing({ schoolId, table, idCol, idVal, type, title, message, relatedId }) {
  const ex = await queryOne(
    `SELECT TOP 1 id FROM ${table}
     WHERE school_id=@sid AND ${idCol}=@uid AND type=@type AND related_id=@rid AND is_read=0`,
    { sid: U(schoolId), uid: U(idVal), type: { type: sql.VarChar(40), value: type }, rid: U(relatedId) }
  );
  const params = {
    sid: U(schoolId), uid: U(idVal), type: { type: sql.VarChar(40), value: type },
    title: { type: sql.NVarChar(200), value: String(title).slice(0, 200) },
    msg: { type: sql.NVarChar(500), value: message ? String(message).slice(0, 500) : null },
    rid: U(relatedId),
  };
  if (ex) {
    await query(
      `UPDATE ${table} SET title=@title, message=@msg, created_at=SYSUTCDATETIME() WHERE id=@id`,
      { ...params, id: U(ex.id) }
    );
  } else {
    await query(
      `INSERT INTO ${table} (school_id, ${idCol}, type, title, message, related_id)
       VALUES (@sid, @uid, @type, @title, @msg, @rid)`,
      params
    );
  }
}

// recipient replied  ->  notify the sender + every school_admin (except the replier)
async function pingAdminSide({ schoolId, messageId, createdBy, excludeUserId, title, preview }) {
  const admins = await query(
    `SELECT DISTINCT sm.user_id FROM school_members sm
     WHERE sm.school_id=@sid AND sm.role='school_admin' AND sm.is_active=1 AND sm.deleted_at IS NULL`,
    { sid: U(schoolId) }
  );
  const ids = new Set(admins.recordset.map((r) => String(r.user_id).toLowerCase()));
  if (createdBy) ids.add(String(createdBy).toLowerCase());
  if (excludeUserId) ids.delete(String(excludeUserId).toLowerCase());
  for (const uid of ids) {
    await upsertPing({
      schoolId, table: 'staff_notifications', idCol: 'user_id', idVal: uid,
      type: 'comm_reply', title: `New reply: ${title}`, message: preview, relatedId: messageId,
    });
  }
}

// admin replied  ->  notify that one recipient (staff or student)
async function pingRecipient({ schoolId, recipient, messageId, title, preview }) {
  if (recipient.recipient_type === 'student') {
    return upsertPing({
      schoolId, table: 'student_notifications', idCol: 'student_id', idVal: recipient.student_id,
      type: 'comm_reply', title: `Reply: ${title}`, message: preview, relatedId: messageId,
    });
  }
  return upsertPing({
    schoolId, table: 'staff_notifications', idCol: 'user_id', idVal: recipient.user_id,
    type: 'comm_reply', title: `Reply: ${title}`, message: preview, relatedId: messageId,
  });
}

// ── insert one reply + keep the per-thread counters/read-state in sync (single transaction) ──
// side: 'recipient' | 'admin'.  clientMsgId makes a double-tap / retry idempotent.
async function addReply({ schoolId, messageId, recipientId, side, senderUserId, body, clientMsgId }) {
  return withTransaction(async (tx) => {
    if (clientMsgId) {
      const dup = await new sql.Request(tx)
        .input('sid', sql.UniqueIdentifier, schoolId).input('rid', sql.UniqueIdentifier, recipientId)
        .input('side', sql.VarChar(10), side).input('cm', sql.VarChar(40), clientMsgId)
        .query(`SELECT id, seq, sender_side, body, created_at FROM comm_replies
                WHERE school_id=@sid AND recipient_id=@rid AND sender_side=@side AND client_msg_id=@cm`);
      if (dup.recordset[0]) return { ...dup.recordset[0], duplicate: true };
    }

    const ins = await new sql.Request(tx)
      .input('sid', sql.UniqueIdentifier, schoolId).input('mid', sql.UniqueIdentifier, messageId)
      .input('rid', sql.UniqueIdentifier, recipientId).input('side', sql.VarChar(10), side)
      .input('by', sql.UniqueIdentifier, senderUserId || null).input('body', sql.NVarChar(MAX_REPLY_LEN), body)
      .input('cm', sql.VarChar(40), clientMsgId || null)
      .query(`INSERT INTO comm_replies (school_id, message_id, recipient_id, sender_side, sender_user_id, body, client_msg_id)
              OUTPUT INSERTED.id, INSERTED.seq, INSERTED.sender_side, INSERTED.body, INSERTED.created_at
              VALUES (@sid, @mid, @rid, @side, @by, @body, @cm)`);
    const reply = ins.recordset[0];

    const upd = new sql.Request(tx)
      .input('sid', sql.UniqueIdentifier, schoolId).input('rid', sql.UniqueIdentifier, recipientId)
      .input('now', sql.DateTime2, reply.created_at);
    if (side === 'recipient') {
      await upd.query(`UPDATE comm_recipients
                       SET reply_count = reply_count + 1, last_recipient_reply_at=@now,
                           seen_at = COALESCE(seen_at, @now), recipient_last_read_at=@now
                       WHERE id=@rid AND school_id=@sid`);
    } else {
      await upd.query(`UPDATE comm_recipients
                       SET reply_count = reply_count + 1, last_admin_reply_at=@now, admin_last_read_at=@now
                       WHERE id=@rid AND school_id=@sid`);
    }
    return reply;
  });
}

module.exports = {
  MAX_REPLY_LEN, isSchoolAdmin, cleanBody, canReplyNow,
  getMyRecipient, getManagedMessage, getThreadRecipient, addReply, pingAdminSide, pingRecipient, upsertPing,
};
