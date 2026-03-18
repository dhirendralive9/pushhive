const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/dashboard');
  res.render('pages/login');
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      req.session.error = 'Email and password are required';
      return res.redirect('/auth/login');
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin) {
      req.session.error = 'Invalid email or password';
      return res.redirect('/auth/login');
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      req.session.error = 'Invalid email or password';
      return res.redirect('/auth/login');
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Set session
    req.session.admin = {
      id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    };

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    req.session.error = 'An error occurred during login';
    res.redirect('/auth/login');
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/auth/login');
  });
});

module.exports = router;
