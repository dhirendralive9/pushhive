const express = require('express');
const router = express.Router();
const { requireApiKey, sdkCors } = require('../middleware/auth');
const Subscriber = require('../models/Subscriber');
const Site = require('../models/Site');
const Event = require('../models/Event');
const Campaign = require('../models/Campaign');
const webpush = require('web-push');
const webhooks = require('../services/webhooks');

// Apply CORS to all API routes
router.use(sdkCors);

// ── Subscribe ───────────────────────────────────────────────────
router.post('/subscribe', requireApiKey, async (req, res) => {
  try {
    const { subscription, browser, browserVersion, os, device, referrer, landingPage } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    // Upsert subscriber
    const subscriber = await Subscriber.findOneAndUpdate(
      { siteId: req.site._id, 'subscription.endpoint': subscription.endpoint },
      {
        $set: {
          subscription,
          browser: browser || 'Unknown',
          browserVersion: browserVersion || '',
          os: os || 'Unknown',
          device: device || 'desktop',
          ip: req.headers['x-forwarded-for'] || req.ip,
          referrer: referrer || '',
          landingPage: landingPage || '',
          lastActive: new Date(),
          active: true
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true, new: true }
    );

    // Update subscriber count
    const count = await Subscriber.countDocuments({ siteId: req.site._id, active: true });
    await Site.findByIdAndUpdate(req.site._id, { subscriberCount: count });

    // Send welcome notification if enabled
    if (req.site.welcomeNotification.enabled && subscriber.createdAt.getTime() > Date.now() - 5000) {
      try {
        webpush.setVapidDetails(
          `mailto:${process.env.VAPID_EMAIL}`,
          process.env.VAPID_PUBLIC_KEY,
          process.env.VAPID_PRIVATE_KEY
        );
        const welcomePayload = JSON.stringify({
          title: req.site.welcomeNotification.title,
          body: req.site.welcomeNotification.body,
          icon: req.site.icon || '',
          url: req.site.welcomeNotification.url || req.site.domain,
          campaignId: 'welcome',
          siteId: req.site._id.toString()
        });
        await webpush.sendNotification(subscription, welcomePayload);
      } catch (e) {
        console.error('Welcome notification failed:', e.message);
      }
    }

    // Trigger webhook
    webhooks.fire('subscriber.new', req.site._id, {
      subscriberId: subscriber._id,
      browser: subscriber.browser,
      os: subscriber.os,
      device: subscriber.device,
      siteId: req.site._id
    }).catch(() => {});

    res.json({ success: true, subscriberId: subscriber._id });
  } catch (err) {
    console.error('Subscribe error:', err);
    if (err.code === 11000) {
      return res.json({ success: true, message: 'Already subscribed' });
    }
    res.status(500).json({ error: 'Subscription failed' });
  }
});

// ── Unsubscribe ─────────────────────────────────────────────────
router.post('/unsubscribe', requireApiKey, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });

    await Subscriber.findOneAndUpdate(
      { siteId: req.site._id, 'subscription.endpoint': endpoint },
      { active: false, unsubscribedAt: new Date() }
    );

    const count = await Subscriber.countDocuments({ siteId: req.site._id, active: true });
    await Site.findByIdAndUpdate(req.site._id, { subscriberCount: count });

    // Trigger webhook
    webhooks.fire('subscriber.unsubscribe', req.site._id, {
      endpoint,
      siteId: req.site._id
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Unsubscribe failed' });
  }
});

// ── Track Events (clicks, dismissals) ───────────────────────────
router.post('/track', requireApiKey, async (req, res) => {
  try {
    const { campaignId, type, utm, subscriberId } = req.body;
    if (!campaignId || !type) {
      return res.status(400).json({ error: 'campaignId and type required' });
    }

    const ua = req.headers['user-agent'] || '';

    const event = new Event({
      siteId: req.site._id,
      campaignId,
      subscriberId: subscriberId || undefined,
      type,
      utm: utm || {},
      ip: req.headers['x-forwarded-for'] || req.ip,
      userAgent: ua,
      browser: parseBrowser(ua),
      os: parseOS(ua),
      device: parseDevice(ua)
    });
    await event.save();

    // Update campaign stats
    if (type === 'clicked') {
      await Campaign.findByIdAndUpdate(campaignId, { $inc: { 'stats.clicked': 1 } });
      if (subscriberId) {
        await Subscriber.findByIdAndUpdate(subscriberId, {
          $inc: { totalClicks: 1 },
          lastActive: new Date()
        });
      }
      webhooks.fire('notification.clicked', req.site._id, { campaignId, subscriberId, utm: utm || {} }).catch(() => {});
    } else if (type === 'dismissed') {
      await Campaign.findByIdAndUpdate(campaignId, { $inc: { 'stats.dismissed': 1 } });
      webhooks.fire('notification.dismissed', req.site._id, { campaignId, subscriberId }).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Track error:', err);
    res.status(500).json({ error: 'Tracking failed' });
  }
});

// ── Get site config (for SDK) ───────────────────────────────────
router.get('/config', requireApiKey, async (req, res) => {
  res.json({
    siteId: req.site._id,
    siteName: req.site.name,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    promptConfig: req.site.promptConfig,
    inAppBrowserRedirect: req.site.inAppBrowserRedirect,
    icon: req.site.icon
  });
});

// ── Simple UA parsers ───────────────────────────────────────────
function parseBrowser(ua) {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
  if (/Opera|OPR/i.test(ua)) return 'Opera';
  return 'Other';
}

function parseOS(ua) {
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/iOS|iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function parseDevice(ua) {
  if (/Mobile|Android.*Mobile|iPhone/i.test(ua)) return 'mobile';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  return 'desktop';
}

module.exports = router;
