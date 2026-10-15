// src/controllers/BulkImportController.js
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/teachers/bulk-import   { dryRun: boolean, rows: [...] }

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

// ═════════════════════════════════════════════════════════════════════════════
// ███  STUDENTS BULK IMPORT  ███
// POST /api/students/bulk-import   { dryRun: boolean, rows: [...] }
//
//   dryRun = true  → validate only, NOTHING is written (per-row status + plan).
//   dryRun = false → validate again and import every row that is READY.
//
// Per student ONE transaction creates:
//   students + enrolments (+ grade / section when they do not exist yet)
//   + student_guardians (up to 2) + student_fee_accounts
//   + (optional) ONE opening-balance invoice: category "Previous Dues" (legacy_due)
//     and an optional extra-charge category (extra_fee_title / extra_fee_amount).
//
// Row status:  ok · warning (imports) · needs_input (admin must pick class /
//              section / date of birth in the preview — NOT imported until fixed)
//              · error (skipped).
// Regular fee invoices are NOT generated here (Fees → Generate Invoices does that).
// ═════════════════════════════════════════════════════════════════════════════
const S_MAX_ROWS_DRY_RUN = 2000;
const S_MAX_ROWS_COMMIT = 100;
const PREVIOUS_DUES_NAME = 'Previous Dues';
const DEFAULT_SECTION_NAME = 'A';
const DEFAULT_SECTION_CAPACITY = 40;

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().split('T')[0];

// ── class / section name normalisation ───────────────────────────────────────
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

// "Class 5", "5th", "Grade-5", "V", "std 5" → "5" ; "Class 11 Science" → "11science"
function gradeKey(name) {
  let s = keyOf(name).replace(/[._\-–/]+/g, ' ');
  s = s.replace(/\b(class|grade|std|standard|cls)\b/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1');
  const parts = s.split(' ').filter(Boolean);
  if (parts.length && ROMAN[parts[0]]) parts[0] = String(ROMAN[parts[0]]);
  const k = parts.join('');
  return k || keyOf(name).replace(/\s+/g, '');
}

// Nursery < LKG < UKG < 1..12 < everything else (null → "append at the end")
function deriveGradeOrder(name) {
  const k = gradeKey(name);
  if (k === 'nursery') return -3;
  if (['lkg', 'kg1', 'juniorkg', 'jrkg'].includes(k)) return -2;
  if (['ukg', 'kg2', 'seniorkg', 'srkg'].includes(k)) return -1;
  const m = k.match(/^(\d{1,2})(?!\d)/);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 12) return n; }
  return null;
}

const sectionKey = (n) => keyOf(n).replace(/^(section|sec)\s+/, '').replace(/\s+/g, '');

const parseBool = (v) => ['1', 'y', 'yes', 'true', 'ews'].includes(str(v).toLowerCase());

