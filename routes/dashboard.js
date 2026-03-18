const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validateCsrfToken } = require('../middleware/security');
const Site = require('../models/Site');
const Subscriber = require('../models/Subscriber');
const Campaign = require('../models/Campaign');
const Event = require('../models/Event');
const Admin = require('../models/Admin');
const webpush = require('web-push');

// Apply auth middleware to all dashboard routes
router.use(requireAuth);

// Apply CSRF validation to all POST requests in dashboard
router.use((req, res, next) => {
  if (req.method === 'POST') {
    return validateCsrfToken(req, res, next);
  }
  next();
});

// ── Dashboard Home ──────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const sites = await Site.find().lean();
    const totalSubscribers = await Subscriber.countDocuments({ active: true });
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const newToday = await Subscriber.countDocuments({ createdAt: { $gte: todayStart } });
    const totalCampaigns = await Campaign.countDocuments();
    const recentCampaigns = await Campaign.find()
      .sort({ createdAt: -1 }).limit(5).populate('siteId', 'name').lean();

    // Last 7 days subscriber trend
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dailySubs = await Subscriber.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.render('pages/dashboard', {
      sites, totalSubscribers, newToday, totalCampaigns, recentCampaigns, dailySubs
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('pages/error', { message: 'Failed to load dashboard' });
  }
});

// ── Sites Management ────────────────────────────────────────────
router.get('/sites', async (req, res) => {
  const sites = await Site.find().sort({ createdAt: -1 }).lean();
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  res.render('pages/sites', { sites, vapidPublicKey });
});

router.post('/sites', async (req, res) => {
  try {
    const { name, domain } = req.body;
    const site = new Site({ name, domain: domain.replace(/\/$/, '') });
    await site.save();
    req.session.success = `Site "${name}" created successfully`;
    res.redirect('/dashboard/sites');
  } catch (err) {
    req.session.error = 'Failed to create site: ' + err.message;
    res.redirect('/dashboard/sites');
  }
});

router.get('/sites/:id', async (req, res) => {
  try {
    const site = await Site.findById(req.params.id).lean();
    if (!site) { req.session.error = 'Site not found'; return res.redirect('/dashboard/sites'); }
    const subscriberCount = await Subscriber.countDocuments({ siteId: site._id, active: true });
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    res.render('pages/site-detail', { site, subscriberCount, serverUrl });
  } catch (err) {
    req.session.error = 'Failed to load site';
    res.redirect('/dashboard/sites');
  }
});

router.post('/sites/:id/update', async (req, res) => {
  try {
    const { name, domain, icon, promptDelay, promptStyle, promptTitle, promptMessage,
      allowButtonText, denyButtonText, welcomeEnabled, welcomeTitle, welcomeBody, welcomeUrl,
      inAppBrowserRedirect } = req.body;
    await Site.findByIdAndUpdate(req.params.id, {
      name, domain: domain.replace(/\/$/, ''), icon,
      promptConfig: {
        delay: parseInt(promptDelay) || 3,
        style: promptStyle || 'banner',
        title: promptTitle || 'Stay Updated!',
        message: promptMessage || 'Get notified about our latest updates.',
        allowButtonText: allowButtonText || 'Allow',
        denyButtonText: denyButtonText || 'Maybe Later'
      },
      welcomeNotification: {
        enabled: welcomeEnabled === 'on',
        title: welcomeTitle || 'Thanks for subscribing!',
        body: welcomeBody || 'You will now receive updates from us.',
        url: welcomeUrl || ''
      },
      inAppBrowserRedirect: inAppBrowserRedirect === 'on'
    });
    req.session.success = 'Site updated successfully';
    res.redirect(`/dashboard/sites/${req.params.id}`);
  } catch (err) {
    req.session.error = 'Failed to update site';
    res.redirect(`/dashboard/sites/${req.params.id}`);
  }
});

router.post('/sites/:id/delete', async (req, res) => {
  try {
    await Site.findByIdAndDelete(req.params.id);
    await Subscriber.deleteMany({ siteId: req.params.id });
    await Campaign.deleteMany({ siteId: req.params.id });
    await Event.deleteMany({ siteId: req.params.id });
    req.session.success = 'Site and all associated data deleted';
    res.redirect('/dashboard/sites');
  } catch (err) {
    req.session.error = 'Failed to delete site';
    res.redirect('/dashboard/sites');
  }
});

// ── Subscribers ─────────────────────────────────────────────────
router.get('/subscribers', async (req, res) => {
  try {
    const { siteId, device, browser, tag, page = 1 } = req.query;
    const filter = { active: true };
    if (siteId) filter.siteId = siteId;
    if (device) filter.device = device;
    if (browser) filter.browser = new RegExp(browser, 'i');
    if (tag) filter.tags = tag;

    const limit = 50;
    const skip = (parseInt(page) - 1) * limit;
    const total = await Subscriber.countDocuments(filter);
    const subscribers = await Subscriber.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('siteId', 'name').lean();
    const sites = await Site.find().lean();
    const totalPages = Math.ceil(total / limit);

    res.render('pages/subscribers', {
      subscribers, sites, total, page: parseInt(page), totalPages,
      filters: { siteId, device, browser, tag }
    });
  } catch (err) {
    console.error(err);
    res.render('pages/error', { message: 'Failed to load subscribers' });
  }
});

