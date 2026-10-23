// src/routes/exams.js
const router = require('express').Router();
const ctrl = require('../controllers/examController'); // Verify exact casing/pluralization of your controller file
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Exam Group Management
router.get('/', ctrl.listExams);
router.post('/', authorize('school_admin'), ctrl.createExam);
router.get('/:id', ctrl.getExam);
router.put('/:id', authorize('school_admin'), ctrl.updateExam);
router.delete('/:id', authorize('school_admin'), ctrl.deleteExam);
router.put('/:id/classes', authorize('school_admin'), ctrl.setExamClasses);

// Date Sheet Management
router.get('/:id/datesheet', ctrl.getDatesheet);
router.put('/:id/datesheet', authorize('school_admin'), ctrl.saveDatesheet);
router.delete('/:id/datesheet/:rowId', authorize('school_admin'), ctrl.deleteDatesheetRow);

// Marks Entry
router.get('/:id/marks-roster', ctrl.getMarksRoster);
router.post('/:id/marks', authorize('school_admin', 'teacher'), ctrl.saveMarks);

// Results Processing & Publishing
router.get('/:id/results', ctrl.getResults);
router.put('/:id/publish', authorize('school_admin'), ctrl.publishExam);
router.put('/:id/unpublish', authorize('school_admin'), ctrl.unpublishExam);
router.delete('/:id/results/:studentId', authorize('school_admin'), ctrl.deleteStudentResult);

module.exports = router;