// ── row normalisation (pure, no DB) ──────────────────────────────────────────
function normalizeStudentRow(raw, idx) {
  const r = raw || {};
  const errors = [];
  const warnings = [];
  const flags = [];
  const needs = [];
  const tooLong = (label, v, max) => { if (v && v.length > max) errors.push(`${label} too long (max ${max})`); };

  // name
  let first_name = normName(r.first_name);
  let middle_name = normName(r.middle_name);
  let last_name = normName(r.last_name);
  if (!first_name && normName(r.full_name)) {
    const t = normName(r.full_name).split(' ');
    first_name = t[0];
    if (t.length > 1) last_name = t[t.length - 1];
    if (t.length > 2) middle_name = t.slice(1, -1).join(' ');
  }
  if (!first_name) errors.push('student name is required');
  tooLong('first_name', first_name, 100); tooLong('middle_name', middle_name, 100); tooLong('last_name', last_name, 100);

  const admission_no_given = str(r.admission_no);
  tooLong('admission_no', admission_no_given, 100);

  const g = normGender(r.gender);
  if (g.unknown) warnings.push(`gender "${str(r.gender)}" not recognised — set to Male`);
  else if (g.defaulted) warnings.push('gender blank — set to Male');

  // date of birth: DB column is NOT NULL → admin must pick it in the preview
  const today = istToday();
  const dob = parseDate(r.date_of_birth);
  let date_of_birth = dob.value;
  if (!date_of_birth) {
    needs.push('dob');
    warnings.push(dob.bad ? 'Date of birth invalid — pick a date' : 'Date of birth missing — pick a date');
  } else if (date_of_birth > today) {
    date_of_birth = null; needs.push('dob'); warnings.push('Date of birth is in the future — pick a date');
  } else {
    const age = (new Date(today) - new Date(date_of_birth)) / (365.25 * 864e5);
    if (age < 2 || age > 25) warnings.push(`Date of birth gives age ${Math.floor(age)} — please verify`);
  }

  const ad = parseDate(r.admission_date);
  let admission_date = ad.value || today;
  if (ad.bad) warnings.push('admission_date invalid — using today');

  const class_name = normName(r.class_name);
  const section_name = normName(r.section_name);
  tooLong('class_name', class_name, 100); tooLong('section_name', section_name, 50);
  if (!class_name) { needs.push('class'); warnings.push('Class missing — pick or type a class'); }

  const roll_no = str(r.roll_no);
  tooLong('roll_no', roll_no, 50);

  const blood_group = str(r.blood_group).toUpperCase().replace(/\s/g, '') || null;
  tooLong('blood_group', blood_group, 10);
  const nationality = normName(r.nationality) || 'Indian';
  const religion = normName(r.religion) || null;
  const caste = normName(r.caste) || null;
  const sub_caste = normName(r.sub_caste) || null;
  tooLong('nationality', nationality, 100); tooLong('religion', religion, 100);
  tooLong('caste', caste, 100); tooLong('sub_caste', sub_caste, 100);
  const is_ews = parseBool(r.is_ews);

  const aadhaar_no = str(r.aadhaar_no).replace(/[\s-]/g, '') || null;
  tooLong('aadhaar_no', aadhaar_no, 20);
  if (aadhaar_no && !/^\d{12}$/.test(aadhaar_no)) warnings.push('aadhaar_no is not 12 digits');
  const previous_school = normName(r.previous_school) || null;
  const tc_no = str(r.tc_no) || null;
  tooLong('previous_school', previous_school, 255); tooLong('tc_no', tc_no, 100);

  const clip = (v) => { const t = str(v); return t ? t.slice(0, 2000) : null; };
  const address_permanent = clip(r.address_permanent);
  const address_current = clip(r.address_current);
  const medical_conditions = clip(r.medical_conditions);
  const disabilities = clip(r.disabilities);
  const city = normName(r.city) || null;
  const state = normName(r.state) || null;
  tooLong('city', city, 100); tooLong('state', state, 100);
  let pincode = str(r.pincode) || null;
  if (pincode && !/^\d{6}$/.test(pincode)) { warnings.push('pincode must be 6 digits — ignored'); pincode = null; }

  // guardians (1 = primary). Name blank → guardian skipped (never junk rows).
  const guardians = [];
  for (const [p, primary] of [['guardian', true], ['guardian2', false]]) {
    const name = normName(r[`${p}_name`]);
    const relation = normName(r[`${p}_relation`]);
    const phone = str(r[`${p}_phone`]).replace(/[\s\-()]/g, '');
    const email = str(r[`${p}_email`]).toLowerCase();
    if (!name) {
      if (relation || phone || email) warnings.push(`${p} details ignored — name is blank`);
      continue;
    }
    tooLong(`${p}_name`, name, 255); tooLong(`${p}_relation`, relation, 50); tooLong(`${p}_phone`, phone, 50);
    if (!phone) warnings.push(`${p} phone missing`);
    else if (!/^\+?\d{10,15}$/.test(phone)) warnings.push(`${p} phone looks unusual`);
    let em = email || null;
    if (em && (!EMAIL_RE.test(em) || em.length > 255)) { warnings.push(`${p} email not valid — ignored`); em = null; }
    guardians.push({ full_name: name, relation: relation || 'Parent', phone, email: em, is_primary: primary });
  }
  if (guardians.length === 0) flags.push('no_guardian');

  // fees: legacy due + optional extra charge (rupees → paise)
  let legacy_paise = 0;
  const ld = parseMoney(r.legacy_due);
  if (Number.isNaN(ld)) errors.push('legacy_due must be a valid amount (max 2 decimals)');
  else if (ld) legacy_paise = Math.round(ld * 100);
  const legacy_remark = normName(r.legacy_due_remark) || null;
  tooLong('legacy_due_remark', legacy_remark, 150);

  let extra_paise = 0;
  let extra_title = normName(r.extra_fee_title) || null;
  const ex = parseMoney(r.extra_fee_amount);
  if (Number.isNaN(ex)) errors.push('extra_fee_amount must be a valid amount (max 2 decimals)');
  else if (ex) {
    extra_paise = Math.round(ex * 100);
    if (!extra_title) { extra_title = 'Other Charges'; warnings.push('extra_fee_title blank — using "Other Charges"'); }
  } else if (extra_title) { warnings.push('extra_fee_title given without amount — ignored'); extra_title = null; }
  tooLong('extra_fee_title', extra_title, 100);
  if (legacy_paise || extra_paise) flags.push('has_dues');

  return {
    idx,
    line: Number.isInteger(r.line) ? r.line : idx + 2,
    first_name, middle_name: middle_name || null, last_name: last_name || null,
    admission_no_given: admission_no_given || null,
    gender: g.value, date_of_birth, admission_date,
    class_name, section_name, roll_no_given: roll_no || null,
    blood_group, nationality, religion, caste, sub_caste, is_ews, aadhaar_no, previous_school, tc_no,
    address_permanent, address_current, city, state, pincode, medical_conditions, disabilities,
    guardians,
    fee: { legacy_paise, legacy_remark, extra_paise, extra_title },
    errors, warnings, flags, needs,
  };
}

