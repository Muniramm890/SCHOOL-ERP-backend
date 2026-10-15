//src/routes/arrangement.js 
const router = require('express').Router();
const ctrl = require('../controllers/arrangementController');
const { authenticate, authorize } = require('../middleware/auth');

// [module-permissions] pehle: router.use(authenticate, authorize('admin', 'principal')) — role names 'admin'/'principal' exist nahi karte the,
// isse module sirf school_admin tak limited tha. Ab access server.js ke moduleGate (User Management permission) se control hota hai.
router.use(authenticate);

router.get('/draft', ctrl.getDraft);
router.post('/confirm', ctrl.confirmArrangement);
router.delete('/:id', ctrl.cancelEntry);
router.get('/history', ctrl.listHistory);
router.post('/notify', ctrl.notifySubstitutes);

module.exports = router;