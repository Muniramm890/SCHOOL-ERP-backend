// src/controllers/resultsController.js  (v2)
// Result compute engine + analytics + report cards.
// exam_results.status is ONLY the outcome: pass | fail | incomplete (publish state lives in exam_groups.status).
const { query, withTransaction, sql } = require('../config/db');
const { success } = require('../utils/response');
const R = require('../utils/examRules');
const { handle, U, bad, notFound, conflict, forbidden } = R;
const { reportCardPdf, bulkReportCardsPdf, sendPdf } = require('../services/documents');

const pct2 = (n) => (n === null || n === undefined ? 0 : Math.round(Number(n) * 100) / 100);
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);
const isStudent = (req) => !!req.student;

// students may only see published exams; staff see everything
async function examFor(req, examId) {
  const exam = await R.loadExam(req.user.schoolId, examId);
  if (isStudent(req) && exam.status !== 'published') throw forbidden('This result has not been published yet');
  return exam;
}
const needExamParam = (req) => {
  const id = req.query.exam_group_id;
  if (!id) throw bad('exam_group_id is required');
  return R.needUuid(id, 'exam_group_id');
};
// every analytics query joins the exam so deleted exams / other schools never leak in
const EXAM_JOIN = `JOIN exam_groups eg ON eg.id = er.exam_group_id AND eg.school_id = er.school_id AND eg.deleted_at IS NULL`;

// ═══════════════════════════ EXAM LIST (results screen) ═══════════════════════════
exports.listExamGroups = handle(async (req, res) => {
  const { schoolId } = req.user;
  const { academic_year_id } = req.query;
  if (academic_year_id) R.needUuid(academic_year_id, 'academic_year_id');
  const r = await query(`
    SELECT eg.id, eg.name, eg.exam_type, eg.start_date, eg.end_date, eg.weightage_percent, eg.status, eg.academic_year_id,
           (SELECT COUNT(*) FROM exam_results er WHERE er.exam_group_id = eg.id) AS results_computed_count
    FROM exam_groups eg
    WHERE eg.school_id=@sid AND eg.deleted_at IS NULL AND (@ayId IS NULL OR eg.academic_year_id=@ayId)
    ORDER BY eg.start_date DESC`, { sid: U(schoolId), ayId: U(academic_year_id || null) });
  return success(res, r.recordset, 'Exam groups fetched');
});

