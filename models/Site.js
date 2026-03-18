const mongoose = require('mongoose');
const crypto = require('crypto');

const siteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  domain: { type: String, required: true, trim: true },
  apiKey: { type: String, unique: true },
  icon: { type: String, default: '' }, // URL to default notification icon
  welcomeNotification: {
    enabled: { type: Boolean, default: true },
    title: { type: String, default: 'Thanks for subscribing!' },
    body: { type: String, default: 'You will now receive updates from us.' },
    url: { type: String, default: '' }
  },
  promptConfig: {
    delay: { type: Number, default: 3 },          // seconds before showing prompt
    style: { type: String, enum: ['native', 'banner', 'modal'], default: 'banner' },
    title: { type: String, default: 'Stay Updated!' },
    message: { type: String, default: 'Get notified about our latest updates.' },
    allowButtonText: { type: String, default: 'Allow' },
    denyButtonText: { type: String, default: 'Maybe Later' }
  },
  inAppBrowserRedirect: { type: Boolean, default: true }, // enable FB/IG webview escape
  subscriberCount: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Generate API key before save
siteSchema.pre('save', function (next) {
  if (!this.apiKey) {
    this.apiKey = 'ph_' + crypto.randomBytes(24).toString('hex');
  }
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Site', siteSchema);
