// src/routes/driver.js
const express = require('express');
const ctrl = require('../controllers/trackerController');
const { authenticate } = require('../middleware/auth');
const { authenticateTracker } = require('../services/trackerService');

const router = express.Router();
router.get('/me', authenticate, ctrl.me);
router.post('/tracker-token', authenticate, ctrl.issueToken);
router.post('/locations', authenticateTracker, ctrl.locations);
module.exports = router;
