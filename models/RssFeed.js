const mongoose = require('mongoose');

const rssFeedSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  name: { type: String, required: true, trim: true },
  feedUrl: { type: String, required: true, trim: true },
  // Polling
  pollInterval: { type: Number, default: 10, min: 1, max: 1440 }, // minutes
  lastPolledAt: { type: Date },
  lastItemGuid: { type: String, default: '' },   // GUID/link of last seen item
  lastItemDate: { type: Date },                   // pubDate of last seen item
  // Notification template
  template: {
    titlePrefix: { type: String, default: '' },        // e.g. "New Post: "
    titleField: { type: String, enum: ['title', 'custom'], default: 'title' },
    customTitle: { type: String, default: '' },
    bodyField: { type: String, enum: ['description', 'custom'], default: 'description' },
    customBody: { type: String, default: '' },
    icon: { type: String, default: '' },
    image: { type: String, default: '' },              // Empty = try to extract from feed item
    extractImage: { type: Boolean, default: true },    // Auto-extract image from content
  },
  // UTM
  utm: {
    source: { type: String, default: 'pushhive' },
    medium: { type: String, default: 'web_push' },
    campaign: { type: String, default: 'rss_auto' }
  },
  // Targeting
  targetAll: { type: Boolean, default: true },
  targetTags: [{ type: String }],
  // Status
  active: { type: Boolean, default: true },
  errorCount: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  autoDisabled: { type: Boolean, default: false },
  // Stats
  totalSent: { type: Number, default: 0 },
  campaignIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

rssFeedSchema.index({ active: 1, autoDisabled: 1 });

module.exports = mongoose.model('RssFeed', rssFeedSchema);
