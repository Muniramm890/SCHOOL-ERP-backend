// src/services/trackerService.js
// 24x7 bus tracking from the DRIVER'S PHONE (Admin app, native Android service).
//  - The driver logs in with his own username; the app asks for a long-lived, location-only "tracker token".
//  - Every location post is mapped:  token -> user -> transport_staff (driver) -> active trip assignment -> vehicle.
//  - Latest point goes to transport_vehicle_positions (what the Live map reads); a throttled trail goes to
//    transport_position_history (30 days). Tables are created lazily (no manual migration needed).
const crypto = require('crypto');
const { query, queryOne, sql } = require('../config/db');

const UID = (v) => ({ type: sql.UniqueIdentifier, value: v });

let ready = null;
const ensureTables = () => ready || (ready = (async () => {
  await query(`IF OBJECT_ID(N'dbo.transport_tracker_tokens', N'U') IS NULL
    CREATE TABLE dbo.transport_tracker_tokens (
      id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ttok_id DEFAULT NEWID() CONSTRAINT PK_transport_tracker_tokens PRIMARY KEY,
      school_id UNIQUEIDENTIFIER NOT NULL, user_id UNIQUEIDENTIFIER NOT NULL, token_hash CHAR(64) NOT NULL,
      created_at DATETIME2 NOT NULL CONSTRAINT DF_ttok_created DEFAULT SYSUTCDATETIME(),
      last_seen_at DATETIME2 NULL, battery_pct TINYINT NULL, app_version NVARCHAR(30) NULL, device_model NVARCHAR(80) NULL, revoked_at DATETIME2 NULL)`);
  await query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ttok_hash' AND object_id = OBJECT_ID(N'dbo.transport_tracker_tokens'))
    CREATE UNIQUE INDEX UX_ttok_hash ON dbo.transport_tracker_tokens (token_hash)`);
  await query(`IF OBJECT_ID(N'dbo.transport_position_history', N'U') IS NULL
    CREATE TABLE dbo.transport_position_history (
      id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_transport_position_history PRIMARY KEY,
      school_id UNIQUEIDENTIFIER NOT NULL, vehicle_id UNIQUEIDENTIFIER NOT NULL, user_id UNIQUEIDENTIFIER NULL,
      latitude DECIMAL(9,6) NOT NULL, longitude DECIMAL(9,6) NOT NULL, speed_kmh DECIMAL(6,2) NULL, heading DECIMAL(6,2) NULL,
      accuracy_m DECIMAL(7,2) NULL, battery_pct TINYINT NULL, recorded_at DATETIME2 NOT NULL,
      received_at DATETIME2 NOT NULL CONSTRAINT DF_tph_received DEFAULT SYSUTCDATETIME())`);
  await query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tph_vehicle_time' AND object_id = OBJECT_ID(N'dbo.transport_position_history'))
    CREATE INDEX IX_tph_vehicle_time ON dbo.transport_position_history (vehicle_id, recorded_at)`);
  await query(`IF COL_LENGTH(N'dbo.transport_vehicle_positions', N'source') IS NULL ALTER TABLE dbo.transport_vehicle_positions ADD source VARCHAR(12) NULL`);
  await query(`IF COL_LENGTH(N'dbo.transport_vehicle_positions', N'battery_pct') IS NULL ALTER TABLE dbo.transport_vehicle_positions ADD battery_pct TINYINT NULL`);
})().catch((e) => { ready = null; throw e; }));

// ── tokens ──
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const authCache = new Map(); // hash -> { ctx, at }