// ═══════════════════════════ COMPUTE ═══════════════════════════
// Rules per student and subject (marks are handled in integer paise-style cents, never float sums):
//   no marks row / present without marks      -> missing  => student is "incomplete"
//   leave | tc | exempted                      -> ignored (not in max, not a fail)
//   absent | malpractice                       -> max counts, scores 0, student fails
//   present                                    -> marks counted, below passing marks => fail
//   grade-only subjects never add marks/max (they only need a grade, absent => fail)
async function computeSection(schoolId, exam, sectionId) {
  const p = { eid: U(exam.id), sec: U(sectionId), sid: U(schoolId), ay: U(exam.academic_year_id) };
  const [subs, scaleR, stuR, marksR] = await Promise.all([
    query(`SELECT id, max_marks, passing_marks, is_grade_only FROM exam_subjects WHERE exam_group_id=@eid AND section_id=@sec AND school_id=@sid AND deleted_at IS NULL`, p),
    query(`SELECT grade_label, min_percent FROM grading_scale WHERE school_id=@sid ORDER BY min_percent DESC`, p),
    query(`SELECT DISTINCT student_id FROM enrolments WHERE section_id=@sec AND school_id=@sid AND academic_year_id=@ay AND is_active=1 AND deleted_at IS NULL`, p),
    query(`SELECT em.exam_subject_id, em.student_id, em.marks_obtained, em.grade_obtained, em.status
           FROM exam_marks em JOIN exam_subjects es ON es.id = em.exam_subject_id
           WHERE es.exam_group_id=@eid AND es.section_id=@sec AND es.school_id=@sid AND es.deleted_at IS NULL`, p),
  ]);
  const subjects = subs.recordset, scale = scaleR.recordset, students = stuR.recordset.map((x) => String(x.student_id).toLowerCase());
  if (!subjects.length) throw bad('No subjects in the date sheet for this class - add them first');
  if (!scale.length) throw bad('Set up the grading scale first (Setup > Grading Scale)');

  const markIdx = new Map();
  marksR.recordset.forEach((m) => markIdx.set(`${String(m.student_id).toLowerCase()}|${String(m.exam_subject_id).toLowerCase()}`, m));

  const rows = students.map((sid) => {
    let obtained = 0, maxC = 0, missing = 0, anyFail = false;
    for (const es of subjects) {
      const m = markIdx.get(`${sid}|${String(es.id).toLowerCase()}`);
      if (!m) { missing++; continue; }
      const st = m.status || 'present';
      if (R.EXEMPT.has(st)) continue;
      if (es.is_grade_only) {
        if (R.FAILING.has(st)) anyFail = true;
        else if (!m.grade_obtained) missing++;
        continue;
      }
      maxC += R.cents(es.max_marks);
      if (R.FAILING.has(st)) { anyFail = true; continue; }
      if (m.marks_obtained === null || m.marks_obtained === undefined) { missing++; continue; }
      obtained += R.cents(m.marks_obtained);
      if (Number(m.marks_obtained) < Number(es.passing_marks)) anyFail = true;
    }
    const complete = missing === 0 && maxC > 0;
    const percentage = complete ? R.round2((obtained / maxC) * 100) : 0;
    return {
      student_id: sid, total_marks: obtained / 100, max_total: maxC / 100, pct: percentage,
      grade: complete ? R.gradeFor(scale, percentage) : null,
      status: !complete ? 'incomplete' : anyFail ? 'fail' : 'pass',
    };
  });

  const j = JSON.stringify(rows), ids = JSON.stringify(students);
  await withTransaction(async (tx) => {
    const rq = (text) => {
      const r = tx.request();
      r.input('eid', sql.UniqueIdentifier, exam.id); r.input('sec', sql.UniqueIdentifier, sectionId); r.input('sid', sql.UniqueIdentifier, schoolId);
      r.input('j', sql.NVarChar(sql.MAX), j); r.input('ids', sql.NVarChar(sql.MAX), ids);
      return r.query(text);
    };
    // also clears a stale row left in another section if a student was moved
    await rq(`DELETE FROM exam_results WHERE exam_group_id=@eid AND school_id=@sid
                AND (section_id=@sec OR student_id IN (SELECT CAST(value AS uniqueidentifier) FROM OPENJSON(@ids)))`);
    if (rows.length) {
      await rq(`INSERT INTO exam_results (id, exam_group_id, section_id, student_id, school_id, total_marks, max_total, percentage, grade, status, computed_at)
                SELECT NEWID(), @eid, @sec, student_id, @sid, total_marks, max_total, pct, grade, status, GETUTCDATE()
                FROM OPENJSON(@j) WITH (student_id uniqueidentifier '$.student_id', total_marks decimal(8,2) '$.total_marks', max_total decimal(8,2) '$.max_total',
                                        pct decimal(5,2) '$.pct', grade varchar(10) '$.grade', status varchar(20) '$.status')`);
    }
    // ranks: class_rank = within the section, school_rank = within the whole class (all sections of the grade). incomplete = no rank.
    await rq(`UPDATE er SET class_rank = x.rk
              FROM exam_results er JOIN (SELECT id, RANK() OVER (PARTITION BY section_id ORDER BY percentage DESC) AS rk
                                         FROM exam_results WHERE exam_group_id=@eid AND school_id=@sid AND status<>'incomplete') x ON x.id = er.id
              WHERE er.exam_group_id=@eid AND er.section_id=@sec`);
    await rq(`UPDATE er SET school_rank = x.rk
              FROM exam_results er JOIN (SELECT r.id, RANK() OVER (PARTITION BY sc.grade_id ORDER BY r.percentage DESC) AS rk
                                         FROM exam_results r JOIN sections sc ON sc.id = r.section_id
                                         WHERE r.exam_group_id=@eid AND r.school_id=@sid AND r.status<>'incomplete') x ON x.id = er.id
              WHERE er.exam_group_id=@eid AND er.school_id=@sid`);
    await rq(`UPDATE exam_results SET class_rank=NULL, school_rank=NULL WHERE exam_group_id=@eid AND school_id=@sid AND status='incomplete'`);
  });
  return { section_id: sectionId, computed: rows.length, incomplete: rows.filter((r) => r.status === 'incomplete').length, passed: rows.filter((r) => r.status === 'pass').length, failed: rows.filter((r) => r.status === 'fail').length };
}

