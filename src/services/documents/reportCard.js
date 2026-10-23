// src/services/documents/reportCard.js - premium report card (single + whole-section bulk), in-memory PDF
const { query, queryOne, sql } = require('../../config/db');
const K = require('./kit');
const { M, CW, INK, MUTED, FAINT, LINE } = K;
const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

const pct = (m, max) => (max > 0 && m !== null && m !== undefined && m !== '' ? `${((Number(m) / Number(max)) * 100).toFixed(1)}%` : '-');
const FAIL = '#b91c1c';

// exam_results.status holds 'pass' | 'fail' | 'incomplete' after computing, but publishing overwrites it with
// 'published' / 'draft'. So the Pass/Fail shown on the card is derived from the marks (same rule as the result compute).
function resultOf(overall, subjects) {
  if (['pass', 'fail', 'incomplete'].includes(overall.status)) return overall.status;
  const failed = subjects.some((s) => (s.status === 'absent') || (!s.is_grade_only && s.marks_obtained !== null && s.marks_obtained !== undefined && Number(s.marks_obtained) < Number(s.passing_marks)));
  return failed ? 'fail' : 'pass';
}

// Official report card: full A4, single school theme, school text in header + footer
const LABEL = { absent: ['AB', 'Absent'], malpractice: ['MP', 'Malpractice'], leave: ['L', 'Leave'], tc: ['TC', 'TC'], exempted: ['EX', 'Exempt'] };
const EXEMPT_ST = new Set(['leave', 'tc', 'exempted']);

