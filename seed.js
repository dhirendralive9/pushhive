#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./models/Admin');

const email = process.argv[2] || process.env.ADMIN_EMAIL;
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
const name = process.argv[4] || process.env.ADMIN_NAME || 'Admin';

if (!email || !password) {
  console.error('Usage: node seed.js <email> <password> [name]');
  console.error('   or: set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  process.exit(1);
}

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    // Check if admin already exists
    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.log(`⚠ Admin with email ${email} already exists. Updating password...`);
      existing.password = password;
      existing.name = name;
      await existing.save();
      console.log('✓ Admin password updated');
    } else {
      const admin = new Admin({ email, password, name, role: 'super' });
      await admin.save();
      console.log(`✓ Admin account created: ${email}`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('✗ Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
