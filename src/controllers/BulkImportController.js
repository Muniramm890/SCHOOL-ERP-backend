// src/controllers/BulkImportController.js
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/teachers/bulk-import   { dryRun: boolean, rows: [...] }
//
//   dryRun = true  → validate only, NOTHING is written. Returns per-row status,
//                    subject plan (existing / restore / new) and a summary.
//   dryRun = false → validate again (never trust the client) and import every
//                    row that has no errors. One DB transaction per teacher, so
//                    a bad row never blocks the others.
//
// Per teacher one transaction creates:
//   users + school_members + staff_profiles
//   + subjects (only if the name is new for this school; soft-deleted ones are restored)
//   + subject_teachers   (teacher added INSIDE the school-level subject)
//   + salary_structures  (optional)  + staff_bank_details (optional)
//
// Email / phone stay GLOBALLY unique (DB constraints) — duplicates are reported
// as row errors. Existing endpoints (/teachers, /payroll, /setup) are untouched.
// ─────────────────────────────────────────────────────────────────────────────
const { query, withTransaction, sql } = require('../config/db');
const { success, badRequest } = require('../utils/response');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const MAX_ROWS_DRY_RUN = 1000;
const MAX_ROWS_COMMIT = 100;
const MAX_SUBJECTS_PER_TEACHER = 10;
const ROLES = ['teacher', 'librarian', 'accountant', 'management']; // school_members CHECK constraint
const MAX_MONEY = 99999999.99; // DECIMAL(10,2)

// ═════════════════════════ small pure helpers ═══════════════════════════════
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const normName = (s) => str(s).replace(/\s+/g, ' ');
const keyOf = (s) => normName(s).toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IFSC_RE = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const PAN_RE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;

const todayISO = () => new Date().toISOString().split('T')[0];

// Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY. Returns { value, bad }.
function parseDate(v) {
  const s = str(v);
  if (!s) return { value: null, bad: false };
  let y, m, d, mt;
  if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else return { value: null, bad: true };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2100) {
    return { value: null, bad: true };
  }
  return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, bad: false };
}

function normGender(v) {
  const s = str(v).toLowerCase();
  if (!s) return { value: 'Male', defaulted: true, unknown: false }; // same default as POST /teachers
  if (['m', 'male', 'boy', 'man'].includes(s)) return { value: 'Male', defaulted: false, unknown: false };
  if (['f', 'female', 'girl', 'woman'].includes(s)) return { value: 'Female', defaulted: false, unknown: false };
  if (['o', 'other', 'others', 'prefer_not_to_say'].includes(s)) return { value: 'Other', defaulted: false, unknown: false };
  return { value: 'Male', defaulted: true, unknown: true };
}

// '' → null (not provided) | number | NaN (invalid)
function parseMoney(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[₹,\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const n = Number(s);
  return n > MAX_MONEY ? NaN : n;
}

function parseSubjects(v) {
  let list = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === 'string') list = v.split(/[|;]/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = normName(item);
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Suggestion only (never auto-merged): "Maths" ≈ "Mathematics"
function findSimilarSubject(name, activeSubjects) {
  const a = keyOf(name);
  if (a.length < 3) return null;
  let best = null;
  let bestScore = Infinity;
  for (const s of activeSubjects) {
    const b = keyOf(s.name);
    let score = Infinity;
    const dist = levenshtein(a, b);
    if (dist <= 2) score = dist;
    else if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a) || a.slice(0, 4) === b.slice(0, 4))) score = 3;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best ? { subject_id: best.id, name: best.name } : null;
}

