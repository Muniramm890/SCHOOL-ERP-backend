// src/controllers/transportController.js
// ══════════════════════════════════════════════════
// TRANSPORT MANAGEMENT — 3-level SaaS-safe flow:
//   Level 1: Masters (vehicles, staff, routes, stops)
//   Level 2: Trip/Route Allocation (vehicle+driver+conductor ↔ route, swappable)
//   Level 3: Student Allocation (route+stop → auto bus + auto fee)
//
// EVERY query is scoped by req.user.schoolId (from JWT via authenticate
// middleware) — client input is NEVER trusted for tenant scoping.
// ══════════════════════════════════════════════════
const { query, queryOne, withTransaction, sql } = require('../config/db');
const { success, created, notFound, badRequest } = require('../utils/response');
const { v4: uuidv4 } = require('uuid');
const { logAudit } = require('../utils/auditLogger');

const uid = (v) => ({ type: sql.UniqueIdentifier, value: v });

// ══════════════════════════════ LEVEL 1: VEHICLES ══════════════════════════════
exports.listVehicles = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const rows = await query(
      `SELECT * FROM transport_vehicles WHERE school_id=@sid AND deleted_at IS NULL ORDER BY registration_no`,
      { sid: uid(schoolId) }
    );
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

exports.createVehicle = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const b = req.body;
    if (!b.registration_no || !b.vehicle_type || !b.seating_capacity) {
      return badRequest(res, 'registration_no, vehicle_type, seating_capacity are required');
    }
    const clash = await queryOne(
      `SELECT id FROM transport_vehicles WHERE school_id=@sid AND registration_no=@reg AND deleted_at IS NULL`,
      { sid: uid(schoolId), reg: { type: sql.NVarChar(20), value: b.registration_no.trim().toUpperCase() } }
    );
    if (clash) return badRequest(res, 'A vehicle with this registration number already exists');

    const id = uuidv4();
    await query(
      `INSERT INTO transport_vehicles (id, school_id, registration_no, vehicle_type, seating_capacity,
         fitness_cert_no, fitness_expiry, insurance_no, insurance_expiry, puc_no, puc_expiry, permit_no, permit_expiry,
         gps_provider, device_imei, sim_number, traccar_device_id, status, created_by)
       VALUES (@id,@sid,@reg,@type,@cap,@fcn,@fce,@ins,@ine,@puc,@puce,@perm,@perme,@gps,@imei,@sim,@tdid,'active',@by)`,
      {
        id: uid(id), sid: uid(schoolId),
        reg: { type: sql.NVarChar(20), value: b.registration_no.trim().toUpperCase() },
        type: { type: sql.VarChar(20), value: b.vehicle_type },
        cap: { type: sql.SmallInt, value: b.seating_capacity },
        fcn: { type: sql.NVarChar(50), value: b.fitness_cert_no || null },
        fce: { type: sql.Date, value: b.fitness_expiry || null },
        ins: { type: sql.NVarChar(50), value: b.insurance_no || null },
        ine: { type: sql.Date, value: b.insurance_expiry || null },
        puc: { type: sql.NVarChar(50), value: b.puc_no || null },
        puce: { type: sql.Date, value: b.puc_expiry || null },
        perm: { type: sql.NVarChar(50), value: b.permit_no || null },
        perme: { type: sql.Date, value: b.permit_expiry || null },
        gps: { type: sql.VarChar(30), value: b.gps_provider || null },
        imei: { type: sql.VarChar(20), value: b.device_imei || null },
        sim: { type: sql.VarChar(15), value: b.sim_number || null },
        tdid: { type: sql.VarChar(50), value: b.traccar_device_id || null },
        by: uid(userId),
      }
    );
    await logAudit({ schoolId, userId, actionType: 'TRANSPORT_VEHICLE_CREATED', details: { registration_no: b.registration_no } });
    return created(res, { id }, 'Vehicle added');
  } catch (err) { next(err); }
};

