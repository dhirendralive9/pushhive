const mongoose = require('mongoose');
const crypto = require('crypto');

const webhookSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  name: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  secret: { type: String, default: '' },
  events: [{
    type: String,
    enum: [
      'subscriber.new',
      'subscriber.unsubscribe',
      'campaign.sent',
      'campaign.failed',
      'notification.clicked',
      'notification.dismissed',
      'ab_test.winner'
    ]
  }],
  active: { type: Boolean, default: true },
  headers: { type: Map, of: String, default: {} },
  // Health tracking
  lastTriggered: { type: Date },
  lastStatus: { type: Number },
  lastError: { type: String, default: '' },
  failCount: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  autoDisabled: { type: Boolean, default: false },
  autoDisabledAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

webhookSchema.pre('save', function (next) {
  if (!this.secret) {
    this.secret = 'whsec_' + crypto.randomBytes(24).toString('hex');
  }
  this.updatedAt = new Date();
  next();
});

webhookSchema.methods.sign = function (payload) {
  const hmac = crypto.createHmac('sha256', this.secret);
  hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return hmac.digest('hex');
};

webhookSchema.index({ siteId: 1, active: 1 });

module.exports = mongoose.model('Webhook', webhookSchema);
