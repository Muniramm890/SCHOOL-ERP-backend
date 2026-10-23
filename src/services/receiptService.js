//src/services/receiptService.js
const { queryOne, query, sql } = require('../config/db');


const money = (paise) => `Rs. ${((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

// (PDF generation lives in services/documents - receipts are rendered on demand, never stored)

exports.sendPaymentConfirmationWhatsapp = async (schoolId, paymentId) => {
  try {
    const { sendTemplate } = require('./whatsappService');
    const { queryOne, sql } = require('../config/db');

    // 1. Fetch Payment Data
    const payment = await queryOne(
      `SELECT * FROM fee_payments WHERE id=@id AND school_id=@sid`,
      { id: { type: sql.UniqueIdentifier, value: paymentId }, sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );
    if (!payment) return;

    // 2. Fetch School Data
    const school = await queryOne(
      `SELECT name FROM schools WHERE id=@sid`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );

    // 3. Fetch Student & Parent Phone
        const student = await queryOne(
      `SELECT s.first_name, s.last_name,
        (SELECT TOP 1 phone FROM student_guardians WHERE student_id = s.id AND is_primary = 1) AS guardian_phone
       FROM students s WHERE s.id=@uid`,
      { uid: { type: sql.UniqueIdentifier, value: payment.student_id } }
    );

    if (!student) return;

    const targetPhone = student.guardian_phone;
    if (!targetPhone) {
      console.log("❌ No phone number found for WhatsApp");
      return;
    }

    // 4. Format Variables (Strict limit applied to prevent Meta Error #132005)
    const schoolName = String(school?.name || "School").substring(0, 60);
    const studentName = [student.first_name, student.last_name].filter(Boolean).join(" ").substring(0, 30);
    const amount = (payment.amount_paise / 100).toString();

    // Formatting Date to Month (e.g. "September 2026")
    const dateObj = new Date(payment.payment_date || Date.now());
    const month = dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' }).substring(0, 20);
    
    // Transaction ID & Mode
    const trxId = String(payment.razorpay_payment_id || payment.transaction_ref || "CASH").substring(0, 30);
    const mode = String(payment.payment_method || "CASH").substring(0, 20);

    // Time string format: "02 September 2026, 10:25 AM"
    const timeOptions = { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' };
    const timeStr = dateObj.toLocaleString('en-IN', timeOptions).replace(' am', ' AM').replace(' pm', ' PM');

    // 🔴 5. Build EXACT Meta Payload (Matches your GAS Script: 1 Header, 6 Body)
    const components = [
      {
        type: "header",
        parameters: [
          { type: "text", text: schoolName } // Header {{1}}
        ]
      },
      {
        type: "body",
        parameters: [
          { type: "text", text: studentName },  // Body {{1}}
          { type: "text", text: amount },       // Body {{2}}
          { type: "text", text: month },        // Body {{3}}
          { type: "text", text: trxId },        // Body {{4}}
          { type: "text", text: mode },         // Body {{5}}
          { type: "text", text: timeStr }       // Body {{6}}
        ]
      }
    ];

    // 6. Send using Node.js WhatsApp Service
    await sendTemplate(targetPhone, 'fee_submission_confirmation', 'en', components);
    console.log("✅ Fee WhatsApp Sent to: " + targetPhone);

  } catch (error) {
    console.error("❌ WhatsApp Error:", error.message);
  }
};

exports.sendPaymentConfirmationEmail = async (schoolId, paymentId) => {
  try {
    console.log('📧 Email flow started for payment:', paymentId);
    const emailService = require('./emailService');

    const payment = await queryOne(
      `SELECT fp.receipt_no, fp.amount_paise, fp.payment_method, fp.payment_date, fp.student_id
       FROM fee_payments fp WHERE fp.id=@id AND fp.school_id=@sid`,
      { id: { type: sql.UniqueIdentifier, value: paymentId }, sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );
    if (!payment) return;

    const student = await queryOne(
      `SELECT s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name, s.photo_url,
              g.name AS class_name, sc.name AS section_name
       FROM students s
       LEFT JOIN enrolments e ON e.student_id=s.id AND e.school_id=@sid AND e.is_active=1
       LEFT JOIN sections sc ON sc.id=e.section_id
       LEFT JOIN grades g ON g.id=sc.grade_id
       WHERE s.id=@uid AND s.school_id=@sid`,
      { uid: { type: sql.UniqueIdentifier, value: payment.student_id }, sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );

    const guardian = await queryOne(
      `SELECT TOP 1 email, full_name FROM student_guardians
       WHERE student_id=@uid AND is_primary=1 AND deleted_at IS NULL AND email IS NOT NULL`,
      { uid: { type: sql.UniqueIdentifier, value: payment.student_id } }
    );
        if (!guardian?.email) { console.log('❌ No guardian email found for student:', payment.student_id); return; }

    const school = await queryOne(
      `SELECT name, logo_url, brand_color, address_line1, city, state, phone, email
       FROM schools WHERE id=@sid`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );

    const brandColor = school.brand_color || '#E8600A';
    const { buffer: pdfBuffer, filename: pdfName } = await require('./documents').receiptPdf(schoolId, paymentId);

    const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f4f7;padding:24px;">
      <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.06);">
        <div style="background:${brandColor};padding:24px 28px;display:flex;align-items:center;gap:14px;">
          ${school.logo_url ? `<img src="${school.logo_url}" width="48" height="48" style="border-radius:8px;background:#fff;padding:4px;" />` : ''}
          <div>
            <div style="color:#fff;font-size:18px;font-weight:800;">${school.name}</div>
            <div style="color:#ffffffcc;font-size:11px;">${[school.address_line1, school.city, school.state].filter(Boolean).join(', ')}</div>
          </div>
        </div>

        <div style="padding:28px;">
          <div style="text-align:center;margin-bottom:20px;">
            ${student.photo_url ? `<img src="${student.photo_url}" width="64" height="64" style="border-radius:50%;object-fit:cover;border:3px solid ${brandColor}44;" />` : ''}
            <h2 style="margin:12px 0 2px;color:#111;">${student.student_name}</h2>
            <div style="color:#777;font-size:13px;">${student.class_name || ''} ${student.section_name || ''}</div>
          </div>

          <div style="background:#f9fafb;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;">
              <span style="color:#666;font-size:13px;">Receipt No.</span>
              <span style="font-weight:700;font-size:13px;">${payment.receipt_no}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;">
              <span style="color:#666;font-size:13px;">Payment Date</span>
              <span style="font-weight:700;font-size:13px;">${new Date(payment.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;">
              <span style="color:#666;font-size:13px;">Payment Method</span>
              <span style="font-weight:700;font-size:13px;">${payment.payment_method}</span>
            </div>
          </div>

          <div style="text-align:center;background:${brandColor}11;border-radius:12px;padding:18px;margin-bottom:22px;">
            <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Amount Paid</div>
            <div style="font-size:28px;font-weight:800;color:${brandColor};margin-top:4px;">₹${(payment.amount_paise / 100).toLocaleString('en-IN')}</div>
          </div>

          <div style="text-align:center;">
            <div style="font-size:12.5px;color:#555;">Your fee receipt is attached to this email as a PDF.</div>
          </div>
        </div>

        <div style="background:#fafafa;padding:16px 28px;text-align:center;border-top:1px solid #eee;">
          <div style="font-size:10.5px;color:#999;">This is a computer-generated email. Please do not reply.</div>
          <div style="font-size:11px;color:#aaa;margin-top:4px;">${school.name} · ${school.phone || ''} ${school.email ? '· ' + school.email : ''}</div>
        </div>
      </div>
    </div>`;

        await emailService.sendHtmlEmail({
      to: guardian.email,
      from: 'muniramm890@gmail.com',
      fromName: school.name,
      subject: `Fee Payment Confirmation — ${payment.receipt_no}`,
      html,
      attachments: [{ content: pdfBuffer.toString('base64'), filename: `${pdfName}.pdf`, type: 'application/pdf', disposition: 'attachment' }],
    });
    console.log('✅ Email sent successfully to:', guardian.email);
  } catch (e) {
    console.error('❌ Payment confirmation email failed:', e.message, e.stack);
  }
};
