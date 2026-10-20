const router = require('express').Router();
const ctrl = require('../controllers/deviceTokenController').staff;
const { authenticate } = require('../middleware/auth');
router.use(authenticate);
router.post('/', ctrl.register);
router.delete('/', ctrl.unregister);
module.exports = router;