exports.updateVehicle = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const { id } = req.params;
    const b = req.body;
    const existing = await queryOne(`SELECT id FROM transport_vehicles WHERE id=@id AND school_id=@sid AND deleted_at IS NULL`, { id: uid(id), sid: uid(schoolId) });
    if (!existing) return notFound(res, 'Vehicle not found');

    await query(
      `UPDATE transport_vehicles SET
         vehicle_type=@type, seating_capacity=@cap,
         fitness_cert_no=@fcn, fitness_expiry=@fce, insurance_no=@ins, insurance_expiry=@ine,
         puc_no=@puc, puc_expiry=@puce, permit_no=@perm, permit_expiry=@perme,
         gps_provider=@gps, device_imei=@imei, sim_number=@sim, traccar_device_id=@tdid,
         status=@status, updated_at=GETUTCDATE()
       WHERE id=@id AND school_id=@sid`,
      {
        id: uid(id), sid: uid(schoolId),
        type: { type: sql.VarChar(20), value: b.vehicle_type },
        cap: { type: sql.SmallInt, value: b.seating_capacity },
        fcn: { type: sql.NVarChar(50), value: b.fitness_cert_no || null },
        fce: { type: sql.Date, value: b.fitness_expiry || null },
        ins: { type: sql.NVarChar(50), value: b.insurance_no || null },
        ine: { type: sql.Date, value: b.insurance_expiry || null },
        puc: { type: sql.NVarChar(50), value: b.puc_no || null },
        puce: { type: sql.Date, value: b.puc_expiry || null },
        perm: { type: sql.NVarChar(50), value: b.permit_no || null },
        perme: { type: sql.Date, value: b.permit_expiry || null },
        gps: { type: sql.VarChar(30), value: b.gps_provider || null },
        imei: { type: sql.VarChar(20), value: b.device_imei || null },
        sim: { type: sql.VarChar(15), value: b.sim_number || null },
        tdid: { type: sql.VarChar(50), value: b.traccar_device_id || null },
        status: { type: sql.VarChar(20), value: b.status || 'active' },
      }
    );
    return success(res, null, 'Vehicle updated');
  } catch (err) { next(err); }
};

exports.deleteVehicle = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const { id } = req.params;
    const active = await queryOne(
      `SELECT id FROM transport_trip_assignments WHERE vehicle_id=@id AND school_id=@sid AND status='active'`,
      { id: uid(id), sid: uid(schoolId) }
    );
    if (active) return badRequest(res, 'This vehicle is currently assigned to an active route — reassign or end that trip first');

    await query(`UPDATE transport_vehicles SET deleted_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`, { id: uid(id), sid: uid(schoolId) });
    await logAudit({ schoolId, userId, actionType: 'TRANSPORT_VEHICLE_DELETED', details: { vehicleId: id } });
    return success(res, null, 'Vehicle removed');
  } catch (err) { next(err); }
};

// ══════════════════════════════ LEVEL 1: STAFF (drivers/conductors) ══════════════════════════════
exports.listTransportStaff = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { role } = req.query; // optional filter: 'driver' | 'conductor'
    const rows = await query(
      `SELECT * FROM transport_staff WHERE school_id=@sid AND deleted_at IS NULL ${role ? 'AND role=@role' : ''} ORDER BY full_name`,
      role ? { sid: uid(schoolId), role: { type: sql.VarChar(20), value: role } } : { sid: uid(schoolId) }
    );
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

exports.createTransportStaff = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const b = req.body;
    if (!b.full_name || !b.role || !b.phone) return badRequest(res, 'full_name, role, phone are required');
    if (!['driver', 'conductor'].includes(b.role)) return badRequest(res, "role must be 'driver' or 'conductor'");

    const id = uuidv4();
    await query(
      `INSERT INTO transport_staff (id, school_id, user_id, full_name, role, phone, license_no, license_expiry, is_verified, status, created_by)
       VALUES (@id,@sid,@uid,@name,@role,@phone,@lic,@lice,@ver,'active',@by)`,
      {
        id: uid(id), sid: uid(schoolId),
        uid: { type: sql.UniqueIdentifier, value: b.user_id || null },
        name: { type: sql.NVarChar(150), value: b.full_name },
        role: { type: sql.VarChar(20), value: b.role },
        phone: { type: sql.VarChar(15), value: b.phone },
        lic: { type: sql.NVarChar(50), value: b.license_no || null },
        lice: { type: sql.Date, value: b.license_expiry || null },
        ver: { type: sql.Bit, value: !!b.is_verified },
        by: uid(userId),
      }
    );
    await logAudit({ schoolId, userId, actionType: 'TRANSPORT_STAFF_CREATED', details: { full_name: b.full_name, role: b.role } });
    return created(res, { id }, 'Transport staff added');
  } catch (err) { next(err); }
};

