const router = require('express').Router();
const ctrl = require('../../controllers/deviceTokenController').student;
const { authenticateStudent } = require('../../middleware/studentAuth');
router.use(authenticateStudent);
router.post('/', ctrl.register);
router.delete('/', ctrl.unregister);
module.exports = router;
