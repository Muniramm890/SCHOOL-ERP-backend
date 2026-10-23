// src/services/documents/payslip.js - premium salary slip (in-memory PDF)
const { queryOne, sql } = require('../../config/db');
const K = require('./kit');
const { W, M, CW, INK, MUTED, FAINT, LINE } = K;
const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (my) => { const [y, m] = String(my || '').split('-'); return MONTHS[+m - 1] ? `${MONTHS[+m - 1]} ${y}` : String(my || ''); };
const num = (n) => Number(n) || 0;

function drawPayslip(doc, brand, slip) {
  let y = K.drawHeader(doc, brand, { badge: 'Salary Slip', meta: [monthLabel(slip.month_year), `Status: ${slip.payment_status || '-'}`] });

  // ── employee card ──
  K.card(doc, M, y, CW, 70, { fill: brand.softer });
  const c3 = (CW - 32) / 3;
  K.kv(doc, 'Employee', slip.staff_name, M + 16, y + 10, c3 - 8);
  K.kv(doc, 'Designation', slip.designation, M + 16 + c3, y + 10, c3 - 8);
  K.kv(doc, 'Department', slip.department, M + 16 + c3 * 2, y + 10, c3 - 8);
  K.kv(doc, 'Pay Period', monthLabel(slip.month_year), M + 16, y + 38, c3 - 8);
  K.kv(doc, 'Days Present', `${slip.present_days ?? '-'} / ${slip.total_days ?? '-'}`, M + 16 + c3, y + 38, c3 - 8);
  K.kv(doc, 'Paid Leave / LOP', `${slip.paid_leave_days ?? 0} / ${slip.lop_days ?? 0}`, M + 16 + c3 * 2, y + 38, c3 - 8);
  y += 70 + 16;

  // ── earnings | deductions ──
  const earn = [['Basic Pay', slip.basic, true], ['HRA', slip.hra], ['DA', slip.da], ['Special Allowance', slip.special_allowance], ['Other Allowance', slip.other_allowance], ['Bonus', slip.bonus_amount]]
    .filter(([, v, always]) => always || num(v) > 0);
  const ded = [['LOP Deduction', slip.lop_deduction], ['Provident Fund (PF)', slip.pf_deduction], ['Professional Tax (PT)', slip.pt_deduction], ['Other Deduction', slip.other_deduction]]
    .filter(([, v]) => num(v) > 0);
  if (!ded.length) ded.push(['No deductions', 0]);

  const gap = 14, cw = (CW - gap) / 2, rowH = 19;
  const side = (x, title, list, totalLabel, total, tone, onTone) => {
    doc.roundedRect(x, y, cw, 20, 5).fill(tone);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(onTone).text(title.toUpperCase(), x + 10, y + 6.5, { characterSpacing: 0.8, lineBreak: false });
    doc.text('AMOUNT', x, y + 6.5, { width: cw - 10, align: 'right', characterSpacing: 0.8, lineBreak: false });
    let yy = y + 20;
    list.forEach(([label, v], i) => {
      if (i % 2 === 0) doc.rect(x, yy, cw, rowH).fill(brand.softer);
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(label, x + 10, yy + 5.5, { width: cw - 110, lineBreak: false });
      doc.font('Helvetica-Bold').text(num(v) ? K.money(v) : '-', x, yy + 5.5, { width: cw - 10, align: 'right', lineBreak: false });
      yy += rowH;
    });
    return { yy, draw: (fy) => {
      doc.rect(x, fy, cw, 22).fill(brand.soft);
      doc.moveTo(x, fy).lineTo(x + cw, fy).lineWidth(0.8).strokeColor(tone).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(totalLabel, x + 10, fy + 7, { lineBreak: false });
      doc.text(K.money(total), x, fy + 7, { width: cw - 10, align: 'right', lineBreak: false });
    } };
  };
  const L = side(M, 'Earnings', earn, 'Gross Earnings', slip.gross_salary, brand.color, brand.on);
  const R = side(M + cw + gap, 'Deductions', ded, 'Total Deductions', slip.total_deduction, '#475569', '#ffffff');
  const fy = Math.max(L.yy, R.yy);
  L.draw(fy); R.draw(fy);
  y = fy + 22 + 18;

  // ── net pay banner ──
  doc.roundedRect(M, y, CW, 64, 10).fill(brand.deep);
  doc.roundedRect(M, y, 6, 64, 3).fill(brand.color);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#cbd5e1').text('NET PAY', M + 22, y + 12, { characterSpacing: 1, lineBreak: false });
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#e2e8f0').text(K.amountInWords(slip.net_pay), M + 22, y + 38, { width: CW - 230 });
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#ffffff').text(K.money(slip.net_pay), W - M - 230, y + 18, { width: 210, align: 'right', lineBreak: false });
  y += 64 + 16;

  // ── payment info ──
  const bank = slip.bank_details;
  const bits = [
    ['Payment Status', slip.payment_status || '-'],
    ['Mode', slip.payment_mode || '-'],
    ['Transaction ID', slip.trx_id || '-'],
    ['Bank / UPI', bank ? `${bank.bank_name || '-'}${bank.account_number ? '  A/C ****' + String(bank.account_number).slice(-4) : ''}${bank.upi_id ? '  UPI ' + bank.upi_id : ''}` : '-'],
  ];
  K.card(doc, M, y, CW, 42);
  const widths = [90, 80, 120, CW - 290 - 28];
  let px = M + 14;
  bits.forEach(([k, v], i) => { K.kv(doc, k, v, px, y + 9, widths[i] - 8, { size: 8.2 }); px += widths[i]; });
  y += 42 + 14;

  if (slip.is_manually_adjusted) {
    doc.roundedRect(M, y, CW, 30, 6).fillAndStroke('#fffbeb', '#fde68a');
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#92400e').text('ADJUSTMENT NOTE', M + 12, y + 7, { characterSpacing: 0.6, lineBreak: false });
    doc.font('Helvetica').fontSize(7.8).fillColor('#78350f').text(`Manually adjusted${num(slip.bonus_amount) > 0 ? ` (bonus ${K.moneyShort(slip.bonus_amount)})` : ''}. Reason: ${slip.adjustment_note || '-'}`, M + 12, y + 17, { width: CW - 24, lineBreak: false, ellipsis: true });
    y += 40;
  }

  const sy = Math.max(y + 44, 640);
  K.signatureLine(doc, 'Employee Signature', M + 10, sy, 150);
  K.signatureLine(doc, 'Authorised Signatory', W - M - 160, sy, 150);
}

