const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  subscriberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscriber' },
  type: {
    type: String,
    enum: ['delivered', 'clicked', 'dismissed', 'failed'],
    required: true
  },
  // A/B testing
  variantId: { type: mongoose.Schema.Types.ObjectId },
  variantName: { type: String, default: '' },
  // UTM data captured on click
  utm: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  },
  // Extra data
  browser: String,
  os: String,
  device: String,
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now }
});

eventSchema.index({ siteId: 1, campaignId: 1, type: 1 });
eventSchema.index({ siteId: 1, createdAt: -1 });
eventSchema.index({ campaignId: 1, type: 1 });
eventSchema.index({ campaignId: 1, variantName: 1, type: 1 });

module.exports = mongoose.model('Event', eventSchema);