// ── Campaigns ───────────────────────────────────────────────────
router.get('/campaigns', async (req, res) => {
  const campaigns = await Campaign.find().sort({ createdAt: -1 })
    .populate('siteId', 'name').lean();
  const sites = await Site.find().lean();
  res.render('pages/campaigns', { campaigns, sites });
});

router.get('/campaigns/new', async (req, res) => {
  const sites = await Site.find({ active: true }).lean();
  res.render('pages/campaign-new', { sites });
});

router.post('/campaigns', async (req, res) => {
  try {
    const { siteId, title, body, url, icon, image, utmSource, utmMedium,
      utmCampaign, utmTerm, utmContent, targetAll, targetTags,
      action1Title, action1Url, action2Title, action2Url, scheduledAt,
      abEnabled, abTitleB, abBodyB, abIconB,
      abTestPercentage, abWaitHours, abWinnerMetric } = req.body;

    const campaignData = {
      siteId, title, body, url, icon, image,
      utm: {
        source: utmSource || 'pushhive',
        medium: utmMedium || 'web_push',
        campaign: utmCampaign || '',
        term: utmTerm || '',
        content: utmContent || ''
      },
      targetAll: targetAll !== 'false',
      targetTags: targetTags ? targetTags.split(',').map(t => t.trim()) : [],
      actions: [
        ...(action1Title ? [{ title: action1Title, url: action1Url }] : []),
        ...(action2Title ? [{ title: action2Title, url: action2Url }] : [])
      ],
      status: scheduledAt ? 'scheduled' : 'draft',
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null
    };

    // A/B Testing setup
    if (abEnabled === 'on' && abTitleB && abBodyB) {
      campaignData.abTest = {
        enabled: true,
        variants: [
          { name: 'A', title, body, icon: icon || '', image: image || '' },
          { name: 'B', title: abTitleB, body: abBodyB, icon: abIconB || icon || '', image: image || '' }
        ],
        testPercentage: parseInt(abTestPercentage) || 20,
        waitHours: parseInt(abWaitHours) || 4,
        winnerMetric: abWinnerMetric || 'ctr',
        status: ''
      };
    }

    const campaign = new Campaign(campaignData);
    await campaign.save();
    req.session.success = `Campaign created${campaign.abTest.enabled ? ' with A/B test' : ''}`;
    res.redirect('/dashboard/campaigns');
  } catch (err) {
    req.session.error = 'Failed to create campaign: ' + err.message;
    res.redirect('/dashboard/campaigns/new');
  }
});

// Send campaign (via queue — returns immediately)
router.post('/campaigns/:id/send', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) { req.session.error = 'Campaign not found'; return res.redirect('/dashboard/campaigns'); }
    if (campaign.status === 'sending' || campaign.status === 'queued') {
      req.session.error = 'Campaign is already being sent';
      return res.redirect('/dashboard/campaigns');
    }

    // Queue campaign for async processing by workers
    const { queueCampaign } = require('../services/queue');
    campaign.status = 'queued';
    await campaign.save();
    await queueCampaign(campaign._id);

    req.session.success = `Campaign "${campaign.title}" queued for sending. Track progress on the campaign detail page.`;
    res.redirect('/dashboard/campaigns');
  } catch (err) {
    console.error('Send error:', err);
    req.session.error = 'Failed to queue campaign: ' + err.message;
    res.redirect('/dashboard/campaigns');
  }
});

// Campaign detail / analytics
router.get('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate('siteId', 'name').lean();
    if (!campaign) { req.session.error = 'Campaign not found'; return res.redirect('/dashboard/campaigns'); }

    // Get click events breakdown
    const clicksByBrowser = await Event.aggregate([
      { $match: { campaignId: campaign._id, type: 'clicked' } },
      { $group: { _id: '$browser', count: { $sum: 1 } } }
    ]);
    const clicksByDevice = await Event.aggregate([
      { $match: { campaignId: campaign._id, type: 'clicked' } },
      { $group: { _id: '$device', count: { $sum: 1 } } }
    ]);
    const clickTimeline = await Event.aggregate([
      { $match: { campaignId: campaign._id, type: 'clicked' } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt' } },
        count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);

    res.render('pages/campaign-detail', { campaign, clicksByBrowser, clicksByDevice, clickTimeline });
  } catch (err) {
    res.render('pages/error', { message: 'Failed to load campaign' });
  }
});