// ── DB look-ups ──────────────────────────────────────────────────────────────
async function loadStudentContext(schoolId) {
  const sidP = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
  const ayRes = await query(
    `SELECT TOP 1 id, name FROM academic_years WHERE school_id=@sid AND deleted_at IS NULL ORDER BY is_current DESC, created_at DESC`, sidP);
  const ay = ayRes.recordset[0];
  if (!ay) return null;
  const ayP = { ...sidP, ay: { type: sql.UniqueIdentifier, value: ay.id } };

  const [gr, se, en, ca] = await Promise.all([
    query(`SELECT id, name, numeric_order, deleted_at FROM grades WHERE school_id=@sid`, sidP),
    query(`SELECT id, grade_id, name, max_strength, deleted_at FROM sections WHERE school_id=@sid AND academic_year_id=@ay`, ayP),
    query(`SELECT section_id, roll_no, is_active, deleted_at FROM enrolments WHERE school_id=@sid AND academic_year_id=@ay`, ayP),
    query(`SELECT id, name FROM fee_categories WHERE school_id=@sid AND deleted_at IS NULL`, sidP),
  ]);

  const grades = gr.recordset.map((g) => ({
    id: g.id, name: g.name, order: g.numeric_order, deleted: !!g.deleted_at, key: keyOf(g.name), gkey: gradeKey(g.name), sections: [],
  }));
  const byId = new Map(grades.map((g) => [g.id, g]));
  for (const s of se.recordset) {
    const g = byId.get(s.grade_id);
    if (g) g.sections.push({ id: s.id, name: s.name, key: sectionKey(s.name), max: s.max_strength || DEFAULT_SECTION_CAPACITY, deleted: !!s.deleted_at });
  }
  const rolls = new Map(); const numericMax = new Map(); const activeCount = new Map();
  for (const e of en.recordset) {
    if (e.roll_no !== null && e.roll_no !== undefined) {
      const rk = String(e.roll_no).trim().toLowerCase();
      if (!rolls.has(e.section_id)) rolls.set(e.section_id, new Set());
      rolls.get(e.section_id).add(rk);
      if (/^\d+$/.test(rk)) numericMax.set(e.section_id, Math.max(numericMax.get(e.section_id) || 0, Number(rk)));
    }
    if (e.is_active && !e.deleted_at) activeCount.set(e.section_id, (activeCount.get(e.section_id) || 0) + 1);
  }
  const cats = new Map(ca.recordset.map((c) => [keyOf(c.name), { id: c.id, name: c.name }]));
  const maxOrder = grades.reduce((m, g) => Math.max(m, g.order || 0), 0);

  return {
    ay, grades, rolls, numericMax, activeCount, cats, maxOrder,
    // filled after each committed row so later rows in the same request reuse them
    newGrades: new Map(), newSections: new Map(), newCats: new Map(), restoredGrades: new Set(), restoredSections: new Set(),
  };
}

async function loadExistingAdmissionNos(schoolId, nos) {
  const hit = new Set();
  for (const part of chunk(nos, 400)) {
    if (!part.length) continue;
    const params = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
    part.forEach((n, i) => { params[`a${i}`] = { type: sql.NVarChar(100), value: n }; });
    const r = await query(
      `SELECT admission_no FROM students WHERE school_id=@sid AND deleted_at IS NULL AND admission_no IN (${part.map((_, i) => `@a${i}`).join(',')})`, params);
    for (const row of r.recordset) hit.add(String(row.admission_no).toLowerCase());
  }
  return hit;
}

async function loadExistingInvoiceNos(schoolId, nos) {
  const hit = new Set();
  for (const part of chunk(nos, 400)) {
    if (!part.length) continue;
    const params = { sid: { type: sql.UniqueIdentifier, value: schoolId } };
    part.forEach((n, i) => { params[`v${i}`] = { type: sql.NVarChar(100), value: n }; });
    const r = await query(
      `SELECT invoice_no FROM fee_invoices WHERE school_id=@sid AND invoice_no IN (${part.map((_, i) => `@v${i}`).join(',')})`, params);
    for (const row of r.recordset) hit.add(String(row.invoice_no).toLowerCase());
  }
  return hit;
}

// ── grade resolution: exact name → normalised name → restore deleted → new ───
function resolveGrade(ctx, name) {
  const ek = keyOf(name);
  const gk = gradeKey(name);
  const live = ctx.grades.filter((g) => !g.deleted);
  let m = live.filter((g) => g.key === ek);
  if (m.length === 0) m = live.filter((g) => g.gkey === gk);
  if (m.length === 1) return { action: 'existing', grade: m[0] };
  if (m.length > 1) return { action: 'ambiguous', count: m.length };
  const del = ctx.grades.filter((g) => g.deleted && (g.key === ek || g.gkey === gk));
  if (del.length) return { action: 'restore', grade: del[0] };
  return { action: 'new' };
}

