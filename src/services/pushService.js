// src/services/pushService.js
// FCM push (Android). Never throws and never blocks the HTTP request: callers use `.catch(() => {})` / fire-and-forget.
// Needs env FIREBASE_SERVICE_ACCOUNT = the full service-account JSON text. Without it push is silently disabled.
const { query, sql } = require('../config/db');

let _messaging = null;
let _tried = false;

function getMessaging() {
  if (_messaging) return _messaging;
  if (_tried) return null;
  _tried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.warn('[push] FIREBASE_SERVICE_ACCOUNT not set — push notifications disabled'); return null; }
  try {
    const admin = require('firebase-admin');
    const cred = JSON.parse(raw);
    if (cred.private_key) cred.private_key = String(cred.private_key).replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    _messaging = admin.messaging();
    return _messaging;
  } catch (e) {
    console.error('[push] init failed:', e.message);
    return null;
  }
}

const toStr = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
const INVALID = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

async function tokensFor(schoolId, { userIds = [], studentIds = [] }) {
  const U = (v) => ({ type: sql.UniqueIdentifier, value: v });
  const out = new Map();
  if (userIds.length) {
    const r = await query(
      `SELECT fcm_token FROM device_tokens
       WHERE school_id=@sid AND is_active=1 AND user_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`,
      { sid: U(schoolId), ids: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(userIds) } }
    );
    r.recordset.forEach((x) => out.set(x.fcm_token, true));
  }
  if (studentIds.length) {
    const r = await query(
      `SELECT fcm_token FROM device_tokens
       WHERE school_id=@sid AND is_active=1 AND student_id IN (SELECT CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`,
      { sid: U(schoolId), ids: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(studentIds) } }
    );
    r.recordset.forEach((x) => out.set(x.fcm_token, true));
  }
  return [...out.keys()];
}

/**
 * @param {object} p
 * @param {string} p.schoolId
 * @param {string[]} [p.userIds]      staff user ids
 * @param {string[]} [p.studentIds]
 * @param {string} p.title
 * @param {string} [p.body]
 * @param {object} [p.data]           e.g. { type:'chat', messageId, recipientId } -> app opens that chat on tap
 */
async function send({ schoolId, userIds = [], studentIds = [], title, body = '', data = {} }) {
  try {
    const messaging = getMessaging();
    if (!messaging || (!userIds.length && !studentIds.length)) return { sent: 0 };
    const tokens = await tokensFor(schoolId, { userIds, studentIds });
    if (!tokens.length) return { sent: 0 };

    let sent = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const resp = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title: String(title).slice(0, 100), body: String(body).slice(0, 180) },
        data: toStr(data),
        android: { priority: 'high', notification: { channelId: 'chat', sound: 'default' } },
      });
      sent += resp.successCount;
      const dead = [];
      resp.responses.forEach((r, k) => { if (!r.success && INVALID.has(r.error?.code)) dead.push(chunk[k]); });
      if (dead.length) {
        await query(
          `UPDATE device_tokens SET is_active=0 WHERE fcm_token IN (SELECT [value] FROM OPENJSON(@t))`,
          { t: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(dead) } }
        );
      }
    }
    return { sent };
  } catch (e) {
    console.error('[push] send failed:', e.message);
    return { sent: 0 };
  }
}

module.exports = { send };
