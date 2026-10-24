// src/controllers/examController.js  (v2)
// Exam groups, date sheet, marks entry, publish/unpublish, grading scale.
// Rules: every query is school-scoped, parent ids are verified, published exams are locked,
// blank marks stay NULL, statuses are whitelisted, bulk writes are single set-based statements.
const { query, withTransaction, sql } = require('../config/db');
const { success, created } = require('../utils/response');
const R = require('../utils/examRules');
const { handle, U, bad, notFound, conflict } = R;

const EXAM_TYPE_RE = /^[a-z0-9_]{2,30}$/;
const EDITABLE_STATUS = ['draft', 'scheduled', 'ongoing', 'completed']; // 'published' only via /publish

// ═══════════════════════════ EXAM GROUPS ═══════════════════════════

// GET /api/exams?academic_year_id=
exports.listExams = handle(async (req, res) => {
  const { schoolId } = req.user;
  const { academic_year_id } = req.query;
  if (academic_year_id) R.needUuid(academic_year_id, 'academic_year_id');
  const f = await R.features();
  const r = await query(`
    SELECT eg.id, eg.name, eg.exam_type, eg.start_date, eg.end_date, eg.weightage_percent, eg.status, eg.academic_year_id,
           ay.name AS academic_year_name${f.publishCols ? ', eg.published_at' : ''},
           (SELECT COUNT(*) FROM exam_sections s WHERE s.exam_group_id = eg.id) AS section_count,
           (SELECT COUNT(DISTINCT x.subject_id) FROM exam_subjects x WHERE x.exam_group_id = eg.id AND x.deleted_at IS NULL) AS subject_count,
           (SELECT STRING_AGG(CAST(s2.section_id AS NVARCHAR(36)), ',') FROM exam_sections s2 WHERE s2.exam_group_id = eg.id) AS section_ids_csv
    FROM exam_groups eg
    JOIN academic_years ay ON ay.id = eg.academic_year_id
    WHERE eg.school_id = @sid AND eg.deleted_at IS NULL AND (@ayid IS NULL OR eg.academic_year_id = @ayid)
    ORDER BY eg.start_date DESC`,
    { sid: U(schoolId), ayid: U(academic_year_id || null) });
  return success(res, r.recordset.map((x) => ({ ...x, section_ids: x.section_ids_csv ? x.section_ids_csv.split(',') : [] })));
});

// GET /api/exams/:id
exports.getExam = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  const sections = await query(`
    SELECT sc.id, sc.name, sc.grade_id, g.name AS grade_name
    FROM exam_sections es JOIN sections sc ON sc.id = es.section_id JOIN grades g ON g.id = sc.grade_id
    WHERE es.exam_group_id = @id ORDER BY g.numeric_order, sc.name`, { id: U(exam.id) });
  return success(res, { ...exam, sections: sections.recordset });
});

async function assertYearOfSchool(schoolId, ayId) {
  R.needUuid(ayId, 'academic_year_id');
  const r = await query(`SELECT 1 AS ok FROM academic_years WHERE id=@id AND school_id=@sid`, { id: U(ayId), sid: U(schoolId) });
  if (!r.recordset.length) throw bad('Academic year not found for this school');
}
async function assertNameFree(schoolId, ayId, name, selfId) {
  const r = await query(
    `SELECT 1 AS x FROM exam_groups WHERE school_id=@sid AND academic_year_id=@ay AND deleted_at IS NULL
       AND LOWER(name)=LOWER(@name) AND (@self IS NULL OR id<>@self)`,
    { sid: U(schoolId), ay: U(ayId), name: { type: sql.NVarChar(200), value: name }, self: U(selfId || null) });
  if (r.recordset.length) throw conflict('An exam with this name already exists in this academic year');
}
function checkCore({ name, exam_type, start_date, end_date, weightage }) {
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 200)) throw bad('Exam name must be 2-200 characters');
  if (exam_type !== undefined && !EXAM_TYPE_RE.test(exam_type)) throw bad('Invalid exam type');
  if (start_date !== undefined && !R.isYmd(start_date)) throw bad('Start date is invalid (YYYY-MM-DD)');
  if (end_date !== undefined && !R.isYmd(end_date)) throw bad('End date is invalid (YYYY-MM-DD)');
  if (start_date && end_date && end_date < start_date) throw bad('End date cannot be before the start date');
  if (weightage !== undefined && !(Number.isFinite(weightage) && weightage >= 0 && weightage <= 100)) throw bad('Weightage must be between 0 and 100');
}

