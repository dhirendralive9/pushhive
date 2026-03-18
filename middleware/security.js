const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const helmet = require('helmet');
const Admin = require('../models/Admin');

// ── Helmet — Security Headers ───────────────────────────────────
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net",
        "https://challenges.cloudflare.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["https://challenges.cloudflare.com"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }  // Allow SDK to be loaded cross-origin
});

// ── Login Rate Limiter — Brute Force Protection ─────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 5 attempts per window
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.error = 'Too many login attempts. Please try again in 15 minutes.';
    res.redirect('/auth/login');
  },
  keyGenerator: (req) => {
    return req.ip || req.headers['x-forwarded-for'] || 'unknown';
  }
});

// ── API Rate Limiter — Prevent API Abuse ────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 120,               // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

// ── SDK Rate Limiter — Subscribe/Unsubscribe ────────────────────
const sdkLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 30,                // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' }
});

// ── Account Lockout ─────────────────────────────────────────────
const LOGIN_MAX_ATTEMPTS = 10;
const LOCK_DURATION = 30 * 60 * 1000; // 30 minutes

async function checkAccountLock(req, res, next) {
  const { email } = req.body;
  if (!email) return next();

  const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
  if (!admin) return next(); // Don't reveal if account exists

  if (admin.lockUntil && admin.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((admin.lockUntil - Date.now()) / 60000);
    req.session.error = `Account locked. Try again in ${minutesLeft} minutes.`;
    return res.redirect('/auth/login');
  }

  // Reset lock if expired
  if (admin.lockUntil && admin.lockUntil <= Date.now()) {
    admin.failedLoginAttempts = 0;
    admin.lockUntil = null;
    await admin.save();
  }

  next();
}

async function recordFailedLogin(email) {
  const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
  if (!admin) return;

  admin.failedLoginAttempts = (admin.failedLoginAttempts || 0) + 1;

  if (admin.failedLoginAttempts >= LOGIN_MAX_ATTEMPTS) {
    admin.lockUntil = new Date(Date.now() + LOCK_DURATION);
    console.log(`[Security] Account locked: ${email} after ${LOGIN_MAX_ATTEMPTS} failed attempts`);
  }

  await admin.save();
}

async function resetFailedLogin(email) {
  await Admin.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { failedLoginAttempts: 0, lockUntil: null }
  );
}

// ── Cloudflare Turnstile Verification ───────────────────────────
async function verifyTurnstile(req, res, next) {
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;

  // Skip if Turnstile not configured
  if (!turnstileSecret) return next();

  const token = req.body['cf-turnstile-response'];
  if (!token) {
    req.session.error = 'Please complete the security check';
    return res.redirect('/auth/login');
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: turnstileSecret,
        response: token,
        remoteip: req.ip
      })
    });

    const data = await response.json();
    if (data.success) {
      return next();
    }

    console.log(`[Security] Turnstile verification failed:`, data['error-codes']);
    req.session.error = 'Security verification failed. Please try again.';
    return res.redirect('/auth/login');
  } catch (err) {
    console.error('[Security] Turnstile API error:', err);
    // Fail open — don't lock out admins if Cloudflare is down
    return next();
  }
}

// ── Input Sanitization Middleware ────────────────────────────────
const sanitizeInputs = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.log(`[Security] Sanitized key: ${key} from ${req.ip}`);
  }
});

// ── XSS Sanitizer for string inputs ─────────────────────────────
function xssSanitize(req, res, next) {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        // Strip HTML tags from all string inputs
        req.body[key] = req.body[key]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<[^>]*>/g, '')
          .trim();
      }
    }
  }
  next();
}

// ── CSRF Token Generation ───────────────────────────────────────
function generateCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function validateCsrfToken(req, res, next) {
  // Skip for API routes (they use API keys)
  if (req.path.startsWith('/api/')) return next();

  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    req.session.error = 'Invalid form submission. Please try again.';
    return res.redirect('back');
  }
  next();
}

// ── Security Logging ────────────────────────────────────────────
function securityLogger(req, res, next) {
  const suspiciousPatterns = [
    /(\$gt|\$gte|\$lt|\$lte|\$ne|\$in|\$nin|\$regex)/i,  // NoSQL injection
    /(union\s+select|drop\s+table|insert\s+into)/i,       // SQL injection
    /(<script|javascript:|on\w+\s*=)/i,                    // XSS
    /(\.\.\/|\.\.\\)/,                                      // Path traversal
  ];

  const checkValue = JSON.stringify(req.body) + JSON.stringify(req.query);
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(checkValue)) {
      console.log(`[Security] Suspicious request from ${req.ip}: ${req.method} ${req.path} — Pattern: ${pattern}`);
      break;
    }
  }
  next();
}

module.exports = {
  helmetMiddleware,
  loginLimiter,
  apiLimiter,
  sdkLimiter,
  checkAccountLock,
  recordFailedLogin,
  resetFailedLogin,
  verifyTurnstile,
  sanitizeInputs,
  xssSanitize,
  generateCsrfToken,
  validateCsrfToken,
  securityLogger
};
