// src/controllers/paymentController.js
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { withTransaction, queryOne, sql } = require('../config/db');
const { success, badRequest, notFound } = require('../utils/response');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Cashfree config -- placeholders, set these in .env ─────────────────────
// CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_API_VERSION (e.g. 2023-08-01),
// CASHFREE_ENV ('SANDBOX' or 'PRODUCTION', default sandbox if unset)
const CASHFREE_BASE_URL = process.env.CASHFREE_ENV === 'PRODUCTION'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

const cashfreeHeaders = () => ({
  'Content-Type': 'application/json',
  'x-api-version': process.env.CASHFREE_API_VERSION,
  'x-client-id': process.env.CASHFREE_APP_ID,
  'x-client-secret': process.env.CASHFREE_SECRET_KEY,
});

// ═══════════════════════════════════════════════════════════════════════════
// SHARED: writes one payment into fee_payments + related tables.
// Both Razorpay and Cashfree call this AFTER their own gateway-specific
// verification succeeds -- so the row saved in the DB is byte-for-byte the
// same shape regardless of gateway. Only `gateway` differs ('razorpay' /
// 'cashfree'); the razorpay_order_id / razorpay_payment_id / razorpay_signature
// columns are intentionally reused as generic "gateway order/payment/signature"
// fields for Cashfree too, so receiptService.js, audit logs, and every report
// that already reads these columns keep working untouched.
// ═══════════════════════════════════════════════════════════════════════════
async function recordFeePayment({
  schoolId, userId, userName, student_id, amount_paise, invoice_id, remarks,
  breakdown, payment_method, gateway, gateway_order_id, gateway_payment_id, gateway_signature,
}) {
  const total_discount = (breakdown && Array.isArray(breakdown))
    ? breakdown.reduce((sum, item) => sum + (Number(item.discount_amount) || 0), 0)
    : 0;

  const paymentId = uuidv4();
  let generatedReceipt = '';

  await withTransaction(async (tx) => {
    // 1. Ensure Fee Account exists
    const sReq = tx.request();
    sReq.input('sid', sql.UniqueIdentifier, schoolId);
    sReq.input('uid', sql.UniqueIdentifier, student_id);
    const sRes = await sReq.query(`
      SELECT sfa.id AS account_id
      FROM students s
      LEFT JOIN student_fee_accounts sfa ON sfa.student_id = s.id AND sfa.school_id = @sid
      WHERE s.id = @uid AND s.school_id = @sid
    `);
    let accountId = sRes.recordset[0]?.account_id;

    if (!accountId) {
      accountId = uuidv4();
      const crAcc = tx.request();
      crAcc.input('aid', sql.UniqueIdentifier, accountId);
      crAcc.input('sid', sql.UniqueIdentifier, schoolId);
      crAcc.input('uid', sql.UniqueIdentifier, student_id);
      await crAcc.query(`
        INSERT INTO student_fee_accounts (id, school_id, student_id, total_fee_paise, paid_paise, pending_paise, status)
        VALUES (@aid, @sid, @uid, 0, 0, 0, 'pending')
      `);
    }

    // 2. Generate Receipt Number
    const rcptReq = tx.request();
    rcptReq.input('sid', sql.UniqueIdentifier, schoolId);
    const rcptRes = await rcptReq.query(`
      SELECT 'RCP-' + FORMAT(GETUTCDATE(), 'yyyyMM') + '-' + RIGHT('0000' + CAST(COUNT(*)+1 AS VARCHAR), 4) AS receipt_no
      FROM fee_payments WHERE school_id = @sid AND FORMAT(created_at, 'yyyyMM') = FORMAT(GETUTCDATE(), 'yyyyMM')
    `);
    generatedReceipt = rcptRes.recordset[0].receipt_no;

    const amt = Number(amount_paise) || 0;

    // 3. Insert Main Payment Record
    const pReq = tx.request();
    pReq.input('id', sql.UniqueIdentifier, paymentId);
    pReq.input('sid', sql.UniqueIdentifier, schoolId);
    pReq.input('invId', sql.UniqueIdentifier, invoice_id || null);
    pReq.input('aid', sql.UniqueIdentifier, accountId);
    pReq.input('uid', sql.UniqueIdentifier, student_id);
    pReq.input('rcpt', sql.NVarChar(100), generatedReceipt);
    pReq.input('amt', sql.BigInt, amt);
    pReq.input('mth', sql.VarChar(50), payment_method);
    pReq.input('ref', sql.NVarChar(255), gateway_payment_id);
    pReq.input('cby', sql.UniqueIdentifier, userId);
    pReq.input('rmk', sql.NVarChar(sql.MAX), remarks || null);
    pReq.input('roid', sql.NVarChar(200), gateway_order_id);
    pReq.input('rpid', sql.NVarChar(200), gateway_payment_id);
    pReq.input('rsig', sql.NVarChar(500), gateway_signature || null);
    pReq.input('gw', sql.VarChar(50), gateway);
    await pReq.query(`
      INSERT INTO fee_payments (id, school_id, invoice_id, fee_account_id, student_id, receipt_no, payment_date, amount_paise, payment_method, transaction_ref, collected_by, remarks, gateway, razorpay_order_id, razorpay_payment_id, razorpay_signature)
      VALUES (@id, @sid, @invId, @aid, @uid, @rcpt, CONVERT(date, GETUTCDATE()), @amt, @mth, @ref, @cby, @rmk, @gw, @roid, @rpid, @rsig)
    `);

    // 4. Update Student Fee Account Balances
    const accReq = tx.request();
    accReq.input('aid', sql.UniqueIdentifier, accountId);
    accReq.input('amt', sql.BigInt, amt);
    await accReq.query(`
      UPDATE student_fee_accounts
      SET paid_paise = paid_paise + @amt,
          pending_paise = CASE WHEN pending_paise - @amt < 0 THEN 0 ELSE pending_paise - @amt END,
          status = CASE WHEN pending_paise - @amt <= 0 THEN 'paid' ELSE 'partial' END,
          updated_at = GETUTCDATE()
      WHERE id = @aid
    `);

    // 5. Insert Itemized Breakdown & Update Invoice Items
    if (breakdown && Array.isArray(breakdown) && breakdown.length > 0) {
      for (const item of breakdown) {
        if (item.category_id === 'legacy_arrears') continue;

        const itReq = tx.request();
        itReq.input('sid', sql.UniqueIdentifier, schoolId);
        itReq.input('pid', sql.UniqueIdentifier, paymentId);
        itReq.input('cid', sql.UniqueIdentifier, item.category_id);
        itReq.input('pAmt', sql.BigInt, Number(item.pay_amount) || 0);
        itReq.input('dAmt', sql.BigInt, Number(item.discount_amount) || 0);

        await itReq.query(`
          INSERT INTO fee_payment_items (school_id, payment_id, fee_category_id, amount_paise, discount_paise)
          VALUES (@sid, @pid, @cid, @pAmt, @dAmt)
        `);

        if (invoice_id) {
          const iItReq = tx.request();
          iItReq.input('invId', sql.UniqueIdentifier, invoice_id);
          iItReq.input('cid', sql.UniqueIdentifier, item.category_id);
          iItReq.input('pAmt', sql.BigInt, Number(item.pay_amount) || 0);
          iItReq.input('dAmt', sql.BigInt, Number(item.discount_amount) || 0);
          await iItReq.query(`
            UPDATE fee_invoice_items
            SET paid_paise = paid_paise + @pAmt, discount_paise = discount_paise + @dAmt
            WHERE invoice_id = @invId AND fee_category_id = @cid
          `);
        }
      }
    }

    // 5.5 Update Main Invoice Total Balances
    if (invoice_id) {
      const invReq = tx.request();
      invReq.input('invId', sql.UniqueIdentifier, invoice_id);
      invReq.input('amt', sql.BigInt, amt);
      invReq.input('dsc', sql.BigInt, total_discount);
      await invReq.query(`
        UPDATE fee_invoices
        SET paid_paise = paid_paise + @amt,
            discount_paise = discount_paise + @dsc,
            balance_paise = CASE WHEN total_paise - (discount_paise + @dsc) - (paid_paise + @amt) < 0 THEN 0 ELSE total_paise - (discount_paise + @dsc) - (paid_paise + @amt) END,
            status = CASE WHEN total_paise - (discount_paise + @dsc) <= (paid_paise + @amt) THEN 'paid' ELSE 'partial' END,
            updated_at = GETUTCDATE()
        WHERE id = @invId
      `);
    }

    // 6. Log to Dashboard Recent Activity
    try {
      const logReq = tx.request();
      logReq.input('lid', sql.UniqueIdentifier, uuidv4());
      logReq.input('sid', sql.UniqueIdentifier, schoolId);
      logReq.input('uid', sql.UniqueIdentifier, userId);
      logReq.input('unm', sql.NVarChar(200), userName || 'Accountant');
      logReq.input('act', sql.NVarChar(50), 'FEE_PAID');
      logReq.input('det', sql.NVarChar(sql.MAX), JSON.stringify({
        studentName: "Student",
        amount: (amt / 100).toFixed(0),
        receiptNo: generatedReceipt,
        paymentMethod: payment_method,
      }));
      await logReq.query(`
        INSERT INTO audit_logs (id, school_id, user_id, user_name, action_type, details, created_at)
        VALUES (@lid, @sid, @uid, @unm, @act, @det, GETUTCDATE())
      `);
    } catch (logErr) {
      console.warn(`Audit Logging Warning (${gateway}):`, logErr.message);
    }
  });

  // Fire and forget Notifications
  require('../services/receiptService').sendPaymentConfirmationWhatsapp(schoolId, paymentId);
  require('../services/receiptService').sendPaymentConfirmationEmail(schoolId, paymentId);

  return { id: paymentId, receipt_no: generatedReceipt };
}