// POST /api/exams
exports.createExam = handle(async (req, res) => {
  const { schoolId, userId } = req.user;
  const b = req.body || {};
  if (!b.name || !b.academic_year_id || !b.start_date || !b.end_date) throw bad('name, academic_year_id, start_date and end_date are required');
  const name = String(b.name).trim();
  const weightage = b.weightage_percent === undefined || b.weightage_percent === '' || b.weightage_percent === null ? 0 : Number(b.weightage_percent);
  const exam_type = b.exam_type || 'unit_test';
  checkCore({ name, exam_type, start_date: b.start_date, end_date: b.end_date, weightage });
  await assertYearOfSchool(schoolId, b.academic_year_id);
  await assertNameFree(schoolId, b.academic_year_id, name);

  const r = await query(`
    INSERT INTO exam_groups (id, school_id, academic_year_id, name, exam_type, start_date, end_date, weightage_percent, status, created_by)
    OUTPUT INSERTED.id
    VALUES (NEWID(), @sid, @ay, @name, @etype, @sd, @ed, @wt, 'draft', @uid)`, {
    sid: U(schoolId), ay: U(b.academic_year_id), name: { type: sql.NVarChar(200), value: name },
    etype: { type: sql.VarChar(30), value: exam_type }, sd: { type: sql.Date, value: b.start_date }, ed: { type: sql.Date, value: b.end_date },
    wt: { type: sql.Decimal(5, 2), value: R.round2(weightage) }, uid: U(userId),
  });
  return created(res, { id: r.recordset[0].id }, 'Exam created successfully');
});

// PUT /api/exams/:id
exports.updateExam = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  R.assertEditable(exam);
  const b = req.body || {};

  const name = b.name !== undefined && b.name !== null && b.name !== '' ? String(b.name).trim() : exam.name;
  const exam_type = b.exam_type || exam.exam_type;
  const start_date = b.start_date || R.ymd(exam.start_date);
  const end_date = b.end_date || R.ymd(exam.end_date);
  const weightage = b.weightage_percent !== undefined && b.weightage_percent !== null && b.weightage_percent !== '' ? Number(b.weightage_percent) : Number(exam.weightage_percent);
  const ay = b.academic_year_id || exam.academic_year_id;
  checkCore({ name, exam_type, start_date, end_date, weightage });

  if (b.status !== undefined && b.status !== null && b.status !== '') {
    if (b.status === 'published') throw bad('Use the Publish action to publish results');
    if (!EDITABLE_STATUS.includes(b.status)) throw bad('Invalid exam status');
  }
  if (String(ay).toLowerCase() !== String(exam.academic_year_id).toLowerCase()) {
    await assertYearOfSchool(schoolId, ay);
    const has = await query(`SELECT TOP 1 1 AS x FROM exam_subjects WHERE exam_group_id=@id AND deleted_at IS NULL`, { id: U(exam.id) });
    if (has.recordset.length) throw conflict('Academic year cannot be changed after the date sheet is created');
  }
  if (name.toLowerCase() !== String(exam.name).toLowerCase() || ay !== exam.academic_year_id) await assertNameFree(schoolId, ay, name, exam.id);

  await query(`
    UPDATE exam_groups SET name=@name, exam_type=@etype, academic_year_id=@ay, start_date=@sd, end_date=@ed,
           weightage_percent=@wt, status=ISNULL(@status, status), updated_at=GETUTCDATE()
    WHERE id=@id AND school_id=@sid AND deleted_at IS NULL`, {
    id: U(exam.id), sid: U(schoolId), name: { type: sql.NVarChar(200), value: name }, etype: { type: sql.VarChar(30), value: exam_type },
    ay: U(ay), sd: { type: sql.Date, value: start_date }, ed: { type: sql.Date, value: end_date },
    wt: { type: sql.Decimal(5, 2), value: R.round2(weightage) }, status: { type: sql.VarChar(20), value: b.status || null },
  });
  return success(res, null, 'Exam updated successfully');
});

// DELETE /api/exams/:id  (soft delete; a published exam must be unpublished first)
exports.deleteExam = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  if (exam.status === 'published') throw conflict('Unpublish the exam before deleting it');
  await query(`UPDATE exam_groups SET deleted_at=GETUTCDATE(), updated_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`, { id: U(exam.id), sid: U(schoolId) });
  return success(res, null, 'Exam deleted successfully');
});