// ── whole-batch validation + class/section/roll/admission/fee planning ───────
async function validateStudentBatch(schoolId, rawRows) {
  const ctx = await loadStudentContext(schoolId);
  if (!ctx) return null;
  const rows = rawRows.map((r, i) => normalizeStudentRow(r, i));

  // ---- admission numbers ----
  const seenAdm = new Map();
  const given = [];
  for (const r of rows) {
    if (!r.admission_no_given) continue;
    const k = r.admission_no_given.toLowerCase();
    if (seenAdm.has(k)) r.errors.push(`duplicate admission_no in file (same as line ${seenAdm.get(k)})`);
    else { seenAdm.set(k, r.line); given.push(r.admission_no_given); }
  }
  const admHit = await loadExistingAdmissionNos(schoolId, given);
  for (const r of rows) {
    if (r.admission_no_given && admHit.has(r.admission_no_given.toLowerCase())) r.errors.push('admission_no already exists in your school');
  }

  // ---- class / section plan (only rows that can still be imported take part) ----
  const live = (r) => r.errors.length === 0;
  const plannedOrder = new Map();
  let otherOrder = Math.max(12, ctx.maxOrder);
  const gradeInfo = new Map(); // identity -> { name, action, grade?, fileSections: Map(skey -> name) }
  for (const r of rows) {
    if (!live(r) || !r.class_name) continue;
    const res = resolveGrade(ctx, r.class_name);
    if (res.action === 'ambiguous') { r.errors.push(`class "${r.class_name}" matches ${res.count} classes — use the exact name`); continue; }
    const identity = res.grade ? `id:${res.grade.id}` : `new:${gradeKey(r.class_name)}`;
    r._gid = identity;
    if (!gradeInfo.has(identity)) {
      const info = { identity, name: res.grade ? res.grade.name : r.class_name, action: res.action, grade: res.grade || null, fileSections: new Map() };
      if (res.action === 'new') {
        let o = deriveGradeOrder(r.class_name);
        if (o === null) o = ++otherOrder;
        info.order = o;
      } else info.order = res.grade.order;
      gradeInfo.set(identity, info);
    }
    if (r.section_name) {
      const sk = sectionKey(r.section_name);
      if (!gradeInfo.get(identity).fileSections.has(sk)) gradeInfo.get(identity).fileSections.set(sk, r.section_name);
    }
  }

  const sectionInfo = new Map(); // identity|skey -> { name, action, id?, max, rolls:Set, countExisting, assigned:0, nextRoll }
  const getSection = (gi, skey, display) => {
    const sid = `${gi.identity}|${skey}`;
    if (sectionInfo.has(sid)) return sectionInfo.get(sid);
    const ex = gi.grade ? gi.grade.sections.find((s) => s.key === skey && !s.deleted) : null;
    const del = !ex && gi.grade ? gi.grade.sections.find((s) => s.key === skey && s.deleted) : null;
    const base = ex || del;
    const info = {
      sid, identity: gi.identity, skey,
      name: base ? base.name : display,
      action: ex ? 'existing' : del ? 'restore' : 'new',
      id: base ? base.id : null,
      max: base ? base.max : DEFAULT_SECTION_CAPACITY,
      rolls: new Set(base ? (ctx.rolls.get(base.id) || []) : []),
      numericMax: base ? (ctx.numericMax.get(base.id) || 0) : 0,
      existingCount: base && !base.deleted ? (ctx.activeCount.get(base.id) || 0) : 0,
      assigned: 0,
    };
    sectionInfo.set(sid, info);
    return info;
  };

  for (const r of rows) {
    if (!live(r) || !r._gid) continue;
    const gi = gradeInfo.get(r._gid);
    const liveExisting = gi.grade ? gi.grade.sections.filter((s) => !s.deleted) : [];
    const options = new Map(); // skey -> display
    liveExisting.forEach((s) => options.set(s.key, s.name));
    gi.fileSections.forEach((disp, k) => { if (!options.has(k)) options.set(k, disp); });
    let how = 'named'; let skey; let display;
    if (r.section_name) { skey = sectionKey(r.section_name); display = options.get(skey) || r.section_name; }
    else if (options.size === 0) { skey = sectionKey(DEFAULT_SECTION_NAME); display = DEFAULT_SECTION_NAME; how = 'default'; }
    else if (options.size === 1) { [skey, display] = [...options.entries()][0]; how = 'only_section'; }
    else {
      r.needs.push('section');
      r.section_options = [...options.values()].sort((a, b) => a.localeCompare(b));
      r.warnings.push('Class has several sections — choose one (or type a new one)');
      continue;
    }
    const sec = getSection(gi, skey, display);
    r._sec = sec;
    r.plan = {
      grade: { name: gi.name, action: gi.action, order: gi.order, id: gi.grade ? gi.grade.id : null, identity: gi.identity },
      section: { name: sec.name, action: sec.action, id: sec.id, how, identity: sec.sid },
    };
  }

  // ---- roll numbers (explicit first, then auto) — only rows that will really import ----
  const importable = (r) => r.errors.length === 0 && r.needs.length === 0 && r._sec;
  const rollSeen = new Map();
  for (const r of rows) {
    if (!importable(r) || !r.roll_no_given) continue;
    const k = `${r._sec.sid}|${r.roll_no_given.toLowerCase()}`;
    if (rollSeen.has(k)) { r.errors.push(`roll no ${r.roll_no_given} repeated in this section (line ${rollSeen.get(k)})`); continue; }
    if (r._sec.rolls.has(r.roll_no_given.toLowerCase())) { r.errors.push(`roll no ${r.roll_no_given} is already used in this section`); continue; }
    rollSeen.set(k, r.line);
    r._sec.rolls.add(r.roll_no_given.toLowerCase());
    if (/^\d+$/.test(r.roll_no_given)) r._sec.numericMax = Math.max(r._sec.numericMax, Number(r.roll_no_given));
  }
  for (const r of rows) {
    if (!importable(r)) continue;
    if (r.roll_no_given) { r.roll_no = r.roll_no_given; }
    else {
      let n = r._sec.numericMax + 1;
      while (r._sec.rolls.has(String(n))) n += 1;
      r._sec.numericMax = n; r._sec.rolls.add(String(n));
      r.roll_no = String(n); r.flags.push('roll_auto');
    }
    r._sec.assigned += 1;
  }

  // ---- capacity warnings (not enforced anywhere today → warning only) ----
  for (const r of rows) {
    if (!importable(r)) continue;
    const total = r._sec.existingCount + r._sec.assigned;
    if (total > r._sec.max) { r.warnings.push(`Section ${r._sec.name} will have ${total} students (capacity ${r._sec.max})`); r.flags.push('over_capacity'); }
  }

  // ---- admission numbers: auto for blanks ----
  const year = istToday().slice(0, 4);
  const prefix = `ADM-${year}-`;
  const needAuto = rows.filter((r) => importable(r) && !r.admission_no_given);
  if (needAuto.length) {
    const pr = await query(
      `SELECT admission_no FROM students WHERE school_id=@sid AND deleted_at IS NULL AND admission_no LIKE @pfx`,
      { sid: { type: sql.UniqueIdentifier, value: schoolId }, pfx: { type: sql.NVarChar(100), value: `${prefix}%` } });
    let max = 0;
    for (const x of pr.recordset) { const m = String(x.admission_no).match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }
    const used = new Set(seenAdm.keys());
    let n = max;
    for (const r of needAuto) {
      let cand;
      do { n += 1; cand = `${prefix}${String(n).padStart(4, '0')}`; } while (used.has(cand.toLowerCase()));
      used.add(cand.toLowerCase());
      r.admission_no = cand; r.flags.push('admission_auto');
    }
  }
  for (const r of rows) if (r.admission_no_given) r.admission_no = r.admission_no_given;

  // ---- fee plan: categories + invoice numbers ----
  const catPlan = new Map(); // key -> { name, action, id }
  const planCat = (name) => {
    const k = keyOf(name);
    if (catPlan.has(k)) return catPlan.get(k);
    const ex = ctx.cats.get(k);
    const p = { key: k, name: ex ? ex.name : name, action: ex ? 'existing' : 'new', id: ex ? ex.id : null };
    catPlan.set(k, p);
    return p;
  };
  const dueRows = rows.filter((r) => importable(r) && (r.fee.legacy_paise || r.fee.extra_paise));
  if (dueRows.length) {
    const candidates = dueRows.map((r) => `OPB-${(r.admission_no || '').slice(0, 90)}`);
    const taken = await loadExistingInvoiceNos(schoolId, candidates);
    for (const r of dueRows) {
      let no = `OPB-${r.admission_no.slice(0, 90)}`; let n = 1;
      while (taken.has(no.toLowerCase())) { n += 1; no = `OPB-${r.admission_no.slice(0, 90)}-${n}`; }
      taken.add(no.toLowerCase());
      r.fee.invoice_no = no;
      if (r.fee.legacy_paise) r.fee.legacy_cat = planCat(PREVIOUS_DUES_NAME);
      if (r.fee.extra_paise) r.fee.extra_cat = planCat(r.fee.extra_title);
    }
  }

  // ---- summary (counts only rows that will really be imported) ----
  const ready = rows.filter(importable);
  const gSum = new Map(); const sSum = new Map();
  for (const r of ready) {
    const g = r.plan.grade; const s = r.plan.section;
    const gs = gSum.get(g.identity) || { name: g.name, action: g.action, order: g.order, students: 0 };
    gs.students += 1; gSum.set(g.identity, gs);
    const ss = sSum.get(s.identity) || { class_name: g.name, name: s.name, action: s.action, how: s.how, students: 0, max: sectionInfo.get(s.identity).max, total: 0 };
    ss.students += 1; ss.total = sectionInfo.get(s.identity).existingCount + sectionInfo.get(s.identity).assigned; sSum.set(s.identity, ss);
  }
  const sumPaise = (f) => ready.reduce((t, r) => t + (r.fee[f] || 0), 0);
  const summary = {
    total: rows.length,
    ok: rows.filter((r) => !r.errors.length && !r.needs.length && !r.warnings.length).length,
    warning: rows.filter((r) => !r.errors.length && !r.needs.length && r.warnings.length).length,
    needs_input: rows.filter((r) => !r.errors.length && r.needs.length).length,
    error: rows.filter((r) => r.errors.length).length,
    ready: ready.length,
    needs_class: rows.filter((r) => !r.errors.length && r.needs.includes('class')).length,
    needs_section: rows.filter((r) => !r.errors.length && r.needs.includes('section')).length,
    needs_dob: rows.filter((r) => !r.errors.length && r.needs.includes('dob')).length,
    classes_existing: [...gSum.values()].filter((g) => g.action === 'existing').map((g) => ({ name: g.name, students: g.students })),
    classes_restore: [...gSum.values()].filter((g) => g.action === 'restore').map((g) => ({ name: g.name, students: g.students })),
    classes_new: [...gSum.values()].filter((g) => g.action === 'new').map((g) => ({ name: g.name, students: g.students, numeric_order: g.order })),
    sections: [...sSum.values()],
    sections_new: [...sSum.values()].filter((s) => s.action !== 'existing').length,
    over_capacity: [...sSum.values()].filter((s) => s.total > s.max).map((s) => ({ class_name: s.class_name, name: s.name, total: s.total, max: s.max })),
    legacy: { students: ready.filter((r) => r.fee.legacy_paise).length, total_paise: sumPaise('legacy_paise') },
    extra: { students: ready.filter((r) => r.fee.extra_paise).length, total_paise: sumPaise('extra_paise') },
    categories_new: [...catPlan.values()].filter((c) => c.action === 'new').map((c) => c.name),
    admission_auto: ready.filter((r) => r.flags.includes('admission_auto')).length,
    roll_auto: ready.filter((r) => r.flags.includes('roll_auto')).length,
    no_guardian: ready.filter((r) => r.flags.includes('no_guardian')).length,
  };

  const available_classes = ctx.grades.filter((g) => !g.deleted)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name))
    .map((g) => ({ id: g.id, name: g.name, sections: g.sections.filter((s) => !s.deleted).map((s) => s.name).sort() }));

  return { ctx, rows, summary, available_classes, catPlan };
}