exports.updateTransportStaff = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const b = req.body;
    await query(
      `UPDATE transport_staff SET full_name=@name, phone=@phone, license_no=@lic, license_expiry=@lice,
         is_verified=@ver, status=@status, updated_at=GETUTCDATE()
       WHERE id=@id AND school_id=@sid`,
      {
        id: uid(id), sid: uid(schoolId),
        name: { type: sql.NVarChar(150), value: b.full_name },
        phone: { type: sql.VarChar(15), value: b.phone },
        lic: { type: sql.NVarChar(50), value: b.license_no || null },
        lice: { type: sql.Date, value: b.license_expiry || null },
        ver: { type: sql.Bit, value: !!b.is_verified },
        status: { type: sql.VarChar(20), value: b.status || 'active' },
      }
    );
    return success(res, null, 'Staff updated');
  } catch (err) { next(err); }
};

exports.deleteTransportStaff = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const active = await queryOne(
      `SELECT id FROM transport_trip_assignments WHERE (driver_id=@id OR conductor_id=@id) AND school_id=@sid AND status='active'`,
      { id: uid(id), sid: uid(schoolId) }
    );
    if (active) return badRequest(res, 'This staff member is on an active trip assignment — reassign first');
    await query(`UPDATE transport_staff SET deleted_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`, { id: uid(id), sid: uid(schoolId) });
    return success(res, null, 'Staff removed');
  } catch (err) { next(err); }
};

// ══════════════════════════════ LEVEL 1: ROUTES & STOPS ══════════════════════════════
exports.listRoutes = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { academic_year_id } = req.query;
    const ay = academic_year_id || (await queryOne(`SELECT id FROM academic_years WHERE school_id=@sid AND is_current=1`, { sid: uid(schoolId) }))?.id;
    if (!ay) return success(res, []);

    const rows = await query(
      `SELECT r.*,
         (SELECT COUNT(*) FROM transport_stops st WHERE st.route_id=r.id AND st.deleted_at IS NULL) AS stop_count,
         (SELECT TOP 1 v.registration_no FROM transport_trip_assignments ta
          JOIN transport_vehicles v ON v.id = ta.vehicle_id
          WHERE ta.route_id=r.id AND ta.status='active') AS current_vehicle
       FROM transport_routes r
       WHERE r.school_id=@sid AND r.academic_year_id=@ayid AND r.deleted_at IS NULL
       ORDER BY r.name`,
      { sid: uid(schoolId), ayid: uid(ay) }
    );
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

exports.createRoute = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const { name, shift, academic_year_id } = req.body;
    if (!name || !shift) return badRequest(res, 'name and shift are required');
    const ay = academic_year_id || (await queryOne(`SELECT id FROM academic_years WHERE school_id=@sid AND is_current=1`, { sid: uid(schoolId) }))?.id;
    if (!ay) return badRequest(res, 'No active academic year found');

    const id = uuidv4();
    await query(
      `INSERT INTO transport_routes (id, school_id, academic_year_id, name, shift, status, created_by)
       VALUES (@id,@sid,@ayid,@name,@shift,'active',@by)`,
      { id: uid(id), sid: uid(schoolId), ayid: uid(ay), name: { type: sql.NVarChar(150), value: name }, shift: { type: sql.VarChar(20), value: shift }, by: uid(userId) }
    );
    return created(res, { id }, 'Route created');
  } catch (err) { next(err); }
};