// PUT /api/exams/:id/classes   Body: { section_ids: [uuid] }
// removed sections: their date sheet is soft-deleted (marks are kept, re-adding restores) and their computed results are dropped.
exports.setExamClasses = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  R.assertEditable(exam);
  const { section_ids } = req.body || {};
  if (!Array.isArray(section_ids)) throw bad('section_ids must be an array');
  const ids = [...new Set(section_ids.map((x) => String(x).toLowerCase()))];
  ids.forEach((x) => R.needUuid(x, 'section id'));
  if (ids.length) {
    const ok = await query(`SELECT COUNT(*) AS n FROM sections WHERE school_id=@sid AND deleted_at IS NULL AND id IN (SELECT value FROM OPENJSON(@j))`,
      { sid: U(schoolId), j: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(ids) } });
    if (ok.recordset[0].n !== ids.length) throw bad('One or more sections do not belong to this school');
  }
  const j = JSON.stringify(ids);
  await withTransaction(async (tx) => {
    const rq = (text) => { const r = tx.request(); r.input('eid', sql.UniqueIdentifier, exam.id); r.input('sid', sql.UniqueIdentifier, schoolId); r.input('j', sql.NVarChar(sql.MAX), j); return r.query(text); };
    const removed = `SELECT section_id FROM exam_sections WHERE exam_group_id=@eid AND section_id NOT IN (SELECT CAST(value AS uniqueidentifier) FROM OPENJSON(@j))`;
    await rq(`UPDATE exam_subjects SET deleted_at=GETUTCDATE(), updated_at=GETUTCDATE() WHERE exam_group_id=@eid AND deleted_at IS NULL AND section_id IN (${removed})`);
    await rq(`DELETE FROM exam_results WHERE exam_group_id=@eid AND school_id=@sid AND section_id IN (${removed})`);
    await rq(`DELETE FROM exam_sections WHERE exam_group_id=@eid AND section_id NOT IN (SELECT CAST(value AS uniqueidentifier) FROM OPENJSON(@j))`);
    await rq(`INSERT INTO exam_sections (id, exam_group_id, section_id, school_id)
              SELECT NEWID(), @eid, CAST(v.value AS uniqueidentifier), @sid FROM OPENJSON(@j) v
              WHERE NOT EXISTS (SELECT 1 FROM exam_sections x WHERE x.exam_group_id=@eid AND x.section_id = CAST(v.value AS uniqueidentifier))`);
  });
  return success(res, null, 'Exam classes updated successfully');
});

// ═══════════════════════════ DATE SHEET ═══════════════════════════

async function assertSectionInExam(schoolId, examId, sectionId) {
  R.needUuid(sectionId, 'section_id');
  const r = await query(`SELECT 1 AS ok FROM exam_sections WHERE exam_group_id=@eid AND section_id=@sec AND school_id=@sid`, { eid: U(examId), sec: U(sectionId), sid: U(schoolId) });
  if (!r.recordset.length) throw bad('This class/section is not part of the exam. Add it in "Classes" first.');
}

// GET /api/exams/:id/datesheet?section_id=
exports.getDatesheet = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  const { section_id } = req.query;
  if (!section_id) throw bad('section_id query param is required');
  R.needUuid(section_id, 'section_id');
  const r = await query(`
    SELECT exs.id, exs.subject_id, s.name AS subject_name, exs.exam_date, exs.start_time, exs.duration_minutes,
           exs.max_marks, exs.passing_marks, exs.is_grade_only
    FROM exam_subjects exs JOIN subjects s ON s.id = exs.subject_id
    WHERE exs.exam_group_id=@eid AND exs.section_id=@sec AND exs.school_id=@sid AND exs.deleted_at IS NULL
    ORDER BY exs.exam_date, exs.start_time, s.name`, { eid: U(exam.id), sec: U(section_id), sid: U(schoolId) });
  return success(res, r.recordset);
});

