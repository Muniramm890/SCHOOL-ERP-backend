// src/services/sessionService.js
// Login sessions for staff (users: teachers, drivers, accountants...) AND students:
//   who logged in, when, from which device / IP / location, last seen, and REMOTE LOGOUT.
// Every JWT carries a `sid`; middleware rejects it as soon as the session is ended (logout, remote logout, password change).
// Tokens issued before this feature have no `sid` and keep working until they expire (then users log in again).
// Everything here is best-effort: if tracking fails, login still works (never lock users out because of a tracking bug).
const { query, queryOne, sql } = require('../config/db');

const UID = (v) => ({ type: sql.UniqueIdentifier, value: v });
const DAY = 86400000;

// ───────────────────────── tables (same as src/db/sql/login_sessions.sql) ─────────────────────────
let ready = null;
const ensureTables = () => ready || (ready = (async () => {
  await query(`IF OBJECT_ID(N'dbo.login_sessions', N'U') IS NULL
    CREATE TABLE dbo.login_sessions (
      id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_login_sessions_id DEFAULT NEWID() CONSTRAINT PK_login_sessions PRIMARY KEY,
      school_id UNIQUEIDENTIFIER NOT NULL, principal_type VARCHAR(10) NOT NULL, user_id UNIQUEIDENTIFIER NULL, student_id UNIQUEIDENTIFIER NULL,
      display_name NVARCHAR(200) NULL, role VARCHAR(40) NULL, device_id NVARCHAR(100) NULL, device_name NVARCHAR(150) NULL, platform VARCHAR(20) NULL,
      os NVARCHAR(60) NULL, browser NVARCHAR(60) NULL, app_version NVARCHAR(30) NULL, ip_address VARCHAR(64) NULL,
      geo_city NVARCHAR(100) NULL, geo_region NVARCHAR(100) NULL, geo_country NVARCHAR(100) NULL,
      latitude DECIMAL(9,6) NULL, longitude DECIMAL(9,6) NULL, location_accuracy_m DECIMAL(8,1) NULL, location_source VARCHAR(10) NULL,
      user_agent NVARCHAR(400) NULL, login_at DATETIME2 NOT NULL CONSTRAINT DF_login_sessions_login DEFAULT SYSUTCDATETIME(),
      last_seen_at DATETIME2 NULL, expires_at DATETIME2 NULL, ended_at DATETIME2 NULL, end_reason VARCHAR(20) NULL,
      revoked_by_user_id UNIQUEIDENTIFIER NULL, revoked_by_name NVARCHAR(200) NULL)`);
  await query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_sessions_school_time' AND object_id = OBJECT_ID(N'dbo.login_sessions')) CREATE INDEX IX_login_sessions_school_time ON dbo.login_sessions (school_id, login_at DESC)`);
  await query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_sessions_user' AND object_id = OBJECT_ID(N'dbo.login_sessions')) CREATE INDEX IX_login_sessions_user ON dbo.login_sessions (user_id, ended_at)`);
  await query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_sessions_student' AND object_id = OBJECT_ID(N'dbo.login_sessions')) CREATE INDEX IX_login_sessions_student ON dbo.login_sessions (student_id, ended_at)`);
  await query(`IF OBJECT_ID(N'dbo.login_failures', N'U') IS NULL
    CREATE TABLE dbo.login_failures (
      id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_login_failures PRIMARY KEY, school_id UNIQUEIDENTIFIER NULL, principal_type VARCHAR(10) NOT NULL,
      identifier NVARCHAR(255) NULL, reason VARCHAR(30) NULL, ip_address VARCHAR(64) NULL, device_name NVARCHAR(150) NULL, platform VARCHAR(20) NULL,
      user_agent NVARCHAR(400) NULL, created_at DATETIME2 NOT NULL CONSTRAINT DF_login_failures_created DEFAULT SYSUTCDATETIME())`);
  await query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_failures_time' AND object_id = OBJECT_ID(N'dbo.login_failures')) CREATE INDEX IX_login_failures_time ON dbo.login_failures (school_id, created_at DESC)`);
})().catch((e) => { ready = null; throw e; }));

