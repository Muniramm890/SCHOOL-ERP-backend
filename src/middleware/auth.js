// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('../utils/response');
const { queryOne, sql } = require('../config/db');

// Verify JWT and attach user context
const authenticate = async (req, res, next) => {
  // moduleGate() pehle hi authenticate kar chuka ho to dobara DB lookup nahi (route files me bhi router.use(authenticate) hai)
  if (req._staffAuthed) return next();
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'No token provided');
    }

    const token = authHeader.split(' ')[1];
    
    // 🔥 THE FIX: Yahan same fallback secret use karna zaroori hai!
    // Verification mein bhi wahi string use karein
const secretKey = process.env.JWT_SECRET; 
const decoded = jwt.verify(token, secretKey);
    // Only real access tokens: refresh tokens (30 days) and password-reset tokens are signed with the same secret.
    if (decoded.type === 'refresh' || decoded.purpose) return unauthorized(res, 'Invalid token type');
    // Fetch live user + school member record
    const member = await queryOne(
      `SELECT sm.id AS member_id, sm.school_id, sm.user_id, sm.role, sm.permissions, sm.is_active,
              u.full_name, u.email, u.phone
       FROM   school_members sm
       JOIN   users u ON u.id = sm.user_id
       WHERE  sm.user_id  = @userId
         AND  sm.school_id = @schoolId
         AND  sm.deleted_at IS NULL`,
      {
        userId:   { type: sql.UniqueIdentifier, value: decoded.userId },
        schoolId: { type: sql.UniqueIdentifier, value: decoded.schoolId },
      }
    );

    if (!member || !member.is_active) {
      return unauthorized(res, 'Account inactive or not found');
    }

    req.user = {
      userId:    member.user_id,
      memberId:  member.member_id,
      schoolId:  member.school_id,
      role:      member.role,
      fullName:  member.full_name,
      email:     member.email,
      permissions: JSON.parse(member.permissions || '{}'),
    };
    req._staffAuthed = true;

    next();
  } catch (err) {
    // Console log add kiya taaki exact error server logs mein dikhe
    console.error("Auth Middleware Error:", err.message);
    
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token expired');
    if (err.name === 'JsonWebTokenError') return unauthorized(res, 'Invalid token');
    next(err);
  }
};


const authorize = (...allowedRoles) => (req, res, next) => {
  // Agar user ka role 'school_admin' hai, toh usey har jagah access do
  if (req.user.role === 'school_admin') return next();
  
  // Agar specific roles check karne hain
  if (allowedRoles.includes(req.user.role)) return next();
  
  return forbidden(res, 'Access denied. You do not have the required permissions.');
};

// School ID consistency check — frontend must send X-School-Id header or route param
const requireSchool = (req, res, next) => {
  const headerSchool = req.headers['x-school-id'];
  if (headerSchool && headerSchool !== req.user.schoolId) {
    return forbidden(res, 'School mismatch');
  }
  next();
};

// Per-module permission gate.
// school_admin (top authority) always passes; everyone else needs AT LEAST ONE of the given
// module keys inside school_members.permissions.modules (User Management se assign hote hain).
// Usage: authorizeModule('fees')  |  authorizeModule('exams', 'results')  (any-of)
const authorizeModule = (...moduleKeys) => (req, res, next) => {
  if (req.user.role === 'school_admin') return next();
  const allowed = Array.isArray(req.user.permissions?.modules) ? req.user.permissions.modules : [];
  if (moduleKeys.some((k) => allowed.includes(k))) return next();
  return forbidden(res, `Access denied. You do not have access to the '${moduleKeys.join("' / '")}' module.`);
};

// Route-level rules ko regex me compile karta hai.  Rule format: "METHOD /path/:param/*"
//   METHOD = GET/POST/PUT/PATCH/DELETE ya * (any)   |   :param = ek path segment   |   * = kuch bhi
const compileRules = (rules) =>
  Object.entries(rules).map(([rule, value]) => {
    const [method, pattern] = rule.split(' ');
    const re = new RegExp(
      '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+').replace(/\*/g, '.*') + '$'
    );
    return { method, re, value };
  });

// moduleGate(keys, rules) — server.js me mount-level par use hota hai:
//   app.use('/api/fees', moduleGate('fees', { 'GET /overview': ['fees', 'dashboard'] }), require('./routes/fees'));
// Default: har request par `keys` me se koi ek module permission chahiye (school_admin ko hamesha access).
// rules (optional) se exceptions:
//   value = ['k1','k2']  -> us route ke liye alag module keys
//   value = 'open'       -> koi bhi authenticated staff (doosre modules ke shared lookups, jaise GET /students)
//   value = 'skip'       -> koi staff auth nahi (route khud auth karta hai, jaise student token wala /homework/mine)
const moduleGate = (keys, rules = {}) => {
  const compiled = compileRules(rules);
  const defaultGate = authorizeModule(...[].concat(keys));
  return (req, res, next) => {
    const rule = compiled.find((r) => (r.method === '*' || r.method === req.method) && r.re.test(req.path));
    if (rule && rule.value === 'skip') return next();
    authenticate(req, res, (err) => {
      if (err) return next(err);
      if (rule && rule.value === 'open') return next();
      const gate = rule ? authorizeModule(...[].concat(rule.value)) : defaultGate;
      return gate(req, res, next);
    });
  };
};

module.exports = { authenticate, authorize, requireSchool, authorizeModule, moduleGate };
