const webpush = require('web-push');
const Subscriber = require('../models/Subscriber');
const Site = require('../models/Site');
const Campaign = require('../models/Campaign');
const Event = require('../models/Event');

/**
 * Send a single push notification to one subscriber
 */
async function sendToSubscriber(subscription, payload) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

/**
 * Send a test notification to a specific subscriber
 */
async function sendTestNotification(subscriberId, { title, body, url, icon }) {
  const sub = await Subscriber.findById(subscriberId);
  if (!sub || !sub.active) throw new Error('Subscriber not found or inactive');

  const payload = {
    title: title || 'Test Notification',
    body: body || 'This is a test from PushHive',
    icon: icon || '',
    url: url || '/',
    campaignId: 'test',
    siteId: sub.siteId.toString()
  };

  return sendToSubscriber(sub.subscription, payload);
}

/**
 * Get campaign sending stats in real-time
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
 * Clean up expired/invalid subscriptions for a site
 */
async function cleanupSubscriptions(siteId) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const subscribers = await Subscriber.find({ siteId, active: true });
  let cleaned = 0;

  // Send empty payload to check validity
  const BATCH_SIZE = 200;
  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(sub =>
        webpush.sendNotification(sub.subscription, null, { TTL: 0 })
          .catch(async (err) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await Subscriber.findByIdAndUpdate(sub._id, {
                active: false,
                unsubscribedAt: new Date()
              });
              cleaned++;
            }
          })
      )
    );
  }

  // Update site count
  const activeCount = await Subscriber.countDocuments({ siteId, active: true });
  await Site.findByIdAndUpdate(siteId, { subscriberCount: activeCount });

  return { cleaned, remaining: activeCount };
}

module.exports = {
  sendToSubscriber,
  sendTestNotification,
  getCampaignStats,
  cleanupSubscriptions
};
