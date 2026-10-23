// src/services/documents/payslip.js - official salary slip. Half of A4 when it fits, full A4 otherwise.
const { queryOne, sql } = require('../../config/db');
const K = require('./kit');
const { M, CW, INK, MUTED, FAINT, LINE } = K;
const U = (v) => ({ type: sql.UniqueIdentifier, value: v });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (my) => { const [y, m] = String(my || '').split('-'); return MONTHS[+m - 1] ? `${MONTHS[+m - 1]} ${y}` : String(my || ''); };
const num = (n) => Number(n) || 0;

function drawPayslip(doc, brand, slip) {
  const c = doc._compact, { width: W, height: H } = doc.page;
  let y = K.drawHeader(doc, brand);
  y = K.titleBand(doc, brand, y, 'Salary Slip', monthLabel(slip.month_year));

  y = K.infoGrid(doc, brand, {
    y, rowH: c ? 21 : 25,
    rows: [
      [['Employee Name', slip.staff_name], ['Designation', slip.designation], ['Department', slip.department]],
      [['Pay Period', monthLabel(slip.month_year)], ['Days Present', `${slip.present_days ?? '-'} / ${slip.total_days ?? '-'}`], ['Paid Leave / LOP Days', `${slip.paid_leave_days ?? 0} / ${slip.lop_days ?? 0}`]],
    ],
  }) + (c ? 9 : 14);

  const earn = [['Basic Pay', slip.basic, true], ['House Rent Allowance', slip.hra], ['Dearness Allowance', slip.da], ['Special Allowance', slip.special_allowance], ['Other Allowance', slip.other_allowance], ['Bonus', slip.bonus_amount]].filter(([, v, always]) => always || num(v) > 0);
  const ded = [['LOP Deduction', slip.lop_deduction], ['Provident Fund (PF)', slip.pf_deduction], ['Professional Tax (PT)', slip.pt_deduction], ['Other Deduction', slip.other_deduction]].filter(([, v]) => num(v) > 0);
  if (!ded.length) ded.push(['No deductions', 0]);

  const gap = 10, cw = (CW - gap) / 2, rowH = c ? 13 : 18;
  const side = (x, title, list, totalLabel, total, fill, onFill) => {
    doc.rect(x, y, cw, 17).fill(fill);
    doc.font('Helvetica-Bold').fontSize(7.2).fillColor(onFill).text(title.toUpperCase(), x + 6, y + 5.5, { characterSpacing: 0.8, lineBreak: false });
    doc.text('AMOUNT', x, y + 5.5, { width: cw - 6, align: 'right', characterSpacing: 0.8, lineBreak: false });
    let yy = y + 17;
    const n = Math.max(earn.length, ded.length);
    for (let i = 0; i < n; i++) {
      const row = list[i];
      doc.rect(x, yy, cw, rowH).lineWidth(0.4).strokeColor(LINE).stroke();
      if (row) {
        doc.font('Helvetica').fontSize(8).fillColor(INK).text(row[0], x + 6, yy + (rowH - 8) / 2 + 0.5, { width: cw - 90, lineBreak: false });
        doc.font('Helvetica-Bold').text(num(row[1]) ? K.money(row[1]) : '-', x, yy + (rowH - 8) / 2 + 0.5, { width: cw - 6, align: 'right', lineBreak: false });
      }
      yy += rowH;
    }
    doc.rect(x, yy, cw, rowH + 2).fill(brand.soft);
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK).text(totalLabel, x + 6, yy + (rowH - 6) / 2 + 0.5, { lineBreak: false });
    doc.text(K.money(total), x, yy + (rowH - 6) / 2 + 0.5, { width: cw - 6, align: 'right', lineBreak: false });
    doc.rect(x, y, cw, yy + rowH + 2 - y).lineWidth(0.9).strokeColor(brand.color).stroke();
    return yy + rowH + 2;
  };
  const e1 = side(M, 'Earnings', earn, 'Gross Earnings', slip.gross_salary, brand.color, brand.on);
  side(M + cw + gap, 'Deductions', ded, 'Total Deductions', slip.total_deduction, '#374151', '#ffffff');
  y = e1 + (c ? 7 : 12);

  // net pay strip
  const nh = c ? 28 : 44;
  doc.rect(M, y, CW, nh).fill(brand.deep);
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#d1d5db').text('NET PAY', M + 12, y + (c ? 6 : 10), { characterSpacing: 1.2, lineBreak: false });
  doc.font('Times-Italic').fontSize(8.5).fillColor('#f3f4f6').text(K.amountInWords(slip.net_pay), M + 12, y + (c ? 17 : 24), { width: CW - 220, lineBreak: false, ellipsis: true });
  doc.font('Times-Bold').fontSize(c ? 18 : 23).fillColor('#ffffff').text(K.money(slip.net_pay), M, y + (c ? 6 : 10), { width: CW - 12, align: 'right', lineBreak: false });
  y += nh + 4;

  const bank = slip.bank_details;
  const info = [`Status: ${slip.payment_status || '-'}`, slip.payment_mode && `Mode: ${slip.payment_mode}`, slip.trx_id && `Txn: ${slip.trx_id}`, bank && `Bank: ${bank.bank_name || '-'}${bank.account_number ? ' A/C ****' + String(bank.account_number).slice(-4) : ''}${bank.upi_id ? ' UPI ' + bank.upi_id : ''}`].filter(Boolean).join('    |    ');
  doc.font('Helvetica').fontSize(7.4).fillColor(MUTED).text(info, M, y, { width: CW, lineBreak: false, ellipsis: true });
  y += 10;
  if (slip.is_manually_adjusted) {
    doc.font('Helvetica-Oblique').fontSize(7.2).fillColor('#92400e').text(`Note: manually adjusted${num(slip.bonus_amount) > 0 ? ` (bonus ${K.moneyShort(slip.bonus_amount)})` : ''} - ${slip.adjustment_note || '-'}`, M, y, { width: CW, lineBreak: false, ellipsis: true });
    y += 10;
  }
  const sy = c ? y + 15 : Math.max(y + 40, H - 150);
  K.signatureLine(doc, 'Employee Signature', M + 8, sy, 140);
  K.signatureLine(doc, 'Authorised Signatory', W - M - 148, sy, 140);
  return sy + 14;
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
  const title = `Salary Slip ${monthLabel(slip.month_year)}`;
  let doc = K.createDoc(brand, { title, half: true });
  const end = drawPayslip(doc, brand, slip);
  if (end > K.contentLimit(doc) || doc.bufferedPageRange().count > 1) { doc = K.createDoc(brand, { title, half: false }); drawPayslip(doc, brand, slip); }
  K.drawFooters(doc, brand, { ref: monthLabel(slip.month_year) });
  return { buffer: await K.finish(doc), filename: `Payslip_${K.safeName(slip.staff_name)}_${slip.month_year}` };
}

module.exports = { payslipPdf, drawPayslip };
