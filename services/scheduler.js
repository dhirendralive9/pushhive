const Campaign = require('../models/Campaign');
const Subscriber = require('../models/Subscriber');
const Site = require('../models/Site');
const Event = require('../models/Event');
const webpush = require('web-push');

class Scheduler {
  constructor() {
    this.interval = null;
    this.isRunning = false;
  }

  start(intervalMs = 30000) {
    console.log('✓ Campaign scheduler started (checking every 30s)');
    this.interval = setInterval(() => this.checkScheduled(), intervalMs);
    // Run immediately on start
    this.checkScheduled();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('✗ Campaign scheduler stopped');
    }
  }

  async checkScheduled() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const now = new Date();
      const dueCampaigns = await Campaign.find({
        status: 'scheduled',
        scheduledAt: { $lte: now }
      });

      for (const campaign of dueCampaigns) {
        console.log(`[Scheduler] Sending scheduled campaign: ${campaign.title}`);
        await this.sendCampaign(campaign);
      }
    } catch (err) {
      console.error('[Scheduler] Error checking scheduled campaigns:', err);
    } finally {
      this.isRunning = false;
    }
  }

  async sendCampaign(campaign) {
    try {
      campaign.status = 'sending';
      await campaign.save();

      // Build target filter
      const filter = { siteId: campaign.siteId, active: true };
      if (!campaign.targetAll && campaign.targetTags.length > 0) {
        filter.tags = { $in: campaign.targetTags };
      }
      if (campaign.targetBrowsers && campaign.targetBrowsers.length > 0) {
        filter.browser = { $in: campaign.targetBrowsers };
      }
      if (campaign.targetDevices && campaign.targetDevices.length > 0) {
        filter.device = { $in: campaign.targetDevices };
      }

      const subscribers = await Subscriber.find(filter);
      campaign.stats.targeted = subscribers.length;

      if (subscribers.length === 0) {
        campaign.status = 'sent';
        campaign.sentAt = new Date();
        campaign.stats.sent = 0;
        await campaign.save();
        console.log(`[Scheduler] Campaign "${campaign.title}" — no subscribers matched`);
        return;
      }

      // Configure web-push
      webpush.setVapidDetails(
        `mailto:${process.env.VAPID_EMAIL}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );

      const notificationUrl = campaign.buildUrl();
      const payload = JSON.stringify({
        title: campaign.title,
        body: campaign.body,
        icon: campaign.icon || '',
        image: campaign.image || '',
        badge: campaign.badge || '',
        url: notificationUrl,
        campaignId: campaign._id.toString(),
        siteId: campaign.siteId.toString(),
        actions: campaign.actions || [],
        utm: campaign.utm
      });

      // Send in batches
      const BATCH_SIZE = 500;
      let sent = 0, failed = 0;

      for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
        const batch = subscribers.slice(i, i + BATCH_SIZE);

        await Promise.allSettled(
          batch.map(sub =>
            webpush.sendNotification(sub.subscription, payload)
              .then(() => {
                sent++;
                new Event({
                  siteId: campaign.siteId,
                  campaignId: campaign._id,
                  subscriberId: sub._id,
                  type: 'delivered',
                  browser: sub.browser,
                  os: sub.os,
                  device: sub.device
                }).save().catch(() => {});
              })
              .catch(async (err) => {
                failed++;
                if (err.statusCode === 410 || err.statusCode === 404) {
                  await Subscriber.findByIdAndUpdate(sub._id, {
                    active: false,
                    unsubscribedAt: new Date()
                  });
                  await Site.findByIdAndUpdate(campaign.siteId, {
                    $inc: { subscriberCount: -1 }
                  });
                }
                new Event({
                  siteId: campaign.siteId,
                  campaignId: campaign._id,
                  subscriberId: sub._id,
                  type: 'failed'
                }).save().catch(() => {});
              })
          )
        );

        // Small delay between batches to avoid overwhelming
        if (i + BATCH_SIZE < subscribers.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      campaign.stats.sent = sent;
      campaign.stats.failed = failed;
      campaign.stats.delivered = sent;
      campaign.status = 'sent';
      campaign.sentAt = new Date();
      await campaign.save();

      // Update site subscriber count (clean up stale subs)
      const activeCount = await Subscriber.countDocuments({
        siteId: campaign.siteId,
        active: true
      });
      await Site.findByIdAndUpdate(campaign.siteId, { subscriberCount: activeCount });

      console.log(`[Scheduler] Campaign "${campaign.title}" sent: ${sent} delivered, ${failed} failed`);
    } catch (err) {
      console.error(`[Scheduler] Failed to send campaign "${campaign.title}":`, err);
      campaign.status = 'failed';
      await campaign.save();
    }
  }
}

module.exports = new Scheduler();
