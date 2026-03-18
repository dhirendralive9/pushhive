const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  // Delay before sending this step (from previous step or trigger)
  delayMinutes: { type: Number, default: 0 },      // 0 = immediate
  delayHours: { type: Number, default: 0 },
  delayDays: { type: Number, default: 0 },
  // Notification content
  title: { type: String, required: true, maxlength: 100 },
  body: { type: String, required: true, maxlength: 250 },
  icon: { type: String, default: '' },
  image: { type: String, default: '' },
  url: { type: String, required: true },
  // Condition: only send if subscriber has/hasn't done something
  condition: {
    type: { type: String, enum: ['none', 'clicked_previous', 'not_clicked_previous', 'has_tag', 'not_has_tag'], default: 'none' },
    value: { type: String, default: '' }  // tag name for tag conditions
  },
  // Stats per step
  stats: {
    sent: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 }
  }
}, { _id: true });

// Calculate total delay in ms
stepSchema.methods.getTotalDelayMs = function () {
  return ((this.delayDays || 0) * 86400000) +
         ((this.delayHours || 0) * 3600000) +
         ((this.delayMinutes || 0) * 60000);
};

const automationSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  // Trigger
  trigger: {
    type: { type: String, enum: ['subscriber.new', 'tag.added', 'manual'], default: 'subscriber.new' },
    value: { type: String, default: '' }  // tag name for tag.added trigger
  },
  // Steps (ordered notification sequence)
  steps: [stepSchema],
  // UTM
  utm: {
    source: { type: String, default: 'pushhive' },
    medium: { type: String, default: 'web_push' },
    campaign: { type: String, default: 'drip' }
  },
  // Status
  active: { type: Boolean, default: false },
  // Stats
  totalEnrolled: { type: Number, default: 0 },
  totalCompleted: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

automationSchema.index({ active: 1, 'trigger.type': 1 });

module.exports = mongoose.model('Automation', automationSchema);