// POST /api/results/compute/:examGroupId   Body: { section_id? }  (no section_id = every class of the exam)
exports.computeResults = handle(async (req, res) => {
  const { schoolId } = req.user;
  const exam = await R.loadExam(schoolId, req.params.examGroupId);
  R.assertEditable(exam);
  const { section_id } = req.body || {};
  let sectionIds;
  if (section_id && section_id !== 'all') {
    R.needUuid(section_id, 'section_id');
    const ok = await query(`SELECT 1 AS ok FROM exam_sections WHERE exam_group_id=@eid AND section_id=@sec AND school_id=@sid`, { eid: U(exam.id), sec: U(section_id), sid: U(schoolId) });
    if (!ok.recordset.length) throw bad('This class/section is not part of the exam');
    sectionIds = [section_id];
  } else {
    const r = await query(`SELECT section_id FROM exam_sections WHERE exam_group_id=@eid AND school_id=@sid AND EXISTS
                           (SELECT 1 FROM exam_subjects x WHERE x.exam_group_id=@eid AND x.section_id=exam_sections.section_id AND x.deleted_at IS NULL)`, { eid: U(exam.id), sid: U(schoolId) });
    sectionIds = r.recordset.map((x) => x.section_id);
    if (!sectionIds.length) throw bad('No class has a date sheet yet');
  }
  const sections = [];
  for (const id of sectionIds) sections.push(await computeSection(schoolId, exam, id));
  const sum = (k) => sections.reduce((n, s) => n + s[k], 0);
  const out = { total_students: sum('computed'), computed: sum('computed'), incomplete: sum('incomplete'), passed: sum('passed'), failed: sum('failed'), sections };
  return success(res, out, `Results computed for ${out.computed} student(s)${out.incomplete ? ` (${out.incomplete} incomplete)` : ''}`);
});

// ═══════════════════════════ ANALYTICS ═══════════════════════════
// one definition everywhere: pass % = pass / (pass + fail); averages ignore incomplete rows.
const AVG = `AVG(CASE WHEN er.status <> 'incomplete' THEN er.percentage END)`;
const PASS = `SUM(CASE WHEN er.status='pass' THEN 1 ELSE 0 END)`;
const FAIL = `SUM(CASE WHEN er.status='fail' THEN 1 ELSE 0 END)`;

exports.getOverview = handle(async (req, res) => {
  const { schoolId } = req.user;
  const egId = needExamParam(req);
  const p = { egId: U(egId), sid: U(schoolId) };
  const [stats, topper] = await Promise.all([
    query(`SELECT COUNT(*) AS total_appeared, ${PASS} AS total_pass, ${FAIL} AS total_fail,
                  SUM(CASE WHEN er.status='incomplete' THEN 1 ELSE 0 END) AS total_incomplete,
                  ${AVG} AS avg_percentage, MAX(CASE WHEN er.status <> 'incomplete' THEN er.percentage END) AS highest_percentage
           FROM exam_results er ${EXAM_JOIN} WHERE er.exam_group_id=@egId AND er.school_id=@sid`, p),
    query(`SELECT TOP 1 er.student_id, (s.first_name + ' ' + ISNULL(s.last_name,'')) AS full_name, er.percentage, g.name AS grade_name, sec.name AS section_name
           FROM exam_results er ${EXAM_JOIN}
           JOIN students s ON s.id = er.student_id JOIN sections sec ON sec.id = er.section_id JOIN grades g ON g.id = sec.grade_id
           WHERE er.exam_group_id=@egId AND er.school_id=@sid AND er.status='pass'
           ORDER BY er.percentage DESC, er.total_marks DESC`, p),
  ]);
  const s = stats.recordset[0];
  return success(res, {
    total_appeared: s.total_appeared || 0, total_pass: s.total_pass || 0, total_fail: s.total_fail || 0, total_incomplete: s.total_incomplete || 0,
    pass_percent: ratio(s.total_pass || 0, (s.total_pass || 0) + (s.total_fail || 0)),
    avg_percentage: pct2(s.avg_percentage), highest_percentage: s.highest_percentage,
    topper: topper.recordset[0] || null,
  }, 'Overview fetched');
});

