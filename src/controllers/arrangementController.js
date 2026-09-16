// src/controllers/arrangementController.js
const { query, queryOne, sql } = require('../config/db');
const { success, created, notFound, badRequest } = require('../utils/response');
const { v4: uuidv4 } = require('uuid');
const { sendHtmlEmail } = require('../services/emailService');
const { sendTemplate } = require('../services/whatsappService');

async function assertStaffBelongsToSchool(schoolId, staffId) {
  const row = await queryOne(
    `SELECT id FROM school_members WHERE school_id=@sid AND user_id=@uid AND is_active=1 AND deleted_at IS NULL`,
    { sid: { type: sql.UniqueIdentifier, value: schoolId }, uid: { type: sql.UniqueIdentifier, value: staffId } }
  );
  return !!row;
}
//

// ══════════════════════════════════════════════════
// DRAFT — raw ingredients for a date; all gap/match logic happens on frontend
// ══════════════════════════════════════════════════
exports.getDraft = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { date } = req.query; // 'YYYY-MM-DD'
    if (!date) return badRequest(res, 'date is required (YYYY-MM-DD)');

    // ⚠️ Confirm convention matches your timetable module: 0=Sunday...6=Saturday
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();

    const [periodSlots, teachers, attendance, timetable, subjectTeachers, existingSubs] = await Promise.all([
      query(`SELECT id, period_number, label, start_time, end_time, is_break
             FROM period_slots WHERE school_id=@sid AND is_active=1 AND is_break=0 ORDER BY period_number`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId } }),

      query(`SELECT sm.user_id AS teacher_id, u.full_name, u.avatar_url, sp.designation, sp.department
             FROM school_members sm
             JOIN users u ON u.id = sm.user_id
             LEFT JOIN staff_profiles sp ON sp.user_id = sm.user_id AND sp.school_id = sm.school_id
             WHERE sm.school_id=@sid AND sm.role='teacher' AND sm.is_active=1 AND sm.deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId } }),

      query(`SELECT user_id AS teacher_id, status FROM staff_attendance
             WHERE school_id=@sid AND attendance_date=@date AND deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, date: { type: sql.Date, value: date } }),

      query(`SELECT te.id, te.period_slot_id, te.section_id, te.subject_id, te.teacher_id, te.room_no,
                    sec.name AS section_name, g.name AS class_name, sub.name AS subject_name
             FROM timetable_entries te
             JOIN sections sec ON sec.id = te.section_id
             JOIN grades g ON g.id = sec.grade_id
             LEFT JOIN subjects sub ON sub.id = te.subject_id
             WHERE te.school_id=@sid AND te.day_of_week=@dow`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, dow: { type: sql.TinyInt, value: dayOfWeek } }),

      query(`SELECT subject_id, teacher_user_id AS teacher_id FROM subject_teachers
             WHERE school_id=@sid AND is_active=1 AND deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId } }),

      query(`SELECT id, period_slot_id, section_id, subject_id, original_teacher_id, substitute_teacher_id, notified_at
             FROM substitution_logs WHERE school_id=@sid AND substitution_date=@date AND deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, date: { type: sql.Date, value: date } }),
    ]);

    return success(res, {
      date, day_of_week: dayOfWeek,
      period_slots: periodSlots.recordset,
      teachers: teachers.recordset,
      attendance: attendance.recordset,
      timetable: timetable.recordset,
      subject_teachers: subjectTeachers.recordset,
      existing_substitutions: existingSubs.recordset,
    });
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════
// CONFIRM — persist admin's final selections for the day
// ══════════════════════════════════════════════════
exports.confirmArrangement = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const { date, entries } = req.body;
    // entries = [{period_slot_id, section_id, subject_id, original_teacher_id, substitute_teacher_id, original_status, is_suggested_match}]
    if (!date || !Array.isArray(entries) || entries.length === 0) return badRequest(res, 'date and entries[] are required.');

    let savedCount = 0;
    const changedByTeacher = new Map();
    for (const e of entries) {
      if (!(await assertStaffBelongsToSchool(schoolId, e.substitute_teacher_id))) continue; // SaaS safety

      const existing = await queryOne(
        `SELECT id FROM substitution_logs WHERE school_id=@sid AND substitution_date=@date AND period_slot_id=@ps AND section_id=@sec AND deleted_at IS NULL`,
        { sid: { type: sql.UniqueIdentifier, value: schoolId }, date: { type: sql.Date, value: date },
          ps: { type: sql.UniqueIdentifier, value: e.period_slot_id }, sec: { type: sql.UniqueIdentifier, value: e.section_id } });

      const p = {
        sid: { type: sql.UniqueIdentifier, value: schoolId }, date: { type: sql.Date, value: date },
        ps: { type: sql.UniqueIdentifier, value: e.period_slot_id }, sec: { type: sql.UniqueIdentifier, value: e.section_id },
        subj: { type: sql.UniqueIdentifier, value: e.subject_id || null },
        orig: { type: sql.UniqueIdentifier, value: e.original_teacher_id },
        sub: { type: sql.UniqueIdentifier, value: e.substitute_teacher_id },
        stat: { type: sql.VarChar(2), value: e.original_status || null },
        suggested: { type: sql.Bit, value: e.is_suggested_match ? 1 : 0 },
        by: { type: sql.UniqueIdentifier, value: userId }, now: { type: sql.DateTime2, value: new Date() },
      };

     let substituteChanged = false;
      if (existing) {
        substituteChanged = existing.substitute_teacher_id !== e.substitute_teacher_id;
        await query(`UPDATE substitution_logs SET substitute_teacher_id=@sub, is_suggested_match=@suggested WHERE id=@id`,
          { ...p, id: { type: sql.UniqueIdentifier, value: existing.id } });
      } else {
        substituteChanged = true; // brand new assignment
        await query(
          `INSERT INTO substitution_logs (id, school_id, substitution_date, period_slot_id, section_id, subject_id,
             original_teacher_id, substitute_teacher_id, original_status, is_suggested_match, created_by, created_at)
           VALUES (@id, @sid, @date, @ps, @sec, @subj, @orig, @sub, @stat, @suggested, @by, @now)`,
          { ...p, id: { type: sql.UniqueIdentifier, value: uuidv4() } });
      }
      savedCount++;

      // fire an in-app-only notification whenever a teacher is freshly assigned/changed —
      // email + WhatsApp still go only via the explicit "Notify" button (notifySubstitutes)
      if (substituteChanged) {
        if (!changedByTeacher.has(e.substitute_teacher_id)) changedByTeacher.set(e.substitute_teacher_id, []);
        changedByTeacher.get(e.substitute_teacher_id).push(e);
      }
    }

    // consolidate: one in-app row per teacher, covering every newly-assigned period in this save
    for (const [teacherId, changedEntries] of changedByTeacher) {
      const lines = [];
      for (const e of changedEntries) {
        const row = await queryOne(
          `SELECT ps.period_number, g.name AS class_name, sec.name AS section_name, uo.full_name AS original_teacher_name
           FROM period_slots ps
           JOIN sections sec ON sec.id=@sec
           JOIN grades g ON g.id = sec.grade_id
           JOIN users uo ON uo.id=@orig
           WHERE ps.id=@ps`,
          {
            ps: { type: sql.UniqueIdentifier, value: e.period_slot_id },
            sec: { type: sql.UniqueIdentifier, value: e.section_id },
            orig: { type: sql.UniqueIdentifier, value: e.original_teacher_id },
          }
        );
        if (row) lines.push(`📍 P${row.period_number}: Class ${row.class_name}-${row.section_name} (Repl. ${row.original_teacher_name})`);
      }
      const dateStr = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

      try {
        await query(
          `INSERT INTO staff_notifications (school_id, user_id, type, title, message)
           VALUES (@sid, @uid, 'substitution', @title, @msg)`,
          {
            sid: { type: sql.UniqueIdentifier, value: schoolId },
            uid: { type: sql.UniqueIdentifier, value: teacherId },
            title: { type: sql.NVarChar(200), value: `Substitution Duty — ${dateStr}` },
            msg: { type: sql.NVarChar(500), value: lines.join('\n').slice(0, 500) },
          }
        );
      } catch (e) {
        // Never let an in-app notify failure take down the whole save — substitution_logs already committed above.
        console.error('In-app substitution notify failed for teacher', teacherId, ':', e.message);
      }
    }

    return success(res, { saved: savedCount, notified_in_app: changedByTeacher.size }, 'Arrangement confirmed successfully');
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════
// CANCEL a single substitution entry
// ══════════════════════════════════════════════════
exports.cancelEntry = async (req, res, next) => {
  try {
    const { id } = req.params; const { schoolId } = req.user;
    await query(`UPDATE substitution_logs SET deleted_at=@now WHERE id=@id AND school_id=@sid`,
      { id: { type: sql.UniqueIdentifier, value: id }, sid: { type: sql.UniqueIdentifier, value: schoolId }, now: { type: sql.DateTime2, value: new Date() } });
    return success(res, null, 'Substitution cancelled');
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════
// HISTORY — raw list for a date range; frontend aggregates for Overview charts
// ══════════════════════════════════════════════════
exports.listHistory = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { from, to } = req.query;
    let where = `sl.school_id=@sid AND sl.deleted_at IS NULL`;
    const params = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
    if (from) { where += ` AND sl.substitution_date >= @from`; params.from = { type: sql.Date, value: from }; }
    if (to) { where += ` AND sl.substitution_date <= @to`; params.to = { type: sql.Date, value: to }; }

    const rows = await query(
      `SELECT sl.*, sec.name AS section_name, g.name AS class_name, sub.name AS subject_name,
              uo.full_name AS original_teacher_name, us.full_name AS substitute_teacher_name,
              ps.label AS period_label, ps.period_number
       FROM substitution_logs sl
       JOIN sections sec ON sec.id = sl.section_id
       JOIN grades g ON g.id = sec.grade_id
       LEFT JOIN subjects sub ON sub.id = sl.subject_id
       JOIN users uo ON uo.id = sl.original_teacher_id
       JOIN users us ON us.id = sl.substitute_teacher_id
       JOIN period_slots ps ON ps.id = sl.period_slot_id
       WHERE ${where}
       ORDER BY sl.substitution_date DESC, ps.period_number`, params);
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

// ══════════════════════════════════════════════════
// NOTIFY — groups today's substitution_logs by substitute teacher,
// fires ONE consolidated message per teacher across app + email + WhatsApp.
// ══════════════════════════════════════════════════
exports.notifySubstitutes = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const { date } = req.body;
    if (!date) return badRequest(res, 'date is required (YYYY-MM-DD)');

    const school = await queryOne(`SELECT name FROM schools WHERE id=@sid`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId } });
    const schoolName = school?.name || 'Your School';

    const ay = await queryOne(
      `SELECT id FROM academic_years WHERE school_id=@sid AND is_current=1`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );
    if (!ay) return badRequest(res, 'No active academic year found for this school.');

    const rows = await query(
      `SELECT sl.substitute_teacher_id, sl.original_teacher_id, ps.period_number, ps.label AS period_label,
              g.name AS class_name, sec.name AS section_name,
              uo.full_name AS original_teacher_name,
              us.full_name AS sub_name, us.email AS sub_email, us.phone AS sub_phone
       FROM substitution_logs sl
       JOIN period_slots ps ON ps.id = sl.period_slot_id
       JOIN sections sec    ON sec.id = sl.section_id
       JOIN grades g        ON g.id = sec.grade_id
       JOIN users uo        ON uo.id = sl.original_teacher_id
       JOIN users us        ON us.id = sl.substitute_teacher_id
       WHERE sl.school_id=@sid AND sl.substitution_date=@date AND sl.deleted_at IS NULL
       ORDER BY sl.substitute_teacher_id, ps.period_number`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, date: { type: sql.Date, value: date } }
    );

    if (rows.recordset.length === 0) return success(res, { notified: 0, results: [] }, 'No substitutions found for this date');

    const byTeacher = new Map();
    for (const r of rows.recordset) {
      if (!byTeacher.has(r.substitute_teacher_id)) byTeacher.set(r.substitute_teacher_id, []);
      byTeacher.get(r.substitute_teacher_id).push(r);
    }

    const dateStr = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

    const existingBatch = await queryOne(
      `SELECT TOP 1 comm_message_id FROM substitution_logs
       WHERE school_id=@sid AND substitution_date=@date AND comm_message_id IS NOT NULL AND deleted_at IS NULL`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, date: { type: sql.Date, value: date } }
    );

    let msgId = existingBatch?.comm_message_id;
    if (!msgId) {
      msgId = uuidv4();
      await query(
        `INSERT INTO comm_messages (id, school_id, academic_year_id, title, body, category, source_module, source_id, status, created_by, created_at)
         VALUES (@id, @sid, @ay, @title, @body, 'substitution', 'substitution', NULL, 'pending', @by, @now)`,
        {
          id: { type: sql.UniqueIdentifier, value: msgId },
          sid: { type: sql.UniqueIdentifier, value: schoolId },
          ay: { type: sql.UniqueIdentifier, value: ay.id },
          title: { type: sql.NVarChar(200), value: `Substitution Duty — ${dateStr}` },
          body: { type: sql.NVarChar(sql.MAX), value: `Substitution duty assignments for ${dateStr}` },
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

    let notified = 0;
    let anySentOverall = false, anyFailedOverall = false;
    const results = [];

    for (const [teacherId, entries] of byTeacher) {
      const teacherName = entries[0].sub_name;
      const arrangementLines = entries
        .map((e) => `📍 P${e.period_number}: Class ${e.class_name}-${e.section_name} (Repl. ${e.original_teacher_name})`)
        .join('\n');

      const existingRecipient = await queryOne(
        `SELECT id FROM comm_recipients WHERE message_id=@mid AND user_id=@uid`,
        { mid: { type: sql.UniqueIdentifier, value: msgId }, uid: { type: sql.UniqueIdentifier, value: teacherId } }
      );
      let recipientId = existingRecipient?.id;
      if (!recipientId) {
        recipientId = uuidv4();
        await query(
          `INSERT INTO comm_recipients (id, school_id, message_id, recipient_type, student_id, user_id, created_at)
           VALUES (@id, @sid, @mid, 'staff', NULL, @uid, @now)`,
          {
            id: { type: sql.UniqueIdentifier, value: recipientId },
            sid: { type: sql.UniqueIdentifier, value: schoolId },
            mid: { type: sql.UniqueIdentifier, value: msgId },
            uid: { type: sql.UniqueIdentifier, value: teacherId },
            now: { type: sql.DateTime2, value: new Date() },
          }
        );
      }

      const priorDeliveries = await query(
        `SELECT channel, status FROM comm_deliveries WHERE recipient_id=@rid`,
        { rid: { type: sql.UniqueIdentifier, value: recipientId } }
      );
      const alreadySent = new Set(priorDeliveries.recordset.filter((d) => d.status === 'sent').map((d) => d.channel));

      const teacherResult = { teacher_id: teacherId, teacher_name: teacherName, app: null, email: null, whatsapp: null, overall: null };
      let anySentForTeacher = false, anyFailedForTeacher = false;

      const recordDelivery = async (channel, status, errorMsg) => {
        const existingDelivery = await queryOne(
          `SELECT id FROM comm_deliveries WHERE recipient_id=@rid AND channel=@ch`,
          { rid: { type: sql.UniqueIdentifier, value: recipientId }, ch: { type: sql.VarChar(20), value: channel } }
        );
        if (existingDelivery) {
          await query(
            `UPDATE comm_deliveries SET status=@status, error_message=@err,
               sent_at=CASE WHEN @status='sent' THEN GETUTCDATE() ELSE sent_at END
             WHERE id=@id`,
            {
              id: { type: sql.UniqueIdentifier, value: existingDelivery.id },
              status: { type: sql.VarChar(20), value: status },
              err: { type: sql.NVarChar(500), value: errorMsg ? String(errorMsg).slice(0, 500) : null },
            }
          );
        } else {
          await query(
            `INSERT INTO comm_deliveries (school_id, recipient_id, channel, status, error_message, sent_at)
             VALUES (@sid, @rid, @ch, @status, @err, CASE WHEN @status='sent' THEN GETUTCDATE() ELSE NULL END)`,
            {
              sid: { type: sql.UniqueIdentifier, value: schoolId },
              rid: { type: sql.UniqueIdentifier, value: recipientId },
              ch: { type: sql.VarChar(20), value: channel },
              status: { type: sql.VarChar(20), value: status },
              err: { type: sql.NVarChar(500), value: errorMsg ? String(errorMsg).slice(0, 500) : null },
            }
          );
        }
        teacherResult[channel] = { status, error: errorMsg || null };
        if (status === 'sent') anySentForTeacher = true; else anyFailedForTeacher = true;
      };

      if (alreadySent.has('app')) {
        teacherResult.app = { status: 'sent', error: null };
        anySentForTeacher = true;
      } else {
        try {
          await query(
            `INSERT INTO staff_notifications (school_id, user_id, type, title, message, related_id)
             VALUES (@sid, @uid, 'substitution', @title, @msg, @relId)`,
            {
              sid: { type: sql.UniqueIdentifier, value: schoolId },
              uid: { type: sql.UniqueIdentifier, value: teacherId },
              title: { type: sql.NVarChar(200), value: `Substitution Duty — ${dateStr}` },
              msg: { type: sql.NVarChar(500), value: arrangementLines.slice(0, 500) },
              relId: { type: sql.UniqueIdentifier, value: msgId },
            }
          );
          await recordDelivery('app', 'sent', null);
        } catch (e) {
          console.error('In-app substitution notify failed for teacher', teacherId, ':', e.message);
          await recordDelivery('app', 'failed', e.message);
        }
      }

      if (alreadySent.has('email')) {
        teacherResult.email = { status: 'sent', error: null };
        anySentForTeacher = true;
      } else if (entries[0].sub_email) {
        try {
          const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120">
            <rect width="600" height="120" fill="#1d4ed8"/>
            <text x="30" y="50" font-family="Arial" font-size="22" fill="#ffffff" font-weight="bold">${schoolName}</text>
            <text x="30" y="85" font-family="Arial" font-size="15" fill="#dbeafe">Substitution Duty Alert</text>
          </svg>`;
          const bannerBase64 = `data:image/svg+xml;base64,${Buffer.from(bannerSvg).toString('base64')}`;
          const html = `
            <img src="${bannerBase64}" style="width:100%;max-width:600px;border-radius:8px 8px 0 0;" />
            <div style="padding:20px;font-family:Arial,sans-serif;">
              <p>Dear ${teacherName},</p>
              <p>You have been assigned substitution duty on <strong>${dateStr}</strong>:</p>
              <pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-line;">${arrangementLines}</pre>
              <p style="color:#6b7280;font-size:12px;">— ${schoolName}</p>
            </div>`;
          await sendHtmlEmail({
            to: entries[0].sub_email, from: process.env.SG_FROM_EMAIL,
            fromName: schoolName, subject: `Substitution Duty — ${dateStr}`, html,
          });
          await recordDelivery('email', 'sent', null);
        } catch (e) {
          console.error('Substitution email failed:', e.message);
          await recordDelivery('email', 'failed', e.message);
        }
      } else {
        await recordDelivery('email', 'failed', 'No email on file for this teacher');
      }

      if (alreadySent.has('whatsapp')) {
        teacherResult.whatsapp = { status: 'sent', error: null };
        anySentForTeacher = true;
      } else if (entries[0].sub_phone) {
        try {
          const components = [{
            type: 'body',
            parameters: [
              { type: 'text', text: teacherName },
              { type: 'text', text: dateStr },
              { type: 'text', text: arrangementLines },
              { type: 'text', text: schoolName },
            ],
          }];
          await sendTemplate(entries[0].sub_phone, 'substitution_assignment_alert', 'en', components);
          await recordDelivery('whatsapp', 'sent', null);
        } catch (e) {
          console.error('Substitution WhatsApp failed:', e.message);
          await recordDelivery('whatsapp', 'failed', e.message);
        }
      } else {
        await recordDelivery('whatsapp', 'failed', 'No phone number on file for this teacher');
      }

      const teacherStatus = anySentForTeacher && anyFailedForTeacher ? 'partial' : anySentForTeacher ? 'sent' : 'failed';
      teacherResult.overall = teacherStatus;
      results.push(teacherResult);
      if (anySentForTeacher) anySentOverall = true;
      if (anyFailedForTeacher) anyFailedOverall = true;

      await query(
        `UPDATE substitution_logs SET notified_at=@now, notify_status=@st, comm_message_id=@mid
         WHERE school_id=@sid AND substitution_date=@date AND substitute_teacher_id=@tid AND deleted_at IS NULL`,
        {
          now: { type: sql.DateTime2, value: new Date() },
          st: { type: sql.VarChar(10), value: teacherStatus },
          mid: { type: sql.UniqueIdentifier, value: msgId },
          sid: { type: sql.UniqueIdentifier, value: schoolId },
          date: { type: sql.Date, value: date },
          tid: { type: sql.UniqueIdentifier, value: teacherId },
        }
      );

      notified++;
    }

    const finalStatus = anyFailedOverall && anySentOverall ? 'partial' : anyFailedOverall ? 'failed' : 'sent';
    await query(`UPDATE comm_messages SET status=@st WHERE id=@id`,
      { st: { type: sql.VarChar(20), value: finalStatus }, id: { type: sql.UniqueIdentifier, value: msgId } });

    return success(
      res,
      { notified, results, comm_message_id: msgId, status: finalStatus },
      finalStatus === 'sent' ? `Notified ${notified} teacher(s) via app/email/WhatsApp`
        : finalStatus === 'partial' ? `Notified ${notified} teacher(s), but some channels failed — see details`
        : `Notify failed on all channels — see details`
    );
  } catch (err) { next(err); }
};
      notified++;
    }

    await query(`UPDATE substitution_logs SET notified_at=@now WHERE school_id=@sid AND substitution_date=@date AND deleted_at IS NULL`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, date: { type: sql.Date, value: date }, now: { type: sql.DateTime2, value: new Date() } });

    return success(res, { notified }, `Notified ${notified} teacher(s) via app/email/WhatsApp`);
  } catch (err) { next(err); }
};
