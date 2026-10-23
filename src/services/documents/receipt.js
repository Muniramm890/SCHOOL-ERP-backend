// src/services/documents/receipt.js - premium fee receipt (in-memory PDF)
const { queryOne, query, sql } = require('../../config/db');
const K = require('./kit');
const { W, M, CW, INK, MUTED, FAINT } = K;
const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

async function drawReceipt(doc, brand, { payment, student, items, photo }) {
  const isVoid = !!payment.is_void;
  let y = K.drawHeader(doc, brand, {
    badge: 'Fee Receipt',
    meta: [`No. ${payment.receipt_no}`, K.fmtDate(payment.payment_date, true), isVoid ? 'STATUS: VOID' : 'STATUS: PAID'].slice(0, 3),
  });

  // ── two info cards ──
  const h = 92, wl = 262, gap = 12, wr = CW - wl - gap;
  K.card(doc, M, y, wl, h, { fill: brand.softer });
  K.avatar(doc, brand, photo, student.student_name, M + 12, y + 12, 52, 62);
  const sx = M + 76, sw = wl - 88;
  doc.font('Helvetica').fontSize(6.6).fillColor(FAINT).text('RECEIVED FROM', sx, y + 12, { characterSpacing: 0.5, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(student.student_name || '-', sx, y + 22, { width: sw, lineBreak: false, ellipsis: true });
  const cls = `${student.class_name || '-'}${student.section_name ? ' (' + student.section_name + ')' : ''}`;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`Class: ${cls}`, sx, y + 40, { width: sw, lineBreak: false })
    .text(`Admission No: ${student.admission_no || '-'}`, sx, y + 52, { width: sw, lineBreak: false })
    .text(`Roll No: ${student.roll_no || '-'}`, sx, y + 64, { width: sw, lineBreak: false });

  const rx = M + wl + gap;
  K.card(doc, rx, y, wr, h);
  const cw2 = (wr - 36) / 2, txn = payment.razorpay_payment_id || payment.transaction_ref;
  K.kv(doc, 'Receipt No', payment.receipt_no, rx + 14, y + 12, cw2);
  K.kv(doc, 'Payment Date', K.fmtDate(payment.payment_date), rx + 22 + cw2, y + 12, cw2);
  K.kv(doc, 'Payment Mode', String(payment.payment_method || 'Cash').toUpperCase(), rx + 14, y + 38, cw2);
  K.kv(doc, 'Transaction / Ref', txn || payment.bank_name || '-', rx + 22 + cw2, y + 38, cw2);
  if (txn && payment.bank_name) K.kv(doc, 'Bank / Gateway', payment.bank_name, rx + 14, y + 66, wr - 28, { size: 8 });
  y += h + 18;

  // ── fee table ──
  y = K.sectionTitle(doc, brand, 'Fee details', M, y, CW);
  const rows = (items && items.length ? items : [{ category_name: 'Fee Payment', amount_paise: payment.amount_paise }]).map((it, i) => [
    { text: String(i + 1), color: MUTED },
    it.discount_paise > 0
      ? { text: it.category_name, bold: true, sub: `Includes discount of ${K.money(it.discount_paise / 100)}`, subColor: '#dc2626' }
      : { text: it.category_name, bold: true },
    { text: K.money(it.amount_paise / 100), bold: true },
  ]);
  y = K.table(doc, brand, { y, cols: [{ label: '#', w: 36 }, { label: 'Description', w: CW - 36 - 130 }, { label: 'Amount', w: 130, align: 'right' }], rows, rowH: 21 });
  y += 14;

  // ── total + words ──
  const tw = 214;
  K.card(doc, W - M - tw, y, tw, 52, { fill: brand.soft, stroke: brand.color });
  doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text(isVoid ? 'AMOUNT (CANCELLED)' : 'TOTAL AMOUNT PAID', W - M - tw, y + 10, { width: tw, align: 'center', characterSpacing: 0.8, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(18).fillColor(isVoid ? '#dc2626' : brand.deep).text(K.money(payment.amount_paise / 100), W - M - tw, y + 24, { width: tw, align: 'center', lineBreak: false });
  const lw = CW - tw - 16;
  doc.font('Helvetica').fontSize(6.6).fillColor(FAINT).text('AMOUNT IN WORDS', M, y + 4, { characterSpacing: 0.5, lineBreak: false });
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(INK).text(K.amountInWords(payment.amount_paise / 100), M, y + 15, { width: lw });
  if (payment.remarks) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Remarks: ${payment.remarks}`, M, doc.y + 6, { width: lw });
  y += 52 + 48;

  // ── signatures ──
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Collected by', M, y - 34, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(payment.collected_by_name || 'Online Payment System', M, y - 23, { lineBreak: false });
  K.signatureLine(doc, 'Authorised Signatory', W - M - 150, y, 150);

  if (isVoid) K.stamp(doc, 'VOID');
}

async function receiptPdf(schoolId, paymentId, { studentId } = {}) {
  const payment = await queryOne(
    `SELECT fp.*, u.full_name AS collected_by_name
     FROM fee_payments fp LEFT JOIN users u ON u.id = fp.collected_by
     WHERE fp.id=@id AND fp.school_id=@sid AND fp.deleted_at IS NULL`,
    { id: U(paymentId), sid: U(schoolId) }
  );
  if (!payment) throw K.httpError(404, 'Payment not found');
  if (studentId && String(payment.student_id).toLowerCase() !== String(studentId).toLowerCase()) throw K.httpError(403, 'Not allowed');

  const [brand, student, itemsRes] = await Promise.all([
    K.getBrand(schoolId),
    queryOne(
      `SELECT s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name, s.admission_no, s.photo_url,
              g.name AS class_name, sc.name AS section_name, e.roll_no
       FROM students s
       LEFT JOIN enrolments e ON e.student_id = s.id AND e.school_id=@sid AND e.is_active=1
       LEFT JOIN sections sc ON sc.id = e.section_id
       LEFT JOIN grades g ON g.id = sc.grade_id
       WHERE s.id=@uid AND s.school_id=@sid`,
      { uid: U(payment.student_id), sid: U(schoolId) }
    ),
    query(
      `SELECT fc.name AS category_name, fpi.amount_paise, fpi.discount_paise
       FROM fee_payment_items fpi JOIN fee_categories fc ON fc.id = fpi.fee_category_id
       WHERE fpi.payment_id=@pid AND fpi.amount_paise > 0`,
      { pid: U(paymentId) }
    ),
  ]);
  if (!student) throw K.httpError(404, 'Student not found');
  const photo = await K.fetchImage(student.photo_url);

  const doc = K.createDoc(brand, { title: `Fee Receipt ${payment.receipt_no}` });
  await drawReceipt(doc, brand, { payment, student, items: itemsRes.recordset || [], photo });
  K.drawFooters(doc, brand, { ref: payment.receipt_no, pageNumbers: false });
  return { buffer: await K.finish(doc), filename: `Receipt_${payment.receipt_no}` };
}

module.exports = { receiptPdf, drawReceipt };