// PUT /api/exams/:id/datesheet   Body: { section_id, entries:[{subject_id, exam_date?, start_time?, duration_minutes?, max_marks, passing_marks?, is_grade_only?}] }
exports.saveDatesheet = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  R.assertEditable(exam);
  const { section_id, entries } = req.body || {};
  if (!section_id) throw bad('section_id is required');
  if (!Array.isArray(entries)) throw bad('entries must be an array');
  await assertSectionInExam(schoolId, exam.id, section_id);

  const start = R.ymd(exam.start_date), end = R.ymd(exam.end_date);
  const errors = [], seen = new Set(), rows = [];
  entries.forEach((e, i) => {
    const tag = `Row ${i + 1}`;
    if (!R.isUuid(e?.subject_id)) { errors.push(`${tag}: subject is invalid`); return; }
    const sid = e.subject_id.toLowerCase();
    if (seen.has(sid)) { errors.push(`${tag}: subject is listed twice`); return; }
    seen.add(sid);
    const grade = !!e.is_grade_only;
    const has = (v) => v !== undefined && v !== null && v !== '';
    let max = 0, pass = 0;
    if (!grade) {
      max = has(e.max_marks) ? Number(e.max_marks) : 100;
      if (!(Number.isFinite(max) && max > 0 && max <= 9999)) { errors.push(`${tag}: max marks must be greater than 0`); return; }
      pass = has(e.passing_marks) ? Number(e.passing_marks) : R.round2(max * 0.33); // 0 is a valid "no pass mark"
      if (!(Number.isFinite(pass) && pass >= 0 && pass <= max)) { errors.push(`${tag}: passing marks must be between 0 and max marks (${max})`); return; }
    }
    const dur = has(e.duration_minutes) ? Number(e.duration_minutes) : 120;
    if (!(Number.isInteger(dur) && dur >= 1 && dur <= 1440)) { errors.push(`${tag}: duration must be 1-1440 minutes`); return; }
    let date = null;
    if (has(e.exam_date)) {
      date = String(e.exam_date).slice(0, 10);
      if (!R.isYmd(date)) { errors.push(`${tag}: exam date is invalid`); return; }
      if (date < start || date > end) { errors.push(`${tag}: exam date must be between ${start} and ${end}`); return; }
    }
    let time = '09:00:00';
    if (has(e.start_time)) {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(e.start_time));
      if (!m || +m[1] > 23 || +m[2] > 59) { errors.push(`${tag}: start time is invalid`); return; }
      time = `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
    }
    rows.push({ subject_id: sid, exam_date: date, start_time: time, duration: dur, max_marks: R.round2(max), passing_marks: R.round2(pass), is_grade_only: grade });
  });
  if (errors.length) throw bad(errors[0], errors);
  if (rows.length) {
    const ok = await query(`SELECT COUNT(*) AS n FROM subjects WHERE school_id=@sid AND deleted_at IS NULL AND id IN (SELECT value FROM OPENJSON(@j))`,
      { sid: U(schoolId), j: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(rows.map((x) => x.subject_id)) } });
    if (ok.recordset[0].n !== rows.length) throw bad('One or more subjects do not belong to this school');
  }

  const j = JSON.stringify(rows);
  await withTransaction(async (tx) => {
    const rq = (text) => { const r = tx.request(); r.input('sid', sql.UniqueIdentifier, schoolId); r.input('eid', sql.UniqueIdentifier, exam.id); r.input('sec', sql.UniqueIdentifier, section_id); r.input('j', sql.NVarChar(sql.MAX), j); return r.query(text); };
    // un-ticked subjects are soft-deleted (their marks stay, ticking them again restores everything)
    await rq(`UPDATE exam_subjects SET deleted_at=GETUTCDATE(), updated_at=GETUTCDATE()
              WHERE school_id=@sid AND exam_group_id=@eid AND section_id=@sec AND deleted_at IS NULL
                AND subject_id NOT IN (SELECT subject_id FROM OPENJSON(@j) WITH (subject_id uniqueidentifier '$.subject_id'))`);
    if (!rows.length) return;
    await rq(`
      MERGE exam_subjects WITH (HOLDLOCK) AS t
      USING (SELECT * FROM OPENJSON(@j) WITH (subject_id uniqueidentifier '$.subject_id', exam_date date '$.exam_date', start_time varchar(8) '$.start_time',
              duration smallint '$.duration', max_marks decimal(6,2) '$.max_marks', passing_marks decimal(6,2) '$.passing_marks', is_grade_only bit '$.is_grade_only')) AS s
        ON t.exam_group_id=@eid AND t.section_id=@sec AND t.subject_id=s.subject_id
      WHEN MATCHED AND (t.deleted_at IS NOT NULL OR ISNULL(t.exam_date,'19000101') <> ISNULL(s.exam_date,'19000101') OR ISNULL(t.start_time,'') <> s.start_time
                        OR t.duration_minutes <> s.duration OR t.max_marks <> s.max_marks OR t.passing_marks <> s.passing_marks OR t.is_grade_only <> s.is_grade_only)
        THEN UPDATE SET exam_date=s.exam_date, start_time=s.start_time, duration_minutes=s.duration, max_marks=s.max_marks,
                        passing_marks=s.passing_marks, is_grade_only=s.is_grade_only, updated_at=GETUTCDATE(), deleted_at=NULL
      WHEN NOT MATCHED THEN INSERT (id, school_id, exam_group_id, section_id, subject_id, exam_date, start_time, duration_minutes, max_marks, passing_marks, is_grade_only)
        VALUES (NEWID(), @sid, @eid, @sec, s.subject_id, s.exam_date, s.start_time, s.duration, s.max_marks, s.passing_marks, s.is_grade_only);`);
  });
  return success(res, null, 'Date sheet saved successfully');
});

// DELETE /api/exams/:id/datesheet/:rowId   (soft delete - marks are never destroyed)
exports.deleteDatesheetRow = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  R.assertEditable(exam);
  R.needUuid(req.params.rowId, 'row id');
  const r = await query(`UPDATE exam_subjects SET deleted_at=GETUTCDATE(), updated_at=GETUTCDATE()
                         WHERE id=@rid AND exam_group_id=@eid AND school_id=@sid AND deleted_at IS NULL`,
    { rid: U(req.params.rowId), eid: U(exam.id), sid: U(schoolId) });
  if (r.rowsAffected && r.rowsAffected[0] === 0) throw notFound('Date sheet row not found');
  return success(res, null, 'Removed from date sheet');
});

// ═══════════════════════════ MARKS ENTRY ═══════════════════════════

async function loadExamSubject(schoolId, examId, where, params) {
  const r = await query(`SELECT id, section_id, subject_id, max_marks, passing_marks, is_grade_only FROM exam_subjects
                         WHERE exam_group_id=@eid AND school_id=@sid AND deleted_at IS NULL AND ${where}`, { eid: U(examId), sid: U(schoolId), ...params });
  if (!r.recordset.length) throw notFound('This subject is not scheduled for this exam/class - build the date sheet first');
  return r.recordset[0];
}

// GET /api/exams/:id/marks-roster?section_id=&subject_id=
exports.getMarksRoster = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  const { section_id, subject_id } = req.query;
  if (!section_id || !subject_id) throw bad('section_id and subject_id are required');
  R.needUuid(section_id, 'section_id'); R.needUuid(subject_id, 'subject_id');
  const es = await loadExamSubject(schoolId, exam.id, 'section_id=@sec AND subject_id=@sub', { sec: U(section_id), sub: U(subject_id) });
  const r = await query(`
    SELECT st.id AS student_id, st.first_name, st.last_name, e.roll_no,
           em.marks_obtained, em.grade_obtained, ISNULL(em.status, 'present') AS status, em.remarks
    FROM enrolments e
    JOIN students st ON st.id = e.student_id
    LEFT JOIN exam_marks em ON em.exam_subject_id = @esid AND em.student_id = st.id
    WHERE e.section_id=@sec AND e.school_id=@sid AND e.academic_year_id=@ay AND e.is_active=1 AND e.deleted_at IS NULL
    ORDER BY TRY_CAST(e.roll_no AS INT), e.roll_no, st.first_name`,
    { esid: U(es.id), sec: U(section_id), sid: U(schoolId), ay: U(exam.academic_year_id) });
  return success(res, r.recordset);
});

// POST /api/exams/:id/marks   Body: { exam_subject_id, entries:[{student_id, marks_obtained?, grade_obtained?, status?, remarks?}] }
// all-or-nothing: one invalid row rejects the request with the list of problems.
exports.saveMarks = handle(async (req, res) => {
  const { schoolId, userId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  R.assertEditable(exam);
  const { exam_subject_id, entries } = req.body || {};
  if (!exam_subject_id) throw bad('exam_subject_id is required');
  R.needUuid(exam_subject_id, 'exam_subject_id');
  if (!Array.isArray(entries)) throw bad('entries must be an array');
  if (entries.length > 1000) throw bad('Too many rows in one request');
  const es = await loadExamSubject(schoolId, exam.id, 'id=@esid', { esid: U(exam_subject_id) });

  const roster = await query(
    `SELECT student_id FROM enrolments WHERE section_id=@sec AND school_id=@sid AND academic_year_id=@ay AND is_active=1 AND deleted_at IS NULL`,
    { sec: U(es.section_id), sid: U(schoolId), ay: U(exam.academic_year_id) });
  const inSection = new Set(roster.recordset.map((x) => String(x.student_id).toLowerCase()));

  const max = Number(es.max_marks), errors = [], byStudent = new Map();
  entries.forEach((e, i) => {
    const tag = `Row ${i + 1}`;
    if (!R.isUuid(e?.student_id)) { errors.push(`${tag}: student is invalid`); return; }
    const sid = e.student_id.toLowerCase();
    if (!inSection.has(sid)) { errors.push(`${tag}: student is not enrolled in this class/section`); return; }
    const status = e.status || 'present';
    if (!R.MARK_STATUSES.includes(status)) { errors.push(`${tag}: invalid status "${status}"`); return; }
    let marks = null, grade = null;
    if (status === 'present') {
      if (es.is_grade_only) {
        grade = e.grade_obtained ? String(e.grade_obtained).trim().slice(0, 10) : null;
      } else if (e.marks_obtained !== undefined && e.marks_obtained !== null && e.marks_obtained !== '') {
        const n = Number(e.marks_obtained);
        if (!Number.isFinite(n) || n < 0 || n > max) { errors.push(`${tag}: marks must be between 0 and ${max}`); return; }
        marks = R.round2(n);
      }
    }
    const remarks = e.remarks ? String(e.remarks).slice(0, 500) : null;
    byStudent.set(sid, { student_id: sid, marks, grade, status, remarks });
  });
  if (errors.length) throw bad(errors[0], errors);

  const rows = [...byStudent.values()];
  if (rows.length) {
    await withTransaction(async (tx) => {
      const r = tx.request();
      r.input('sid', sql.UniqueIdentifier, schoolId); r.input('esid', sql.UniqueIdentifier, es.id);
      r.input('uid', sql.UniqueIdentifier, userId || null); r.input('j', sql.NVarChar(sql.MAX), JSON.stringify(rows));
      await r.query(`
        MERGE exam_marks WITH (HOLDLOCK) AS t
        USING (SELECT * FROM OPENJSON(@j) WITH (student_id uniqueidentifier '$.student_id', marks decimal(6,2) '$.marks', grade varchar(10) '$.grade',
                status varchar(20) '$.status', remarks nvarchar(500) '$.remarks')) AS s
          ON t.exam_subject_id=@esid AND t.student_id=s.student_id
        WHEN MATCHED AND (ISNULL(t.marks_obtained,-1) <> ISNULL(s.marks,-1) OR ISNULL(t.grade_obtained,'') <> ISNULL(s.grade,'') OR t.status <> s.status OR ISNULL(t.remarks,'') <> ISNULL(s.remarks,''))
          THEN UPDATE SET marks_obtained=s.marks, grade_obtained=s.grade, status=s.status, remarks=s.remarks, entered_by=@uid, updated_at=GETUTCDATE()
        WHEN NOT MATCHED THEN INSERT (id, school_id, exam_subject_id, student_id, marks_obtained, grade_obtained, status, remarks, entered_by)
          VALUES (NEWID(), @sid, @esid, s.student_id, s.marks, s.grade, s.status, s.remarks, @uid);`);
    });
  }
  return success(res, { saved: rows.length }, 'Marks saved successfully');
});

// ═══════════════════════════ RESULTS / PUBLISH ═══════════════════════════

// GET /api/exams/:id/results?section_id=
exports.getResults = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  const { section_id } = req.query;
  if (!section_id) throw bad('section_id is required');
  R.needUuid(section_id, 'section_id');
  const p = { eid: U(exam.id), sec: U(section_id), sid: U(schoolId) };

  const [subjects, results, marks, stale] = await Promise.all([
    query(`SELECT exs.id, s.name, exs.is_grade_only FROM exam_subjects exs JOIN subjects s ON s.id = exs.subject_id
           WHERE exs.exam_group_id=@eid AND exs.section_id=@sec AND exs.school_id=@sid AND exs.deleted_at IS NULL
           ORDER BY exs.exam_date, exs.start_time, s.name`, p),
    query(`SELECT er.student_id, st.first_name, st.last_name, e.roll_no, er.total_marks, er.max_total, er.percentage, er.grade,
                  er.class_rank, er.school_rank, er.status, er.computed_at
           FROM exam_results er
           JOIN students st ON st.id = er.student_id
           LEFT JOIN enrolments e ON e.student_id=er.student_id AND e.section_id=er.section_id AND e.academic_year_id=@ay AND e.is_active=1 AND e.deleted_at IS NULL
           WHERE er.exam_group_id=@eid AND er.section_id=@sec AND er.school_id=@sid
           ORDER BY ISNULL(er.class_rank, 999999), TRY_CAST(e.roll_no AS INT)`, { ...p, ay: U(exam.academic_year_id) }),
    query(`SELECT em.student_id, em.exam_subject_id, em.marks_obtained, em.grade_obtained, em.status, exs.is_grade_only
           FROM exam_marks em JOIN exam_subjects exs ON exs.id = em.exam_subject_id
           WHERE exs.exam_group_id=@eid AND exs.section_id=@sec AND exs.school_id=@sid AND exs.deleted_at IS NULL`, p),
    // marks or date sheet changed after the last compute?
    query(`SELECT CASE WHEN EXISTS (
             SELECT 1 FROM exam_results er WHERE er.exam_group_id=@eid AND er.section_id=@sec AND er.school_id=@sid
               AND (EXISTS (SELECT 1 FROM exam_marks em JOIN exam_subjects x ON x.id=em.exam_subject_id
                            WHERE x.exam_group_id=@eid AND x.section_id=@sec AND ISNULL(em.updated_at, em.entered_at) > er.computed_at)
                    OR EXISTS (SELECT 1 FROM exam_subjects x2 WHERE x2.exam_group_id=@eid AND x2.section_id=@sec AND x2.updated_at > er.computed_at))
           ) THEN 1 ELSE 0 END AS is_stale`, p),
  ]);

  const marksMap = {};
  marks.recordset.forEach((m) => {
    (marksMap[m.student_id] ||= {})[m.exam_subject_id] = {
      val: m.status !== 'present' ? String(m.status).toUpperCase() : (m.is_grade_only ? m.grade_obtained : m.marks_obtained),
      status: m.status || 'present',
    };
  });
  const rows = results.recordset.map((r) => ({ ...r, marks: marksMap[r.student_id] || {} }));
  const computed_at = rows.reduce((mx, r) => (r.computed_at && (!mx || r.computed_at > mx) ? r.computed_at : mx), null);
  return success(res, { subjects: subjects.recordset, rows, stale: !!stale.recordset[0].is_stale, computed_at, exam_status: exam.status });
});

// PUT /api/exams/:id/publish   Body: { force?: boolean }
// Publishing never touches exam_results.status (that column is the pass/fail/incomplete outcome).
exports.publishExam = handle(async (req, res) => {
  const { schoolId, userId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  if (exam.status === 'published') return success(res, null, 'Results are already published');
  const force = req.body && req.body.force === true;

  const secs = await query(`
    SELECT es.section_id, sc.name AS section_name, g.name AS grade_name,
           (SELECT COUNT(*) FROM exam_subjects x WHERE x.exam_group_id=es.exam_group_id AND x.section_id=es.section_id AND x.deleted_at IS NULL) AS subject_count,
           (SELECT COUNT(*) FROM exam_results r WHERE r.exam_group_id=es.exam_group_id AND r.section_id=es.section_id) AS result_count,
           (SELECT COUNT(*) FROM exam_results r WHERE r.exam_group_id=es.exam_group_id AND r.section_id=es.section_id AND r.status='incomplete') AS incomplete_count,
           CASE WHEN EXISTS (
             SELECT 1 FROM exam_results er WHERE er.exam_group_id=es.exam_group_id AND er.section_id=es.section_id
               AND (EXISTS (SELECT 1 FROM exam_marks em JOIN exam_subjects x ON x.id=em.exam_subject_id WHERE x.exam_group_id=es.exam_group_id AND x.section_id=es.section_id AND ISNULL(em.updated_at, em.entered_at) > er.computed_at)
                    OR EXISTS (SELECT 1 FROM exam_subjects x2 WHERE x2.exam_group_id=es.exam_group_id AND x2.section_id=es.section_id AND x2.updated_at > er.computed_at))
           ) THEN 1 ELSE 0 END AS is_stale
    FROM exam_sections es JOIN sections sc ON sc.id=es.section_id JOIN grades g ON g.id=sc.grade_id
    WHERE es.exam_group_id=@eid AND es.school_id=@sid ORDER BY g.numeric_order, sc.name`, { eid: U(exam.id), sid: U(schoolId) });

  const withSubjects = secs.recordset.filter((s) => s.subject_count > 0);
  const problems = [];
  if (!withSubjects.length) problems.push('No class has a date sheet yet.');
  withSubjects.forEach((s) => {
    const n = `${s.grade_name}-${s.section_name}`;
    if (!s.result_count) problems.push(`${n}: results are not computed.`);
    else if (s.is_stale) problems.push(`${n}: marks changed after the last compute - recompute results.`);
    else if (s.incomplete_count > 0 && !force) problems.push(`${n}: ${s.incomplete_count} student(s) have incomplete marks.`);
  });
  if (problems.length) throw conflict('Results cannot be published yet', problems);

  const f = await R.features();
  await query(`UPDATE exam_groups SET status='published', updated_at=GETUTCDATE()${f.publishCols ? ', published_at=GETUTCDATE(), published_by=@uid' : ''}
               WHERE id=@id AND school_id=@sid AND deleted_at IS NULL`, { id: U(exam.id), sid: U(schoolId), uid: U(userId || null) });
  return success(res, null, 'Results published successfully');
});

// PUT /api/exams/:id/unpublish
exports.unpublishExam = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  const f = await R.features();
  await query(`UPDATE exam_groups SET status='completed', updated_at=GETUTCDATE()${f.publishCols ? ', published_at=NULL, published_by=NULL' : ''}
               WHERE id=@id AND school_id=@sid AND deleted_at IS NULL`, { id: U(exam.id), sid: U(schoolId) });
  return success(res, null, 'Results reopened for editing');
});

// DELETE /api/exams/:id/results/:studentId
exports.deleteStudentResult = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.id);
  R.assertEditable(exam);
  R.needUuid(req.params.studentId, 'student id');
  await query(`DELETE FROM exam_results WHERE exam_group_id=@eid AND student_id=@stu AND school_id=@sid`, { eid: U(exam.id), stu: U(req.params.studentId), sid: U(schoolId) });
  return success(res, null, 'Result deleted successfully');
});

// ═══════════════════════════ GRADING SCALE ═══════════════════════════

// GET /api/setup/grading-scale   (highest band first - same order everywhere)
exports.getGradingScale = handle(async (req, res) => {
  const r = await query(`SELECT grade_label, min_percent, max_percent FROM grading_scale WHERE school_id=@sid ORDER BY min_percent DESC`, { sid: U(req.user.schoolId) });
  return success(res, r.recordset);
});

// PUT /api/setup/grading-scale   Body: { scale:[{grade_label,min_percent,max_percent}] }
// a grade is the highest band whose minimum the student reaches, so only minimums matter; one band must start at 0.
exports.saveGradingScale = handle(async (req, res) => {
  const { schoolId } = req.user;
  const { scale } = req.body || {};
  if (!Array.isArray(scale) || !scale.length) throw bad('scale must be a non-empty array');
  if (scale.length > 20) throw bad('Too many grade bands');
  const errors = [], labels = new Set(), bands = [];
  scale.forEach((b, i) => {
    const tag = `Band ${i + 1}`;
    const label = String(b?.grade_label ?? '').trim();
    const min = Number(b?.min_percent), max = Number(b?.max_percent);
    if (!label || label.length > 10) errors.push(`${tag}: grade label is required (max 10 characters)`);
    else if (labels.has(label.toLowerCase())) errors.push(`${tag}: duplicate grade label "${label}"`);
    else labels.add(label.toLowerCase());
    if (!(Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max <= 100 && min <= max)) errors.push(`${tag}: percentages must be between 0 and 100 and min cannot exceed max`);
    bands.push({ grade_label: label, min_percent: R.round2(min), max_percent: R.round2(max) });
  });
  if (!errors.length) {
    const mins = bands.map((b) => b.min_percent);
    if (new Set(mins).size !== mins.length) errors.push('Two bands cannot start at the same percentage');
    if (!mins.includes(0)) errors.push('One band must start at 0% so every student gets a grade');
  }
  if (errors.length) throw bad(errors[0], errors);
  bands.sort((a, b) => b.min_percent - a.min_percent);
  bands.forEach((b, i) => {
    b.sort_order = i;
    b.max_percent = i === 0 ? 100 : R.round2(bands[i - 1].min_percent - 0.01); // no overlap: 70-79.99, 80-89.99, 90-100
  });

  await withTransaction(async (tx) => {
    const r = tx.request();
    r.input('sid', sql.UniqueIdentifier, schoolId); r.input('j', sql.NVarChar(sql.MAX), JSON.stringify(bands));
    await r.query(`DELETE FROM grading_scale WHERE school_id=@sid;
      INSERT INTO grading_scale (id, school_id, grade_label, min_percent, max_percent, sort_order)
      SELECT NEWID(), @sid, grade_label, min_percent, max_percent, sort_order
      FROM OPENJSON(@j) WITH (grade_label varchar(10) '$.grade_label', min_percent decimal(5,2) '$.min_percent', max_percent decimal(5,2) '$.max_percent', sort_order smallint '$.sort_order');`);
  });
  return success(res, null, 'Grading scale saved successfully');
});