// ═════════════════════════ row normalisation + validation ═══════════════════
function normalizeRow(raw, idx) {
  const r = raw || {};
  const errors = [];
  const warnings = [];
  const flags = [];

  const full_name = normName(r.full_name);
  const email = str(r.email).toLowerCase();
  const phone = str(r.phone).replace(/[\s\-()]/g, '');
  const employee_code = str(r.employee_code);
  const role = str(r.role).toLowerCase() || 'teacher';
  const password = str(r.password);

  if (!full_name) errors.push('full_name is required');
  else if (full_name.length > 255) errors.push('full_name is too long (max 255)');

  if (!email) errors.push('email is required');
  else if (!EMAIL_RE.test(email) || email.length > 255) errors.push('email is not valid');

  // phone is required: users.phone is UNIQUE and SQL Server allows only ONE NULL in a unique constraint
  if (!phone) errors.push('phone is required');
  else if (!/^\+?\d{10,15}$/.test(phone)) errors.push('phone must be 10–15 digits');

  if (!ROLES.includes(role)) errors.push(`role must be one of: ${ROLES.join(', ')}`);
  if (password && password.length < 6) errors.push('password must be at least 6 characters (or leave blank)');
  if (employee_code.length > 100) errors.push('employee_code too long (max 100)');

  const g = normGender(r.gender);
  if (g.unknown) warnings.push(`gender "${str(r.gender)}" not recognised — set to Male`);
  else if (g.defaulted) { warnings.push('gender blank — set to Male'); flags.push('gender_defaulted'); }

  const jd = parseDate(r.join_date);
  if (jd.bad) errors.push('join_date invalid (use YYYY-MM-DD or DD/MM/YYYY)');
  const dob = parseDate(r.date_of_birth);
  if (dob.bad) errors.push('date_of_birth invalid (use YYYY-MM-DD or DD/MM/YYYY)');
  const join_date = jd.value || todayISO();

  let experience_years = 0;
  if (str(r.experience_years) !== '') {
    const n = Number(str(r.experience_years));
    if (!Number.isInteger(n) || n < 0 || n > 60) errors.push('experience_years must be a whole number 0–60');
    else experience_years = n;
  }

  const department = str(r.department) || null;
  const designation = str(r.designation) || null;
  const qualification = str(r.qualification) || null;
  if (department && department.length > 100) errors.push('department too long (max 100)');
  if (designation && designation.length > 100) errors.push('designation too long (max 100)');
  if (qualification && qualification.length > 255) errors.push('qualification too long (max 255)');

  // ── subjects ──
  let subjects = parseSubjects(r.subjects);
  if (subjects.some((n) => n.length > 200)) errors.push('subject name too long (max 200)');
  if (subjects.length > MAX_SUBJECTS_PER_TEACHER) errors.push(`max ${MAX_SUBJECTS_PER_TEACHER} subjects per teacher`);
  if (role !== 'teacher' && subjects.length) {
    warnings.push(`subjects ignored for role "${role}"`);
    subjects = [];
  }
  if (role === 'teacher' && subjects.length === 0) {
    warnings.push('No subject — teacher will be created UNASSIGNED');
    flags.push('no_subject');
  }

  // ── salary ──
  const SAL_FIELDS = ['basic', 'hra', 'da', 'special_allowance', 'other_allowance', 'pf_deduction', 'pt_deduction', 'other_deduction'];
  const sal = {};
  let salaryGiven = false;
  for (const f of SAL_FIELDS) {
    const n = parseMoney(r[f]);
    if (Number.isNaN(n)) { errors.push(`${f} must be a valid amount (max 2 decimals)`); sal[f] = 0; }
    else { if (n !== null) salaryGiven = true; sal[f] = n === null ? 0 : n; }
  }
  const eff = parseDate(r.effective_from);
  if (eff.bad) errors.push('effective_from invalid (use YYYY-MM-DD or DD/MM/YYYY)');
  if (str(r.effective_from) !== '') salaryGiven = true;
  let salary = null;
  if (salaryGiven) {
    sal.effective_from = eff.value || join_date;
    if (!sal.basic) warnings.push('salary given but basic is 0');
    salary = sal;
  } else {
    warnings.push('No salary — set it later in Payroll → Teacher Setup');
    flags.push('no_salary');
  }

  // ── bank ──
  const bank = {
    account_holder: str(r.account_holder),
    account_number: str(r.account_number).replace(/\s/g, ''),
    ifsc_code: str(r.ifsc_code).toUpperCase(),
    bank_name: str(r.bank_name),
    branch_name: str(r.branch_name),
    upi_id: str(r.upi_id),
    pan_number: str(r.pan_number).toUpperCase(),
  };
  const bankGiven = Object.values(bank).some(Boolean);
  let bankOut = null;
  if (bankGiven) {
    if (bank.account_holder.length > 150 || bank.bank_name.length > 150 || bank.branch_name.length > 150) errors.push('bank text field too long (max 150)');
    if (bank.account_number.length > 50) errors.push('account_number too long (max 50)');
    if (bank.upi_id.length > 100) errors.push('upi_id too long (max 100)');
    if (bank.account_number && !/^\d{6,20}$/.test(bank.account_number)) warnings.push('account_number looks unusual (expected 6–20 digits)');
    if (bank.ifsc_code && !IFSC_RE.test(bank.ifsc_code)) warnings.push('IFSC format looks wrong');
    if (bank.pan_number && !PAN_RE.test(bank.pan_number)) warnings.push('PAN format looks wrong');
    if (bank.account_number && !bank.ifsc_code) warnings.push('account_number given but IFSC missing');
    bankOut = { ...bank, account_holder: bank.account_holder || full_name };
  } else {
    warnings.push('No bank details');
    flags.push('no_bank');
  }

  return {
    idx,
    line: Number.isInteger(r.line) ? r.line : idx + 2,
    full_name, email, phone, gender: g.value, password, employee_code: employee_code || null,
    join_date, date_of_birth: dob.value, department, designation, qualification, experience_years,
    role, subjects, salary, bank: bankOut,
    errors, warnings, flags,
  };
}