exports.updateRoute = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const { name, shift, status } = req.body;
    await query(
      `UPDATE transport_routes SET name=@name, shift=@shift, status=@status, updated_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`,
      { id: uid(id), sid: uid(schoolId), name: { type: sql.NVarChar(150), value: name }, shift: { type: sql.VarChar(20), value: shift }, status: { type: sql.VarChar(20), value: status || 'active' } }
    );
    return success(res, null, 'Route updated');
  } catch (err) { next(err); }
};

exports.deleteRoute = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const inUse = await queryOne(
      `SELECT id FROM student_transport_allocations WHERE route_id=@id AND school_id=@sid AND status='active' AND deleted_at IS NULL`,
      { id: uid(id), sid: uid(schoolId) }
    );
    if (inUse) return badRequest(res, 'Students are still allocated to this route — reassign them first');
    await query(`UPDATE transport_routes SET deleted_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`, { id: uid(id), sid: uid(schoolId) });
    return success(res, null, 'Route removed');
  } catch (err) { next(err); }
};

exports.listStops = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { routeId } = req.params;
    const rows = await query(
      `SELECT * FROM transport_stops WHERE route_id=@rid AND school_id=@sid AND deleted_at IS NULL ORDER BY sequence_no`,
      { rid: uid(routeId), sid: uid(schoolId) }
    );
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

exports.createStop = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { routeId } = req.params;
    const b = req.body;
    if (!b.stop_name || b.monthly_fare == null) return badRequest(res, 'stop_name and monthly_fare are required');

    const route = await queryOne(`SELECT id FROM transport_routes WHERE id=@rid AND school_id=@sid AND deleted_at IS NULL`, { rid: uid(routeId), sid: uid(schoolId) });
    if (!route) return notFound(res, 'Route not found');

    const nextSeq = await queryOne(`SELECT ISNULL(MAX(sequence_no),0)+1 AS n FROM transport_stops WHERE route_id=@rid AND deleted_at IS NULL`, { rid: uid(routeId) });

    const id = uuidv4();
    await query(
      `INSERT INTO transport_stops (id, school_id, route_id, stop_name, sequence_no, pickup_time, drop_time, monthly_fare_paise, latitude, longitude)
       VALUES (@id,@sid,@rid,@name,@seq,@pt,@dt,@fare,@lat,@lng)`,
      {
        id: uid(id), sid: uid(schoolId), rid: uid(routeId),
        name: { type: sql.NVarChar(150), value: b.stop_name },
        seq: { type: sql.SmallInt, value: nextSeq.n },
        pt: { type: sql.VarChar(8), value: b.pickup_time || null },
        dt: { type: sql.VarChar(8), value: b.drop_time || null },
        fare: { type: sql.BigInt, value: Math.round(Number(b.monthly_fare) * 100) }, // rupees → paise
        lat: { type: sql.Decimal(9, 6), value: b.latitude || null },
        lng: { type: sql.Decimal(9, 6), value: b.longitude || null },
      }
    );
    return created(res, { id }, 'Stop added');
  } catch (err) { next(err); }
};

exports.updateStop = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const b = req.body;
    await query(
      `UPDATE transport_stops SET stop_name=@name, pickup_time=@pt, drop_time=@dt, monthly_fare_paise=@fare,
         latitude=@lat, longitude=@lng, updated_at=GETUTCDATE()
       WHERE id=@id AND school_id=@sid`,
      {
        id: uid(id), sid: uid(schoolId),
        name: { type: sql.NVarChar(150), value: b.stop_name },
        pt: { type: sql.VarChar(8), value: b.pickup_time || null },
        dt: { type: sql.VarChar(8), value: b.drop_time || null },
        fare: { type: sql.BigInt, value: Math.round(Number(b.monthly_fare) * 100) },
        lat: { type: sql.Decimal(9, 6), value: b.latitude || null },
        lng: { type: sql.Decimal(9, 6), value: b.longitude || null },
      }
    );
    return success(res, null, 'Stop updated');
  } catch (err) { next(err); }
};

