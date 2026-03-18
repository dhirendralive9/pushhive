const express = require('express');
const router = express.Router();
const { requireApiKey, sdkCors } = require('../middleware/auth');
const Site = require('../models/Site');
const Subscriber = require('../models/Subscriber');
const Campaign = require('../models/Campaign');
const Event = require('../models/Event');
const { sendTestNotification, getCampaignStats, cleanupSubscriptions, getCampaignProgress } = require('../services/notifications');
const { queueCampaign } = require('../services/queue');

router.use(sdkCors);
router.use(requireApiKey);

// ── Subscribers ─────────────────────────────────────────────────

// List subscribers
router.get('/subscribers', async (req, res) => {
  try {
    const { page = 1, limit = 50, device, browser, tag, active } = req.query;
    const filter = { siteId: req.site._id };

    if (active !== undefined) filter.active = active === 'true';
    else filter.active = true;
    if (device) filter.device = device;
    if (browser) filter.browser = new RegExp(browser, 'i');
    if (tag) filter.tags = tag;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Subscriber.countDocuments(filter);
    const subscribers = await Subscriber.find(filter)
      .select('-subscription')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: subscribers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
});

// Get subscriber count
router.get('/subscribers/count', async (req, res) => {
  try {
    const active = await Subscriber.countDocuments({ siteId: req.site._id, active: true });
    const total = await Subscriber.countDocuments({ siteId: req.site._id });
    res.json({ success: true, active, total });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

// Add tags to subscriber
router.post('/subscribers/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body;
    if (!tags || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'tags array required' });
    }
    const sub = await Subscriber.findOneAndUpdate(
      { _id: req.params.id, siteId: req.site._id },
      { $addToSet: { tags: { $each: tags } } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    res.json({ success: true, tags: sub.tags });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

// Remove tags from subscriber
router.delete('/subscribers/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body;
    if (!tags || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'tags array required' });
    }
    const sub = await Subscriber.findOneAndUpdate(
      { _id: req.params.id, siteId: req.site._id },
      { $pullAll: { tags } },
      { new: true }
    );
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    res.json({ success: true, tags: sub.tags });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove tags' });
  }
});

// Cleanup stale subscriptions
router.post('/subscribers/cleanup', async (req, res) => {
  try {
    const result = await cleanupSubscriptions(req.site._id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// ── Campaigns ───────────────────────────────────────────────────

// List campaigns
router.get('/campaigns', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { siteId: req.site._id };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Campaign.countDocuments(filter);
    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: campaigns,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Create campaign (with optional A/B test)
router.post('/campaigns', async (req, res) => {
  try {
    const { title, body, url, icon, image, utm, targetAll, targetTags,
      targetDevices, targetBrowsers, actions, scheduledAt, abTest } = req.body;

    if (!title || !body || !url) {
      return res.status(400).json({ error: 'title, body, and url are required' });
    }

    const campaignData = {
      siteId: req.site._id,
      title, body, url,
      icon: icon || req.site.icon || '',
      image: image || '',
      utm: {
        source: (utm && utm.source) || 'pushhive',
        medium: (utm && utm.medium) || 'web_push',
        campaign: (utm && utm.campaign) || '',
        term: (utm && utm.term) || '',
        content: (utm && utm.content) || ''
      },
      targetAll: targetAll !== false,
      targetTags: targetTags || [],
      targetDevices: targetDevices || [],
      targetBrowsers: targetBrowsers || [],
      actions: actions || [],
      status: scheduledAt ? 'scheduled' : 'draft',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null
    };

    // A/B Test setup via API
    // Example: abTest: { variantB: { title: "Alt title", body: "Alt body" }, testPercentage: 20, waitHours: 4 }
    if (abTest && abTest.variantB && abTest.variantB.title && abTest.variantB.body) {
      campaignData.abTest = {
        enabled: true,
        variants: [
          { name: 'A', title, body, icon: icon || '', image: image || '' },
          { name: 'B', title: abTest.variantB.title, body: abTest.variantB.body, icon: abTest.variantB.icon || icon || '', image: abTest.variantB.image || image || '' }
        ],
        testPercentage: abTest.testPercentage || 20,
        waitHours: abTest.waitHours || 4,
        winnerMetric: abTest.winnerMetric || 'ctr',
        status: ''
      };
    }

    const campaign = new Campaign(campaignData);
    await campaign.save();
    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create campaign: ' + err.message });
  }
});

// Send campaign immediately (via queue)
router.post('/campaigns/:id/send', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, siteId: req.site._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (['sent', 'sending', 'queued'].includes(campaign.status)) {
      return res.status(400).json({ error: `Campaign already ${campaign.status}` });
    }

    campaign.status = 'queued';
    await campaign.save();
    const job = await queueCampaign(campaign._id);

    res.json({
      success: true,
      message: 'Campaign queued for sending',
      jobId: job.id,
      campaignId: campaign._id
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to queue campaign' });
  }
});

// Get campaign progress (live from queue)
router.get('/campaigns/:id/progress', async (req, res) => {
  try {
    const progress = await getCampaignProgress(req.params.id);
    if (!progress) return res.status(404).json({ error: 'No active job found' });
    res.json({ success: true, data: progress });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// Get campaign stats
router.get('/campaigns/:id/stats', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, siteId: req.site._id }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const liveStats = await getCampaignStats(campaign._id);
    res.json({
      success: true,
      data: {
        ...campaign.stats,
        live: liveStats,
        ctr: campaign.stats.sent > 0
          ? ((campaign.stats.clicked / campaign.stats.sent) * 100).toFixed(2) + '%'
          : '0%'
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ── Quick Send (one-shot notification) ──────────────────────────
router.post('/send', async (req, res) => {
  try {
    const { title, body, url, icon, image, utm, targetAll, targetTags } = req.body;

    if (!title || !body || !url) {
      return res.status(400).json({ error: 'title, body, and url are required' });
    }

    // Create and immediately queue campaign
    const campaign = new Campaign({
      siteId: req.site._id,
      title, body, url,
      icon: icon || req.site.icon || '',
      image: image || '',
      utm: {
        source: (utm && utm.source) || 'pushhive',
        medium: (utm && utm.medium) || 'web_push',
        campaign: (utm && utm.campaign) || '',
        term: (utm && utm.term) || '',
        content: (utm && utm.content) || ''
      },
      targetAll: targetAll !== false,
      targetTags: targetTags || [],
      status: 'scheduled',
      scheduledAt: new Date() // Send immediately
    });

    await campaign.save();
    res.status(201).json({
      success: true,
      message: 'Notification queued for immediate delivery',
      campaignId: campaign._id
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send: ' + err.message });
  }
});

// ── Test Notification ───────────────────────────────────────────
router.post('/test/:subscriberId', async (req, res) => {
  try {
    const { title, body, url, icon } = req.body;
    await sendTestNotification(req.params.subscriberId, { title, body, url, icon });
    res.json({ success: true, message: 'Test notification sent' });
  } catch (err) {
    res.status(500).json({ error: 'Test notification failed: ' + err.message });
  }
});

// ── Analytics ───────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const dateFrom = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
    const siteId = req.site._id;

    const [subGrowth, eventBreakdown, browserDist, deviceDist] = await Promise.all([
      Subscriber.aggregate([
        { $match: { siteId, createdAt: { $gte: dateFrom } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      Event.aggregate([
        { $match: { siteId, createdAt: { $gte: dateFrom } } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ]),
      Subscriber.aggregate([
        { $match: { siteId, active: true } },
        { $group: { _id: '$browser', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Subscriber.aggregate([
        { $match: { siteId, active: true } },
        { $group: { _id: '$device', count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      success: true,
      data: { subGrowth, eventBreakdown, browserDist, deviceDist }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