// ── POST /api/payments/razorpay/create-order ──────────────────────────────
// Only KEY_ID (public/publishable) ever goes back to frontend. KEY_SECRET never leaves server.
exports.createOrder = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    
    // 🔴 NEW: Payload mein breakdown array bhi aayega
    const { student_id, amount_paise, breakdown } = req.body;

    if (!student_id || !amount_paise || amount_paise <= 0) {
      return badRequest(res, 'Valid student_id and positive amount_paise are required');
    }

    // 🔴 STRICT SECURITY CHECK: Itemized validation
    // Ensure frontend tampering hasn't happened. Total requested amount MUST equal the sum of itemized breakdown.
    if (breakdown && Array.isArray(breakdown)) {
      const calculatedTotal = breakdown.reduce((sum, item) => sum + (Number(item.pay_amount) || 0), 0);
      if (calculatedTotal !== amount_paise) {
        return badRequest(res, 'Security Error: Itemized breakdown total does not match the requested order amount.');
      }
    }

    const student = await queryOne(
      `SELECT s.id, s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name,
              sg.phone AS guardian_phone, sg.email AS guardian_email
       FROM students s
       LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary=1 AND sg.deleted_at IS NULL
       WHERE s.id=@uid AND s.school_id=@sid AND s.deleted_at IS NULL`,
      { uid: { type: sql.UniqueIdentifier, value: student_id },
        sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );
    if (!student) return notFound(res, 'Student not found');

    const receipt = `rcpt_${Date.now()}`;
    const order = await razorpay.orders.create({
      amount: amount_paise, // razorpay expects smallest currency unit = paise, matches our schema exactly
      currency: 'INR',
      receipt,
      notes: { 
        student_id, 
        school_id: schoolId, 
        student_name: student.student_name,
        // 🔴 NEW: Audit tracking on Razorpay Dashboard
        is_itemized: (breakdown && breakdown.length > 0) ? 'yes' : 'no' 
      },
    });

    return success(res, {
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      student_name: student.student_name,
      guardian_phone: student.guardian_phone,
      guardian_email: student.guardian_email,
    }, 'Order created');
  } catch (err) { next(err); }
};