// ═════════════════════════ DB look-ups (read-only) ══════════════════════════
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

async function loadSubjectCache(schoolId) {
  const r = await query(
    `SELECT id, name, is_active, deleted_at FROM subjects WHERE school_id=@sid`,
    { sid: { type: sql.UniqueIdentifier, value: schoolId } }
  );
  const map = new Map();
  for (const s of r.recordset) map.set(keyOf(s.name), { id: s.id, name: s.name, deleted: !!s.deleted_at });
  return map;
}

// Which of these emails / phones already exist in `users` (global) and does that user belong to THIS school?
async function loadExistingIdentities(schoolId, emails, phones) {
  const emailHit = new Map(); // email -> { inSchool }
  const phoneHit = new Map();
  for (const part of chunk(emails, 400)) {
    if (!part.length) continue;
    const params = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
    part.forEach((e, i) => { params[`e${i}`] = { type: sql.NVarChar(255), value: e }; });
    const r = await query(
      `SELECT LOWER(u.email) AS email,
              MAX(CASE WHEN sm.school_id = @sid THEN 1 ELSE 0 END) AS in_school
       FROM users u
       LEFT JOIN school_members sm ON sm.user_id = u.id AND sm.deleted_at IS NULL
       WHERE u.email IN (${part.map((_, i) => `@e${i}`).join(',')})
       GROUP BY LOWER(u.email)`, params);
    for (const row of r.recordset) emailHit.set(row.email, { inSchool: !!row.in_school });
  }
  for (const part of chunk(phones, 400)) {
    if (!part.length) continue;
    const params = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
    part.forEach((p, i) => { params[`p${i}`] = { type: sql.NVarChar(50), value: p }; });
    const r = await query(
      `SELECT u.phone AS phone,
              MAX(CASE WHEN sm.school_id = @sid THEN 1 ELSE 0 END) AS in_school
       FROM users u
       LEFT JOIN school_members sm ON sm.user_id = u.id AND sm.deleted_at IS NULL
       WHERE u.phone IN (${part.map((_, i) => `@p${i}`).join(',')})
       GROUP BY u.phone`, params);
    for (const row of r.recordset) phoneHit.set(row.phone, { inSchool: !!row.in_school });
  }
  return { emailHit, phoneHit };
}

