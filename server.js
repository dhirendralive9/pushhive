require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const {
  helmetMiddleware, sanitizeInputs, xssSanitize,
  generateCsrfToken, securityLogger, apiLimiter, sdkLimiter
} = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy (behind Nginx/Docker) ───────────────────────────
app.set('trust proxy', 1);

// ── MongoDB Connection ──────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✓ MongoDB connected'))
  .catch(err => { console.error('✗ MongoDB connection error:', err); process.exit(1); });

// ── Security Middleware ─────────────────────────────────────────
app.use(helmetMiddleware);
app.use(sanitizeInputs);
app.use(securityLogger);

// ── Body Parsing ────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(xssSanitize);
app.use(express.static(path.join(__dirname, 'public')));

// Session with MongoDB store
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60 // 24 hours
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  },
  name: 'pushhive.sid'
}));

// CSRF token generation for all dashboard pages
app.use(generateCsrfToken);

// Role-based helpers for templates
const { roleHelpers } = require('./middleware/roles');
app.use(roleHelpers);

// Make session data + config available to all EJS views
app.use((req, res, next) => {
  res.locals.admin = req.session.admin || null;
  res.locals.success = req.session.success || null;
  res.locals.error = req.session.error || null;
  res.locals.turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '';
  res.locals.appVersion = pkg.version;
  delete req.session.success;
  delete req.session.error;
  next();
});

// ── View Engine ─────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Health Check & Version ──────────────────────────────────────
const pkg = require('./package.json');
const { ping: pingRedis } = require('./services/redis');

app.get('/health', async (req, res) => {
  try {
    const mongoState = mongoose.connection.readyState;
    const redisOk = await pingRedis();
    const uptime = process.uptime();
    const status = (mongoState === 1 && redisOk) ? 'ok' : 'degraded';
    res.json({
      status,
      version: pkg.version,
      uptime: Math.floor(uptime),
      mongo: mongoState === 1 ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/version', (req, res) => {
  res.json({ version: pkg.version, name: pkg.name });
});

// ── Routes (with rate limiters) ─────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/api/v1', apiLimiter, require('./routes/external-api'));
app.use('/api', sdkLimiter, require('./routes/api'));
app.use('/sdk', require('./routes/sdk'));

// Root redirect
app.get('/', (req, res) => {
  if (req.session.admin) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

// ── 404 Handler ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('pages/404');
});

// ── Error Handler ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('pages/error', { message: 'Something went wrong' });
});

// ── Start Server ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ PushHive running on port ${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);

  // Start campaign scheduler
  const scheduler = require('./services/scheduler');
  scheduler.start(30000); // Check every 30 seconds
});
