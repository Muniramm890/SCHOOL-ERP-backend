// src/controllers/commHubController.js
// 🔴 COMMUNICATION HUB — targeted notices/notifications across App / Email, with attachments
// (WhatsApp channel removed — Meta blocks freeform business-initiated messages outside approved templates)
const { query, queryOne, withTransaction, sql } = require('../config/db');
const { success, created, notFound, badRequest, paginated } = require('../utils/response');
const { sendHtmlEmail } = require('../services/emailService');
const { uploadCommAttachment } = require('../services/uploadService');
const { logAudit } = require('../utils/auditLogger');

// Which channels are valid for a given attachment type — enforced both here and on the frontend
const ATTACHMENT_CHANNEL_MATRIX = {
  none: ['app', 'email', 'sms'],
  image: ['app', 'email'],
  pdf: ['app', 'email'],
  document: ['app', 'email'],
  video: ['app'], // email can't realistically carry video bytes; sms can't carry any file
};
const MAX_EMAIL_ATTACH_BYTES = 10 * 1024 * 1024; // beyond this, skip raw-attach, just link in the email body

function detectAttachmentType(mimetype, ext) {
  if ((mimetype || '').startsWith('image/')) return 'image';
  if ((mimetype || '').startsWith('video/')) return 'video';
  if (ext === '.pdf') return 'pdf';
  return 'document';
}