async function loadExistingEmployeeCodes(schoolId, codes) {
  const hit = new Set();
  for (const part of chunk(codes, 400)) {
    if (!part.length) continue;
    const params = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
    part.forEach((c, i) => { params[`c${i}`] = { type: sql.NVarChar(100), value: c }; });
    const r = await query(
      `SELECT DISTINCT LOWER(employee_code) AS code FROM school_members
       WHERE school_id=@sid AND deleted_at IS NULL AND employee_code IN (${part.map((_, i) => `@c${i}`).join(',')})`, params);
    for (const row of r.recordset) hit.add(row.code);
  }
  return hit;
}

// ═════════════════════════ validate whole batch (shared by dry-run & commit) ═
async function validateBatch(schoolId, rawRows) {
  const rows = rawRows.map((r, i) => normalizeRow(r, i));

  // 1. duplicates inside the file (first occurrence wins)
  const seenEmail = new Map();
  const seenPhone = new Map();
  const seenCode = new Map();
  for (const r of rows) {
    if (r.email) {
      if (seenEmail.has(r.email)) r.errors.push(`duplicate email in file (same as line ${seenEmail.get(r.email)})`);
      else seenEmail.set(r.email, r.line);
    }
    if (r.phone) {
      if (seenPhone.has(r.phone)) r.errors.push(`duplicate phone in file (same as line ${seenPhone.get(r.phone)})`);
      else seenPhone.set(r.phone, r.line);
    }
    if (r.employee_code) {
      const k = r.employee_code.toLowerCase();
      if (seenCode.has(k)) r.warnings.push(`employee_code repeated in file (line ${seenCode.get(k)})`);
      else seenCode.set(k, r.line);
    }
  }

  // 2. duplicates in DB (email/phone are globally unique)
  const emails = [...new Set(rows.map((r) => r.email).filter((e) => e && EMAIL_RE.test(e)))];
  const phones = [...new Set(rows.map((r) => r.phone).filter((p) => /^\+?\d{10,15}$/.test(p)))];
  const codes = [...new Set(rows.map((r) => r.employee_code).filter(Boolean))];
  const { emailHit, phoneHit } = await loadExistingIdentities(schoolId, emails, phones);
  const codeHit = await loadExistingEmployeeCodes(schoolId, codes);
  for (const r of rows) {
    const eh = emailHit.get(r.email);
    if (eh) r.errors.push(eh.inSchool ? 'email already exists in your school (skipped)' : 'email is already registered in the system');
    const ph = phoneHit.get(r.phone);
    if (ph) r.errors.push(ph.inSchool ? 'phone already exists in your school (skipped)' : 'phone is already registered in the system');
    if (r.employee_code && codeHit.has(r.employee_code.toLowerCase())) r.warnings.push('employee_code already used in your school');
  }

  // 3. subject plan
  const cache = await loadSubjectCache(schoolId);
  const activeSubjects = [...cache.values()].filter((s) => !s.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const plan = new Map(); // key -> { name, action, subject_id, count, suggestion }
  for (const r of rows) {
    r.subjectPlan = r.subjects.map((name) => {
      const k = keyOf(name);
      const hit = cache.get(k);
      let entry;
      if (hit && !hit.deleted) entry = { name: hit.name, action: 'existing', subject_id: hit.id };
      else if (hit && hit.deleted) entry = { name: hit.name, action: 'restore', subject_id: hit.id };
      else entry = { name, action: 'new', subject_id: null, suggestion: findSimilarSubject(name, activeSubjects) };
      if (r.errors.length === 0) {
        const p = plan.get(k) || { ...entry, count: 0 };
        p.count += 1;
        plan.set(k, p);
      }
      return entry;
    });
  }

  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.errors.length === 0 && r.warnings.length === 0).length,
    warning: rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
    error: rows.filter((r) => r.errors.length > 0).length,
    unassigned: rows.filter((r) => r.errors.length === 0 && r.flags.includes('no_subject')).length,
    no_salary: rows.filter((r) => r.errors.length === 0 && r.flags.includes('no_salary')).length,
    no_bank: rows.filter((r) => r.errors.length === 0 && r.flags.includes('no_bank')).length,
    subjects_existing: [...plan.values()].filter((p) => p.action === 'existing').map((p) => ({ name: p.name, subject_id: p.subject_id, teachers_to_add: p.count })),
    subjects_restore: [...plan.values()].filter((p) => p.action === 'restore').map((p) => ({ name: p.name, subject_id: p.subject_id, teachers_to_add: p.count })),
    subjects_new: [...plan.values()].filter((p) => p.action === 'new').map((p) => ({ name: p.name, teachers_to_add: p.count, suggestion: p.suggestion || null })),
  };

  return { rows, cache, summary, activeSubjects };
}