exports.getClassWise = handle(async (req, res) => {
  const egId = needExamParam(req);
  const r = await query(`
    SELECT g.id AS grade_id, g.name AS grade_name, COUNT(*) AS total_students, ${PASS} AS pass_count, ${FAIL} AS fail_count, ${AVG} AS avg_percentage
    FROM exam_results er ${EXAM_JOIN} JOIN sections sec ON sec.id = er.section_id JOIN grades g ON g.id = sec.grade_id
    WHERE er.exam_group_id=@egId AND er.school_id=@sid
    GROUP BY g.id, g.name, g.numeric_order ORDER BY g.numeric_order`, { egId: U(egId), sid: U(req.user.schoolId) });
  return success(res, r.recordset.map((x) => ({ ...x, avg_percentage: pct2(x.avg_percentage), pass_percent: ratio(x.pass_count, x.pass_count + x.fail_count) })), 'Class-wise analysis fetched');
});

exports.getSectionWise = handle(async (req, res) => {
  const egId = needExamParam(req);
  const r = await query(`
    SELECT sec.id AS section_id, sec.name AS section_name, g.name AS grade_name, COUNT(*) AS total_students, ${PASS} AS pass_count, ${FAIL} AS fail_count, ${AVG} AS avg_percentage
    FROM exam_results er ${EXAM_JOIN} JOIN sections sec ON sec.id = er.section_id JOIN grades g ON g.id = sec.grade_id
    WHERE er.exam_group_id=@egId AND er.school_id=@sid
    GROUP BY sec.id, sec.name, g.name, g.numeric_order ORDER BY g.numeric_order, sec.name`, { egId: U(egId), sid: U(req.user.schoolId) });
  return success(res, r.recordset.map((x) => ({ ...x, avg_percentage: pct2(x.avg_percentage), pass_percent: ratio(x.pass_count, x.pass_count + x.fail_count) })), 'Section-wise analysis fetched');
});

exports.getSectionResults = handle(async (req, res) => {
  const { schoolId } = req.user;
  const egId = needExamParam(req);
  const { section_id } = req.query;
  if (!section_id) throw bad('exam_group_id and section_id are required');
  R.needUuid(section_id, 'section_id');
  const r = await query(`
    SELECT er.student_id, (s.first_name + ' ' + ISNULL(s.last_name,'')) AS student_name, enr.roll_no,
           er.total_marks, er.max_total, er.percentage, er.grade, er.class_rank, er.school_rank, er.status
    FROM exam_results er ${EXAM_JOIN}
    JOIN students s ON s.id = er.student_id
    LEFT JOIN enrolments enr ON enr.student_id=er.student_id AND enr.section_id=er.section_id AND enr.academic_year_id=eg.academic_year_id AND enr.is_active=1 AND enr.deleted_at IS NULL
    WHERE er.exam_group_id=@egId AND er.section_id=@secId AND er.school_id=@sid
    ORDER BY ISNULL(er.class_rank, 999999), TRY_CAST(enr.roll_no AS INT)`, { egId: U(egId), secId: U(section_id), sid: U(schoolId) });
  return success(res, r.recordset, 'Section results fetched');
});

// subject-wise: only students who actually sat the paper count (present); absent/malpractice shown separately; exempt ignored
const SUBJ_FROM = `
  FROM exam_subjects es
  JOIN exam_groups eg ON eg.id = es.exam_group_id AND eg.school_id = es.school_id AND eg.deleted_at IS NULL
  JOIN subjects s ON s.id = es.subject_id
  JOIN exam_marks em ON em.exam_subject_id = es.id AND em.status NOT IN ('leave','tc','exempted')
  WHERE es.exam_group_id=@egId AND es.school_id=@sid AND es.deleted_at IS NULL AND es.is_grade_only = 0`;