exports.deleteStop = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const inUse = await queryOne(
      `SELECT id FROM student_transport_allocations WHERE stop_id=@id AND school_id=@sid AND status='active' AND deleted_at IS NULL`,
      { id: uid(id), sid: uid(schoolId) }
    );
    if (inUse) return badRequest(res, 'Students are still allocated to this stop');
    await query(`UPDATE transport_stops SET deleted_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`, { id: uid(id), sid: uid(schoolId) });
    return success(res, null, 'Stop removed');
  } catch (err) { next(err); }
};

// ══════════════════════════════ LEVEL 2: TRIP ASSIGNMENT ══════════════════════════════
exports.listTripAssignments = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const rows = await query(
      `SELECT ta.*, r.name AS route_name, v.registration_no, d.full_name AS driver_name, c.full_name AS conductor_name
       FROM transport_trip_assignments ta
       JOIN transport_routes r ON r.id = ta.route_id
       JOIN transport_vehicles v ON v.id = ta.vehicle_id
       JOIN transport_staff d ON d.id = ta.driver_id
       LEFT JOIN transport_staff c ON c.id = ta.conductor_id
       WHERE ta.school_id=@sid AND ta.status='active'
       ORDER BY r.name`,
      { sid: uid(schoolId) }
    );
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

// Assign OR 1-click replace (breakdown scenario) — student allocations untouched,
// because students are linked to route_id, not vehicle_id.
exports.assignTrip = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const { route_id, vehicle_id, driver_id, conductor_id } = req.body;
    if (!route_id || !vehicle_id || !driver_id) return badRequest(res, 'route_id, vehicle_id, driver_id are required');

    const ay = (await queryOne(`SELECT id FROM academic_years WHERE school_id=@sid AND is_current=1`, { sid: uid(schoolId) }))?.id;
    if (!ay) return badRequest(res, 'No active academic year found');

    // vehicle/driver must not already be active on a DIFFERENT route
    const vClash = await queryOne(
      `SELECT id FROM transport_trip_assignments WHERE school_id=@sid AND vehicle_id=@vid AND status='active' AND route_id<>@rid`,
      { sid: uid(schoolId), vid: uid(vehicle_id), rid: uid(route_id) }
    );
    if (vClash) return badRequest(res, 'This vehicle is already assigned to another active route');

    let newId;
    await withTransaction(async (tx) => {
      // end whatever is currently active on this route (swap/replace)
      const endReq = tx.request();
      endReq.input('sid', sql.UniqueIdentifier, schoolId);
      endReq.input('rid', sql.UniqueIdentifier, route_id);
      await endReq.query(
        `UPDATE transport_trip_assignments SET status='replaced', effective_to=CAST(GETUTCDATE() AS DATE)
         WHERE school_id=@sid AND route_id=@rid AND status='active'`
      );

      newId = uuidv4();
      const insReq = tx.request();
      insReq.input('id', sql.UniqueIdentifier, newId);
      insReq.input('sid', sql.UniqueIdentifier, schoolId);
      insReq.input('ayid', sql.UniqueIdentifier, ay);
      insReq.input('rid', sql.UniqueIdentifier, route_id);
      insReq.input('vid', sql.UniqueIdentifier, vehicle_id);
      insReq.input('did', sql.UniqueIdentifier, driver_id);
      insReq.input('cid', sql.UniqueIdentifier, conductor_id || null);
      insReq.input('by', sql.UniqueIdentifier, userId);
      await insReq.query(
        `INSERT INTO transport_trip_assignments (id, school_id, academic_year_id, route_id, vehicle_id, driver_id, conductor_id, effective_from, status, created_by)
         VALUES (@id,@sid,@ayid,@rid,@vid,@did,@cid,CAST(GETUTCDATE() AS DATE),'active',@by)`
      );
    });

    await logAudit({ schoolId, userId, actionType: 'TRANSPORT_TRIP_ASSIGNED', details: { route_id, vehicle_id, driver_id } });
    return created(res, { id: newId }, 'Trip assignment saved — students on this route are unaffected');
  } catch (err) { next(err); }
};