const studentRowStatus = (r) => (r.errors.length ? 'error' : r.needs.length ? 'needs_input' : r.warnings.length ? 'warning' : 'ok');
const studentPublicRow = (r) => ({
  idx: r.idx, line: r.line, status: studentRowStatus(r),
  errors: r.errors, warnings: r.warnings, flags: r.flags, needs: r.needs,
  section_options: r.section_options || null,
  plan: r.plan || null,
  admission_no: r.admission_no || null,
  roll_no: r.roll_no || null,
  fee: { legacy_paise: r.fee.legacy_paise, extra_paise: r.fee.extra_paise, extra_title: r.fee.extra_title },
});

// ── write one student (one transaction) ──────────────────────────────────────
async function importOneStudent(schoolId, adminUserId, r, ctx) {
  const studentId = uuidv4();
  const pend = { grades: [], sections: [], cats: [], restoredGrades: [], restoredSections: [] };
  let invoiceCreated = false;

  await withTransaction(async (tx) => {
    // 1. class (grade)
    const gp = r.plan.grade;
    let gradeId = gp.id || ctx.newGrades.get(gp.identity) || null;
    if (!gradeId) {
      gradeId = uuidv4();
      const q = tx.request();
      q.input('id', sql.UniqueIdentifier, gradeId); q.input('sid', sql.UniqueIdentifier, schoolId);
      q.input('name', sql.NVarChar(100), gp.name); q.input('ord', sql.SmallInt, gp.order);
      await q.query(`INSERT INTO grades (id, school_id, name, numeric_order, stream) VALUES (@id, @sid, @name, @ord, 'none')`);
      pend.grades.push([gp.identity, gradeId]);
    } else if (gp.action === 'restore' && !ctx.restoredGrades.has(gradeId)) {
      const q = tx.request();
      q.input('id', sql.UniqueIdentifier, gradeId); q.input('sid', sql.UniqueIdentifier, schoolId);
      await q.query(`UPDATE grades SET deleted_at=NULL, is_active=1, updated_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`);
      pend.restoredGrades.push(gradeId);
    }

    // 2. section (current academic year)
    const sp = r.plan.section;
    let sectionId = sp.id || ctx.newSections.get(sp.identity) || null;
    if (!sectionId) {
      sectionId = uuidv4();
      const q = tx.request();
      q.input('id', sql.UniqueIdentifier, sectionId); q.input('sid', sql.UniqueIdentifier, schoolId);
      q.input('gid', sql.UniqueIdentifier, gradeId); q.input('ay', sql.UniqueIdentifier, ctx.ay.id);
      q.input('name', sql.NVarChar(50), sp.name);
      await q.query(`INSERT INTO sections (id, school_id, grade_id, academic_year_id, name) VALUES (@id, @sid, @gid, @ay, @name)`);
      pend.sections.push([sp.identity, sectionId]);
    } else if (sp.action === 'restore' && !ctx.restoredSections.has(sectionId)) {
      const q = tx.request();
      q.input('id', sql.UniqueIdentifier, sectionId); q.input('sid', sql.UniqueIdentifier, schoolId);
      await q.query(`UPDATE sections SET deleted_at=NULL, is_active=1, updated_at=GETUTCDATE() WHERE id=@id AND school_id=@sid`);
      pend.restoredSections.push(sectionId);
    }

    // 3. student
    const s1 = tx.request();
    s1.input('id', sql.UniqueIdentifier, studentId); s1.input('sid', sql.UniqueIdentifier, schoolId);
    s1.input('adm', sql.NVarChar(100), r.admission_no); s1.input('fn', sql.NVarChar(100), r.first_name);
    s1.input('mn', sql.NVarChar(100), r.middle_name); s1.input('ln', sql.NVarChar(100), r.last_name);
    s1.input('gen', sql.VarChar(20), r.gender); s1.input('dob', sql.Date, r.date_of_birth);
    s1.input('bg', sql.VarChar(10), r.blood_group); s1.input('nat', sql.NVarChar(100), r.nationality);
    s1.input('rel', sql.NVarChar(100), r.religion); s1.input('caste', sql.NVarChar(100), r.caste);
    s1.input('sc', sql.NVarChar(100), r.sub_caste); s1.input('ews', sql.Bit, r.is_ews ? 1 : 0);
    s1.input('aad', sql.NVarChar(20), r.aadhaar_no); s1.input('ps', sql.NVarChar(255), r.previous_school);
    s1.input('tc', sql.NVarChar(100), r.tc_no); s1.input('ad', sql.Date, r.admission_date);
    s1.input('ap', sql.NVarChar(sql.MAX), r.address_permanent); s1.input('ac', sql.NVarChar(sql.MAX), r.address_current);
    s1.input('city', sql.NVarChar(100), r.city); s1.input('state', sql.NVarChar(100), r.state);
    s1.input('pin', sql.Char(6), r.pincode); s1.input('med', sql.NVarChar(sql.MAX), r.medical_conditions);
    s1.input('dis', sql.NVarChar(sql.MAX), r.disabilities);
    await s1.query(`INSERT INTO students (id,school_id,admission_no,first_name,middle_name,last_name,gender,date_of_birth,blood_group,nationality,religion,caste,sub_caste,is_ews,aadhaar_no,previous_school,tc_no,admission_date,address_permanent,address_current,city,state,pincode,medical_conditions,disabilities)
      VALUES (@id,@sid,@adm,@fn,@mn,@ln,@gen,@dob,@bg,@nat,@rel,@caste,@sc,@ews,@aad,@ps,@tc,@ad,@ap,@ac,@city,@state,@pin,@med,@dis)`);

    // 4. enrolment
    const e1 = tx.request();
    e1.input('sid', sql.UniqueIdentifier, schoolId); e1.input('st', sql.UniqueIdentifier, studentId);
    e1.input('sec', sql.UniqueIdentifier, sectionId); e1.input('ay', sql.UniqueIdentifier, ctx.ay.id);
    e1.input('roll', sql.NVarChar(50), r.roll_no);
    await e1.query(`INSERT INTO enrolments (id,school_id,student_id,section_id,academic_year_id,roll_no,is_active) VALUES (NEWID(),@sid,@st,@sec,@ay,@roll,1)`);

    // 5. guardians
    for (const g of r.guardians) {
      const q = tx.request();
      q.input('sid', sql.UniqueIdentifier, schoolId); q.input('st', sql.UniqueIdentifier, studentId);
      q.input('rel', sql.NVarChar(50), g.relation); q.input('fn', sql.NVarChar(255), g.full_name);
      q.input('ph', sql.NVarChar(50), g.phone); q.input('em', sql.NVarChar(255), g.email);
      q.input('pri', sql.Bit, g.is_primary ? 1 : 0);
      await q.query(`INSERT INTO student_guardians (id,school_id,student_id,relation,full_name,phone,email,is_primary) VALUES (NEWID(),@sid,@st,@rel,@fn,@ph,@em,@pri)`);
    }

    // 6. opening balance invoice (legacy due + extra) + fee account
    const total = r.fee.legacy_paise + r.fee.extra_paise;
    const items = [];
    const catId = async (plan, name) => {
      let id = plan.id || ctx.newCats.get(plan.key);
      if (!id) {
        id = uuidv4();
        const q = tx.request();
        q.input('id', sql.UniqueIdentifier, id); q.input('sid', sql.UniqueIdentifier, schoolId); q.input('name', sql.NVarChar(100), name);
        await q.query(`INSERT INTO fee_categories (id, school_id, name, is_recurring) VALUES (@id, @sid, @name, 0)`);
        pend.cats.push([plan.key, id]);
      }
      return id;
    };
    if (r.fee.legacy_paise) items.push({ cat: await catId(r.fee.legacy_cat, PREVIOUS_DUES_NAME), amt: r.fee.legacy_paise });
    if (r.fee.extra_paise) items.push({ cat: await catId(r.fee.extra_cat, r.fee.extra_title), amt: r.fee.extra_paise });

    if (total > 0) {
      const invId = uuidv4();
      const title = r.fee.legacy_remark ? `Opening Balance – ${r.fee.legacy_remark}` : 'Opening Balance';
      const iq = tx.request();
      iq.input('id', sql.UniqueIdentifier, invId); iq.input('sid', sql.UniqueIdentifier, schoolId);
      iq.input('st', sql.UniqueIdentifier, studentId); iq.input('ay', sql.UniqueIdentifier, ctx.ay.id);
      iq.input('no', sql.NVarChar(100), r.fee.invoice_no); iq.input('title', sql.NVarChar(255), title);
      iq.input('due', sql.Date, istToday()); iq.input('total', sql.BigInt, total);
      iq.input('cby', sql.UniqueIdentifier, adminUserId);
      await iq.query(`INSERT INTO fee_invoices (id, school_id, student_id, academic_year_id, invoice_no, title, due_date, total_paise, balance_paise, status, created_by)
        VALUES (@id,@sid,@st,@ay,@no,@title,@due,@total,@total,'pending',@cby)`);
      for (const it of items) {
        const q = tx.request();
        q.input('iid', sql.UniqueIdentifier, invId); q.input('cid', sql.UniqueIdentifier, it.cat); q.input('amt', sql.BigInt, it.amt);
        await q.query(`INSERT INTO fee_invoice_items (id, invoice_id, fee_category_id, amount_paise) VALUES (NEWID(),@iid,@cid,@amt)`);
      }
      invoiceCreated = true;
    }
    const fa = tx.request();
    fa.input('sid', sql.UniqueIdentifier, schoolId); fa.input('st', sql.UniqueIdentifier, studentId);
    fa.input('total', sql.BigInt, total); fa.input('status', sql.VarChar(20), total > 0 ? 'pending' : 'Pending');
    await fa.query(`INSERT INTO student_fee_accounts (id,school_id,student_id,total_fee_paise,paid_paise,pending_paise,status) VALUES (NEWID(),@sid,@st,@total,0,@total,@status)`);
  });

  // committed → safe to share what this row created with the following rows
  for (const [k, id] of pend.grades) ctx.newGrades.set(k, id);
  for (const [k, id] of pend.sections) ctx.newSections.set(k, id);
  for (const [k, id] of pend.cats) ctx.newCats.set(k, id);
  pend.restoredGrades.forEach((id) => ctx.restoredGrades.add(id));
  pend.restoredSections.forEach((id) => ctx.restoredSections.add(id));
  return {
    student_id: studentId,
    created_grade: pend.grades.length ? r.plan.grade.name : null,
    created_section: pend.sections.length ? `${r.plan.grade.name} – ${r.plan.section.name}` : null,
    restored: pend.restoredGrades.length + pend.restoredSections.length,
    created_cats: pend.cats.length,
    invoice: invoiceCreated,
  };
}