// ── POST /api/payments/razorpay/verify ─────────────────────────────────────
exports.verifyAndRecord = async (req, res, next) => {
  try {
    const { schoolId, userId, fullName: userName } = req.user;
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      student_id, amount_paise, invoice_id, remarks, breakdown
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return badRequest(res, 'Missing Razorpay verification fields');
    }

    // ── CRITICAL SECURITY STEP: verify signature server-side using KEY_SECRET ──
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return badRequest(res, 'Payment signature verification failed — possible tampering');
    }

    // Double-check payment status directly with Razorpay (defense in depth)
    const rpPayment = await razorpay.payments.fetch(razorpay_payment_id);
    if (rpPayment.status !== 'captured' && rpPayment.status !== 'authorized') {
      return badRequest(res, `Payment not completed. Status: ${rpPayment.status}`);
    }
    if (rpPayment.order_id !== razorpay_order_id) {
      return badRequest(res, 'Order mismatch');
    }

    const amt = Number(amount_paise) || rpPayment.amount;

    const result = await recordFeePayment({
      schoolId, userId, userName, student_id, amount_paise: amt, invoice_id, remarks, breakdown,
      payment_method: rpPayment.method === 'upi' ? 'UPI' : rpPayment.method === 'card' ? 'Card' : 'Online',
      gateway: 'razorpay',
      gateway_order_id: razorpay_order_id,
      gateway_payment_id: razorpay_payment_id,
      gateway_signature: razorpay_signature,
    });

    return success(res, result, `Payment of ₹${(amt / 100).toFixed(2)} verified & recorded`);
  } catch (err) { next(err); }
};

