// src/services/traccarService.js
// ══════════════════════════════════════════════════
// Self-hosted Traccar integration — IoT/GPS-agnostic.
// Each school runs its OWN Traccar server (200+ protocols supported out of
// the box: Concox, Teltonika, Coban, Sinotrack...). We just call Traccar's
// REST API per school and normalize the response so the frontend map never
// needs to know which hardware vendor a school is using.
//
// Isolation: config is read from school_transport_settings keyed by
// schoolId — one school's positions can NEVER be fetched using another
// school's Traccar credentials, since the caller always supplies schoolId
// from req.user (JWT), never from client input.
// ══════════════════════════════════════════════════
const crypto = require('crypto');
const { queryOne, sql } = require('../config/db');

const ENC_KEY = crypto.createHash('sha256').update(process.env.TRANSPORT_ENC_KEY || 'change-this-in-env').digest(); // 32 bytes

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

async function getSchoolConfig(schoolId) {
  const row = await queryOne(
    `SELECT traccar_base_url, traccar_username, traccar_password_enc FROM school_transport_settings WHERE school_id=@sid AND is_active=1`,
    { sid: { type: sql.UniqueIdentifier, value: schoolId } }
  );
  if (!row) return null;
  return {
    baseUrl: row.traccar_base_url.replace(/\/+$/, ''),
    username: row.traccar_username,
    password: decrypt(row.traccar_password_enc),
  };
}

function authHeader(cfg) {
  return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
}

// GET /api/devices — used to populate the Vehicle master's device dropdown
async function fetchDevices(schoolId) {
  const cfg = await getSchoolConfig(schoolId);
  if (!cfg) throw new Error('Traccar is not configured for this school yet');
  const res = await fetch(`${cfg.baseUrl}/api/devices`, { headers: { Authorization: authHeader(cfg) } });
  if (!res.ok) throw new Error(`Traccar devices fetch failed: ${res.status}`);
  const devices = await res.json();
  return devices.map((d) => ({ id: d.id, uniqueId: d.uniqueId, name: d.name, status: d.status }));
}

// GET /api/positions — normalized, protocol-agnostic shape regardless of
// whether the underlying hardware is Concox/Teltonika/GT06/etc.
async function fetchLivePositions(schoolId) {
  const cfg = await getSchoolConfig(schoolId);
  if (!cfg) throw new Error('Traccar is not configured for this school yet');

  const [devicesRes, positionsRes] = await Promise.all([
    fetch(`${cfg.baseUrl}/api/devices`, { headers: { Authorization: authHeader(cfg) } }),
    fetch(`${cfg.baseUrl}/api/positions`, { headers: { Authorization: authHeader(cfg) } }),
  ]);
  if (!devicesRes.ok) throw new Error(`Traccar devices fetch failed: ${devicesRes.status}`);
  if (!positionsRes.ok) throw new Error(`Traccar positions fetch failed: ${positionsRes.status}`);

  const devices = await devicesRes.json();
  const positions = await positionsRes.json();
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  return positions.map((p) => {
    const dev = deviceById.get(p.deviceId);
    return {
      traccar_device_id: dev?.uniqueId || null,
      device_name: dev?.name || null,
      latitude: p.latitude,
      longitude: p.longitude,
      speed_kmh: p.speed ? Number((p.speed * 1.852).toFixed(1)) : 0, // Traccar reports knots → km/h
      heading: p.course || 0,
      ignition_on: p.attributes?.ignition ?? null,
      recorded_at: p.deviceTime || p.fixTime,
    };
  });
}

module.exports = { encrypt, decrypt, getSchoolConfig, fetchDevices, fetchLivePositions };
