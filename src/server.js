// src/server.js
require('dotenv').config();

// Fail fast: without a JWT secret every login / reset token would be signed with `undefined`.
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.warn('WARNING: JWT_SECRET is shorter than 32 characters. Use a long random value.');
}
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression= require('compression');
const rateLimit  = require('express-rate-limit');
const { getPool, poolPromise } = require('./config/db');
const logger     = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { moduleGate } = require('./middleware/auth');
const requestLogger = require('./middleware/requestLogger');


const app = express();
app.set('trust proxy', 1);

const customKeyGenerator = (req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  return typeof ip === 'string' ? ip.split(',')[0].split(':')[0].trim() : 'unknown';
};

// ── Security & compression ─────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());

// ── CORS ──────────────────────────────────────────────────────────────
// ── CORS ──────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'https://admin.schooloffice.tech,https://teachers.schooloffice.tech,https://student.schooloffice.tech,https://admin.schooloffice.tech/?signup=1,https://dpw5tz.csb.app,https://k5wrj7.csb.app').split(',');
// Capacitor (Android/iOS) app WebView origins — hamesha allowed, chahe FRONTEND_URL env set ho. (Auth token header se hota hai, cookies se nahi.)
const nativeAppOrigins = ['https://localhost', 'http://localhost', 'capacitor://localhost', 'ionic://localhost'];
nativeAppOrigins.forEach((o) => { if (!allowedOrigins.includes(o)) allowedOrigins.push(o); });

// koi bhi https://<anything>.schooloffice.tech (admin / teachers / student / app ... ) hamesha allowed
const schoolOfficeSubdomain = /^https:\/\/([a-z0-9-]+\.)*schooloffice\.tech$/i;
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || schoolOfficeSubdomain.test(origin)) return cb(null, true);
    // Azure Log stream me dikhega: kaunsa web address block hua (FRONTEND_URL me jodna ho to yahi value)
    console.warn(`[cors] blocked origin: ${origin}`);
    cb(null, false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-School-Id'],
}));
app.options('*', cors());

// ── Body parsing ──────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Detailed request/response logging (custom) ──────────────────────────
app.use(requestLogger);  

// ── Logging ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}



// ── Rate limiting ──────────────────────────────────────────────────────
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  keyGenerator: customKeyGenerator,
  message: { success: false, message: 'Too many login attempts. Try after 15 minutes.' },
}));

app.use('/api/', rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 min
  max: 300,
  keyGenerator: customKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
}));

// ── Health check ───────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV, ts: new Date().toISOString() });
});

// ── API Routes ─────────────────────────────────────────────────────────
const API = '/api';

app.use(`${API}/auth`,          require('./routes/auth'));

// ── Module-wise access (User Management > Permissions) ──────────────────────
// moduleGate(keys, rules): school_admin ko sab; baaki ko school_members.permissions.modules me se koi ek key chahiye.
// 'open'  = doosre modules ke shared lookups (koi bhi authenticated staff padh sakta hai); writes module permission maangte hain.
// Fine-grained role checks (authorize(...)) route files ke andar waise hi chalte hain.
app.use(`${API}/dashboard`,     moduleGate('dashboard'),                                   require('./routes/dashboard'));
app.use(`${API}/setup`,         moduleGate('setup',    { 'GET *': 'open' }),               require('./routes/setup'));
app.use(`${API}/students`,      moduleGate('students', { 'GET *': 'open' }),               require('./routes/students'));
app.use(`${API}/promotion`,     moduleGate('promotion'),                                   require('./routes/promotion'));
app.use(`${API}/teachers`,      moduleGate('teachers', { 'GET *': 'open' }),               require('./routes/teachers'));
app.use(`${API}/fees`,          moduleGate('fees',     { 'GET /overview': ['fees', 'dashboard'] }), require('./routes/fees'));
app.use(`${API}/payroll`,       moduleGate('payroll'),                                     require('./routes/payroll'));
app.use(`${API}/arrangement`,   moduleGate('arrangement'),                                 require('./routes/arrangement'));
app.use('/api/payments',        moduleGate('fees'),                                        require('./routes/payments'));
app.use(`${API}/results`,       moduleGate(['results', 'exams']),                          require('./routes/results'));
app.use(`${API}/timetable`,     moduleGate(['timetable', 'setup', 'teachers']),            require('./routes/timetables'));
app.use(`${API}/quick-tests`,   moduleGate('tests'),                                       require('./routes/quickTests'));
app.use(`${API}/exams`,         moduleGate(['exams', 'results']),                          require('./routes/exams'));
app.use(`${API}/notices`,       require('./routes/notices'));
app.use(`${API}/notifications`, require('./routes/notifications'));
app.use(`${API}/inbox`,         require('./routes/inbox'));
app.use(`${API}/device-tokens`, require('./routes/deviceTokens'));
app.use(`${API}/comm`,          moduleGate('commhub',  { 'GET /messages/:id': 'open' }),   require('./routes/commHub'));
app.use(`${API}/homework`,      moduleGate('homework', { 'GET /mine': 'skip' }),           require('./routes/homework'));
app.use('/api/attendance',      moduleGate('attendance', { 'GET /staff/roster': ['attendance', 'dashboard'] }), require('./routes/attendance'));
app.use(`${API}/audit`, require('./routes/audit'));
app.use(`${API}/admin/users`, require('./routes/userManagement'));
app.use(`${API}/transport`,     moduleGate('transport'),                                   require('./routes/transport'));

// ── Student App routes (isolated auth, existing controllers reused) ──────
app.use(`${API}/student/auth`,        require('./routes/student/Auth'));
app.use(`${API}/student/attendance`,  require('./routes/student/Attendance'));
app.use(`${API}/student/fees`,        require('./routes/student/Fees'));
app.use(`${API}/student/payments`,    require('./routes/student/Payments'));
app.use(`${API}/student/results`,     require('./routes/student/Results'));
app.use(`${API}/student/dashboard`,   require('./routes/student/Dashboard'));
app.use(`${API}/student/inbox`,       require('./routes/student/Inbox'));
app.use(`${API}/student/device-tokens`, require('./routes/student/DeviceTokens'));
app.use(`${API}/student/quick-tests`, require('./routes/student/QuickTests'));

// ── 404 ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ───────────────────────────────────────────────
app.use(errorHandler);


// ── Start & Heartbeat ──────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

// Heartbeat Funct   

const start = async () => {
  try {
    await getPool(); 
    
    app.listen(PORT, () => {
      logger.info(`🚀 School ERP API running on port ${PORT} [${process.env.NODE_ENV}]`);
      logger.info(`📡 Azure SQL: ${process.env.DB_SERVER}/${process.env.DB_DATABASE}`);
      
      
    });
    
  } catch (err) {
    logger.error('❌ Startup failed:', err.message);
    process.exit(1);
  }
};


start();

module.exports = app; 

