// src/services/documents/reportCard.js - premium report card (single + whole-section bulk), in-memory PDF
const { query, queryOne, sql } = require('../../config/db');
const K = require('./kit');
const { W, M, CW, INK, MUTED, FAINT } = K;
const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

const gradeColor = (g) => {
  if (['A+', 'A'].includes(g)) return '#16a34a';
  if (['B+', 'B'].includes(g)) return '#2563eb';
  if (g === 'C') return '#ca8a04';
  return '#dc2626';
};
const pct = (m, max) => (max > 0 && m !== null && m !== undefined && m !== '' ? `${((Number(m) / Number(max)) * 100).toFixed(1)}%` : '-');

function drawReportCardPage(doc, brand, { student, guardian, examName, overall, subjects, gradingScale, photo }) {
  let y = K.drawHeader(doc, brand, { badge: 'Report Card', meta: [examName || 'Examination', `${student.class_name || ''}${student.section_name ? ' - ' + student.section_name : ''}`.trim()] });

  // ── student card ──
  K.card(doc, M, y, CW, 76, { fill: brand.softer });
  K.avatar(doc, brand, photo, student.student_name, M + 12, y + 7, 50, 62);
  const gx = M + 76, gw = CW - 90, c3 = gw / 3;
  K.kv(doc, 'Student Name', student.student_name, gx, y + 10, c3 * 2 - 10, { size: 10.5 });
  K.kv(doc, 'Class & Section', `${student.class_name || '-'}${student.section_name ? ' (' + student.section_name + ')' : ''}`, gx + c3 * 2, y + 10, c3 - 6);
  K.kv(doc, 'Roll No', student.roll_no || '-', gx, y + 42, c3 - 10);
  K.kv(doc, 'Admission No', student.admission_no || '-', gx + c3, y + 42, c3 - 10);
  K.kv(doc, 'Date of Birth', student.date_of_birth ? K.fmtDate(student.date_of_birth) : '-', gx + c3 * 2, y + 42, c3 - 6);
  y += 76 + 6;
  if (guardian) {
    doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(`Guardian: ${guardian.full_name}${guardian.relation ? ' (' + guardian.relation + ')' : ''}${guardian.phone ? '   -   ' + guardian.phone : ''}`, M + 2, y, { width: CW, lineBreak: false });
    y += 12;
  }
  y += 6;

  // ── performance tiles ──
  const passed = overall.status === 'pass';
  const tiles = [
    ['Percentage', `${overall.percentage ?? '-'}%`, brand.deep],
    ['Grade', overall.grade || '-', gradeColor(overall.grade)],
    ['Total Marks', `${overall.total_marks ?? '-'} / ${overall.max_total ?? '-'}`, INK],
    ['Rank', `#${overall.class_rank ?? '-'}  /  #${overall.school_rank ?? '-'}`, INK, 'Class / School'],
  ];
  const gap = 8, tw = (CW - gap * 4) / 5;
  tiles.forEach(([label, value, color, sub], i) => {
    const x = M + i * (tw + gap);
    K.card(doc, x, y, tw, 50, { fill: '#ffffff' });
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(FAINT).text(label.toUpperCase(), x, y + 9, { width: tw, align: 'center', characterSpacing: 0.7, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(sub ? 12 : 15).fillColor(color).text(value, x, y + 21, { width: tw, align: 'center', lineBreak: false });
    if (sub) doc.font('Helvetica').fontSize(6).fillColor(FAINT).text(sub, x, y + 38, { width: tw, align: 'center', lineBreak: false });
  });
  const rx = M + 4 * (tw + gap);
  doc.roundedRect(rx, y, tw, 50, 8).fill(passed ? '#16a34a' : '#dc2626');
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#ffffff').opacity(0.85).text('RESULT', rx, y + 9, { width: tw, align: 'center', characterSpacing: 0.7, lineBreak: false }).opacity(1);
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text((overall.status || '-').toUpperCase(), rx, y + 22, { width: tw, align: 'center', lineBreak: false });
  y += 50 + 16;

  // ── scholastic ──
  const scholastic = subjects.filter((s) => !s.is_grade_only);
  const co = subjects.filter((s) => s.is_grade_only);
  if (scholastic.length) {
    y = K.sectionTitle(doc, brand, 'Academic subjects', M, y, CW);
    const rows = scholastic.map((s) => {
      const ab = s.status === 'absent';
      const fail = !ab && Number(s.marks_obtained) < Number(s.passing_marks);
      return [
        { text: s.subject_name, bold: true },
        { text: ab ? 'AB' : (s.marks_obtained ?? '-'), bold: true },
        { text: String(s.max_marks), color: MUTED },
        { text: ab ? '-' : pct(s.marks_obtained, s.max_marks), color: MUTED },
        { text: ab ? 'Absent' : fail ? 'Fail' : 'Pass', bold: true, color: ab || fail ? '#dc2626' : '#16a34a' },
      ];
    });
    y = K.table(doc, brand, { y, cols: [{ label: 'Subject', w: CW - 290 }, { label: 'Marks', w: 80, align: 'center' }, { label: 'Max', w: 60, align: 'center' }, { label: 'Percent', w: 70, align: 'center' }, { label: 'Result', w: 80, align: 'center' }], rows, rowH: 19 });
    y += 14;
  }
  if (co.length) {
    y = K.sectionTitle(doc, brand, 'Co-scholastic / graded areas', M, y, CW);
    const rows = co.map((s) => [{ text: s.subject_name, bold: true }, { text: s.status === 'absent' ? 'AB' : (s.grade_obtained || '-'), bold: true, color: gradeColor(s.grade_obtained) }]);
    y = K.table(doc, brand, { y, cols: [{ label: 'Area', w: CW - 120 }, { label: 'Grade', w: 120, align: 'center' }], rows, rowH: 19 });
    y += 14;
  }
  if (gradingScale && gradingScale.length) {
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(FAINT).text('GRADING SCALE', M, y, { characterSpacing: 0.6, lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(gradingScale.map((g) => `${g.grade_label}: ${g.min_percent}-${g.max_percent}%`).join('    '), M, y + 10, { width: CW });
  }

  const sy = 762, sw = (CW - 60) / 3;
  ['Class Teacher', 'Examination In-Charge', 'Principal'].forEach((l, i) => K.signatureLine(doc, l, M + i * (sw + 30), sy, sw));
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