// ───────────────────────── who/what/where is this request ─────────────────────────
const cut = (v, n) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };

function parseUa(ua) {
  let os = null, browser = null, m;
  if ((m = ua.match(/Android ([\d.]+)/))) os = 'Android ' + m[1];
  else if ((m = ua.match(/(?:iPhone|CPU) OS ([\d_]+)/))) os = 'iOS ' + m[1].replace(/_/g, '.');
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (/; wv\)/.test(ua) || /Capacitor/i.test(ua)) browser = 'App';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  const model = (ua.match(/;\s*([^;)]+?)\s+Build\//) || [])[1];
  return { os, browser, model: model && model.length > 2 ? model : null };
}

const cleanIp = (ip) => String(ip || '').replace(/^::ffff:/, '').slice(0, 64) || null;

/** Apps can send { device: {id,name,platform,appVersion}, location: {lat,lng,accuracy} } in the login body (or x-device-* headers). */
function clientInfo(req) {
  const ua = String(req.headers['user-agent'] || '');
  const body = req.body || {};
  const d = body.device && typeof body.device === 'object' ? body.device : {};
  const h = (k) => req.headers[k];
  const p = parseUa(ua);
  const platform = (cut(d.platform || h('x-platform'), 20) || (/Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : 'web')).toLowerCase();
  const loc = body.location && typeof body.location === 'object' ? body.location : null;
  const lat = loc ? Number(loc.lat) : NaN, lng = loc ? Number(loc.lng) : NaN;
  const hasGps = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  return {
    ip: cleanIp(req.ip || req.socket?.remoteAddress),
    ua: cut(ua, 400), platform, os: p.os, browser: p.browser,
    deviceId: cut(d.id || h('x-device-id'), 100),
    deviceName: cut(d.name || h('x-device-name'), 150) || p.model || `${p.browser || 'Browser'} on ${p.os || 'unknown device'}`,
    appVersion: cut(d.appVersion || h('x-app-version'), 30),
    gps: hasGps ? { lat, lng, acc: Number.isFinite(Number(loc.accuracy)) ? Math.min(Number(loc.accuracy), 99999) : null } : null,
  };
}