const SUBJ_AGG = `
  COUNT(em.id) AS total_attempted,
  SUM(CASE WHEN em.status IN ('absent','malpractice') THEN 1 ELSE 0 END) AS absent_count,
  SUM(CASE WHEN em.status='present' THEN 1 ELSE 0 END) AS present_count,
  SUM(CASE WHEN em.status='present' AND em.marks_obtained >= es.passing_marks THEN 1 ELSE 0 END) AS pass_count,
  AVG(CASE WHEN em.status='present' AND em.marks_obtained IS NOT NULL THEN (em.marks_obtained / NULLIF(es.max_marks,0)) * 100 END) AS avg_percentage`;

exports.getSubjectWise = handle(async (req, res) => {
  const egId = needExamParam(req);
  const r = await query(`
    SELECT s.id AS subject_id, s.name AS subject_name, ${SUBJ_AGG},
           MAX(CASE WHEN em.status='present' THEN em.marks_obtained END) AS highest_marks,
           MIN(CASE WHEN em.status='present' THEN em.marks_obtained END) AS lowest_marks,
           MAX(CASE WHEN em.status='present' THEN (em.marks_obtained / NULLIF(es.max_marks,0)) * 100 END) AS highest_percent,
           MIN(CASE WHEN em.status='present' THEN (em.marks_obtained / NULLIF(es.max_marks,0)) * 100 END) AS lowest_percent
    ${SUBJ_FROM}
    GROUP BY s.id, s.name ORDER BY s.name`, { egId: U(egId), sid: U(req.user.schoolId) });
  return success(res, r.recordset.map((x) => ({
    ...x, avg_percentage: pct2(x.avg_percentage), highest_percent: pct2(x.highest_percent), lowest_percent: pct2(x.lowest_percent),
    pass_percent: ratio(x.pass_count, x.present_count),
  })), 'Subject-wise analysis fetched');
});

exports.getTeacherWise = handle(async (req, res) => {
  const egId = needExamParam(req);
  const r = await query(`
    SELECT u.id AS teacher_user_id, ISNULL(u.full_name, 'Unassigned') AS teacher_name, s.name AS subject_name,
           g.name AS grade_name, sec.name AS section_name, es.is_grade_only, ${SUBJ_AGG}
    FROM exam_subjects es
    JOIN exam_groups eg ON eg.id = es.exam_group_id AND eg.school_id = es.school_id AND eg.deleted_at IS NULL
    JOIN subjects s ON s.id = es.subject_id
    JOIN sections sec ON sec.id = es.section_id JOIN grades g ON g.id = sec.grade_id
    JOIN exam_marks em ON em.exam_subject_id = es.id AND em.status NOT IN ('leave','tc','exempted')
    OUTER APPLY (SELECT TOP 1 te.teacher_id FROM timetable_entries te
                 WHERE te.section_id = es.section_id AND te.subject_id = es.subject_id AND te.school_id = es.school_id
                 GROUP BY te.teacher_id ORDER BY COUNT(*) DESC) assigned
    LEFT JOIN users u ON u.id = assigned.teacher_id
    WHERE es.exam_group_id=@egId AND es.school_id=@sid AND es.deleted_at IS NULL AND es.is_grade_only = 0
    GROUP BY u.id, u.full_name, s.name, g.name, sec.name, es.is_grade_only
    ORDER BY ISNULL(u.full_name, 'zzz'), g.name, sec.name`, { egId: U(egId), sid: U(req.user.schoolId) });
  return success(res, r.recordset.map((x) => ({ ...x, avg_percentage: pct2(x.avg_percentage), pass_percent: ratio(x.pass_count, x.present_count) })), 'Teacher-wise analysis fetched');
});