const rowStatus = (r) => (r.errors.length ? 'error' : r.warnings.length ? 'warning' : 'ok');
const publicRow = (r) => ({
  idx: r.idx, line: r.line, status: rowStatus(r),
  errors: r.errors, warnings: r.warnings, flags: r.flags,
  subjects: r.subjectPlan,
});

// ═════════════════════════ write one teacher (one transaction) ══════════════
async function importOneRow(schoolId, r, cache) {
  const userId = uuidv4();
  const hash = await bcrypt.hash(r.password || 'teacher123', 10);
  const createdSubjects = [];
  const restoredSubjects = [];
  let linksAdded = 0;

  await withTransaction(async (tx) => {
    // 1. users
    const r1 = tx.request();
    r1.input('id', sql.UniqueIdentifier, userId);
    r1.input('fn', sql.NVarChar(255), r.full_name);
    r1.input('em', sql.NVarChar(255), r.email);
    r1.input('ph', sql.NVarChar(50), r.phone);
    r1.input('gen', sql.VarChar(20), r.gender);
    r1.input('pw', sql.NVarChar(255), hash);
    r1.input('dob', sql.Date, r.date_of_birth);
    await r1.query(`INSERT INTO users (id, full_name, email, phone, gender, password, date_of_birth)
                    VALUES (@id, @fn, @em, @ph, @gen, @pw, @dob)`);

    // 2. school_members
    const r2 = tx.request();
    r2.input('id', sql.UniqueIdentifier, uuidv4());
    r2.input('sid', sql.UniqueIdentifier, schoolId);
    r2.input('uid', sql.UniqueIdentifier, userId);
    r2.input('role', sql.VarChar(50), r.role);
    r2.input('emp', sql.NVarChar(100), r.employee_code);
    r2.input('join', sql.Date, r.join_date);
    await r2.query(`INSERT INTO school_members (id, school_id, user_id, role, employee_code, join_date)
                    VALUES (@id, @sid, @uid, @role, @emp, @join)`);

    // 3. staff_profiles
    const r3 = tx.request();
    r3.input('id', sql.UniqueIdentifier, uuidv4());
    r3.input('sid', sql.UniqueIdentifier, schoolId);
    r3.input('uid', sql.UniqueIdentifier, userId);
    r3.input('dept', sql.NVarChar(100), r.department);
    r3.input('des', sql.NVarChar(100), r.designation);
    r3.input('qual', sql.NVarChar(255), r.qualification);
    r3.input('exp', sql.SmallInt, r.experience_years);
    await r3.query(`INSERT INTO staff_profiles (id, school_id, user_id, department, designation, qualification, experience_years)
                    VALUES (@id, @sid, @uid, @dept, @des, @qual, @exp)`);

    // 4. subjects → create if new (or restore if soft-deleted) → add teacher inside subject
    for (const name of r.subjects) {
      const k = keyOf(name);
      let subj = cache.get(k);
      if (!subj) {
        const sId = uuidv4();
        const rs = tx.request();
        rs.input('id', sql.UniqueIdentifier, sId);
        rs.input('sid', sql.UniqueIdentifier, schoolId);
        rs.input('name', sql.NVarChar(200), name);
        await rs.query(`INSERT INTO subjects (id, school_id, name, category) VALUES (@id, @sid, @name, 'core')`);
        subj = { id: sId, name, deleted: false };
        createdSubjects.push([k, subj]);
      } else if (subj.deleted) {
        const rs = tx.request();
        rs.input('id', sql.UniqueIdentifier, subj.id);
        rs.input('sid', sql.UniqueIdentifier, schoolId);
        await rs.query(`UPDATE subjects SET deleted_at=NULL, is_active=1, updated_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`);
        restoredSubjects.push([k, subj]);
      }
      const rl = tx.request();
      rl.input('id', sql.UniqueIdentifier, uuidv4());
      rl.input('sid', sql.UniqueIdentifier, schoolId);
      rl.input('subId', sql.UniqueIdentifier, subj.id);
      rl.input('tid', sql.UniqueIdentifier, userId);
      await rl.query(`INSERT INTO subject_teachers (id, school_id, subject_id, teacher_user_id) VALUES (@id, @sid, @subId, @tid)`);
      linksAdded += 1;
    }

    // 5. salary_structures (optional)
    if (r.salary) {
      const s = r.salary;
      const rsal = tx.request();
      rsal.input('id', sql.UniqueIdentifier, uuidv4());
      rsal.input('sid', sql.UniqueIdentifier, schoolId);
      rsal.input('staff', sql.UniqueIdentifier, userId);
      for (const [p, f] of [['basic', 'basic'], ['hra', 'hra'], ['da', 'da'], ['spl', 'special_allowance'], ['oa', 'other_allowance'], ['pf', 'pf_deduction'], ['pt', 'pt_deduction'], ['od', 'other_deduction']]) {
        rsal.input(p, sql.Decimal(10, 2), s[f]);
      }
      rsal.input('eff', sql.Date, s.effective_from);
      rsal.input('now', sql.DateTime2, new Date());
      await rsal.query(`INSERT INTO salary_structures
        (id, school_id, staff_id, basic, hra, da, special_allowance, other_allowance, pf_deduction, pt_deduction, other_deduction, effective_from, created_at, updated_at)
        VALUES (@id, @sid, @staff, @basic, @hra, @da, @spl, @oa, @pf, @pt, @od, @eff, @now, @now)`);
    }

    // 6. staff_bank_details (optional)
    if (r.bank) {
      const b = r.bank;
      const rb = tx.request();
      rb.input('id', sql.UniqueIdentifier, uuidv4());
      rb.input('sid', sql.UniqueIdentifier, schoolId);
      rb.input('staff', sql.UniqueIdentifier, userId);
      rb.input('holder', sql.NVarChar(150), b.account_holder || null);
      rb.input('acc', sql.NVarChar(50), b.account_number || null);
      rb.input('ifsc', sql.NVarChar(20), b.ifsc_code || null);
      rb.input('bank', sql.NVarChar(150), b.bank_name || null);
      rb.input('branch', sql.NVarChar(150), b.branch_name || null);
      rb.input('upi', sql.NVarChar(100), b.upi_id || null);
      rb.input('pan', sql.NVarChar(20), b.pan_number || null);
      rb.input('now', sql.DateTime2, new Date());
      await rb.query(`INSERT INTO staff_bank_details
        (id, school_id, staff_id, account_holder, account_number, ifsc_code, bank_name, branch_name, upi_id, pan_number, created_at, updated_at)
        VALUES (@id, @sid, @staff, @holder, @acc, @ifsc, @bank, @branch, @upi, @pan, @now, @now)`);
    }
  });

  // committed → now it is safe to update the shared subject cache
  for (const [k, s] of createdSubjects) cache.set(k, s);
  for (const [k, s] of restoredSubjects) cache.set(k, { ...s, deleted: false });
  return {
    user_id: userId,
    links_added: linksAdded,
    created_subjects: createdSubjects.map(([, s]) => s.name),
    restored_subjects: restoredSubjects.map(([, s]) => s.name),
  };
}

