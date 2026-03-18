const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  subscription: {
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true }
    }
  },
  // Device info
  browser: { type: String, default: 'Unknown' },
  browserVersion: { type: String, default: '' },
  os: { type: String, default: 'Unknown' },
  device: { type: String, enum: ['desktop', 'mobile', 'tablet'], default: 'desktop' },
  // Metadata
  ip: { type: String, default: '' },
  country: { type: String, default: '' },
  city: { type: String, default: '' },
  referrer: { type: String, default: '' },
  landingPage: { type: String, default: '' },
  // Engagement
  tags: [{ type: String }],
  lastActive: { type: Date, default: Date.now },
  totalClicks: { type: Number, default: 0 },
  totalReceived: { type: Number, default: 0 },
  // Status
  active: { type: Boolean, default: true },
  unsubscribedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// Compound index: one subscription per endpoint per site
subscriberSchema.index({ siteId: 1, 'subscription.endpoint': 1 }, { unique: true });
subscriberSchema.index({ siteId: 1, active: 1 });
subscriberSchema.index({ siteId: 1, createdAt: -1 });
subscriberSchema.index({ siteId: 1, tags: 1 });

module.exports = mongoose.model('Subscriber', subscriberSchema);