// ══════════════════════════════ LEVEL 3: STUDENT ALLOCATION ══════════════════════════════
exports.listAllocations = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { routeId } = req.query;
    const rows = await query(
      `SELECT sta.*, s.first_name + ' ' + ISNULL(s.last_name,'') AS student_name, s.admission_no,
              r.name AS route_name, st.stop_name,
              (SELECT TOP 1 v.registration_no FROM transport_trip_assignments ta
               JOIN transport_vehicles v ON v.id=ta.vehicle_id
               WHERE ta.route_id=sta.route_id AND ta.status='active') AS assigned_vehicle
       FROM student_transport_allocations sta
       JOIN students s ON s.id = sta.student_id
       JOIN transport_routes r ON r.id = sta.route_id
       JOIN transport_stops st ON st.id = sta.stop_id
       WHERE sta.school_id=@sid AND sta.status='active' AND sta.deleted_at IS NULL
       ${routeId ? 'AND sta.route_id=@rid' : ''}
       ORDER BY s.first_name`,
      routeId ? { sid: uid(schoolId), rid: uid(routeId) } : { sid: uid(schoolId) }
    );
    return success(res, rows.recordset);
  } catch (err) { next(err); }
};

// Stop select hote hi: bus + fee dono auto-resolve
exports.allocateStudent = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.user;
    const { student_id, route_id, stop_id } = req.body;
    if (!student_id || !route_id || !stop_id) return badRequest(res, 'student_id, route_id, stop_id are required');

    const ay = (await queryOne(`SELECT id FROM academic_years WHERE school_id=@sid AND is_current=1`, { sid: uid(schoolId) }))?.id;
    if (!ay) return badRequest(res, 'No active academic year found');

    const stop = await queryOne(
      `SELECT monthly_fare_paise FROM transport_stops WHERE id=@sid2 AND route_id=@rid AND school_id=@sid AND deleted_at IS NULL`,
      { sid2: uid(stop_id), rid: uid(route_id), sid: uid(schoolId) }
    );
    if (!stop) return notFound(res, 'Stop not found on this route');

    const existing = await queryOne(
      `SELECT id FROM student_transport_allocations WHERE school_id=@sid AND student_id=@uid AND academic_year_id=@ayid AND deleted_at IS NULL`,
      { sid: uid(schoolId), uid: uid(student_id), ayid: uid(ay) }
    );

    if (existing) {
      await query(
        `UPDATE student_transport_allocations SET route_id=@rid, stop_id=@sid2, monthly_fee_paise=@fee, status='active', updated_at=GETUTCDATE()
         WHERE id=@id`,
        { id: uid(existing.id), rid: uid(route_id), sid2: uid(stop_id), fee: { type: sql.BigInt, value: Number(stop.monthly_fare_paise) } }
      );
    } else {
      await query(
        `INSERT INTO student_transport_allocations (id, school_id, academic_year_id, student_id, route_id, stop_id, monthly_fee_paise, status, created_by)
         VALUES (@id,@sid,@ayid,@uid,@rid,@sid2,@fee,'active',@by)`,
        {
          id: uid(uuidv4()), sid: uid(schoolId), ayid: uid(ay), uid: uid(student_id), rid: uid(route_id), sid2: uid(stop_id),
          fee: { type: sql.BigInt, value: Number(stop.monthly_fare_paise) }, by: uid(userId),
        }
      );
    }

    // auto-fetch currently assigned bus (Level 2) so frontend can show it immediately
    const bus = await queryOne(
      `SELECT v.registration_no FROM transport_trip_assignments ta JOIN transport_vehicles v ON v.id=ta.vehicle_id
       WHERE ta.route_id=@rid AND ta.status='active'`,
      { rid: uid(route_id) }
    );

    return success(res, {
      monthly_fee: Number(stop.monthly_fare_paise) / 100,
      assigned_vehicle: bus?.registration_no || null,
    }, 'Student allocated to transport — fee will apply from next invoice generation');
  } catch (err) { next(err); }
};

exports.deallocateStudent = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { studentId } = req.params;
    await query(
      `UPDATE student_transport_allocations SET status='inactive', deleted_at=GETUTCDATE() WHERE school_id=@sid AND student_id=@uid AND status='active'`,
      { sid: uid(schoolId), uid: uid(studentId) }
    );
    return success(res, null, 'Student removed from transport');
  } catch (err) { next(err); }
};