// approximate place from the IP address (free service, fire-and-forget after login; switch off with IP_GEO_ENABLED=0)
const geoCache = new Map();
const isPrivate = (ip) => !ip || /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd)/i.test(ip);
async function geoFromIp(ip) {
  if (process.env.IP_GEO_ENABLED === '0' || isPrivate(ip)) return null;
  const hit = geoCache.get(ip); if (hit && Date.now() - hit.at < DAY) return hit.v;
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,region,country,latitude,longitude`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    const v = j && j.success ? { city: cut(j.city, 100), region: cut(j.region, 100), country: cut(j.country, 100), lat: Number(j.latitude), lng: Number(j.longitude) } : null;
    geoCache.set(ip, { v, at: Date.now() }); return v;
  } catch { return null; }
}

// ───────────────────────── create / check / end ─────────────────────────
let lastPurge = 0;
async function createSession({ req, schoolId, type, userId = null, studentId = null, name, role, ttlMs }) {
  await ensureTables();
  const c = clientInfo(req);
  const row = await queryOne(
    `INSERT INTO login_sessions (school_id, principal_type, user_id, student_id, display_name, role, device_id, device_name, platform, os, browser, app_version,
       ip_address, user_agent, latitude, longitude, location_accuracy_m, location_source, last_seen_at, expires_at)
     OUTPUT INSERTED.id AS id
     VALUES (@s, @t, @u, @st, @n, @r, @did, @dn, @pf, @os, @br, @av, @ip, @ua, @la, @lo, @ac, @src, SYSUTCDATETIME(), DATEADD(SECOND, @ttl, SYSUTCDATETIME()))`,
    { s: UID(schoolId), t: { type: sql.VarChar(10), value: type }, u: { type: sql.UniqueIdentifier, value: userId }, st: { type: sql.UniqueIdentifier, value: studentId },
      n: { type: sql.NVarChar(200), value: cut(name, 200) }, r: { type: sql.VarChar(40), value: cut(role, 40) },
      did: { type: sql.NVarChar(100), value: c.deviceId }, dn: { type: sql.NVarChar(150), value: c.deviceName }, pf: { type: sql.VarChar(20), value: c.platform },
      os: { type: sql.NVarChar(60), value: c.os }, br: { type: sql.NVarChar(60), value: c.browser }, av: { type: sql.NVarChar(30), value: c.appVersion },
      ip: { type: sql.VarChar(64), value: c.ip }, ua: { type: sql.NVarChar(400), value: c.ua },
      la: { type: sql.Decimal(9, 6), value: c.gps ? c.gps.lat : null }, lo: { type: sql.Decimal(9, 6), value: c.gps ? c.gps.lng : null },
      ac: { type: sql.Decimal(8, 1), value: c.gps ? c.gps.acc : null }, src: { type: sql.VarChar(10), value: c.gps ? 'gps' : null },
      ttl: { type: sql.Int, value: Math.round((ttlMs || 30 * DAY) / 1000) } });
  const id = row.id;

  // approximate location from IP (does not slow the login down)
  geoFromIp(c.ip).then((g) => {
    if (!g) return;
    const useIpCoords = !c.gps && Number.isFinite(g.lat) && Number.isFinite(g.lng);
    return query(`UPDATE login_sessions SET geo_city=@c, geo_region=@r, geo_country=@k,
        latitude = CASE WHEN @use = 1 THEN @la ELSE latitude END, longitude = CASE WHEN @use = 1 THEN @lo ELSE longitude END,
        location_source = CASE WHEN @use = 1 THEN 'ip' ELSE location_source END WHERE id=@id`,
      { id: UID(id), c: { type: sql.NVarChar(100), value: g.city }, r: { type: sql.NVarChar(100), value: g.region }, k: { type: sql.NVarChar(100), value: g.country },
        use: { type: sql.Bit, value: useIpCoords ? 1 : 0 }, la: { type: sql.Decimal(9, 6), value: useIpCoords ? g.lat : null }, lo: { type: sql.Decimal(9, 6), value: useIpCoords ? g.lng : null } });
  }).catch(() => {});

  if (Date.now() - lastPurge > 6 * 3600 * 1000) { // housekeeping: keep ~6 months
    lastPurge = Date.now();
    query(`DELETE TOP (5000) FROM login_sessions WHERE login_at < DATEADD(DAY, -180, SYSUTCDATETIME())`).catch(() => {});
    query(`DELETE TOP (5000) FROM login_failures WHERE created_at < DATEADD(DAY, -90, SYSUTCDATETIME())`).catch(() => {});
  }
  return id;
}

const cache = new Map();   // sid -> { active, at }   (10 s: remote logout reaches other server instances within ~10 s)
async function check(sid, { fresh = false } = {}) {
  const c = cache.get(sid);
  if (!fresh && c && Date.now() - c.at < 10000) return c.active;
  try {
    const row = await queryOne(`SELECT ended_at, expires_at FROM login_sessions WHERE id=@id`, { id: UID(sid) });
    const active = !!row && !row.ended_at && (!row.expires_at || new Date(row.expires_at) > new Date());
    cache.set(sid, { active, at: Date.now() });
    return active;
  } catch (e) { console.error('[sessions] check failed (allowing):', e.message); return true; } // fail open
}

const touched = new Map();
function touch(sid, force = false) {
  const last = touched.get(sid) || 0;
  if (!force && Date.now() - last < 5 * 60 * 1000) return;
  touched.set(sid, Date.now());
  if (touched.size > 5000) touched.clear();
  query(`UPDATE login_sessions SET last_seen_at = SYSUTCDATETIME() WHERE id=@id AND ended_at IS NULL`, { id: UID(sid) }).catch(() => {});
}

async function endSession(sid, reason = 'logout', by = null) {
  if (!sid) return;
  cache.set(sid, { active: false, at: Date.now() });
  await query(`UPDATE login_sessions SET ended_at = SYSUTCDATETIME(), end_reason=@r, revoked_by_user_id=@bu, revoked_by_name=@bn WHERE id=@id AND ended_at IS NULL`,
    { id: UID(sid), r: { type: sql.VarChar(20), value: reason }, bu: { type: sql.UniqueIdentifier, value: by?.userId || null }, bn: { type: sql.NVarChar(200), value: cut(by?.name, 200) } }).catch((e) => console.error('[sessions] end failed:', e.message));
}

// end every active session of one person (optionally keep the current one)
async function revokeAllFor({ type, userId = null, studentId = null, exceptSid = null, reason = 'remote', by = null }) {
  const col = type === 'student' ? 'student_id' : 'user_id'; const id = type === 'student' ? studentId : userId;
  if (!id) return 0;
  const ids = await query(`SELECT id FROM login_sessions WHERE ${col}=@p AND ended_at IS NULL AND (@ex IS NULL OR id <> @ex)`, { p: UID(id), ex: { type: sql.UniqueIdentifier, value: exceptSid || null } }).then((r) => r.recordset).catch(() => []);
  if (!ids.length) return 0;
  await query(`UPDATE login_sessions SET ended_at = SYSUTCDATETIME(), end_reason=@r, revoked_by_user_id=@bu, revoked_by_name=@bn WHERE ${col}=@p AND ended_at IS NULL AND (@ex IS NULL OR id <> @ex)`,
    { p: UID(id), ex: { type: sql.UniqueIdentifier, value: exceptSid || null }, r: { type: sql.VarChar(20), value: reason }, bu: { type: sql.UniqueIdentifier, value: by?.userId || null }, bn: { type: sql.NVarChar(200), value: cut(by?.name, 200) } });
  ids.forEach((r) => cache.set(r.id, { active: false, at: Date.now() }));
  return ids.length;
}
const revokeStudentsByPhone = async (phone, reason = 'password_changed') => {
  const rows = await query(`SELECT student_id FROM student_credentials WHERE login_phone=@p`, { p: { type: sql.VarChar(20), value: phone } }).then((r) => r.recordset).catch(() => []);
  for (const r of rows) await revokeAllFor({ type: 'student', studentId: r.student_id, reason });
};
const revokeStudentByCredentialId = async (credId, reason = 'password_changed') => {
  const r = await queryOne(`SELECT student_id FROM student_credentials WHERE id=@id`, { id: UID(credId) }).catch(() => null);
  if (r) await revokeAllFor({ type: 'student', studentId: r.student_id, reason });
};

function recordFailure({ req, schoolId = null, type, identifier, reason }) {
  (async () => {
    await ensureTables(); const c = clientInfo(req);
    await query(`INSERT INTO login_failures (school_id, principal_type, identifier, reason, ip_address, device_name, platform, user_agent) VALUES (@s, @t, @i, @r, @ip, @dn, @pf, @ua)`,
      { s: { type: sql.UniqueIdentifier, value: schoolId }, t: { type: sql.VarChar(10), value: type }, i: { type: sql.NVarChar(255), value: cut(identifier, 255) }, r: { type: sql.VarChar(30), value: reason },
        ip: { type: sql.VarChar(64), value: c.ip }, dn: { type: sql.NVarChar(150), value: c.deviceName }, pf: { type: sql.VarChar(20), value: c.platform }, ua: { type: sql.NVarChar(400), value: c.ua } });
  })().catch(() => {});
}

module.exports = { ensureTables, createSession, check, touch, endSession, revokeAllFor, revokeStudentsByPhone, revokeStudentByCredentialId, recordFailure, clientInfo };