// ═══════════════════════════════════════════════════════════════════════════
// CASHFREE — mirrors the Razorpay flow above exactly (same request/response
// contract on the frontend side), only the gateway-specific verification
// step differs. See the note above recordFeePayment() for why no schema
// change was needed.
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /api/payments/cashfree/create-order ───────────────────────────────
exports.createCashfreeOrder = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { student_id, amount_paise, breakdown } = req.body;

    if (!student_id || !amount_paise || amount_paise <= 0) {
      return badRequest(res, 'Valid student_id and positive amount_paise are required');
    }

    if (breakdown && Array.isArray(breakdown)) {
      const calculatedTotal = breakdown.reduce((sum, item) => sum + (Number(item.pay_amount) || 0), 0);
      if (calculatedTotal !== amount_paise) {
        return badRequest(res, 'Security Error: Itemized breakdown total does not match the requested order amount.');
      }
    }

    const student = await queryOne(
      `SELECT s.id, s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name,
              sg.phone AS guardian_phone, sg.email AS guardian_email
       FROM students s
       LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary=1 AND sg.deleted_at IS NULL
       WHERE s.id=@uid AND s.school_id=@sid AND s.deleted_at IS NULL`,
      { uid: { type: sql.UniqueIdentifier, value: student_id },
        sid: { type: sql.UniqueIdentifier, value: schoolId } }
    );
    if (!student) return notFound(res, 'Student not found');

    const orderId = `cforder_${Date.now()}_${student_id.slice(0, 8)}`;

    const cfRes = await fetch(`${CASHFREE_BASE_URL}/orders`, {
      method: 'POST',
      headers: cashfreeHeaders(),
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount_paise / 100, // Cashfree expects RUPEES, not paise
        order_currency: 'INR',
        customer_details: {
          customer_id: student_id,
          customer_name: student.student_name,
          customer_phone: student.guardian_phone || '9999999999',
          customer_email: student.guardian_email || 'noemail@school.com',
        },
        order_meta: {
          // only used by redirect-mode integrations; modal-mode (used on the
          // frontend here) ignores this
          return_url: `${process.env.FRONTEND_URL || ''}/fees/cashfree-return?order_id={order_id}`,
        },
        order_note: (breakdown && breakdown.length > 0) ? 'itemized' : 'lump_sum',
      }),
    });

    const cfData = await cfRes.json();
    if (!cfRes.ok) {
      return badRequest(res, cfData?.message || 'Could not create Cashfree order');
    }

    return success(res, {
      order_id: cfData.order_id,
      payment_session_id: cfData.payment_session_id,
      amount: amount_paise,
      currency: 'INR',
      student_name: student.student_name,
      guardian_phone: student.guardian_phone,
      guardian_email: student.guardian_email,
    }, 'Cashfree order created');
  } catch (err) { next(err); }
};

// ── POST /api/payments/cashfree/verify ──────────────────────────────────────
// Cashfree's checkout doesn't hand the client a signed proof the way
// Razorpay does, so instead of trusting anything from the browser we ask
// Cashfree directly (server-to-server, using our secret key) what the real
// status of the order is, and only record the payment if THAT says success.
exports.verifyCashfreePayment = async (req, res, next) => {
  try {
    const { schoolId, userId, fullName: userName } = req.user;
    const { cf_order_id, student_id, amount_paise, invoice_id, remarks, breakdown } = req.body;

    if (!cf_order_id) return badRequest(res, 'Missing cf_order_id');

    const cfRes = await fetch(`${CASHFREE_BASE_URL}/orders/${cf_order_id}/payments`, {
      method: 'GET',
      headers: cashfreeHeaders(),
    });
    const payments = await cfRes.json();
    if (!cfRes.ok || !Array.isArray(payments)) {
      return badRequest(res, 'Could not verify payment with Cashfree');
    }

    const successfulPayment = payments.find((p) => p.payment_status === 'SUCCESS');
    if (!successfulPayment) {
      return badRequest(res, 'Payment not completed for this order');
    }

    // Prefer the amount Cashfree actually confirms over whatever the client sent.
    const amt = Math.round(successfulPayment.payment_amount * 100) || Number(amount_paise) || 0;

    const result = await recordFeePayment({
      schoolId, userId, userName, student_id, amount_paise: amt, invoice_id, remarks, breakdown,
      payment_method: (successfulPayment.payment_group || '').toLowerCase() === 'upi' ? 'UPI' : 'Card',
      gateway: 'cashfree',
      gateway_order_id: cf_order_id,
      gateway_payment_id: String(successfulPayment.cf_payment_id),
      gateway_signature: null,
    });

    return success(res, result, `Payment of ₹${(amt / 100).toFixed(2)} verified & recorded`);
  } catch (err) { next(err); }
};
