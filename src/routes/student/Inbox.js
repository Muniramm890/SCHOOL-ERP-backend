// src/routes/student/Inbox.js — student inbox (chat view of announcements).
// Every handler only touches rows where the logged-in student is the recipient.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../../controllers/studentInboxController');
const { authenticateStudent } = require('../../middleware/studentAuth');

const replyLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.student?.studentId || req.ip),
  message: { success: false, message: 'Too many replies. Please slow down.' },
});

router.use(authenticateStudent);
router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.get('/:messageId', ctrl.getConversation);
router.get('/:messageId/replies', ctrl.pollReplies);
router.post('/:messageId/reply', replyLimiter, ctrl.reply);

module.exports = router;
