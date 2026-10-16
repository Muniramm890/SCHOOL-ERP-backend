const router = require('express').Router();
const ctrl = require('../controllers/commHubController');
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(authenticate);

router.post('/preview', ctrl.previewTargets);
router.get('/messages', ctrl.listMessages);
router.get('/messages/:id', ctrl.getMessage);
router.get('/messages/:id/viewers', ctrl.getViewers);
router.get('/messages/:id/threads', ctrl.listThreads);
router.get('/messages/:id/threads/:recipientId', ctrl.getThread);
router.post('/messages/:id/threads/:recipientId/reply', ctrl.replyThread);
router.post('/messages', authorize('admin', 'principal', 'teacher'), upload.uploadCommAttachment.array('attachments', 3), ctrl.createAndSend);

module.exports = router;
