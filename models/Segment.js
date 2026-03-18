const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema({
  field: {
    type: String,
    required: true,
    enum: [
      'browser', 'os', 'device',          // Device
      'tags', 'country', 'city',           // Attributes
      'createdAt', 'lastActive',           // Dates
      'totalClicks', 'totalReceived',      // Engagement
      'referrer', 'landingPage'            // Acquisition
    ]
  },
  operator: {
    type: String,
    required: true,
    enum: [
      'equals', 'not_equals',
      'contains', 'not_contains',
      'in', 'not_in',
      'greater_than', 'less_than',
      'after', 'before', 'in_last_days', 'not_in_last_days'
    ]
  },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const ruleGroupSchema = new mongoose.Schema({
  logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
  rules: [ruleSchema]
}, { _id: false });

const segmentSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  // Query structure: groups connected by top-level logic
  logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
  groups: [ruleGroupSchema],
  // Cached count (updated on save and periodically)
  estimatedCount: { type: Number, default: 0 },
  lastCountedAt: { type: Date },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Build MongoDB query from segment rules
segmentSchema.methods.buildQuery = function () {
  const query = { siteId: this.siteId, active: true };
  if (!this.groups || this.groups.length === 0) return query;

  const groupQueries = this.groups.map(group => {
    const conditions = group.rules.map(rule => buildRuleCondition(rule));
    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0];
    return group.logic === 'OR' ? { $or: conditions } : { $and: conditions };
  }).filter(Boolean);

  if (groupQueries.length === 0) return query;
  if (groupQueries.length === 1) return { ...query, ...groupQueries[0] };

  if (this.logic === 'OR') {
    query.$or = groupQueries;
  } else {
    query.$and = groupQueries;
  }

  return query;
};

function buildRuleCondition(rule) {
  const { field, operator, value } = rule;

  switch (operator) {
    case 'equals':
      return { [field]: value };
    case 'not_equals':
      return { [field]: { $ne: value } };
    case 'contains':
      return { [field]: { $regex: value, $options: 'i' } };
    case 'not_contains':
      return { [field]: { $not: { $regex: value, $options: 'i' } } };
    case 'in':
      return { [field]: { $in: Array.isArray(value) ? value : value.split(',').map(v => v.trim()) } };
    case 'not_in':
      return { [field]: { $nin: Array.isArray(value) ? value : value.split(',').map(v => v.trim()) } };
    case 'greater_than':
      return { [field]: { $gt: parseFloat(value) } };
    case 'less_than':
      return { [field]: { $lt: parseFloat(value) } };
    case 'after':
      return { [field]: { $gt: new Date(value) } };
    case 'before':
      return { [field]: { $lt: new Date(value) } };
    case 'in_last_days': {
      const daysAgo = new Date(Date.now() - parseInt(value) * 24 * 60 * 60 * 1000);
      return { [field]: { $gte: daysAgo } };
    }
    case 'not_in_last_days': {
      const daysAgo = new Date(Date.now() - parseInt(value) * 24 * 60 * 60 * 1000);
      return { [field]: { $lt: daysAgo } };
    }
    default:
      return {};
  }
}

module.exports = mongoose.model('Segment', segmentSchema);
