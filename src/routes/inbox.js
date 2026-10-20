// src/routes/inbox.js — staff inbox (chat view of announcements). Any authenticated staff member;
// every handler only ever touches rows where the caller is the recipient.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/inboxController');
const { authenticate } = require('../middleware/auth');
const { uploadChatMedia } = require('../middleware/upload');

const replyLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId || req.ip),
  message: { success: false, message: 'Too many replies. Please slow down.' },
});

router.use(authenticate);
router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
// sender side of a private thread (school_admin / the sender): unlimited back-and-forth with ONE person
router.get('/thread/:messageId/:recipientId', ctrl.getSenderThread);
router.get('/thread/:messageId/:recipientId/replies', ctrl.pollSenderThread);
router.post('/thread/:messageId/:recipientId/reply', replyLimiter, uploadChatMedia, ctrl.replySenderThread);

router.get('/:messageId', ctrl.getConversation);
router.get('/:messageId/replies', ctrl.pollReplies);
router.post('/:messageId/reply', replyLimiter, uploadChatMedia, ctrl.reply);

module.exports = router;