async function createToken(userId, schoolId) {
  await ensureTables();
  await query(`UPDATE transport_tracker_tokens SET revoked_at = SYSUTCDATETIME() WHERE user_id=@u AND school_id=@s AND revoked_at IS NULL`, { u: UID(userId), s: UID(schoolId) });
  const token = 'trk_' + crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO transport_tracker_tokens (school_id, user_id, token_hash) VALUES (@s, @u, @h)`,
    { s: UID(schoolId), u: UID(userId), h: { type: sql.Char(64), value: hashToken(token) } });
  authCache.clear();
  return token;
}

const hits = new Map(); // token hash -> { n, at }  (very small per-device rate limit)
async function authenticateTracker(req, res, next) {
  try {
    const m = String(req.headers.authorization || '').match(/^Bearer (trk_[A-Za-z0-9_-]{20,})$/);
    if (!m) return res.status(401).json({ success: false, message: 'Invalid tracker token' });
    const hash = hashToken(m[1]);

    const w = hits.get(hash) || { n: 0, at: Date.now() };
    if (Date.now() - w.at > 600000) { w.n = 0; w.at = Date.now(); }
    if (++w.n > 400) return res.status(429).json({ success: false, message: 'Too many requests' });
    hits.set(hash, w);

    let hit = authCache.get(hash);
    if (!hit || Date.now() - hit.at > 60000) {
      await ensureTables();
      const row = await queryOne(
        `SELECT t.id AS token_id, t.school_id, t.user_id
         FROM transport_tracker_tokens t
         JOIN users u ON u.id = t.user_id AND u.is_active = 1 AND u.deleted_at IS NULL
         JOIN school_members sm ON sm.user_id = t.user_id AND sm.school_id = t.school_id AND sm.is_active = 1 AND sm.deleted_at IS NULL
         WHERE t.token_hash = @h AND t.revoked_at IS NULL`, { h: { type: sql.Char(64), value: hash } });
      if (!row) { authCache.delete(hash); return res.status(401).json({ success: false, message: 'Tracker token revoked' }); }
      hit = { ctx: { tokenId: row.token_id, schoolId: row.school_id, userId: row.user_id }, at: Date.now() };
      authCache.set(hash, hit);
    }
    req.tracker = hit.ctx;
    return next();
  } catch (err) { console.error('[tracker] auth failed:', err.message); return res.status(503).json({ success: false, message: 'Temporarily unavailable' }); }
}

// ── driver -> vehicle ──
const driverCache = new Map(); // `${schoolId}:${userId}` -> { info, at }
async function resolveDriver(userId, schoolId, { fresh = false } = {}) {
  const key = `${schoolId}:${userId}`;
  const c = driverCache.get(key);
  if (!fresh && c && Date.now() - c.at < 60000) return c.info;

  const staff = await queryOne(
    `SELECT TOP 1 id, full_name, phone FROM transport_staff
     WHERE user_id=@u AND school_id=@s AND deleted_at IS NULL AND status='active' AND LOWER(role)='driver'`, { u: UID(userId), s: UID(schoolId) });
  let info = { is_driver: false, staff_id: null, name: null, phone: null, vehicle: null, route: null };
  if (staff) {
    const a = await queryOne(
      `SELECT TOP 1 ta.vehicle_id, v.registration_no, ta.route_id, r.name AS route_name
       FROM transport_trip_assignments ta
       JOIN transport_vehicles v ON v.id = ta.vehicle_id AND v.deleted_at IS NULL
       LEFT JOIN transport_routes r ON r.id = ta.route_id
       WHERE ta.school_id=@s AND ta.driver_id=@d AND ta.status='active'
       ORDER BY ta.effective_from DESC, ta.created_at DESC`, { s: UID(schoolId), d: UID(staff.id) });
    info = {
      is_driver: true, staff_id: staff.id, name: staff.full_name, phone: staff.phone,
      vehicle: a ? { id: a.vehicle_id, registration_no: a.registration_no } : null,
      route: a && a.route_name ? { name: a.route_name } : null,
    };
  }
  driverCache.set(key, { info, at: Date.now() });
  return info;
}

// ── saving points ──
const lastStored = new Map(); // vehicleId -> { lat, lng, at }
const km = (a, b, c, d) => { const r = (x) => (x * Math.PI) / 180; const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

function cleanPoints(raw) {
  const now = Date.now(); const out = [];
  for (const p of (Array.isArray(raw) ? raw : []).slice(0, 200)) {
    const lat = num(p?.lat, -90, 90), lng = num(p?.lng, -180, 180);
    if (lat === null || lng === null || (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)) continue;
    let t = Number(p.t); if (!Number.isFinite(t)) t = now;       // epoch ms
    if (t > now + 300000) t = now;                                  // phone clock a bit ahead
    if (t < now - 7 * 86400000) continue;                           // too old
    out.push({ lat, lng, t, spd: num(p.speed_kmh, 0, 250), hdg: num(p.heading, 0, 360), acc: num(p.accuracy_m, 0, 100000), bat: num(p.battery, 0, 100) });
  }
  return out.sort((a, b) => a.t - b.t);
}

let lastPurge = 0;
async function saveLocations(ctx, vehicleId, rawPoints, meta = {}) {
  await ensureTables();
  const pts = cleanPoints(rawPoints);
  const bat = Number.isFinite(Number(meta.battery)) ? Math.max(0, Math.min(100, Math.round(Number(meta.battery)))) : null;
  const batP = { type: sql.TinyInt, value: bat };

  await query(`UPDATE transport_tracker_tokens SET last_seen_at=SYSUTCDATETIME(), battery_pct=@b, app_version=@v, device_model=@m WHERE id=@id`,
    { id: UID(ctx.tokenId), b: batP, v: { type: sql.NVarChar(30), value: String(meta.app_version || '').slice(0, 30) || null }, m: { type: sql.NVarChar(80), value: String(meta.device || '').slice(0, 80) || null } });

  if (!pts.length) { // heartbeat only: phone is alive, bus has not moved/produced a fix
    await query(`UPDATE transport_vehicle_positions SET updated_at=SYSUTCDATETIME(), battery_pct=@b WHERE vehicle_id=@v`, { v: UID(vehicleId), b: batP });
    return 0;
  }

  // trail: keep a point if the bus moved >= 15 m or >= 60 s passed (keeps a parked bus from flooding the table)
  const keep = []; let prev = lastStored.get(vehicleId);
  for (const p of pts) {
    if (!prev || p.t - prev.at >= 60000 || km(prev.lat, prev.lng, p.lat, p.lng) * 1000 >= 15) { keep.push(p); prev = { lat: p.lat, lng: p.lng, at: p.t }; }
  }
  if (keep.length) lastStored.set(vehicleId, prev);
  for (let i = 0; i < keep.length; i += 100) {
    const chunk = keep.slice(i, i + 100); const params = { s: UID(ctx.schoolId), v: UID(vehicleId), u: UID(ctx.userId) }; const rows = [];
    chunk.forEach((p, k) => {
      params['la' + k] = { type: sql.Decimal(9, 6), value: p.lat }; params['lo' + k] = { type: sql.Decimal(9, 6), value: p.lng };
      params['sp' + k] = { type: sql.Decimal(6, 2), value: p.spd }; params['hd' + k] = { type: sql.Decimal(6, 2), value: p.hdg };
      params['ac' + k] = { type: sql.Decimal(7, 2), value: p.acc }; params['ba' + k] = { type: sql.TinyInt, value: p.bat === null ? bat : Math.round(p.bat) };
      params['re' + k] = { type: sql.DateTime2, value: new Date(p.t) };
      rows.push(`(@s,@v,@u,@la${k},@lo${k},@sp${k},@hd${k},@ac${k},@ba${k},@re${k})`);
    });
    await query(`INSERT INTO transport_position_history (school_id, vehicle_id, user_id, latitude, longitude, speed_kmh, heading, accuracy_m, battery_pct, recorded_at) VALUES ${rows.join(',')}`, params);
  }

  const last = pts[pts.length - 1];
  await query(
    `MERGE transport_vehicle_positions AS t USING (SELECT @v AS vid) s ON t.vehicle_id = s.vid
     WHEN MATCHED AND (t.recorded_at IS NULL OR t.recorded_at <= @rec) THEN
       UPDATE SET latitude=@lat, longitude=@lng, speed_kmh=@spd, heading=@hdg, ignition_on=NULL, recorded_at=@rec, updated_at=SYSUTCDATETIME(), source='phone', battery_pct=@b
     WHEN MATCHED THEN UPDATE SET updated_at=SYSUTCDATETIME(), battery_pct=@b
     WHEN NOT MATCHED THEN INSERT (vehicle_id, school_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at, source, battery_pct)
       VALUES (@v, @s, @lat, @lng, @spd, @hdg, NULL, @rec, 'phone', @b);`,
    { v: UID(vehicleId), s: UID(ctx.schoolId), lat: { type: sql.Decimal(9, 6), value: last.lat }, lng: { type: sql.Decimal(9, 6), value: last.lng },
      spd: { type: sql.Decimal(6, 2), value: last.spd }, hdg: { type: sql.Decimal(6, 2), value: last.hdg }, rec: { type: sql.DateTime2, value: new Date(last.t) }, b: batP });

  if (Date.now() - lastPurge > 6 * 3600 * 1000) { // keep 30 days of trail
    lastPurge = Date.now();
    query(`DELETE TOP (20000) FROM transport_position_history WHERE recorded_at < DATEADD(DAY, -30, SYSUTCDATETIME())`).catch(() => {});
  }
  return pts.length;
}

module.exports = { ensureTables, createToken, authenticateTracker, resolveDriver, saveLocations };