// Duplicate campaign
router.post('/campaigns/:id/duplicate', async (req, res) => {
  try {
    const original = await Campaign.findById(req.params.id).lean();
    if (!original) { req.session.error = 'Campaign not found'; return res.redirect('/dashboard/campaigns'); }

    delete original._id;
    delete original.__v;
    const duplicate = new Campaign({
      ...original,
      title: original.title + ' (Copy)',
      status: 'draft',
      scheduledAt: null,
      sentAt: null,
      stats: { targeted: 0, sent: 0, delivered: 0, clicked: 0, failed: 0, dismissed: 0 },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await duplicate.save();
    req.session.success = 'Campaign duplicated';
    res.redirect(`/dashboard/campaigns`);
  } catch (err) {
    req.session.error = 'Failed to duplicate campaign';
    res.redirect('/dashboard/campaigns');
  }
});

// Delete campaign
router.post('/campaigns/:id/delete', async (req, res) => {
  try {
    await Campaign.findByIdAndDelete(req.params.id);
    await Event.deleteMany({ campaignId: req.params.id });
    req.session.success = 'Campaign deleted';
    res.redirect('/dashboard/campaigns');
  } catch (err) {
    req.session.error = 'Failed to delete campaign';
    res.redirect('/dashboard/campaigns');
  }
});

// ── Analytics ───────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const { siteId, days = 30 } = req.query;
    const sites = await Site.find().lean();
    const dateFrom = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
    const matchFilter = { createdAt: { $gte: dateFrom } };
    if (siteId) matchFilter.siteId = new (require('mongoose').Types.ObjectId)(siteId);

    // Subscriber growth
    const subGrowth = await Subscriber.aggregate([
      { $match: { createdAt: { $gte: dateFrom }, ...(siteId ? { siteId: new (require('mongoose').Types.ObjectId)(siteId) } : {}) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Events breakdown
    const eventBreakdown = await Event.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    // Browser distribution
    const browserDist = await Subscriber.aggregate([
      { $match: { active: true, ...(siteId ? { siteId: new (require('mongoose').Types.ObjectId)(siteId) } : {}) } },
      { $group: { _id: '$browser', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Device distribution
    const deviceDist = await Subscriber.aggregate([
      { $match: { active: true, ...(siteId ? { siteId: new (require('mongoose').Types.ObjectId)(siteId) } : {}) } },
      { $group: { _id: '$device', count: { $sum: 1 } } }
    ]);

    // UTM performance
    const utmPerformance = await Event.aggregate([
      { $match: { ...matchFilter, type: 'clicked', 'utm.campaign': { $ne: '' } } },
      { $group: { _id: { source: '$utm.source', medium: '$utm.medium', campaign: '$utm.campaign' }, clicks: { $sum: 1 } } },
      { $sort: { clicks: -1 } },
      { $limit: 20 }
    ]);

    res.render('pages/analytics', {
      sites, subGrowth, eventBreakdown, browserDist, deviceDist, utmPerformance,
      filters: { siteId, days }
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.render('pages/error', { message: 'Failed to load analytics' });
  }
});

// ── Queue Status ────────────────────────────────────────────────
router.get('/queue', async (req, res) => {
  try {
    const { getQueueStats, getCampaignJobProgress } = require('../services/queue');
    const queueStats = await getQueueStats();

    // Get recent sending/queued campaigns with progress
    const activeCampaigns = await Campaign.find({
      status: { $in: ['queued', 'sending'] }
    }).populate('siteId', 'name').lean();

    // Attach job progress to each campaign
    for (const campaign of activeCampaigns) {
      campaign.jobProgress = await getCampaignJobProgress(campaign._id);
    }

    res.render('pages/queue', { queueStats, activeCampaigns });
  } catch (err) {
    console.error('Queue status error:', err);
    res.render('pages/queue', { queueStats: {}, activeCampaigns: [], queueError: err.message });
  }
});

// ── API Documentation ───────────────────────────────────────────
router.get('/api-docs', async (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const sites = await Site.find({ active: true }).select('name domain apiKey').lean();
  res.render('pages/api-docs', { serverUrl, sites });
});

// ── Settings ────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const admin = await Admin.findById(req.session.admin.id).lean();
  res.render('pages/settings', {
    admin,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidEmail: process.env.VAPID_EMAIL
  });
});

router.post('/settings/password', async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) {
      req.session.error = 'Passwords do not match';
      return res.redirect('/dashboard/settings');
    }
    const admin = await Admin.findById(req.session.admin.id);
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      req.session.error = 'Current password is incorrect';
      return res.redirect('/dashboard/settings');
    }
    admin.password = newPassword;
    await admin.save();
    req.session.success = 'Password updated successfully';
    res.redirect('/dashboard/settings');
  } catch (err) {
    req.session.error = 'Failed to update password';
    res.redirect('/dashboard/settings');
  }
});

module.exports = router;
