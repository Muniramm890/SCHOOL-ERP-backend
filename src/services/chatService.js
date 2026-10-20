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
const { uploadChatMedia, getSignedDownloadUrl } = require('./uploadService');
const push = require('./pushService');

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

// ── the logged-in STUDENT's own recipient row for a message (null if not a recipient) ──
async function getMyStudentRecipient(schoolId, studentId, messageId) {
  return queryOne(
    `SELECT r.id, r.message_id, r.seen_at
     FROM comm_recipients r
     JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
     WHERE r.school_id=@sid AND r.message_id=@mid AND r.recipient_type='student' AND r.student_id=@stid
       AND m.deleted_at IS NULL`,
    { sid: U(schoolId), mid: U(messageId), stid: U(studentId) }
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
            CASE WHEN r.recipient_type='staff' THEN u.full_name ELSE LTRIM(RTRIM(CONCAT(s.first_name, ' ', s.last_name))) END AS name
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

// preview text for notifications / lists ("📷 Photo" when the reply is only media)
const previewOf = (kind, body) => {
  const t = String(body || '').trim();
  if (t) return t;
  if (kind === 'image') return '📷 Photo';
  if (kind === 'video') return '🎥 Video';
  if (kind === 'file') return '📄 Document';
  return '';
};

// recipient replied  ->  notify the sender + every school_admin (except the replier)
async function pingAdminSide({ schoolId, messageId, recipientId, createdBy, excludeUserId, title, preview }) {
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
  // phone push (fire-and-forget)
  push.send({ schoolId, userIds: [...ids], title: `New reply: ${title}`, body: preview,
    data: { type: 'chat', side: 'sender', messageId, recipientId } }).catch(() => {});
}

// admin replied  ->  notify that one recipient (staff or student)
async function pingRecipient({ schoolId, recipient, messageId, title, preview }) {
  if (recipient.recipient_type === 'student') {
    await upsertPing({
      schoolId, table: 'student_notifications', idCol: 'student_id', idVal: recipient.student_id,
      type: 'comm_reply', title: `Reply: ${title}`, message: preview, relatedId: messageId,
    });
    push.send({ schoolId, studentIds: [recipient.student_id], title: `Reply: ${title}`, body: preview,
      data: { type: 'chat', side: 'recipient', messageId } }).catch(() => {});
    return;
  }
  await upsertPing({
    schoolId, table: 'staff_notifications', idCol: 'user_id', idVal: recipient.user_id,
    type: 'comm_reply', title: `Reply: ${title}`, message: preview, relatedId: messageId,
  });
  push.send({ schoolId, userIds: [recipient.user_id], title: `Reply: ${title}`, body: preview,
    data: { type: 'chat', side: 'recipient', messageId } }).catch(() => {});
}

// ── DB feature detection: lets the new code deploy BEFORE the migration is run without breaking chat ──
let _feat = { ticks: false, media: false, at: 0 };
async function features() {
  if (_feat.ticks && _feat.media) return _feat;
  if (_feat.at && Date.now() - _feat.at < 30000) return _feat;
  try {
    const r = await query(
      `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.comm_replies') AND name IN ('delivered_at','read_at','media_blob')`
    );
    const n = new Set(r.recordset.map((x) => x.name));
    _feat = { ticks: n.has('delivered_at') && n.has('read_at'), media: n.has('media_blob'), at: Date.now() };
  } catch (e) { _feat = { ..._feat, at: Date.now() }; }
  return _feat;
}

const replyColumns = (f, a = 'cr') =>
  `${a}.seq, ${a}.id, ${a}.sender_side, ${a}.kind, ${a}.body, ${a}.created_at` +
  (f.ticks ? `, ${a}.delivered_at, ${a}.read_at` : `, CAST(NULL AS DATETIME2) AS delivered_at, CAST(NULL AS DATETIME2) AS read_at`) +
  (f.media
    ? `, ${a}.media_name, ${a}.media_blob, ${a}.media_mime, ${a}.media_size, ${a}.media_w, ${a}.media_h, ${a}.media_duration`
    : `, CAST(NULL AS NVARCHAR(255)) AS media_name, CAST(NULL AS NVARCHAR(500)) AS media_blob, CAST(NULL AS VARCHAR(100)) AS media_mime,
       CAST(NULL AS BIGINT) AS media_size, CAST(NULL AS INT) AS media_w, CAST(NULL AS INT) AS media_h, CAST(NULL AS INT) AS media_duration`);

// signed (short-lived) URL instead of the raw blob path
function shapeReply(r) {
  const o = { ...r };
  if (o.media_blob) o.media_url = getSignedDownloadUrl(o.media_blob, 120, 'chatMedia');
  delete o.media_blob;
  return o;
}

// replies of ONE thread (seq > sinceSeq). nameAll: also resolve names of recipient-side senders (admin view)
async function selectReplies({ schoolId, recipientId, sinceSeq = 0, nameAll = false }) {
  const f = await features();
  const rows = await query(
    `SELECT ${replyColumns(f)},
            ${nameAll ? 'su.full_name' : "CASE WHEN cr.sender_side='admin' THEN su.full_name ELSE NULL END"} AS sender_name
     FROM comm_replies cr LEFT JOIN users su ON su.id = cr.sender_user_id
     WHERE cr.school_id=@sid AND cr.recipient_id=@rid AND cr.deleted_at IS NULL AND cr.seq > @since
     ORDER BY cr.seq`,
    { sid: U(schoolId), rid: U(recipientId), since: { type: sql.BigInt, value: sinceSeq } }
  );
  return rows.recordset.map(shapeReply);
}

// ticks state of MY latest sent messages (polling returns this so old bubbles' ticks update)
async function receiptsFor({ schoolId, recipientId, mySide }) {
  const f = await features();
  if (!f.ticks) return [];
  const r = await query(
    `SELECT TOP 30 id, delivered_at, read_at FROM comm_replies
     WHERE school_id=@sid AND recipient_id=@rid AND sender_side=@side AND deleted_at IS NULL ORDER BY seq DESC`,
    { sid: U(schoolId), rid: U(recipientId), side: { type: sql.VarChar(10), value: mySide } }
  );
  return r.recordset;
}

// the viewer opened the chat -> the OTHER side's messages become delivered + read
async function markRead({ schoolId, recipientId, senderSide }) {
  const f = await features();
  if (!f.ticks) return;
  await query(
    `UPDATE comm_replies SET read_at = COALESCE(read_at, SYSUTCDATETIME()), delivered_at = COALESCE(delivered_at, SYSUTCDATETIME())
     WHERE school_id=@sid AND recipient_id=@rid AND sender_side=@side AND read_at IS NULL AND deleted_at IS NULL`,
    { sid: U(schoolId), rid: U(recipientId), side: { type: sql.VarChar(10), value: senderSide } }
  );
}

// the app fetched its inbox/badge -> admin messages sent TO ME are "delivered" (✓✓ grey)
async function markDeliveredForRecipient({ schoolId, userId, studentId }) {
  const f = await features();
  if (!f.ticks) return;
  await query(
    `UPDATE cr SET cr.delivered_at = SYSUTCDATETIME()
     FROM comm_replies cr
     JOIN comm_recipients r ON r.id = cr.recipient_id AND r.school_id = cr.school_id
     WHERE r.school_id=@sid AND cr.sender_side='admin' AND cr.delivered_at IS NULL AND cr.deleted_at IS NULL
       AND ((@uid IS NOT NULL AND r.recipient_type='staff' AND r.user_id=@uid)
         OR (@stid IS NOT NULL AND r.recipient_type='student' AND r.student_id=@stid))`,
    { sid: U(schoolId), uid: U(userId || null), stid: U(studentId || null) }
  );
}

// the sender-side app fetched its inbox -> recipients' replies on MY announcements are "delivered"
async function markDeliveredForSender({ schoolId, userId, isAdmin }) {
  const f = await features();
  if (!f.ticks) return;
  await query(
    `UPDATE cr SET cr.delivered_at = SYSUTCDATETIME()
     FROM comm_replies cr
     JOIN comm_recipients r ON r.id = cr.recipient_id AND r.school_id = cr.school_id
     JOIN comm_messages m ON m.id = r.message_id AND m.school_id = r.school_id
     WHERE r.school_id=@sid AND cr.sender_side='recipient' AND cr.delivered_at IS NULL AND cr.deleted_at IS NULL
       AND (@isAdmin = 1 OR m.created_by = @uid)
       AND NOT (r.recipient_type='staff' AND r.user_id = @uid)`,
    { sid: U(schoolId), uid: U(userId), isAdmin: { type: sql.Bit, value: isAdmin ? 1 : 0 } }
  );
}

// ── media validation (photo / video / document) ──
const MEDIA_TYPES = {
  '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.png': ['image', 'image/png'], '.webp': ['image', 'image/webp'],
  '.mp4': ['video', 'video/mp4'], '.mov': ['video', 'video/quicktime'], '.webm': ['video', 'video/webm'], '.3gp': ['video', 'video/3gpp'],
  '.pdf': ['file', 'application/pdf'], '.doc': ['file', 'application/msword'],
  '.docx': ['file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['file', 'application/vnd.ms-excel'], '.xlsx': ['file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['file', 'application/vnd.ms-powerpoint'], '.pptx': ['file', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.txt': ['file', 'text/plain'],
};
const MB = 1024 * 1024;
const LIMITS = { image: 10 * MB, video: 50 * MB, file: 15 * MB };
const STUDENT_VIDEO_LIMIT = 25 * MB;

// -> { kind, ext, mime }   throws {status:400} when not allowed
function classifyUpload(file, { isStudent = false } = {}) {
  const bad = (m) => { const e = new Error(m); e.status = 400; return e; };
  const ext = '.' + String(file.originalname || '').split('.').pop().toLowerCase();
  const hit = MEDIA_TYPES[ext];
  if (!hit) throw bad(`This file type is not allowed (${ext})`);
  const [kind, mime] = hit;
  const cap = kind === 'video' && isStudent ? STUDENT_VIDEO_LIMIT : LIMITS[kind];
  if (file.size > cap) throw bad(`${kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'File'} is too large (max ${Math.round(cap / MB)} MB)`);
  return { kind, ext, mime };
}

// parse + upload the optional file of a reply request. -> media object for addReply, or null
async function prepareMedia(req, { schoolId, recipientId, isStudent }) {
  if (!req.file) return null;
  const f = await features();
  if (!f.media) { const e = new Error('Sending photos / files is not enabled yet'); e.status = 400; throw e; }
  const { kind, ext, mime } = classifyUpload(req.file, { isStudent });
  const { blobPath } = await uploadChatMedia(req.file.buffer, { schoolId, recipientId, ext, mime });
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  return {
    kind, blobPath, mime, name: String(req.file.originalname).slice(0, 255), size: req.file.size,
    width: num(req.body?.width), height: num(req.body?.height), duration: num(req.body?.duration),
  };
}

// ── insert one reply + keep the per-thread counters/read-state in sync (single transaction) ──
// side: 'recipient' | 'admin'.  clientMsgId makes a double-tap / retry idempotent.
// media (optional): { kind, blobPath, mime, name, size, width, height, duration }  -> body = caption (may be empty)
async function addReply({ schoolId, messageId, recipientId, side, senderUserId, body, clientMsgId, media = null }) {
  const f = await features();
  return withTransaction(async (tx) => {
    if (clientMsgId) {
      const dup = await new sql.Request(tx)
        .input('sid', sql.UniqueIdentifier, schoolId).input('rid', sql.UniqueIdentifier, recipientId)
        .input('side', sql.VarChar(10), side).input('cm', sql.VarChar(40), clientMsgId)
        .query(`SELECT ${replyColumns(f)} FROM comm_replies cr
                WHERE cr.school_id=@sid AND cr.recipient_id=@rid AND cr.sender_side=@side AND cr.client_msg_id=@cm`);
      if (dup.recordset[0]) return { ...shapeReply(dup.recordset[0]), duplicate: true };
    }

    const req = new sql.Request(tx)
      .input('sid', sql.UniqueIdentifier, schoolId).input('mid', sql.UniqueIdentifier, messageId)
      .input('rid', sql.UniqueIdentifier, recipientId).input('side', sql.VarChar(10), side)
      .input('by', sql.UniqueIdentifier, senderUserId || null).input('body', sql.NVarChar(MAX_REPLY_LEN), body || '')
      .input('cm', sql.VarChar(40), clientMsgId || null)
      .input('kind', sql.VarChar(10), media ? media.kind : 'text');
    let cols = 'school_id, message_id, recipient_id, sender_side, sender_user_id, kind, body, client_msg_id';
    let vals = '@sid, @mid, @rid, @side, @by, @kind, @body, @cm';
    if (media) {
      req.input('mn', sql.NVarChar(255), media.name).input('mb', sql.NVarChar(500), media.blobPath)
         .input('mm', sql.VarChar(100), media.mime).input('ms', sql.BigInt, media.size)
         .input('mw', sql.Int, media.width || null).input('mh', sql.Int, media.height || null)
         .input('md', sql.Int, media.duration || null);
      cols += ', media_name, media_blob, media_mime, media_size, media_w, media_h, media_duration';
      vals += ', @mn, @mb, @mm, @ms, @mw, @mh, @md';
    }
    const ins = await req.query(
      `INSERT INTO comm_replies (${cols})
       OUTPUT INSERTED.id, INSERTED.seq, INSERTED.sender_side, INSERTED.kind, INSERTED.body, INSERTED.created_at
       VALUES (${vals})`
    );
    const reply = ins.recordset[0];
    if (media) {
      Object.assign(reply, {
        media_name: media.name, media_mime: media.mime, media_size: media.size,
        media_w: media.width || null, media_h: media.height || null, media_duration: media.duration || null,
        media_url: getSignedDownloadUrl(media.blobPath, 120, 'chatMedia'),
      });
    }
    reply.delivered_at = null; reply.read_at = null;

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
  features, selectReplies, receiptsFor, markRead, markDeliveredForRecipient, markDeliveredForSender,
  prepareMedia, classifyUpload, previewOf, shapeReply, replyColumns,
  MAX_REPLY_LEN, isSchoolAdmin, cleanBody, canReplyNow,
  getMyRecipient, getMyStudentRecipient, getManagedMessage, getThreadRecipient, addReply, pingAdminSide, pingRecipient, upsertPing,
};
