const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema({
  webhookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Webhook', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  event: { type: String, required: true },
  url: { type: String, required: true },
  // Request
  payload: { type: mongoose.Schema.Types.Mixed },
  // Response
  statusCode: { type: Number },
  responseBody: { type: String, default: '', maxlength: 2000 },
  responseTime: { type: Number },  // ms
  // Status
  success: { type: Boolean, default: false },
  error: { type: String, default: '' },
  attempt: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now, expires: 30 * 24 * 3600 } // Auto-delete after 30 days
});

webhookLogSchema.index({ webhookId: 1, createdAt: -1 });
webhookLogSchema.index({ siteId: 1, createdAt: -1 });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);