function drawReportCardPage(doc, brand, { student, guardian, examName, overall, subjects, gradingScale, photo, publishedAt, draft }) {
  const { width: W, height: H } = doc.page;
  const result = resultOf(overall, subjects);
  let y = K.drawHeader(doc, brand);
  y = K.titleBand(doc, brand, y, 'Report Card', examName || 'Examination');

  // ── student particulars (formal grid + photo) ──
  const rowH = 23, gw = CW - 84;
  const guardianText = guardian ? `${guardian.full_name}${guardian.relation ? ' (' + guardian.relation + ')' : ''}` : '-';
  const gender = student.gender ? String(student.gender).charAt(0).toUpperCase() + String(student.gender).slice(1).toLowerCase() : '-';
  const gy = K.infoGrid(doc, brand, {
    x: M, y, w: gw, rowH,
    rows: [
      [['Student Name', student.student_name], ['Admission No', student.admission_no]],
      [['Class & Section', `${student.class_name || '-'}${student.section_name ? ' (' + student.section_name + ')' : ''}`], ['Roll No', student.roll_no]],
      [['Date of Birth', student.date_of_birth ? K.fmtDate(student.date_of_birth, true) : '-'], ['Gender', gender]],
      [['Parent / Guardian', guardianText], ['Contact', guardian?.phone]],
    ],
  });
  K.avatar(doc, brand, photo, student.student_name, M + gw + 12, y, 72, gy - y);
  y = gy + 14;

  // ── scholastic areas ──
  const scholastic = subjects.filter((s) => !s.is_grade_only);
  const co = subjects.filter((s) => s.is_grade_only);
  if (scholastic.length) {
    y = K.sectionTitle(doc, brand, 'Scholastic areas', M, y, CW);
    const rows = scholastic.map((s, i) => {
      const lab = LABEL[s.status], exempt = EXEMPT_ST.has(s.status), failingSt = !!lab && !exempt;
      const fail = !lab && s.marks_obtained !== null && s.marks_obtained !== undefined && Number(s.marks_obtained) < Number(s.passing_marks);
      return [
        { text: String(i + 1), color: MUTED },
        { text: s.subject_name, bold: true },
        { text: String(s.max_marks), color: MUTED },
        { text: String(s.passing_marks ?? '-'), color: MUTED },
        { text: lab ? lab[0] : (s.marks_obtained ?? '-'), bold: true, color: fail || failingSt ? FAIL : INK },
        { text: lab ? '-' : pct(s.marks_obtained, s.max_marks), color: MUTED },
        { text: lab ? lab[1] : fail ? 'Fail' : 'Pass', bold: true, color: exempt ? MUTED : fail || failingSt ? FAIL : brand.deep },
      ];
    });
    const w = [30, CW - 30 - 62 - 62 - 76 - 58 - 62, 62, 62, 76, 58, 62];
    y = K.table(doc, brand, {
      y, rows, rowH: 18.5,
      cols: [{ label: 'No.', w: w[0] }, { label: 'Subject', w: w[1] }, { label: 'Max', w: w[2], align: 'center' }, { label: 'Pass', w: w[3], align: 'center' }, { label: 'Obtained', w: w[4], align: 'center' }, { label: 'Percent', w: w[5], align: 'center' }, { label: 'Result', w: w[6], align: 'center' }],
      foot: [{ text: '' }, { text: 'GRAND TOTAL', bold: true }, { text: String(overall.max_total ?? '-'), bold: true }, { text: '' }, { text: String(overall.total_marks ?? '-'), bold: true }, { text: `${overall.percentage ?? '-'}%`, bold: true }, { text: result.toUpperCase(), bold: true, color: result === 'fail' ? FAIL : result === 'incomplete' ? MUTED : brand.deep }],
    });
    y += 13;
  }
  if (co.length) {
    y = K.sectionTitle(doc, brand, 'Co-scholastic / graded areas', M, y, CW);
    const rows = co.map((s, i) => [{ text: String(i + 1), color: MUTED }, { text: s.subject_name, bold: true }, { text: LABEL[s.status] ? LABEL[s.status][0] : (s.grade_obtained || '-'), bold: true, color: brand.deep }]);
    y = K.table(doc, brand, { y, rows, rowH: 18.5, cols: [{ label: 'No.', w: 30 }, { label: 'Area', w: CW - 30 - 110 }, { label: 'Grade', w: 110, align: 'center' }] });
    y += 13;
  }

  // ── result summary ──
  const failed = result === 'fail', incomplete = result === 'incomplete';
  const cells = [['Percentage', `${overall.percentage ?? '-'}%`], ['Overall Grade', overall.grade || '-'], ['Class Rank', overall.class_rank ? `#${overall.class_rank}` : '-'], ['School Rank', overall.school_rank ? `#${overall.school_rank}` : '-'], ['Result', result.toUpperCase()]];
  const cw = CW / cells.length, sh = 40;
  cells.forEach(([label, value], i) => {
    const x = M + i * cw, last = i === cells.length - 1;
    const rf = failed ? FAIL : incomplete ? '#6b7280' : brand.color;
    doc.rect(x, y, cw, sh).fillAndStroke(last ? rf : brand.softer, last ? rf : LINE);
    doc.font('Helvetica-Bold').fontSize(6.4).fillColor(last ? (failed || incomplete ? '#ffffff' : brand.on) : FAINT).text(label.toUpperCase(), x, y + 7, { width: cw, align: 'center', characterSpacing: 0.7, lineBreak: false });
    doc.font('Times-Bold').fontSize(15).fillColor(last ? (failed || incomplete ? '#ffffff' : brand.on) : brand.deep).text(String(value), x, y + 18, { width: cw, align: 'center', lineBreak: false });
  });
  doc.rect(M, y, CW, sh).lineWidth(0.9).strokeColor(brand.color).stroke();
  y += sh + 12;

  // ── grading scale ──
  if (gradingScale && gradingScale.length) {
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(FAINT).text('GRADING SCALE', M, y, { characterSpacing: 0.7, lineBreak: false });
    y += 10;
    const n = Math.min(gradingScale.length, 8), gcw = CW / n;
    gradingScale.slice(0, n).forEach((g, i) => {
      doc.rect(M + i * gcw, y, gcw, 20).fillAndStroke(brand.softer, LINE);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(brand.deep).text(g.grade_label, M + i * gcw, y + 3, { width: gcw, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(6.3).fillColor(MUTED).text(`${g.min_percent} - ${g.max_percent}%`, M + i * gcw, y + 12, { width: gcw, align: 'center', lineBreak: false });
    });
    y += 20 + 12;
  }

  // ── remarks + issue date ──
  const rh = 36, rw = CW * 0.7;
  doc.rect(M, y, rw, rh).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(6.4).fillColor(FAINT).text("CLASS TEACHER'S REMARKS", M + 6, y + 4.5, { characterSpacing: 0.5, lineBreak: false });
  doc.rect(M + rw, y, CW - rw, rh).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(6.4).fillColor(FAINT).text('RESULT PUBLISHED ON', M + rw + 6, y + 4.5, { characterSpacing: 0.5, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(publishedAt ? K.fmtDate(publishedAt, true) : '-', M + rw + 6, y + 15, { lineBreak: false });
  y += rh;

  // ── signatures (a new page if the content ran long) ──
  let sy = Math.max(y + 46, H - 118);
  if (sy > K.contentLimit(doc) - 4) { doc.addPage(); sy = 120; }
  const sw = (CW - 50) / 3;
  ['Class Teacher', 'Examination In-Charge', 'Principal'].forEach((l, i) => K.signatureLine(doc, l, M + i * (sw + 25), sy, sw));
  if (draft) K.stamp(doc, 'DRAFT', '#6b7280'); // staff preview of an unpublished exam
}

const STUDENT_SQL = `SELECT s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name, s.admission_no, s.photo_url,
        s.date_of_birth, s.gender, g.name AS class_name, sec.name AS section_name, e.roll_no
 FROM students s
 LEFT JOIN enrolments e ON e.student_id = s.id AND e.school_id=@sid AND e.is_active=1 AND e.deleted_at IS NULL
 LEFT JOIN sections sec ON sec.id = e.section_id
 LEFT JOIN grades g ON g.id = sec.grade_id
 WHERE s.id=@uid AND s.school_id=@sid`;
const GUARDIAN_SQL = `SELECT TOP 1 relation, full_name, phone FROM student_guardians WHERE student_id=@uid AND is_primary=1 AND deleted_at IS NULL`;
const SUBJECTS_SQL = `SELECT sub.name AS subject_name, em.marks_obtained, em.grade_obtained, em.status, es.max_marks, es.passing_marks, es.is_grade_only
 FROM exam_marks em JOIN exam_subjects es ON es.id = em.exam_subject_id JOIN subjects sub ON sub.id = es.subject_id
 WHERE es.exam_group_id=@egId AND em.student_id=@uid AND em.school_id=@sid AND es.deleted_at IS NULL
 ORDER BY es.exam_date, es.start_time, sub.name`;

async function loadStudentCard(schoolId, studentId, examGroupId, overall) {
  const [student, guardian, subjects] = await Promise.all([
    queryOne(STUDENT_SQL, { uid: U(studentId), sid: U(schoolId) }),
    queryOne(GUARDIAN_SQL, { uid: U(studentId) }),
    query(SUBJECTS_SQL, { egId: U(examGroupId), uid: U(studentId), sid: U(schoolId) }),
  ]);
  if (!student) throw K.httpError(404, 'Student not found');
  const photo = await K.fetchImage(student.photo_url);
  return { student, guardian, subjects: subjects.recordset, photo, overall };
}

async function loadCommon(schoolId, examGroupId, { requirePublished = false } = {}) {
  const [brand, exam, scale] = await Promise.all([
    K.getBrand(schoolId),
    queryOne(`SELECT * FROM exam_groups WHERE id=@id AND school_id=@sid AND deleted_at IS NULL`, { id: U(examGroupId), sid: U(schoolId) }),
    query(`SELECT grade_label, min_percent, max_percent FROM grading_scale WHERE school_id=@sid ORDER BY min_percent DESC`, { sid: U(schoolId) }),
  ]);
  if (!exam) throw K.httpError(404, 'Exam not found');
  if (requirePublished && exam.status !== 'published') throw K.httpError(403, 'This result has not been published yet');
  const published = exam.status === 'published';
  return { brand, examName: exam.name, gradingScale: scale.recordset, publishedAt: published ? (exam.published_at || exam.updated_at) : null, draft: !published };
}

async function reportCardPdf(schoolId, studentId, examGroupId, opts = {}) {
  const common = await loadCommon(schoolId, examGroupId, opts);
  const overall = await queryOne(
    `SELECT total_marks, max_total, percentage, grade, class_rank, school_rank, status
     FROM exam_results WHERE exam_group_id=@egId AND student_id=@uid AND school_id=@sid`,
    { egId: U(examGroupId), uid: U(studentId), sid: U(schoolId) }
  );
  if (!overall) throw K.httpError(404, 'Result not computed for this student yet');
  const card = await loadStudentCard(schoolId, studentId, examGroupId, overall);
  const doc = K.createDoc(common.brand, { title: `Report Card - ${card.student.student_name}` });
  drawReportCardPage(doc, common.brand, { ...card, examName: common.examName, gradingScale: common.gradingScale, publishedAt: common.publishedAt, draft: common.draft });
  K.drawFooters(doc, common.brand, { ref: common.examName || '' });
  return { buffer: await K.finish(doc), filename: `ReportCard_${K.safeName(card.student.student_name)}_${K.safeName(common.examName)}` };
}

// small concurrency pool (photos are downloaded in parallel, not one by one)
async function mapPool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// whole section in 4 queries (students, guardians, marks, overall) instead of 3 per student
async function bulkReportCardsPdf(schoolId, sectionId, examGroupId) {
  const p = { egId: U(examGroupId), secId: U(sectionId), sid: U(schoolId) };
  const [common, resR, stuR, gR, mR] = await Promise.all([
    loadCommon(schoolId, examGroupId),
    query(`SELECT student_id, total_marks, max_total, percentage, grade, class_rank, school_rank, status FROM exam_results
           WHERE exam_group_id=@egId AND section_id=@secId AND school_id=@sid ORDER BY ISNULL(class_rank, 999999), student_id`, p),
    query(`SELECT s.id AS student_id, s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name, s.admission_no, s.photo_url, s.date_of_birth, s.gender,
                  g.name AS class_name, sec.name AS section_name, e.roll_no
           FROM exam_results er JOIN students s ON s.id = er.student_id
           JOIN sections sec ON sec.id = er.section_id JOIN grades g ON g.id = sec.grade_id
           LEFT JOIN enrolments e ON e.student_id = s.id AND e.section_id = er.section_id AND e.school_id=@sid AND e.is_active=1 AND e.deleted_at IS NULL
           WHERE er.exam_group_id=@egId AND er.section_id=@secId AND er.school_id=@sid`, p),
    query(`SELECT student_id, relation, full_name, phone FROM (
             SELECT sg.student_id, sg.relation, sg.full_name, sg.phone, ROW_NUMBER() OVER (PARTITION BY sg.student_id ORDER BY sg.full_name) AS rn
             FROM student_guardians sg WHERE sg.is_primary=1 AND sg.deleted_at IS NULL
               AND sg.student_id IN (SELECT student_id FROM exam_results WHERE exam_group_id=@egId AND section_id=@secId AND school_id=@sid)) x WHERE rn = 1`, p),
    query(`SELECT em.student_id, sub.name AS subject_name, em.marks_obtained, em.grade_obtained, em.status, es.max_marks, es.passing_marks, es.is_grade_only
           FROM exam_marks em JOIN exam_subjects es ON es.id = em.exam_subject_id JOIN subjects sub ON sub.id = es.subject_id
           WHERE es.exam_group_id=@egId AND es.section_id=@secId AND es.school_id=@sid AND es.deleted_at IS NULL
           ORDER BY es.exam_date, es.start_time, sub.name`, p),
  ]);
  const rows = resR.recordset;
  if (!rows.length) throw K.httpError(404, 'No computed results found for this section');
  const key = (id) => String(id).toLowerCase();
  const stuMap = new Map(stuR.recordset.map((x) => [key(x.student_id), x]));
  const gMap = new Map(gR.recordset.map((x) => [key(x.student_id), x]));
  const subMap = new Map();
  mR.recordset.forEach((m) => { const k = key(m.student_id); if (!subMap.has(k)) subMap.set(k, []); subMap.get(k).push(m); });
  const photos = await mapPool(rows, 6, (r) => K.fetchImage(stuMap.get(key(r.student_id))?.photo_url));

  const doc = K.createDoc(common.brand, { title: `Report Cards - ${common.examName || ''}` });
  rows.forEach((r, i) => {
    const student = stuMap.get(key(r.student_id)); if (!student) return;
    if (i > 0) doc.addPage();
    drawReportCardPage(doc, common.brand, {
      student, guardian: gMap.get(key(r.student_id)) || null, subjects: subMap.get(key(r.student_id)) || [], photo: photos[i], overall: r,
      examName: common.examName, gradingScale: common.gradingScale, publishedAt: common.publishedAt, draft: common.draft,
    });
  });
  K.drawFooters(doc, common.brand, { ref: common.examName || '' });
  return { buffer: await K.finish(doc), count: rows.length, filename: `ReportCards_${K.safeName(common.examName)}_${rows.length}` };
}

module.exports = { reportCardPdf, bulkReportCardsPdf, drawReportCardPage };
