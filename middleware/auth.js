// Require admin session
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  req.session.error = 'Please log in to continue';
  return res.redirect('/auth/login');
}

// Require valid API key for SDK/API routes
const Site = require('../models/Site');

async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || req.body.apiKey;
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  try {
    const site = await Site.findOne({ apiKey, active: true });
    if (!site) {
      return res.status(403).json({ error: 'Invalid API key' });
    }
    req.site = site;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}

// CORS headers for SDK endpoints
function sdkCors(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
}

module.exports = { requireAuth, requireApiKey, sdkCors };