async function payslipPdf(schoolId, slipId) {
  const slip = await queryOne(
    `SELECT p.*, u.full_name AS staff_name, sp.designation, sp.department
     FROM payslips p JOIN users u ON u.id = p.staff_id
     LEFT JOIN staff_profiles sp ON sp.user_id = p.staff_id AND sp.school_id = p.school_id
     WHERE p.id=@id AND p.school_id=@sid`,
    { id: U(slipId), sid: U(schoolId) }
  );
  if (!slip) throw K.httpError(404, 'Payslip not found');
  const [bank, brand] = await Promise.all([
    queryOne(`SELECT * FROM staff_bank_details WHERE staff_id=@st AND school_id=@sid`, { st: U(slip.staff_id), sid: U(schoolId) }),
    K.getBrand(schoolId),
  ]);
  slip.bank_details = bank || null;
  const doc = K.createDoc(brand, { title: `Salary Slip ${monthLabel(slip.month_year)}` });
  drawPayslip(doc, brand, slip);
  K.drawFooters(doc, brand, { ref: monthLabel(slip.month_year), pageNumbers: false });
  return { buffer: await K.finish(doc), filename: `Payslip_${K.safeName(slip.staff_name)}_${slip.month_year}` };
}

module.exports = { payslipPdf, drawPayslip };
