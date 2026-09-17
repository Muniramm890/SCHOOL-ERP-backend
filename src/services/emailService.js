//src/services/emailService.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SG_API_KEY);

exports.sendHtmlEmail = async ({ to, from, fromName, subject, html, attachments }) => {
  if (!process.env.SG_API_KEY) throw new Error('SG_API_KEY env var not configured on server');
  if (!from) throw new Error('SG_FROM_EMAIL env var not configured — no sender address set');

  const msg = {
    to,
    from: { email: from, name: fromName },
    subject,
    html,
    attachments,
  };
  try {
    await sgMail.send(msg);
  } catch (err) {
    // @sendgrid/mail puts the REAL rejection reason here, not in err.message
    const detail = err?.response?.body?.errors?.map((e) => e.message).join('; ') || err.message || 'Unknown SendGrid error';
    throw new Error(detail);
  }
};
