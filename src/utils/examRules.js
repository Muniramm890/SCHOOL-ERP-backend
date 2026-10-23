// src/utils/examRules.js - one place for the Exam Management + Results rules (statuses, validation, errors, grade lookup)
const { query, sql } = require('../config/db');
const { error } = require('./response');

// ── statuses (kept in sync with CHECK constraints in src/db/sql/exam_v2_migration.sql) ──
const MARK_STATUSES = ['present', 'absent', 'leave', 'tc', 'malpractice', 'exempted'];
const EXEMPT = new Set(['leave', 'tc', 'exempted']);        // subject ignored for this student (not a fail, not in max)
const FAILING = new Set(['absent', 'malpractice']);         // counts in max, scores 0, makes the student fail
const EXAM_STATUSES = ['draft', 'scheduled', 'ongoing', 'completed', 'published'];
const RESULT_STATUSES = ['pass', 'fail', 'incomplete'];

class ApiError extends Error { constructor(status, message, errors) { super(message); this.status = status; this.errors = errors || null; } }
const bad = (m, errors) => new ApiError(400, m, errors);
const notFound = (m) => new ApiError(404, m);
const conflict = (m, errors) => new ApiError(409, m, errors);
const forbidden = (m) => new ApiError(403, m);

// async route wrapper: ApiError -> clean JSON, duplicate-key -> 409, everything else -> global error handler
const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) {
    if (e instanceof ApiError) return error(res, e.message, e.status, e.errors);
    if (e && (e.number === 2601 || e.number === 2627)) return error(res, 'This record already exists.', 409);
    return next(e);
  }
};

const U = (v) => ({ type: sql.UniqueIdentifier, value: v });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const needUuid = (v, name) => { if (!isUuid(v)) throw bad(`${name} is invalid`); return v; };
const isYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const cents = (n) => Math.round(Number(n) * 100);

// optional columns are detected once (so deploy-before-migration never breaks publish)
let _feat = null, _featAt = 0;
async function features() {
  if (_feat && Date.now() - _featAt < 60000) return _feat;
  try {
    const r = await query(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='exam_groups' AND COLUMN_NAME IN ('published_at','published_by')`);
    _feat = { publishCols: r.recordset[0].n === 2 };
  } catch { _feat = { publishCols: false }; }
  _featAt = Date.now();
  return _feat;
}

async function loadExam(schoolId, examId) {
  needUuid(examId, 'exam id');
  const r = await query(`SELECT * FROM exam_groups WHERE id=@id AND school_id=@sid AND deleted_at IS NULL`, { id: U(examId), sid: U(schoolId) });
  if (!r.recordset.length) throw notFound('Exam not found');
  return r.recordset[0];
}
const assertEditable = (exam) => {
  if (exam.status === 'published') throw conflict('Results are published. Unpublish the exam before changing the date sheet, marks or results.');
};

// highest band whose minimum the percentage reaches (no gaps between bands can leave a student ungraded)
const gradeFor = (scale, pct) => { for (const g of scale) if (pct >= Number(g.min_percent)) return g.grade_label; return null; };

module.exports = {
  MARK_STATUSES, EXEMPT, FAILING, EXAM_STATUSES, RESULT_STATUSES,
  ApiError, bad, notFound, conflict, forbidden, handle,
  U, isUuid, needUuid, isYmd, ymd, round2, cents, features, loadExam, assertEditable, gradeFor,
};