// ────────────────────────────────────────────────────────────────
// Internal: resolve comm_message_targets (criteria) → concrete list
// of { recipient_type, student_id|null, user_id|null }
// ────────────────────────────────────────────────────────────────
async function resolveRecipients(schoolId, academicYearId, targets) {
  const map = new Map();

  for (const t of targets) {
    if (t.target_type === 'all_school') {
      const students = await query(
        `SELECT DISTINCT e.student_id FROM enrolments e
         WHERE e.school_id=@sid AND e.academic_year_id=@ay AND e.is_active=1 AND e.deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, ay: { type: sql.UniqueIdentifier, value: academicYearId } }
      );
      students.recordset.forEach((r) => map.set(`student:${r.student_id}`, { recipient_type: 'student', student_id: r.student_id, user_id: null }));

      const staff = await query(
        `SELECT DISTINCT sm.user_id FROM school_members sm WHERE sm.school_id=@sid AND sm.is_active=1 AND sm.deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId } }
      );
      staff.recordset.forEach((r) => map.set(`staff:${r.user_id}`, { recipient_type: 'staff', student_id: null, user_id: r.user_id }));
    }

    else if (t.target_type === 'grade') {
      const rows = await query(
        `SELECT DISTINCT e.student_id FROM enrolments e
         JOIN sections sc ON sc.id = e.section_id
         WHERE e.school_id=@sid AND e.academic_year_id=@ay AND sc.grade_id=@gid AND e.is_active=1 AND e.deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, ay: { type: sql.UniqueIdentifier, value: academicYearId }, gid: { type: sql.UniqueIdentifier, value: t.grade_id } }
      );
      rows.recordset.forEach((r) => map.set(`student:${r.student_id}`, { recipient_type: 'student', student_id: r.student_id, user_id: null }));
    }

    else if (t.target_type === 'section') {
      const rows = await query(
        `SELECT DISTINCT e.student_id FROM enrolments e
         WHERE e.school_id=@sid AND e.academic_year_id=@ay AND e.section_id=@secId AND e.is_active=1 AND e.deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, ay: { type: sql.UniqueIdentifier, value: academicYearId }, secId: { type: sql.UniqueIdentifier, value: t.section_id } }
      );
      rows.recordset.forEach((r) => map.set(`student:${r.student_id}`, { recipient_type: 'student', student_id: r.student_id, user_id: null }));
    }

    else if (t.target_type === 'gender_in_section') {
      const rows = await query(
        `SELECT DISTINCT e.student_id FROM enrolments e
         JOIN students s ON s.id = e.student_id
         WHERE e.school_id=@sid AND e.academic_year_id=@ay AND e.section_id=@secId
           AND s.gender=@gender AND e.is_active=1 AND e.deleted_at IS NULL`,
        {
          sid: { type: sql.UniqueIdentifier, value: schoolId }, ay: { type: sql.UniqueIdentifier, value: academicYearId },
          secId: { type: sql.UniqueIdentifier, value: t.section_id }, gender: { type: sql.VarChar(20), value: t.gender },
        }
      );
      rows.recordset.forEach((r) => map.set(`student:${r.student_id}`, { recipient_type: 'student', student_id: r.student_id, user_id: null }));
    }

    else if (t.target_type === 'student') {
      if (t.student_id) map.set(`student:${t.student_id}`, { recipient_type: 'student', student_id: t.student_id, user_id: null });
    }

    else if (t.target_type === 'subject_teachers') {
      const rows = await query(
        `SELECT DISTINCT ts.teacher_user_id AS user_id FROM teacher_subjects ts
         WHERE ts.school_id=@sid AND ts.academic_year_id=@ay AND ts.subject_id=@subId`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, ay: { type: sql.UniqueIdentifier, value: academicYearId }, subId: { type: sql.UniqueIdentifier, value: t.subject_id } }
      );
      rows.recordset.forEach((r) => map.set(`staff:${r.user_id}`, { recipient_type: 'staff', student_id: null, user_id: r.user_id }));
    }

    else if (t.target_type === 'class_teachers') {
      let where = `sc.school_id=@sid AND sc.academic_year_id=@ay AND sc.class_teacher_id IS NOT NULL`;
      const params = { sid: { type: sql.UniqueIdentifier, value: schoolId }, ay: { type: sql.UniqueIdentifier, value: academicYearId } };
      if (t.section_id) { where += ` AND sc.id=@secId`; params.secId = { type: sql.UniqueIdentifier, value: t.section_id }; }
      else if (t.grade_id) { where += ` AND sc.grade_id=@gid`; params.gid = { type: sql.UniqueIdentifier, value: t.grade_id }; }
      const rows = await query(`SELECT DISTINCT sc.class_teacher_id AS user_id FROM sections sc WHERE ${where}`, params);
      rows.recordset.forEach((r) => map.set(`staff:${r.user_id}`, { recipient_type: 'staff', student_id: null, user_id: r.user_id }));
    }

    else if (t.target_type === 'role') {
      const rows = await query(
        `SELECT DISTINCT sm.user_id FROM school_members sm
         WHERE sm.school_id=@sid AND sm.role=@role AND sm.is_active=1 AND sm.deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, role: { type: sql.VarChar(30), value: t.role } }
      );
      rows.recordset.forEach((r) => map.set(`staff:${r.user_id}`, { recipient_type: 'staff', student_id: null, user_id: r.user_id }));
    }
  }

  return Array.from(map.values());
}

// ────────────────────────────────────────────────────────────────
// Internal: fetch contact info (email) for dispatch
// Students → primary guardian's email. Staff → their own email.
// ────────────────────────────────────────────────────────────────
async function getContactInfo(schoolId, recipients) {
  const studentIds = recipients.filter((r) => r.recipient_type === 'student').map((r) => r.student_id);
  const userIds = recipients.filter((r) => r.recipient_type === 'staff').map((r) => r.user_id);
  const contacts = new Map();

  if (studentIds.length) {
    const rows = await query(
      `SELECT g.student_id, g.full_name, g.email
       FROM student_guardians g
       WHERE g.school_id=@sid AND g.student_id IN (${studentIds.map((_, i) => `@s${i}`).join(',')}) AND g.deleted_at IS NULL
       ORDER BY g.is_primary DESC`,
      Object.assign(
        { sid: { type: sql.UniqueIdentifier, value: schoolId } },
        Object.fromEntries(studentIds.map((id, i) => [`s${i}`, { type: sql.UniqueIdentifier, value: id }]))
      )
    );
    rows.recordset.forEach((r) => {
      const key = `student:${r.student_id}`;
      if (!contacts.has(key)) contacts.set(key, { name: r.full_name, email: r.email });
    });
  }

  if (userIds.length) {
    const rows = await query(
      `SELECT id, full_name, email FROM users WHERE id IN (${userIds.map((_, i) => `@u${i}`).join(',')})`,
      Object.fromEntries(userIds.map((id, i) => [`u${i}`, { type: sql.UniqueIdentifier, value: id }]))
    );
    rows.recordset.forEach((r) => contacts.set(`staff:${r.id}`, { name: r.full_name, email: r.email }));
  }

  return contacts;
}

// ── POST /api/comm/preview ── (count recipients before sending, no DB writes)
exports.previewTargets = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { academic_year_id, targets } = req.body;
    if (!academic_year_id || !Array.isArray(targets) || targets.length === 0) {
      return badRequest(res, 'academic_year_id and targets[] are required');
    }
    const recipients = await resolveRecipients(schoolId, academic_year_id, targets);
    return success(res, {
      total: recipients.length,
      students: recipients.filter((r) => r.recipient_type === 'student').length,
      staff: recipients.filter((r) => r.recipient_type === 'staff').length,
    });
  } catch (err) { next(err); }
};

// ── GET /api/comm/messages?page=&category= ── (history)
exports.listMessages = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { page = 1, limit = 20, category } = req.query;
    const offset = (page - 1) * limit;

    let where = `m.school_id=@sid`;
    const params = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
    if (category) { where += ` AND m.category=@cat`; params.cat = { type: sql.VarChar(30), value: category }; }

    const count = await queryOne(`SELECT COUNT(*) AS total FROM comm_messages m WHERE ${where}`, params);
    const rows = await query(
      `SELECT m.*, u.full_name AS created_by_name,
              (SELECT COUNT(*) FROM comm_recipients r WHERE r.message_id=m.id) AS recipient_count,
              (SELECT COUNT(*) FROM comm_deliveries d JOIN comm_recipients r ON r.id=d.recipient_id WHERE r.message_id=m.id AND d.status='sent') AS sent_count,
              (SELECT COUNT(*) FROM comm_deliveries d JOIN comm_recipients r ON r.id=d.recipient_id WHERE r.message_id=m.id AND d.status='failed') AS failed_count,
              (SELECT COUNT(*) FROM comm_message_attachments a WHERE a.message_id=m.id) AS attachment_count
       FROM comm_messages m
       JOIN users u ON u.id = m.created_by
       WHERE ${where}
       ORDER BY m.created_at DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      { ...params, offset: { type: sql.Int, value: +offset }, limit: { type: sql.Int, value: +limit } }
    );
    return paginated(res, rows.recordset, count.total, page, limit);
  } catch (err) { next(err); }
};