exports.getToppers = handle(async (req, res) => {
  const egId = needExamParam(req);
  const { grade_id, limit } = req.query;
  if (grade_id) R.needUuid(grade_id, 'grade_id');
  const top = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const r = await query(`
    SELECT TOP (@top) er.student_id, (s.first_name + ' ' + ISNULL(s.last_name,'')) AS student_name, er.percentage, er.grade, er.class_rank, er.school_rank,
           g.name AS grade_name, sec.name AS section_name, enr.roll_no
    FROM exam_results er ${EXAM_JOIN}
    JOIN students s ON s.id = er.student_id JOIN sections sec ON sec.id = er.section_id JOIN grades g ON g.id = sec.grade_id
    LEFT JOIN enrolments enr ON enr.student_id = er.student_id AND enr.section_id = er.section_id AND enr.academic_year_id = eg.academic_year_id AND enr.is_active=1 AND enr.deleted_at IS NULL
    WHERE er.exam_group_id=@egId AND er.school_id=@sid AND er.status='pass' AND (@gradeId IS NULL OR g.id=@gradeId)
    ORDER BY er.percentage DESC, er.total_marks DESC`,
    { top: { type: sql.Int, value: top }, gradeId: U(grade_id || null), egId: U(egId), sid: U(req.user.schoolId) });
  return success(res, r.recordset, 'Toppers fetched');
});

// ═══════════════════════════ STUDENT VIEWS ═══════════════════════════
// students (req.student) only ever see published exams; staff see everything.
exports.getStudentTrend = handle(async (req, res) => {
  const { schoolId } = req.user;
  R.needUuid(req.params.studentId, 'student id');
  const r = await query(`
    SELECT eg.id AS exam_group_id, eg.name AS exam_name, eg.exam_type, eg.start_date, er.percentage, er.grade, er.class_rank, er.school_rank, er.status
    FROM exam_results er ${EXAM_JOIN}
    WHERE er.student_id=@stuId AND er.school_id=@sid AND (@onlyPub = 0 OR eg.status='published')
    ORDER BY eg.start_date ASC`, { stuId: U(req.params.studentId), sid: U(schoolId), onlyPub: { type: sql.Bit, value: isStudent(req) ? 1 : 0 } });
  return success(res, r.recordset, 'Student exam trend fetched');
});

exports.getStudentReportCard = handle(async (req, res) => {
  const { schoolId } = req.user;
  const { studentId } = req.params;
  R.needUuid(studentId, 'student id');
  const examId = needExamParam(req);
  const exam = await examFor(req, examId);
  const p = { egId: U(exam.id), stuId: U(studentId), sid: U(schoolId) };
  const o = await query(`SELECT total_marks, max_total, percentage, grade, class_rank, school_rank, status FROM exam_results WHERE exam_group_id=@egId AND student_id=@stuId AND school_id=@sid`, p);
  if (!o.recordset.length) throw notFound('Result not computed for this student yet');
  const subs = await query(`
    SELECT s.name AS subject_name, em.marks_obtained, em.grade_obtained, em.status, es.max_marks, es.passing_marks, es.is_grade_only
    FROM exam_marks em JOIN exam_subjects es ON es.id = em.exam_subject_id JOIN subjects s ON s.id = es.subject_id
    WHERE es.exam_group_id=@egId AND em.student_id=@stuId AND em.school_id=@sid AND es.deleted_at IS NULL
    ORDER BY es.exam_date, es.start_time, s.name`, p);
  return success(res, { ...o.recordset[0], exam_status: exam.status, subjects: subs.recordset }, 'Report card fetched');
});

// ═══════════════════════════ PDFs (rendered on demand, never stored) ═══════════════════════════
exports.downloadReportCardPdf = handle(async (req, res) => {
  const { schoolId } = req.user;
  R.needUuid(req.params.studentId, 'student id');
  const examId = needExamParam(req);
  const { buffer, filename } = await reportCardPdf(schoolId, req.params.studentId, examId, { requirePublished: isStudent(req) });
  return sendPdf(res, buffer, filename);
});

exports.downloadBulkReportCards = handle(async (req, res) => {
  const { schoolId } = req.user;
  const examId = needExamParam(req);
  const { section_id } = req.query;
  if (!section_id) throw bad('section_id and exam_group_id are required');
  R.needUuid(section_id, 'section_id');
  const { buffer, filename, count } = await bulkReportCardsPdf(schoolId, section_id, examId);
  res.setHeader('X-Report-Count', String(count));
  res.setHeader('Access-Control-Expose-Headers', 'X-Report-Count');
  return sendPdf(res, buffer, filename);
});
