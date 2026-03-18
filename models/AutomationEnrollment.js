const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  automationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true, index: true },
  subscriberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscriber', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  // Progress
  currentStep: { type: Number, default: 0 },   // Index of next step to send
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled', 'paused'],
    default: 'active'
  },
  // Step history
  stepsSent: [{
    stepOrder: Number,
    stepId: mongoose.Schema.Types.ObjectId,
    sentAt: Date,
    clicked: { type: Boolean, default: false },
    clickedAt: Date,
    campaignId: mongoose.Schema.Types.ObjectId
  }],
  // Scheduling
  nextStepAt: { type: Date },   // When to send the next step
  // Metadata
  enrolledAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  cancelledAt: { type: Date }
});

enrollmentSchema.index({ status: 1, nextStepAt: 1 });
enrollmentSchema.index({ automationId: 1, subscriberId: 1 }, { unique: true });
enrollmentSchema.index({ automationId: 1, status: 1 });

module.exports = mongoose.model('AutomationEnrollment', enrollmentSchema);