// ── GET /api/comm/messages/:id ── (detail + attachments + per-channel delivery stats)
exports.getMessage = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const msg = await queryOne(
      `SELECT m.*, u.full_name AS created_by_name FROM comm_messages m JOIN users u ON u.id=m.created_by
       WHERE m.id=@id AND m.school_id=@sid`,
      { id: { type: sql.UniqueIdentifier, value: id }, sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );
    if (!msg) return notFound(res, 'Message not found');

    const channels = await query(`SELECT channel FROM comm_message_channels WHERE message_id=@id`, { id: { type: sql.UniqueIdentifier, value: id } });
    const attachments = await query(
      `SELECT id, file_name, file_url, file_type, file_size_bytes FROM comm_message_attachments WHERE message_id=@id`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );
    const deliveryStats = await query(
      `SELECT d.channel, d.status, COUNT(*) AS cnt FROM comm_deliveries d
       JOIN comm_recipients r ON r.id = d.recipient_id
       WHERE r.message_id=@id GROUP BY d.channel, d.status`,
      { id: { type: sql.UniqueIdentifier, value: id } }
    );

    return success(res, {
      ...msg,
      channels: channels.recordset.map((c) => c.channel),
      attachments: attachments.recordset,
      delivery_stats: deliveryStats.recordset,
    });
  } catch (err) { next(err); }
};

