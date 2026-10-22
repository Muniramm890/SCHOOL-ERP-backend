// src/routes/files.js
const express = require('express');
const ctrl = require('../controllers/filesController');
const { authenticate } = require('../middleware/auth');
const { authenticateStudent } = require('../middleware/studentAuth');

const staff = express.Router();
staff.use(authenticate);                 // any logged-in staff member (admin / teacher / accountant ...)
staff.get('/pdf', ctrl.streamPdf);

const student = express.Router();
student.use(authenticateStudent);
student.get('/pdf', ctrl.streamPdf);

module.exports = { staff, student };
