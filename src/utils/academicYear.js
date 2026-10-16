// src/utils/academicYear.js
// Optional ?academic_year_id= support (topbar "session" of the frontend).
//  - not sent  -> returns null  => every route keeps its previous behaviour
//  - sent      -> validated against req.user.schoolId (a year of another school is never accepted)
const { queryOne, sql } = require('../config/db');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const httpError = (status, message) => { const e = new Error(message); e.status = status; return e; };

/**
 * @returns {Promise<null | {id, name, start_date, end_date}>}  dates are 'YYYY-MM-DD'
 */
const getYearScope = async (req) => {
  const raw = req.query && req.query.academic_year_id;
  if (!raw) return null;
  if (!GUID_RE.test(String(raw))) throw httpError(400, 'Invalid academic_year_id');

  const row = await queryOne(
    `SELECT id, name,
            CONVERT(VARCHAR(10), start_date, 23) AS start_date,
            CONVERT(VARCHAR(10), end_date,   23) AS end_date
     FROM academic_years
     WHERE id = @id AND school_id = @sid AND deleted_at IS NULL`,
    {
      id:  { type: sql.UniqueIdentifier, value: raw },
      sid: { type: sql.UniqueIdentifier, value: req.user.schoolId },
    }
  );
  if (!row) throw httpError(404, 'Academic year not found');
  return row;
};

// helper: SQL parameter (NULL when no year selected)
const ayParam = (ay) => ({ type: sql.UniqueIdentifier, value: ay ? ay.id : null });

module.exports = { getYearScope, ayParam };
