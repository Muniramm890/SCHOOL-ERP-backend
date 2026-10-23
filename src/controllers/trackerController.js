// src/controllers/trackerController.js — endpoints used by the Admin app on the bus phone (driver account)
const { success, forbidden } = require('../utils/response');
const tracker = require('../services/trackerService');

// GET /api/driver/me  (normal login token) — is this account a driver, and which bus is he on?
exports.me = async (req, res, next) => {
  try {
    const info = await tracker.resolveDriver(req.user.userId, req.user.schoolId, { fresh: true });
    return success(res, { is_driver: info.is_driver, name: info.name, vehicle: info.vehicle, route: info.route });
  } catch (err) { next(err); }
};

// POST /api/driver/tracker-token  (normal login token) — long-lived, location-only token for the native background service
exports.issueToken = async (req, res, next) => {
  try {
    const info = await tracker.resolveDriver(req.user.userId, req.user.schoolId, { fresh: true });
    if (!info.is_driver) return forbidden(res, 'This account is not linked to a driver profile. Please ask the school office.');
    const token = await tracker.createToken(req.user.userId, req.user.schoolId);
    return success(res, { token });
  } catch (err) { next(err); }
};

// POST /api/driver/locations  (tracker token) body: { points: [{lat,lng,t,speed_kmh,heading,accuracy_m}], battery, app_version, device }
exports.locations = async (req, res, next) => {
  try {
    const { userId, schoolId } = req.tracker;
    const info = await tracker.resolveDriver(userId, schoolId);
    if (!info.is_driver) return res.status(403).json({ success: false, message: 'Not a driver account' });
    if (!info.vehicle) return success(res, { accepted: 0, vehicle: null }, 'No bus assigned yet');
    const b = req.body || {};
    const accepted = await tracker.saveLocations(req.tracker, info.vehicle.id, b.points, { battery: b.battery, app_version: b.app_version, device: b.device });
    return success(res, { accepted, vehicle: info.vehicle });
  } catch (err) { next(err); }
};
