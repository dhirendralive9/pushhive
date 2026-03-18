const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  name: { type: String, default: 'A' },
  title: { type: String, required: true, maxlength: 100 },
  body: { type: String, required: true, maxlength: 250 },
  icon: { type: String, default: '' },
  image: { type: String, default: '' },
  url: { type: String, default: '' },  // Override main URL if set
  // Per-variant stats
  stats: {
    targeted: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  }
}, { _id: true });

variantSchema.virtual('ctr').get(function () {
  if (this.stats.sent === 0) return 0;
  return ((this.stats.clicked / this.stats.sent) * 100).toFixed(2);
});

const campaignSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  // Content (used for non-A/B campaigns, or as defaults)
  title: { type: String, required: true, maxlength: 100 },
  body: { type: String, required: true, maxlength: 250 },
  icon: { type: String, default: '' },
  image: { type: String, default: '' },
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
  targetSegment: { type: mongoose.Schema.Types.ObjectId, ref: 'Segment' },
  // Actions (up to 2 buttons)
  actions: [{
    title: { type: String },
    url: { type: String }
  }],

  // ── A/B Testing ─────────────────────────────────────────────
  abTest: {
    enabled: { type: Boolean, default: false },
    // Variants (A and B)
    variants: [variantSchema],
    // Split: percentage going to test group (e.g. 20 means 20% get A/B, 80% get winner)
    testPercentage: { type: Number, default: 20, min: 5, max: 50 },
    // Hours to wait before picking winner
    waitHours: { type: Number, default: 4, min: 1, max: 72 },
    // Which metric to judge winner
    winnerMetric: { type: String, enum: ['ctr', 'clicks'], default: 'ctr' },
    // Result
    winnerVariant: { type: String, default: '' },  // 'A' or 'B'
    winnerSentAt: { type: Date },
    // Status: 'testing' → 'waiting' → 'winner_sent' → 'complete'
    status: { type: String, enum: ['testing', 'waiting', 'winner_sent', 'complete', ''], default: '' }
  },

  // Scheduling
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'queued', 'sending', 'ab_testing', 'ab_waiting', 'ab_sending_winner', 'sent', 'failed'],
    default: 'draft',
    index: true
  },
  scheduledAt: { type: Date },
  sentAt: { type: Date },
  // Overall Stats
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
campaignSchema.methods.buildUrl = function (variantName) {
  try {
    const urlObj = new URL(this.url);
    if (this.utm.source) urlObj.searchParams.set('utm_source', this.utm.source);
    if (this.utm.medium) urlObj.searchParams.set('utm_medium', this.utm.medium);
    if (this.utm.campaign) urlObj.searchParams.set('utm_campaign', this.utm.campaign);
    if (this.utm.term) urlObj.searchParams.set('utm_term', this.utm.term);
    if (this.utm.content) urlObj.searchParams.set('utm_content', variantName || this.utm.content || '');
    return urlObj.toString();
  } catch (e) {
    return this.url;
  }
};

// Get payload for a specific variant
campaignSchema.methods.getVariantPayload = function (variantName) {
  if (!this.abTest.enabled || !this.abTest.variants.length) {
    return {
      title: this.title,
      body: this.body,
      icon: this.icon || '',
      image: this.image || '',
      badge: this.badge || '',
      url: this.buildUrl(),
      campaignId: this._id.toString(),
      siteId: this.siteId.toString(),
      actions: this.actions || [],
      utm: this.utm
    };
  }

  const variant = this.abTest.variants.find(v => v.name === variantName);
  if (!variant) return null;

  return {
    title: variant.title || this.title,
    body: variant.body || this.body,
    icon: variant.icon || this.icon || '',
    image: variant.image || this.image || '',
    badge: this.badge || '',
    url: this.buildUrl(variantName),
    campaignId: this._id.toString(),
    variantId: variant._id.toString(),
    variantName: variant.name,
    siteId: this.siteId.toString(),
    actions: this.actions || [],
    utm: { ...this.utm, content: variantName }
  };
};

module.exports = mongoose.model('Campaign', campaignSchema);
