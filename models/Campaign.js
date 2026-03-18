const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  // Content
  title: { type: String, required: true, maxlength: 100 },
  body: { type: String, required: true, maxlength: 250 },
  icon: { type: String, default: '' },
  image: { type: String, default: '' },       // large image
  badge: { type: String, default: '' },
  url: { type: String, required: true },
  // UTM Parameters
  utm: {
    source: { type: String, default: 'pushhive' },
    medium: { type: String, default: 'web_push' },
    campaign: { type: String, default: '' },
    term: { type: String, default: '' },
    content: { type: String, default: '' }
  },
  // Targeting
  targetAll: { type: Boolean, default: true },
  targetTags: [{ type: String }],
  targetBrowsers: [{ type: String }],
  targetDevices: [{ type: String }],
  // Actions (up to 2 buttons)
  actions: [{
    title: { type: String },
    url: { type: String }
  }],
  // Scheduling
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'failed'],
    default: 'draft',
    index: true
  },
  scheduledAt: { type: Date },
  sentAt: { type: Date },
  // Stats
  stats: {
    targeted: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    dismissed: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

campaignSchema.index({ status: 1, scheduledAt: 1 });

// Virtual: click-through rate
campaignSchema.virtual('ctr').get(function () {
  if (this.stats.sent === 0) return 0;
  return ((this.stats.clicked / this.stats.sent) * 100).toFixed(2);
});

// Build the final URL with UTM params
campaignSchema.methods.buildUrl = function () {
  try {
    const urlObj = new URL(this.url);
    if (this.utm.source) urlObj.searchParams.set('utm_source', this.utm.source);
    if (this.utm.medium) urlObj.searchParams.set('utm_medium', this.utm.medium);
    if (this.utm.campaign) urlObj.searchParams.set('utm_campaign', this.utm.campaign);
    if (this.utm.term) urlObj.searchParams.set('utm_term', this.utm.term);
    if (this.utm.content) urlObj.searchParams.set('utm_content', this.utm.content);
    return urlObj.toString();
  } catch (e) {
    return this.url;
  }
};

module.exports = mongoose.model('Campaign', campaignSchema);
