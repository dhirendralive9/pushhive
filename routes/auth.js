const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const {
  loginLimiter,
  checkAccountLock,
  recordFailedLogin,
  resetFailedLogin,
  verifyTurnstile,
  validateCsrfToken
} = require('../middleware/security');

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/dashboard');
  res.render('pages/login');
});

// POST /auth/login — protected by: rate limiter → CSRF → Turnstile → account lock check
router.post('/login',
  loginLimiter,
  validateCsrfToken,
  verifyTurnstile,
  checkAccountLock,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        req.session.error = 'Email and password are required';
        return res.redirect('/auth/login');
      }

      const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
      if (!admin) {
        // Don't reveal whether email exists
        req.session.error = 'Invalid email or password';
        return res.redirect('/auth/login');
      }

      const isMatch = await admin.comparePassword(password);
      if (!isMatch) {
        // Record failed attempt
        await recordFailedLogin(email);
        req.session.error = 'Invalid email or password';
        return res.redirect('/auth/login');
      }

      // Success — reset failed attempts
      await resetFailedLogin(email);

      // Update last login
      admin.lastLogin = new Date();
      await admin.save();

      // Regenerate session to prevent fixation
      const adminData = {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      };

      req.session.regenerate((err) => {
        if (err) {
          console.error('Session regeneration error:', err);
          req.session.error = 'Login failed. Please try again.';
          return res.redirect('/auth/login');
        }
        req.session.admin = adminData;
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('Login error:', err);
      req.session.error = 'An error occurred during login';
      res.redirect('/auth/login');
    }
  }
);

// GET /auth/invite/:token — accept invitation
router.get('/invite/:token', async (req, res) => {
  try {
    const admin = await Admin.findOne({
      inviteToken: req.params.token,
      inviteExpires: { $gt: new Date() },
      inviteAccepted: false
    });
    if (!admin) {
      return res.render('pages/invite', { error: 'Invalid or expired invitation link', token: null });
    }
    res.render('pages/invite', { error: null, token: req.params.token, email: admin.email, name: admin.name });
  } catch (err) {
    res.render('pages/invite', { error: 'Something went wrong', token: null });
  }
});

// POST /auth/invite/:token — set password and activate account
router.post('/invite/:token', async (req, res) => {
  try {
    const { name, password, confirmPassword } = req.body;
    if (!password || password.length < 6) {
      return res.render('pages/invite', { error: 'Password must be at least 6 characters', token: req.params.token, email: '', name: name || '' });
    }
    if (password !== confirmPassword) {
      return res.render('pages/invite', { error: 'Passwords do not match', token: req.params.token, email: '', name: name || '' });
    }

    const admin = await Admin.findOne({
      inviteToken: req.params.token,
      inviteExpires: { $gt: new Date() },
      inviteAccepted: false
    });
    if (!admin) {
      return res.render('pages/invite', { error: 'Invalid or expired invitation link', token: null });
    }

    admin.name = name || admin.name;
    admin.password = password;
    admin.inviteAccepted = true;
    admin.inviteToken = undefined;
    admin.inviteExpires = undefined;
    await admin.save();

    // Auto-login
    req.session.admin = {
      id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    };
    res.redirect('/dashboard');
  } catch (err) {
    res.render('pages/invite', { error: 'Failed to set up account: ' + err.message, token: req.params.token });
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.clearCookie('pushhive.sid');
    res.redirect('/auth/login');
  });
});

module.exports = router;
