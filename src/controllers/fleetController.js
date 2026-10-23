// src/controllers/fleetController.js — live fleet snapshot for the Admin Live map (desktop + app)
const { query, sql } = require('../config/db');
const { success } = require('../utils/response');
const { ensureTables } = require('../services/trackerService');

// GET /api/transport/fleet/live
exports.fleetLive = async (req, res, next) => {
  try {
    await ensureTables();
    const r = await query(
      `SELECT v.id AS vehicle_id, v.registration_no, v.vehicle_type,
              p.latitude, p.longitude, p.speed_kmh, p.heading, p.recorded_at, p.updated_at, p.source, p.battery_pct,
              DATEDIFF(SECOND, p.updated_at, SYSUTCDATETIME()) AS age_sec,
              a.route_name, a.driver_name, a.driver_phone
       FROM transport_vehicles v
       LEFT JOIN transport_vehicle_positions p ON p.vehicle_id = v.id AND p.school_id = v.school_id
       OUTER APPLY (
         SELECT TOP 1 r.name AS route_name, ts.full_name AS driver_name, ts.phone AS driver_phone
         FROM transport_trip_assignments ta
         LEFT JOIN transport_routes r ON r.id = ta.route_id
         LEFT JOIN transport_staff ts ON ts.id = ta.driver_id
         WHERE ta.vehicle_id = v.id AND ta.school_id = v.school_id AND ta.status = 'active'
         ORDER BY ta.effective_from DESC, ta.created_at DESC) a
       WHERE v.school_id = @sid AND v.deleted_at IS NULL
       ORDER BY v.registration_no`, { sid: { type: sql.UniqueIdentifier, value: req.user.schoolId } });
    return success(res, r.recordset);
  } catch (err) { next(err); }
};

// GET /api/transport/map-config
//  - default: free OpenStreetMap (no key, no billing)
//  - optional MAP_TILE_URL / MAP_TILE_ATTRIBUTION: another tile provider, e.g. MapTiler/Stadia (https://.../{z}/{x}/{y}.png?key=...)
//  - optional GOOGLE_MAPS_API_KEY: use Google Maps instead (key is public by design; restrict it by HTTP referrer)
exports.mapConfig = (req, res) => success(res, {
  google_maps_key: process.env.GOOGLE_MAPS_API_KEY || null,
  tile_url: process.env.MAP_TILE_URL || null,
  tile_attribution: process.env.MAP_TILE_ATTRIBUTION || null,
});