function friendlyStudentDbError(err) {
  const m = String(err && err.message || '');
  if (err && (err.number === 2627 || err.number === 2601)) {
    if (/rollno|roll/i.test(m)) return 'roll number already used in this section';
    if (/invoice/i.test(m)) return 'invoice number conflict — please retry this row';
    return 'duplicate record';
  }
  return m || 'Database error';
}

exports.bulkImportStudents = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const adminUserId = req.user.userId || req.user.id;
    const { dryRun = true, rows: rawRows } = req.body || {};

    if (!Array.isArray(rawRows) || rawRows.length === 0) return badRequest(res, 'rows[] is required');
    const limit = dryRun ? S_MAX_ROWS_DRY_RUN : S_MAX_ROWS_COMMIT;
    if (rawRows.length > limit) return badRequest(res, `Max ${limit} rows per ${dryRun ? 'preview' : 'import'} request`);

    const v = await validateStudentBatch(schoolId, rawRows);
    if (!v) return badRequest(res, 'No academic year found for your school. Create one in Setup first.');
    const { ctx, rows, summary, available_classes } = v;

    if (dryRun) {
      return success(res, {
        academic_year: ctx.ay.name,
        summary,
        rows: rows.map(studentPublicRow),
        available_classes,
      }, 'Preview ready');
    }

    const results = [];
    const agg = { imported: 0, classes: new Set(), sections: new Set(), invoices: 0, legacy_paise: 0, extra_paise: 0 };
    for (const r of rows) {
      if (r.errors.length || r.needs.length) {
        const why = r.errors.length ? r.errors.join('; ')
          : `Needs input: ${r.needs.map((n) => ({ class: 'class', section: 'section', dob: 'date of birth' }[n])).join(', ')}`;
        results.push({ idx: r.idx, line: r.line, ok: false, error: why });
        continue;
      }
      try {
        const out = await importOneStudent(schoolId, adminUserId, r, ctx);
        agg.imported += 1;
        if (out.created_grade) agg.classes.add(out.created_grade);
        if (out.created_section) agg.sections.add(out.created_section);
        if (out.invoice) { agg.invoices += 1; agg.legacy_paise += r.fee.legacy_paise; agg.extra_paise += r.fee.extra_paise; }
        results.push({ idx: r.idx, line: r.line, ok: true, student_id: out.student_id, admission_no: r.admission_no, warnings: r.warnings });
      } catch (e) {
        results.push({ idx: r.idx, line: r.line, ok: false, error: friendlyStudentDbError(e) });
      }
    }

    try {
      await query(
        `INSERT INTO audit_logs (id, school_id, user_id, action_type, details, created_at) VALUES (@lid, @sid, @uid, 'STUDENTS_BULK_IMPORT', @det, GETUTCDATE())`,
        {
          lid: { type: sql.UniqueIdentifier, value: uuidv4() },
          sid: { type: sql.UniqueIdentifier, value: schoolId },
          uid: { type: sql.UniqueIdentifier, value: adminUserId },
          det: { type: sql.NVarChar(sql.MAX), value: JSON.stringify({ imported: agg.imported, failed: rows.length - agg.imported, classesCreated: [...agg.classes], sectionsCreated: [...agg.sections], legacyDuePaise: agg.legacy_paise }) },
        });
    } catch (logErr) { console.warn('Student bulk import audit log failed:', logErr.message); }

    return success(res, {
      summary: {
        total: rows.length, imported: agg.imported, failed: rows.length - agg.imported,
        classes_created: [...agg.classes], sections_created: [...agg.sections],
        invoices: agg.invoices, legacy_paise: agg.legacy_paise, extra_paise: agg.extra_paise,
      },
      results,
    }, `${agg.imported} of ${rows.length} imported`);
  } catch (err) { next(err); }
};

exports._studentInternal = { normalizeStudentRow, gradeKey, deriveGradeOrder, sectionKey };

// exposed for unit tests only
exports._internal = { normalizeRow, parseDate, parseMoney, parseSubjects, findSimilarSubject, normGender };