function friendlyDbError(err) {
  const m = String(err && err.message || '');
  if (err && (err.number === 2627 || err.number === 2601)) {
    if (/email/i.test(m)) return 'email is already registered in the system';
    if (/phone/i.test(m)) return 'phone is already registered in the system';
    if (/subjects/i.test(m)) return 'subject name conflict — please retry this row';
    return 'duplicate record — email/phone already registered';
  }
  return m || 'Database error';
}

// ═════════════════════════ controller ═══════════════════════════════════════
exports.bulkImport = async (req, res, next) => {
  try {
    const { schoolId, userId: adminUserId } = req.user;
    const { dryRun = true, rows: rawRows } = req.body || {};

    if (!Array.isArray(rawRows) || rawRows.length === 0) return badRequest(res, 'rows[] is required');
    const limit = dryRun ? MAX_ROWS_DRY_RUN : MAX_ROWS_COMMIT;
    if (rawRows.length > limit) return badRequest(res, `Max ${limit} rows per ${dryRun ? 'preview' : 'import'} request`);

    const { rows, cache, summary, activeSubjects } = await validateBatch(schoolId, rawRows);

    // ── PREVIEW ────────────────────────────────────────────────────────────
    if (dryRun) {
      return success(res, {
        summary,
        rows: rows.map(publicRow),
        available_subjects: activeSubjects.map((s) => ({ id: s.id, name: s.name })),
      }, 'Preview ready');
    }

    // ── COMMIT ─────────────────────────────────────────────────────────────
    const results = [];
    const createdAll = new Set();
    const restoredAll = new Set();
    let linksAdded = 0;
    let imported = 0;

    for (const r of rows) {
      if (r.errors.length) {
        results.push({ idx: r.idx, line: r.line, ok: false, error: r.errors.join('; ') });
        continue;
      }
      try {
        let out;
        try {
          out = await importOneRow(schoolId, r, cache);
        } catch (e) {
          // race: someone created the same subject name between our look-up and insert → reload once and retry
          if ((e.number === 2627 || e.number === 2601) && /subjects/i.test(String(e.message))) {
            const fresh = await loadSubjectCache(schoolId);
            cache.clear();
            for (const [k, v] of fresh) cache.set(k, v);
            out = await importOneRow(schoolId, r, cache);
          } else throw e;
        }
        imported += 1;
        linksAdded += out.links_added;
        out.created_subjects.forEach((n) => createdAll.add(n));
        out.restored_subjects.forEach((n) => restoredAll.add(n));
        results.push({ idx: r.idx, line: r.line, ok: true, user_id: out.user_id, warnings: r.warnings });
      } catch (e) {
        results.push({ idx: r.idx, line: r.line, ok: false, error: friendlyDbError(e) });
      }
    }

    // one summary audit entry (non-blocking)
    try {
      await query(
        `INSERT INTO audit_logs (id, school_id, user_id, action_type, details, created_at)
         VALUES (@lid, @sid, @uid, 'TEACHERS_BULK_IMPORT', @det, GETUTCDATE())`,
        {
          lid: { type: sql.UniqueIdentifier, value: uuidv4() },
          sid: { type: sql.UniqueIdentifier, value: schoolId },
          uid: { type: sql.UniqueIdentifier, value: adminUserId },
          det: { type: sql.NVarChar(sql.MAX), value: JSON.stringify({ imported, failed: rows.length - imported, subjectsCreated: [...createdAll], subjectsRestored: [...restoredAll] }) },
        }
      );
    } catch (logErr) { console.warn('Teacher bulk import audit log failed:', logErr.message); }

    return success(res, {
      summary: {
        total: rows.length,
        imported,
        failed: rows.length - imported,
        links_added: linksAdded,
        subjects_created: [...createdAll],
        subjects_restored: [...restoredAll],
      },
      results,
    }, `${imported} of ${rows.length} imported`);
  } catch (err) { next(err); }
};

// exposed for unit tests only
exports._internal = { normalizeRow, parseDate, parseMoney, parseSubjects, findSimilarSubject, normGender };
