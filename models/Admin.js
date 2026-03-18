const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  name: { type: String, default: 'User' },
  role: {
    type: String,
    enum: ['super', 'admin', 'editor', 'viewer'],
    default: 'viewer'
  },
  // Site access (empty = all sites for super/admin, specific sites for editor/viewer)
  siteAccess: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Site' }],
  // Invitation
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  inviteToken: { type: String },
  inviteExpires: { type: Date },
  inviteAccepted: { type: Boolean, default: false },
  // Security
  lastLogin: { type: Date },
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
  // Status
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Hash password before save
adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate invite token
adminSchema.methods.generateInviteToken = function () {
  this.inviteToken = crypto.randomBytes(32).toString('hex');
  this.inviteExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  return this.inviteToken;
};

// Check permissions
adminSchema.methods.can = function (action) {
  const permissions = {
    super:  ['manage_users', 'manage_sites', 'manage_settings', 'create_campaigns', 'send_campaigns', 'view_analytics', 'manage_webhooks', 'manage_segments', 'manage_rss', 'delete_data'],
    admin:  ['manage_users', 'manage_sites', 'manage_settings', 'create_campaigns', 'send_campaigns', 'view_analytics', 'manage_webhooks', 'manage_segments', 'manage_rss', 'delete_data'],
    editor: ['create_campaigns', 'send_campaigns', 'view_analytics', 'manage_segments'],
    viewer: ['view_analytics']
  };
  return (permissions[this.role] || []).includes(action);
};

// Check if user has access to a specific site
adminSchema.methods.hasAccessToSite = function (siteId) {
  if (this.role === 'super' || this.role === 'admin') return true;
  if (!this.siteAccess || this.siteAccess.length === 0) return true; // No restriction = all
  return this.siteAccess.some(id => id.toString() === siteId.toString());
};

// Role display labels
adminSchema.statics.ROLE_LABELS = {
  super: 'Super Admin',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer'
};

adminSchema.statics.ROLE_DESCRIPTIONS = {
  super: 'Full access to everything. Cannot be deleted.',
  admin: 'Full access. Can manage users, sites, and all features.',
  editor: 'Can create and send campaigns, manage segments, view analytics.',
  viewer: 'Read-only access to analytics and campaign results.'
};

module.exports = mongoose.model('Admin', adminSchema);
