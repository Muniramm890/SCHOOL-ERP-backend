// src/services/notifyService.js
// ══════════════════════════════════════════════════
// GENERIC NOTIFY PIPELINE — reuses CommHub's own tables
// (comm_messages / comm_message_channels / comm_recipients / comm_deliveries)
// so ANY module (substitution, attendance, exam, payroll, fees...) gets
// app + email + WhatsApp delivery automatically, with REAL per-channel
// status recorded, and safe to call repeatedly (idempotent upsert via
// dedupeKey — no duplicate messages / no re-sending already-sent channels).
// ══════════════════════════════════════════════════
const { query, queryOne, sql } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { sendHtmlEmail } = require('./emailService');
const { sendTemplate } = require('./whatsappService');

/**
 * @param {object} opts
 * @param {string} opts.schoolId
 * @param {string} opts.academicYearId
 * @param {string} opts.userId        - who triggered this batch (created_by)
 * @param {string} opts.schoolName    - for email "from name" / banner
 * @param {string} opts.sourceModule  - 'substitution' | 'attendance' | 'exam' | 'payroll' ...
 * @param {string} [opts.sourceId]    - optional entity id this batch relates to
 * @param {string} opts.title         - comm_messages.title
 * @param {string} opts.body          - comm_messages.body (short summary)
 * @param {string} [opts.dedupeKey]   - e.g. `substitution:${schoolId}:${date}` — reused on retry so no duplicate batch/spam
 * @param {Array}  opts.recipients    - [{ userId, name, email, phone,
 *                                         appMessage,                       // string or null -> 'app' channel
 *                                         emailSubject, emailHtml,          // both required -> 'email' channel
 *                                         whatsapp: { template, lang, params:[...] } // -> 'whatsapp' channel
 *                                     }]
 * @returns {Promise<{comm_message_id:string, notified:number, results:Array, status:string}>}
 */
