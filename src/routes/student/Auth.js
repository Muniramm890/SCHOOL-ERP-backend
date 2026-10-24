///src/routes/student/Auth.js
const router = require('express').Router();
const ctrl = require('../../controllers/studentAuthController');
const forgotCtrl = require('../../controllers/studentForgotPasswordController');
const { authenticateStudent } = require('../../middleware/studentAuth');
const { otpSend, otpVerify, otpVerifyByIp } = require('../../middleware/rateLimiter'); // OTP send / guess limits

router.post('/login', ctrl.login);
router.post('/forgot-password/send-otp', ...otpSend, forgotCtrl.sendResetOtp);
router.post('/forgot-password/verify-otp', ...otpVerify, forgotCtrl.verifyResetOtp);
router.post('/forgot-password/reset', otpVerifyByIp, forgotCtrl.resetPassword);

router.get('/me', authenticateStudent, ctrl.me);
router.put('/me', authenticateStudent, ctrl.updateProfile);
router.post('/change-password', authenticateStudent, ctrl.changePassword);
router.post('/logout', authenticateStudent, ctrl.logout);

// My devices + log out another device
const security = require('../../controllers/securityController');
router.get('/sessions', authenticateStudent, security.mineStudent.list);
router.post('/sessions/:id/revoke', authenticateStudent, security.mineStudent.revoke);

module.exports = router;
