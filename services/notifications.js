const webpush = require('web-push');
const Subscriber = require('../models/Subscriber');
const Site = require('../models/Site');
const Event = require('../models/Event');
const { queueCampaign, queueCleanup, getCampaignJobProgress, getQueueStats } = require('./queue');

// Configure VAPID once
function configureVapid() {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/**
 * Send a test notification to a specific subscriber (direct, not queued)
 */
async function sendTestNotification(subscriberId, { title, body, url, icon }) {
  configureVapid();
  const sub = await Subscriber.findById(subscriberId);
  if (!sub || !sub.active) throw new Error('Subscriber not found or inactive');

  const payload = JSON.stringify({
    title: title || 'Test Notification',
    body: body || 'This is a test from PushHive',
    icon: icon || '',
    url: url || '/',
    campaignId: 'test',
    siteId: sub.siteId.toString()
  });

  return webpush.sendNotification(sub.subscription, payload);
}

/**
 * Queue a campaign for sending via Bull
 */
async function sendCampaign(campaignId, options = {}) {
  return queueCampaign(campaignId, options);
}

/**
 * Get live campaign sending progress
 */
async function getCampaignProgress(campaignId) {
  return getCampaignJobProgress(campaignId);
}

/**
 * Get campaign stats from events collection
 */
async function getCampaignStats(campaignId) {
  const [delivered, clicked, dismissed, failed] = await Promise.all([
    Event.countDocuments({ campaignId, type: 'delivered' }),
    Event.countDocuments({ campaignId, type: 'clicked' }),
    Event.countDocuments({ campaignId, type: 'dismissed' }),
    Event.countDocuments({ campaignId, type: 'failed' })
  ]);
  return { delivered, clicked, dismissed, failed };
}

/**
 * Queue subscription cleanup for a site
 */
async function cleanupSubscriptions(siteId) {
  return queueCleanup(siteId);
}

/**
 * Get queue system stats for dashboard
 */
async function getSystemStats() {
  return getQueueStats();
}

module.exports = {
  sendTestNotification,
  sendCampaign,
  getCampaignProgress,
  getCampaignStats,
  cleanupSubscriptions,
  getSystemStats
};
