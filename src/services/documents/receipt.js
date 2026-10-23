// src/services/documents/receipt.js - official fee receipt. Half of A4 when it fits, full A4 when there are many fee heads.
const { queryOne, query, sql } = require('../../config/db');
const K = require('./kit');
const { M, CW, INK, MUTED, FAINT } = K;
const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

// draws the receipt, returns the y where the content ends
function drawReceipt(doc, brand, { payment, student, guardian, items }) {
  const c = doc._compact, { width: W, height: H } = doc.page;
  const isVoid = !!payment.is_void;
  let y = K.drawHeader(doc, brand);
  y = K.titleBand(doc, brand, y, isVoid ? 'Fee Receipt - Cancelled' : 'Fee Receipt');

  const txn = payment.razorpay_payment_id || payment.transaction_ref;
  const cls = `${student.class_name || '-'}${student.section_name ? ' (' + student.section_name + ')' : ''}`;
  y = K.infoGrid(doc, brand, {
    y, rowH: c ? 21 : 25,
    rows: [
      [['Receipt No', payment.receipt_no], ['Payment Date', K.fmtDate(payment.payment_date, true)], ['Payment Mode', String(payment.payment_method || 'Cash').toUpperCase()]],
      [['Student Name', student.student_name], ['Class & Section', cls], ['Admission No', student.admission_no]],
      [['Parent / Guardian', guardian ? `${guardian.full_name}${guardian.relation ? ' (' + guardian.relation + ')' : ''}` : '-'], ['Roll No', student.roll_no], ['Transaction / Ref', txn || payment.bank_name || '-']],
    ],
  }) + (c ? 9 : 14);

  const rows = (items && items.length ? items : [{ category_name: 'Fee Payment', amount_paise: payment.amount_paise }]).map((it, i) => [
    { text: String(i + 1), color: MUTED },
    it.discount_paise > 0 ? { text: it.category_name, bold: true, sub: `Includes discount of ${K.money(it.discount_paise / 100)}`, subColor: '#b91c1c' } : { text: it.category_name, bold: true },
    { text: K.money(it.amount_paise / 100), bold: true },
  ]);
  y = K.table(doc, brand, {
    y, rowH: c ? 16 : 20, headH: c ? 17 : 20, rows,
    cols: [{ label: 'S.No', w: 40 }, { label: 'Particulars', w: CW - 40 - 130 }, { label: 'Amount', w: 130, align: 'right' }],
    foot: [{ text: '' }, { text: isVoid ? 'AMOUNT (CANCELLED)' : 'TOTAL AMOUNT PAID', bold: true }, { text: K.money(payment.amount_paise / 100), bold: true, color: isVoid ? '#b91c1c' : brand.deep }],
  });

  y += 7;
  doc.font('Helvetica').fontSize(7.4).fillColor(FAINT).text('AMOUNT IN WORDS:', M, y, { continued: true, characterSpacing: 0.3 });
  doc.font('Times-Italic').fontSize(9.5).fillColor(INK).text(`  ${K.amountInWords(payment.amount_paise / 100)}`, { characterSpacing: 0 });
  if (payment.remarks) { doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(`Remarks: ${payment.remarks}`, M, doc.y + 2, { width: CW }); }
  y = doc.y + (c ? 10 : 22);

  const sy = c ? y + 17 : Math.max(y + 30, H - 150);
  doc.font('Helvetica').fontSize(7.5).fillColor(FAINT).text('COLLECTED BY', M, sy - 22, { characterSpacing: 0.5, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(payment.collected_by_name || 'Online Payment System', M, sy - 12, { lineBreak: false });
  K.signatureLine(doc, 'Authorised Signatory', W - M - 150, sy, 150);
  if (isVoid) K.stamp(doc, 'VOID');
  return sy + 14;
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

  const [brand, student, guardian, itemsRes] = await Promise.all([
    K.getBrand(schoolId),
    queryOne(
      `SELECT s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name, s.admission_no,
              g.name AS class_name, sc.name AS section_name, e.roll_no
       FROM students s
       LEFT JOIN enrolments e ON e.student_id = s.id AND e.school_id=@sid AND e.is_active=1
       LEFT JOIN sections sc ON sc.id = e.section_id
       LEFT JOIN grades g ON g.id = sc.grade_id
       WHERE s.id=@uid AND s.school_id=@sid`,
      { uid: U(payment.student_id), sid: U(schoolId) }
    ),
    queryOne(`SELECT TOP 1 relation, full_name FROM student_guardians WHERE student_id=@uid AND is_primary=1 AND deleted_at IS NULL`, { uid: U(payment.student_id) }),
    query(
      `SELECT fc.name AS category_name, fpi.amount_paise, fpi.discount_paise
       FROM fee_payment_items fpi JOIN fee_categories fc ON fc.id = fpi.fee_category_id
       WHERE fpi.payment_id=@pid AND fpi.amount_paise > 0`,
      { pid: U(paymentId) }
    ),
  ]);
  if (!student) throw K.httpError(404, 'Student not found');
  const data = { payment, student, guardian, items: itemsRes.recordset || [] };
  const title = `Fee Receipt ${payment.receipt_no}`;

  // try half page first; if the content does not fit above the footer, use a full A4 page
  let doc = K.createDoc(brand, { title, half: true });
  let end = drawReceipt(doc, brand, data);
  if (end > K.contentLimit(doc) || doc.bufferedPageRange().count > 1) { doc = K.createDoc(brand, { title, half: false }); drawReceipt(doc, brand, data); }
  K.drawFooters(doc, brand, { ref: payment.receipt_no });
  return { buffer: await K.finish(doc), filename: `Receipt_${payment.receipt_no}` };
}

module.exports = { receiptPdf, drawReceipt };
