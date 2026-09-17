// src/routes/transport.js
const router = require('express').Router();
const ctrl = require('../controllers/transportController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Level 1 — Vehicles
router.get('/vehicles', ctrl.listVehicles);
router.post('/vehicles', ctrl.createVehicle);
router.put('/vehicles/:id', ctrl.updateVehicle);
router.delete('/vehicles/:id', ctrl.deleteVehicle);

// Level 1 — Staff (drivers/conductors)
router.get('/staff', ctrl.listTransportStaff);
router.post('/staff', ctrl.createTransportStaff);
router.put('/staff/:id', ctrl.updateTransportStaff);
router.delete('/staff/:id', ctrl.deleteTransportStaff);

// Level 1 — Routes & Stops
router.get('/routes', ctrl.listRoutes);
router.post('/routes', ctrl.createRoute);
router.put('/routes/:id', ctrl.updateRoute);
router.delete('/routes/:id', ctrl.deleteRoute);
router.get('/routes/:routeId/stops', ctrl.listStops);
router.post('/routes/:routeId/stops', ctrl.createStop);
router.put('/stops/:id', ctrl.updateStop);
router.delete('/stops/:id', ctrl.deleteStop);

// Level 2 — Trip / Route Allocation
router.get('/trip-assignments', ctrl.listTripAssignments);
router.post('/trip-assignments', ctrl.assignTrip); // also handles 1-click replace

// Level 3 — Student Allocation
router.get('/allocations', ctrl.listAllocations);
router.post('/allocations', ctrl.allocateStudent);
router.delete('/allocations/:studentId', ctrl.deallocateStudent);

// GPS (self-hosted Traccar, per-school)
router.get('/gps/settings', ctrl.getTraccarSettings);
router.put('/gps/settings', ctrl.saveTraccarSettings);
router.get('/gps/devices', ctrl.listGpsDevices);
router.get('/gps/live', ctrl.getLivePositions);

module.exports = router;
