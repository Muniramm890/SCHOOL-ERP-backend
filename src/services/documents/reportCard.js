// src/services/documents/reportCard.js - premium report card (single + whole-section bulk), in-memory PDF
const { query, queryOne, sql } = require('../../config/db');
const K = require('./kit');
const { M, CW, INK, MUTED, FAINT, LINE } = K;
const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

const pct = (m, max) => (max > 0 && m !== null && m !== undefined && m !== '' ? `${((Number(m) / Number(max)) * 100).toFixed(1)}%` : '-');
const FAIL = '#b91c1c';

// Official report card: full A4, single school theme, school text in header + footer
function drawReportCardPage(doc, brand, { student, guardian, examName, overall, subjects, gradingScale, photo }) {
  const { width: W, height: H } = doc.page;
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
      const ab = s.status === 'absent';
      const fail = !ab && Number(s.marks_obtained) < Number(s.passing_marks);
      return [
        { text: String(i + 1), color: MUTED },
        { text: s.subject_name, bold: true },
        { text: String(s.max_marks), color: MUTED },
        { text: String(s.passing_marks ?? '-'), color: MUTED },
        { text: ab ? 'AB' : (s.marks_obtained ?? '-'), bold: true, color: fail || ab ? FAIL : INK },
        { text: ab ? '-' : pct(s.marks_obtained, s.max_marks), color: MUTED },
        { text: ab ? 'Absent' : fail ? 'Fail' : 'Pass', bold: true, color: ab || fail ? FAIL : brand.deep },
      ];
    });
    const w = [30, CW - 30 - 62 - 62 - 76 - 58 - 62, 62, 62, 76, 58, 62];
    y = K.table(doc, brand, {
      y, rows, rowH: 18.5,
      cols: [{ label: 'No.', w: w[0] }, { label: 'Subject', w: w[1] }, { label: 'Max', w: w[2], align: 'center' }, { label: 'Pass', w: w[3], align: 'center' }, { label: 'Obtained', w: w[4], align: 'center' }, { label: 'Percent', w: w[5], align: 'center' }, { label: 'Result', w: w[6], align: 'center' }],
      foot: [{ text: '' }, { text: 'GRAND TOTAL', bold: true }, { text: String(overall.max_total ?? '-'), bold: true }, { text: '' }, { text: String(overall.total_marks ?? '-'), bold: true }, { text: `${overall.percentage ?? '-'}%`, bold: true }, { text: (overall.status || '-').toUpperCase(), bold: true, color: overall.status === 'pass' ? brand.deep : FAIL }],
    });
    y += 13;
  }
  if (co.length) {
    y = K.sectionTitle(doc, brand, 'Co-scholastic / graded areas', M, y, CW);
    const rows = co.map((s, i) => [{ text: String(i + 1), color: MUTED }, { text: s.subject_name, bold: true }, { text: s.status === 'absent' ? 'AB' : (s.grade_obtained || '-'), bold: true, color: brand.deep }]);
    y = K.table(doc, brand, { y, rows, rowH: 18.5, cols: [{ label: 'No.', w: 30 }, { label: 'Area', w: CW - 30 - 110 }, { label: 'Grade', w: 110, align: 'center' }] });
    y += 13;
  }

  // ── result summary ──
  const passed = overall.status === 'pass';
  const cells = [['Percentage', `${overall.percentage ?? '-'}%`], ['Overall Grade', overall.grade || '-'], ['Class Rank', overall.class_rank ? `#${overall.class_rank}` : '-'], ['School Rank', overall.school_rank ? `#${overall.school_rank}` : '-'], ['Result', (overall.status || '-').toUpperCase()]];
  const cw = CW / cells.length, sh = 40;
  cells.forEach(([label, value], i) => {
    const x = M + i * cw, last = i === cells.length - 1;
    doc.rect(x, y, cw, sh).fillAndStroke(last ? (passed ? brand.color : FAIL) : brand.softer, last ? (passed ? brand.color : FAIL) : LINE);
    doc.font('Helvetica-Bold').fontSize(6.4).fillColor(last ? (passed ? brand.on : '#ffffff') : FAINT).text(label.toUpperCase(), x, y + 7, { width: cw, align: 'center', characterSpacing: 0.7, lineBreak: false });
    doc.font('Times-Bold').fontSize(15).fillColor(last ? (passed ? brand.on : '#ffffff') : brand.deep).text(String(value), x, y + 18, { width: cw, align: 'center', lineBreak: false });
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
  doc.font('Helvetica').fontSize(6.4).fillColor(FAINT).text('DATE OF ISSUE', M + rw + 6, y + 4.5, { characterSpacing: 0.5, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(K.fmtDate(new Date(), true), M + rw + 6, y + 15, { lineBreak: false });
  y += rh;

  // ── signatures (a new page if the content ran long) ──
  let sy = Math.max(y + 46, H - 118);
  if (sy > K.contentLimit(doc) - 4) { doc.addPage(); sy = 120; }
  const sw = (CW - 50) / 3;
  ['Class Teacher', 'Examination In-Charge', 'Principal'].forEach((l, i) => K.signatureLine(doc, l, M + i * (sw + 25), sy, sw));
}

const STUDENT_SQL = `SELECT s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name, s.admission_no, s.photo_url,
        s.date_of_birth, s.gender, g.name AS class_name, sec.name AS section_name, e.roll_no
 FROM students s
 LEFT JOIN enrolments e ON e.student_id = s.id AND e.school_id=@sid AND e.is_active=1
 LEFT JOIN sections sec ON sec.id = e.section_id
 LEFT JOIN grades g ON g.id = sec.grade_id
 WHERE s.id=@uid AND s.school_id=@sid`;
const GUARDIAN_SQL = `SELECT TOP 1 relation, full_name, phone FROM student_guardians WHERE student_id=@uid AND is_primary=1 AND deleted_at IS NULL`;
const SUBJECTS_SQL = `SELECT sub.name AS subject_name, em.marks_obtained, em.grade_obtained, em.status, es.max_marks, es.passing_marks, es.is_grade_only
 FROM exam_marks em JOIN exam_subjects es ON es.id = em.exam_subject_id JOIN subjects sub ON sub.id = es.subject_id
 WHERE es.exam_group_id=@egId AND em.student_id=@uid AND em.school_id=@sid ORDER BY sub.name`;

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

async function loadCommon(schoolId, examGroupId) {
  const [brand, examGroup, scale] = await Promise.all([
    K.getBrand(schoolId),
    queryOne(`SELECT name FROM exam_groups WHERE id=@id AND school_id=@sid`, { id: U(examGroupId), sid: U(schoolId) }),
    query(`SELECT grade_label, min_percent, max_percent FROM grading_scale WHERE school_id=@sid ORDER BY sort_order`, { sid: U(schoolId) }),
  ]);
  return { brand, examName: examGroup?.name, gradingScale: scale.recordset };
}

async function reportCardPdf(schoolId, studentId, examGroupId) {
  const overall = await queryOne(
    `SELECT total_marks, max_total, percentage, grade, class_rank, school_rank, status
     FROM exam_results WHERE exam_group_id=@egId AND student_id=@uid AND school_id=@sid`,
    { egId: U(examGroupId), uid: U(studentId), sid: U(schoolId) }
  );
  if (!overall) throw K.httpError(404, 'Result not computed for this student yet');
  const [common, card] = await Promise.all([loadCommon(schoolId, examGroupId), loadStudentCard(schoolId, studentId, examGroupId, overall)]);
  const doc = K.createDoc(common.brand, { title: `Report Card - ${card.student.student_name}` });
  drawReportCardPage(doc, common.brand, { ...card, examName: common.examName, gradingScale: common.gradingScale });
  K.drawFooters(doc, common.brand, { ref: common.examName || '', pageNumbers: false });
  return { buffer: await K.finish(doc), filename: `ReportCard_${K.safeName(card.student.student_name)}_${K.safeName(common.examName)}` };
}

async function bulkReportCardsPdf(schoolId, sectionId, examGroupId) {
  const res = await query(
    `SELECT er.student_id, er.total_marks, er.max_total, er.percentage, er.grade, er.class_rank, er.school_rank, er.status
     FROM exam_results er WHERE er.exam_group_id=@egId AND er.section_id=@secId AND er.school_id=@sid
     ORDER BY ISNULL(er.class_rank, 999999) ASC`,
    { egId: U(examGroupId), secId: U(sectionId), sid: U(schoolId) }
  );
  const rows = res.recordset;
  if (!rows.length) throw K.httpError(404, 'No computed results found for this section');
  const common = await loadCommon(schoolId, examGroupId);
  const doc = K.createDoc(common.brand, { title: `Report Cards - ${common.examName || ''}` });
  for (let i = 0; i < rows.length; i++) {
    const card = await loadStudentCard(schoolId, rows[i].student_id, examGroupId, rows[i]);
    if (i > 0) doc.addPage();
    drawReportCardPage(doc, common.brand, { ...card, examName: common.examName, gradingScale: common.gradingScale });
  }
  K.drawFooters(doc, common.brand, { ref: common.examName || '', pageNumbers: false });
  return { buffer: await K.finish(doc), count: rows.length, filename: `ReportCards_${K.safeName(common.examName)}_${rows.length}` };
}

module.exports = { reportCardPdf, bulkReportCardsPdf, drawReportCardPage };