async function notifyViaCommHub(opts) {
  const { schoolId, academicYearId, userId, schoolName, sourceModule, sourceId = null, title, body, dedupeKey, recipients } = opts;
  if (!recipients || recipients.length === 0) return { comm_message_id: null, notified: 0, results: [], status: 'skipped' };

  // ── 1) reuse existing batch for this dedupeKey (idempotent retry) or create fresh ──
  let msgId = null;
  if (dedupeKey) {
    const existing = await queryOne(
      `SELECT id FROM comm_messages WHERE school_id=@sid AND source_module=@mod AND dedupe_key=@dk`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, mod: { type: sql.VarChar(30), value: sourceModule }, dk: { type: sql.VarChar(200), value: dedupeKey } }
    );
    msgId = existing?.id || null;
  }

  if (!msgId) {
    msgId = uuidv4();
    await query(
      `INSERT INTO comm_messages (id, school_id, academic_year_id, title, body, category, source_module, source_id, dedupe_key, status, created_by, created_at)
       VALUES (@id, @sid, @ay, @title, @body, @mod, @mod, @sourceId, @dk, 'pending', @by, @now)`,
      {
        id: { type: sql.UniqueIdentifier, value: msgId },
        sid: { type: sql.UniqueIdentifier, value: schoolId },
        ay: { type: sql.UniqueIdentifier, value: academicYearId },
        title: { type: sql.NVarChar(200), value: title },
        body: { type: sql.NVarChar(sql.MAX), value: body },
        mod: { type: sql.VarChar(30), value: sourceModule },
        sourceId: { type: sql.UniqueIdentifier, value: sourceId },
        dk: { type: sql.VarChar(200), value: dedupeKey || null },
        by: { type: sql.UniqueIdentifier, value: userId },
        now: { type: sql.DateTime2, value: new Date() },
      }
    );
    for (const ch of ['app', 'email', 'whatsapp']) {
      await query(
        `INSERT INTO comm_message_channels (school_id, message_id, channel) VALUES (@sid, @mid, @ch)`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, mid: { type: sql.UniqueIdentifier, value: msgId }, ch: { type: sql.VarChar(20), value: ch } }
      );
    }
  }

  const results = [];
  let notified = 0, anySentOverall = false, anyFailedOverall = false;

  for (const rcpt of recipients) {
    // reuse recipient row on retry
    const existingR = await queryOne(
      `SELECT id FROM comm_recipients WHERE message_id=@mid AND user_id=@uid`,
      { mid: { type: sql.UniqueIdentifier, value: msgId }, uid: { type: sql.UniqueIdentifier, value: rcpt.userId } }
    );
    let recipientId = existingR?.id;
    if (!recipientId) {
      recipientId = uuidv4();
      await query(
        `INSERT INTO comm_recipients (id, school_id, message_id, recipient_type, student_id, user_id, created_at)
         VALUES (@id, @sid, @mid, 'staff', NULL, @uid, @now)`,
        {
          id: { type: sql.UniqueIdentifier, value: recipientId },
          sid: { type: sql.UniqueIdentifier, value: schoolId },
          mid: { type: sql.UniqueIdentifier, value: msgId },
          uid: { type: sql.UniqueIdentifier, value: rcpt.userId },
          now: { type: sql.DateTime2, value: new Date() },
        }
      );
    }

    const prior = await query(`SELECT channel, status FROM comm_deliveries WHERE recipient_id=@rid`,
      { rid: { type: sql.UniqueIdentifier, value: recipientId } });
    const alreadySent = new Set(prior.recordset.filter((d) => d.status === 'sent').map((d) => d.channel));

    const rResult = { user_id: rcpt.userId, name: rcpt.name, app: null, email: null, whatsapp: null, overall: null };
    let anySent = false, anyFailed = false;

    // upsert delivery row: UPDATE if it exists (retry), INSERT the first time
    const record = async (channel, status, err) => {
      const ex = await queryOne(
        `SELECT id FROM comm_deliveries WHERE recipient_id=@rid AND channel=@ch`,
        { rid: { type: sql.UniqueIdentifier, value: recipientId }, ch: { type: sql.VarChar(20), value: channel } }
      );
      if (ex) {
        await query(
          `UPDATE comm_deliveries SET status=@st, error_message=@err, sent_at=CASE WHEN @st='sent' THEN GETUTCDATE() ELSE sent_at END WHERE id=@id`,
          { id: { type: sql.UniqueIdentifier, value: ex.id }, st: { type: sql.VarChar(20), value: status }, err: { type: sql.NVarChar(500), value: err ? String(err).slice(0, 500) : null } }
        );
      } else {
        await query(
          `INSERT INTO comm_deliveries (school_id, recipient_id, channel, status, error_message, sent_at)
           VALUES (@sid, @rid, @ch, @st, @err, CASE WHEN @st='sent' THEN GETUTCDATE() ELSE NULL END)`,
          {
            sid: { type: sql.UniqueIdentifier, value: schoolId }, rid: { type: sql.UniqueIdentifier, value: recipientId },
            ch: { type: sql.VarChar(20), value: channel }, st: { type: sql.VarChar(20), value: status },
            err: { type: sql.NVarChar(500), value: err ? String(err).slice(0, 500) : null },
          }
        );
      }
      rResult[channel] = { status, error: err || null };
      if (status === 'sent') anySent = true; else anyFailed = true;
    };

    // ── APP ──
    if (alreadySent.has('app')) { rResult.app = { status: 'sent', error: null }; anySent = true; }
    else if (rcpt.appMessage) {
      try {
        await query(
          `INSERT INTO staff_notifications (school_id, user_id, type, title, message, related_id) VALUES (@sid, @uid, @type, @title, @msg, @relId)`,
          {
            sid: { type: sql.UniqueIdentifier, value: schoolId }, uid: { type: sql.UniqueIdentifier, value: rcpt.userId },
            type: { type: sql.VarChar(30), value: sourceModule }, title: { type: sql.NVarChar(200), value: title },
            msg: { type: sql.NVarChar(500), value: String(rcpt.appMessage).slice(0, 500) }, relId: { type: sql.UniqueIdentifier, value: msgId },
          }
        );
        await record('app', 'sent', null);
      } catch (e) { await record('app', 'failed', e.message); }
    } else { await record('app', 'failed', 'No app message provided'); }

    // ── EMAIL ──
    if (alreadySent.has('email')) { rResult.email = { status: 'sent', error: null }; anySent = true; }
    else if (rcpt.email && rcpt.emailHtml) {
      try {
        await sendHtmlEmail({ to: rcpt.email, from: process.env.SG_FROM_EMAIL, fromName: schoolName || 'School', subject: rcpt.emailSubject || title, html: rcpt.emailHtml });
        await record('email', 'sent', null);
      } catch (e) { await record('email', 'failed', e.message); }
    } else { await record('email', 'failed', rcpt.email ? 'No email content provided' : 'No email on file for this user'); }

    // ── WHATSAPP ──
    if (alreadySent.has('whatsapp')) { rResult.whatsapp = { status: 'sent', error: null }; anySent = true; }
    else if (rcpt.phone && rcpt.whatsapp) {
      try {
        const components = [{ type: 'body', parameters: rcpt.whatsapp.params.map((t) => ({ type: 'text', text: t })) }];
        await sendTemplate(rcpt.phone, rcpt.whatsapp.template, rcpt.whatsapp.lang || 'en', components);
        await record('whatsapp', 'sent', null);
      } catch (e) { await record('whatsapp', 'failed', e.message); }
    } else { await record('whatsapp', 'failed', rcpt.phone ? 'No WhatsApp template provided' : 'No phone on file for this user'); }

    const overall = anySent && anyFailed ? 'partial' : anySent ? 'sent' : 'failed';
    rResult.overall = overall;
    results.push(rResult);
    if (anySent) anySentOverall = true;
    if (anyFailed) anyFailedOverall = true;
    notified++;
  }

  const finalStatus = anyFailedOverall && anySentOverall ? 'partial' : anyFailedOverall ? 'failed' : 'sent';
  await query(`UPDATE comm_messages SET status=@st WHERE id=@id`,
    { st: { type: sql.VarChar(20), value: finalStatus }, id: { type: sql.UniqueIdentifier, value: msgId } });

  return { comm_message_id: msgId, notified, results, status: finalStatus };
}

module.exports = { notifyViaCommHub };
