// src/routes/security.js — login activity + remote logout (school admin only, like the audit trail)
const router = require('express').Router();
const ctrl = require('../controllers/securityController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize());
router.get('/summary', ctrl.summary);
router.get('/sessions', ctrl.listSessions);
router.post('/sessions/:id/revoke', ctrl.revokeSession);
router.post('/revoke-all', ctrl.revokeAll);
router.get('/failures', ctrl.failures);
router.get('/never-logged-in', ctrl.neverLoggedIn);
module.exports = router;