// ══════════════════════════════ TRACCAR (self-hosted GPS) ══════════════════════════════
const traccar = require('../services/traccarService');

// GET /transport/gps/settings — never returns the password back to the client
exports.getTraccarSettings = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const row = await queryOne(
      `SELECT traccar_base_url, traccar_username, is_active FROM school_transport_settings WHERE school_id=@sid`,
      { sid: uid(schoolId) }
    );
    return success(res, row || null);
  } catch (err) { next(err); }
};

// PUT /transport/gps/settings — each school points at its OWN self-hosted Traccar server
exports.saveTraccarSettings = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const { traccar_base_url, traccar_username, traccar_password } = req.body;
    if (!traccar_base_url || !traccar_username || !traccar_password) {
      return badRequest(res, 'traccar_base_url, traccar_username, traccar_password are required');
    }
    const encPwd = traccar.encrypt(traccar_password);

    await query(
      `MERGE school_transport_settings AS t
       USING (SELECT @sid AS sid) s ON (t.school_id = s.sid)
       WHEN MATCHED THEN UPDATE SET traccar_base_url=@url, traccar_username=@usr, traccar_password_enc=@pwd, is_active=1, updated_at=GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (school_id, traccar_base_url, traccar_username, traccar_password_enc, is_active)
         VALUES (@sid, @url, @usr, @pwd, 1);`,
      {
        sid: uid(schoolId),
        url: { type: sql.NVarChar(300), value: traccar_base_url.trim() },
        usr: { type: sql.NVarChar(150), value: traccar_username.trim() },
        pwd: { type: sql.NVarChar(500), value: encPwd },
      }
    );
    return success(res, null, 'Traccar connection saved');
  } catch (err) { next(err); }
};

// GET /transport/gps/devices — for the "Device IMEI" dropdown in Vehicle master
exports.listGpsDevices = async (req, res, next) => {
  try {
    const devices = await traccar.fetchDevices(req.user.schoolId);
    return success(res, devices);
  } catch (err) { return badRequest(res, err.message); }
};

// GET /transport/gps/live — polls this school's OWN Traccar, matches by device_imei
// stored on transport_vehicles, caches into transport_vehicle_positions, returns for the map
exports.getLivePositions = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const positions = await traccar.fetchLivePositions(schoolId);

    const vehicles = await query(
      `SELECT id, registration_no, device_imei, traccar_device_id FROM transport_vehicles WHERE school_id=@sid AND deleted_at IS NULL AND device_imei IS NOT NULL`,
      { sid: uid(schoolId) }
    );

    const result = [];
    for (const v of vehicles.recordset) {
      const pos = positions.find((p) => p.traccar_device_id === v.traccar_device_id || p.traccar_device_id === v.device_imei);
      if (!pos) continue;

      await query(
        `MERGE transport_vehicle_positions AS t
         USING (SELECT @vid AS vid) s ON (t.vehicle_id = s.vid)
         WHEN MATCHED THEN UPDATE SET latitude=@lat, longitude=@lng, speed_kmh=@spd, heading=@hdg, ignition_on=@ign, recorded_at=@rec, updated_at=GETUTCDATE()
         WHEN NOT MATCHED THEN INSERT (vehicle_id, school_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at)
           VALUES (@vid, @sid, @lat, @lng, @spd, @hdg, @ign, @rec);`,
        {
          vid: uid(v.id), sid: uid(schoolId),
          lat: { type: sql.Decimal(9, 6), value: pos.latitude }, lng: { type: sql.Decimal(9, 6), value: pos.longitude },
          spd: { type: sql.Decimal(6, 2), value: pos.speed_kmh }, hdg: { type: sql.Decimal(6, 2), value: pos.heading },
          ign: { type: sql.Bit, value: pos.ignition_on }, rec: { type: sql.DateTime2, value: pos.recorded_at ? new Date(pos.recorded_at) : new Date() },
        }
      );

      result.push({ vehicle_id: v.id, registration_no: v.registration_no, ...pos });
    }
    return success(res, result);
  } catch (err) { return badRequest(res, err.message); }
};