// ── POST /api/comm/messages ── (multipart/form-data: fields + up to 3 files under 'attachments')
// Text fields arrive as strings (multipart) — channels/targets must be JSON.stringify'd by the frontend
exports.createAndSend = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const title = req.body.title;
    const body = req.body.body;
    const category = req.body.category || 'general';
    const source_module = req.body.source_module || 'manual';
    const source_id = req.body.source_id || null;
    const academic_year_id_input = req.body.academic_year_id;
    let channels, targets;

    try {
      channels = JSON.parse(req.body.channels || '[]');
      targets = JSON.parse(req.body.targets || '[]');
    } catch {
      return badRequest(res, 'channels and targets must be valid JSON arrays');
    }

    if (!title || !body) return badRequest(res, 'title and body are required');
    if (!Array.isArray(channels) || channels.length === 0) return badRequest(res, 'at least one channel is required');
    if (!Array.isArray(targets) || targets.length === 0) return badRequest(res, 'at least one target is required');

    let ayId = academic_year_id_input;
    if (!ayId) {
      const cur = await queryOne(`SELECT id FROM academic_years WHERE school_id=@sid AND is_current=1`, { sid: { type: sql.UniqueIdentifier, value: schoolId } });
      ayId = cur?.id;
    }
    if (!ayId) return badRequest(res, 'No academic session found for this school');

    // ── Attachment-channel compatibility check ──
    const files = req.files || [];
    let strictestType = 'none';
    const typeRank = { none: 0, image: 1, pdf: 1, document: 1, video: 2 }; // video is most restrictive
    const fileMeta = files.map((f) => {
      const ext = '.' + f.originalname.split('.').pop().toLowerCase();
      const type = detectAttachmentType(f.mimetype, ext);
      if (typeRank[type] > typeRank[strictestType]) strictestType = type;
      return { file: f, ext, type };
    });

    const allowedChannels = ATTACHMENT_CHANNEL_MATRIX[strictestType];
    const invalidChannels = channels.filter((c) => !allowedChannels.includes(c));
    if (invalidChannels.length > 0) {
      return badRequest(res, `Attachment type '${strictestType}' cannot be sent via: ${invalidChannels.join(', ')}. Allowed: ${allowedChannels.join(', ')}`);
    }

    // 1. Resolve recipients BEFORE writing anything — fail fast if nobody matches
    const recipients = await resolveRecipients(schoolId, ayId, targets);
    if (recipients.length === 0) return badRequest(res, 'No recipients matched the selected targets');

    // 2. Upload attachments (outside transaction — network I/O)
    const uploadedAttachments = [];
    for (const fm of fileMeta) {
      const result = await uploadCommAttachment(fm.file.buffer, { schoolId, fileName: fm.file.originalname, ext: fm.ext });
      uploadedAttachments.push({
        file_name: fm.file.originalname, file_url: result.secure_url, blob_path: result.public_id,
        file_type: fm.type, file_size_bytes: fm.file.size,
      });
    }

    // 3. Create message + channels + targets + attachments + recipients (transactional)
    const txResult = await withTransaction(async (tx) => {
      const msgRes = await new sql.Request(tx)
        .input('sid', sql.UniqueIdentifier, schoolId)
        .input('ay', sql.UniqueIdentifier, ayId)
        .input('title', sql.NVarChar(200), title)
        .input('body', sql.NVarChar(sql.MAX), body)
        .input('cat', sql.VarChar(30), category)
        .input('srcMod', sql.VarChar(30), source_module)
        .input('srcId', sql.UniqueIdentifier, source_id)
        .input('by', sql.UniqueIdentifier, userId)
        .query(
          `INSERT INTO comm_messages (school_id, academic_year_id, title, body, category, source_module, source_id, status, created_by)
           OUTPUT INSERTED.id
           VALUES (@sid, @ay, @title, @body, @cat, @srcMod, @srcId, 'sending', @by)`
        );
      const msgId = msgRes.recordset[0].id;

      for (const ch of channels) {
        await new sql.Request(tx)
          .input('sid', sql.UniqueIdentifier, schoolId).input('mid', sql.UniqueIdentifier, msgId).input('ch', sql.VarChar(20), ch)
          .query(`INSERT INTO comm_message_channels (school_id, message_id, channel) VALUES (@sid, @mid, @ch)`);
      }

      for (const t of targets) {
        await new sql.Request(tx)
          .input('sid', sql.UniqueIdentifier, schoolId).input('mid', sql.UniqueIdentifier, msgId)
          .input('ttype', sql.VarChar(30), t.target_type)
          .input('gid', sql.UniqueIdentifier, t.grade_id || null).input('secId', sql.UniqueIdentifier, t.section_id || null)
          .input('subId', sql.UniqueIdentifier, t.subject_id || null).input('stid', sql.UniqueIdentifier, t.student_id || null)
          .input('gender', sql.VarChar(20), t.gender || null).input('role', sql.VarChar(30), t.role || null)
          .query(
            `INSERT INTO comm_message_targets (school_id, message_id, target_type, grade_id, section_id, subject_id, student_id, gender, role)
             VALUES (@sid, @mid, @ttype, @gid, @secId, @subId, @stid, @gender, @role)`
          );
      }

      for (const a of uploadedAttachments) {
        await new sql.Request(tx)
          .input('sid', sql.UniqueIdentifier, schoolId).input('mid', sql.UniqueIdentifier, msgId)
          .input('fn', sql.NVarChar(255), a.file_name).input('fu', sql.NVarChar(500), a.file_url)
          .input('bp', sql.NVarChar(500), a.blob_path).input('ft', sql.VarChar(20), a.file_type)
          .input('fs', sql.BigInt, a.file_size_bytes)
          .query(
            `INSERT INTO comm_message_attachments (school_id, message_id, file_name, file_url, blob_path, file_type, file_size_bytes)
             VALUES (@sid, @mid, @fn, @fu, @bp, @ft, @fs)`
          );
      }

      const recipientRows = [];
      for (const r of recipients) {
        const rRes = await new sql.Request(tx)
          .input('sid', sql.UniqueIdentifier, schoolId).input('mid', sql.UniqueIdentifier, msgId)
          .input('rtype', sql.VarChar(10), r.recipient_type).input('stid', sql.UniqueIdentifier, r.student_id || null)
          .input('uid', sql.UniqueIdentifier, r.user_id || null)
          .query(
            `INSERT INTO comm_recipients (school_id, message_id, recipient_type, student_id, user_id)
             OUTPUT INSERTED.id
             VALUES (@sid, @mid, @rtype, @stid, @uid)`
          );
        recipientRows.push({ id: rRes.recordset[0].id, ...r });
      }

      return { msgId, recipientRows };
    });

    // 4. Dispatch across channels
    const contacts = await getContactInfo(schoolId, recipients);
    let anyFailed = false, anySent = false;

    // Pre-build email attachment payloads once (small files only — direct MIME attach)
    const emailAttachmentPayloads = [];
    for (const fm of fileMeta) {
      if (fm.type === 'video') continue; // matrix already blocks email+video, defensive skip anyway
      if (fm.file.size > MAX_EMAIL_ATTACH_BYTES) continue; // too big — link goes in body instead
      emailAttachmentPayloads.push({
        content: fm.file.buffer.toString('base64'),
        filename: fm.file.originalname,
        type: fm.file.mimetype,
        disposition: 'attachment',
      });
    }
    const attachmentLinksHtml = uploadedAttachments.length
      ? `<p>${uploadedAttachments.map((a) => `📎 <a href="${a.file_url}">${a.file_name}</a>`).join('<br/>')}</p>`
      : '';

    for (const r of txResult.recipientRows) {
      const contact = contacts.get(r.recipient_type === 'student' ? `student:${r.student_id}` : `staff:${r.user_id}`);

      for (const ch of channels) {
        let status = 'pending', errorMsg = null;
        try {
          if (ch === 'app') {
            const table = r.recipient_type === 'student' ? 'student_notifications' : 'staff_notifications';
            const idCol = r.recipient_type === 'student' ? 'student_id' : 'user_id';
            const idVal = r.recipient_type === 'student' ? r.student_id : r.user_id;
            await query(
              `INSERT INTO ${table} (school_id, ${idCol}, type, title, message, related_id)
               VALUES (@sid, @rid, @type, @title, @msg, @relId)`,
              {
                sid: { type: sql.UniqueIdentifier, value: schoolId }, rid: { type: sql.UniqueIdentifier, value: idVal },
                type: { type: sql.VarChar(40), value: category }, title: { type: sql.NVarChar(200), value: title },
                msg: { type: sql.NVarChar(500), value: body.slice(0, 500) }, relId: { type: sql.UniqueIdentifier, value: txResult.msgId },
              }
            );
            status = 'sent';
          }

          else if (ch === 'email') {
            if (!contact?.email) throw new Error('No email on file for this recipient');
            const skippedLargeLinks = uploadedAttachments.filter((a, i) => fileMeta[i]?.file.size > MAX_EMAIL_ATTACH_BYTES);
            const html = `<p>${body.replace(/\n/g, '<br/>')}</p>` + (skippedLargeLinks.length ? attachmentLinksHtml : '');
            await sendHtmlEmail({
              to: contact.email, from: process.env.SG_FROM_EMAIL, fromName: process.env.SG_FROM_NAME || 'School Office',
              subject: title, html, attachments: emailAttachmentPayloads.length ? emailAttachmentPayloads : undefined,
            });
            status = 'sent';
          }

          else if (ch === 'sms') {
            throw new Error('SMS channel not yet configured'); // 🔴 Ready-to-integrate hook — plug provider call here later
          }
        } catch (e) {
          status = 'failed';
          errorMsg = e.message?.slice(0, 500) || 'Unknown error';
        }

        if (status === 'sent') anySent = true; else anyFailed = true;

        await query(
          `INSERT INTO comm_deliveries (school_id, recipient_id, channel, status, error_message, sent_at)
           VALUES (@sid, @rid, @ch, @status, @err, CASE WHEN @status='sent' THEN GETUTCDATE() ELSE NULL END)`,
          {
            sid: { type: sql.UniqueIdentifier, value: schoolId }, rid: { type: sql.UniqueIdentifier, value: r.id },
            ch: { type: sql.VarChar(20), value: ch }, status: { type: sql.VarChar(20), value: status },
            err: { type: sql.NVarChar(500), value: errorMsg },
          }
        );
      }
    }

    const finalStatus = anyFailed && anySent ? 'partial' : anyFailed ? 'failed' : 'sent';
    await query(`UPDATE comm_messages SET status=@st WHERE id=@id`, {
      st: { type: sql.VarChar(20), value: finalStatus }, id: { type: sql.UniqueIdentifier, value: txResult.msgId },
    });

    logAudit({ schoolId, userId, actionType: 'COMM_MESSAGE_SENT', details: JSON.stringify({ messageId: txResult.msgId, recipients: recipients.length, channels, attachments: uploadedAttachments.length }) });

    return created(res, { id: txResult.msgId, status: finalStatus, recipient_count: recipients.length, attachment_count: uploadedAttachments.length });
  } catch (err) { next(err); }
};