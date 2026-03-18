const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validateCsrfToken } = require('../middleware/security');
const Site = require('../models/Site');
const Subscriber = require('../models/Subscriber');
const Campaign = require('../models/Campaign');
const Event = require('../models/Event');
const Admin = require('../models/Admin');
const Webhook = require('../models/Webhook');
const WebhookLog = require('../models/WebhookLog');
const RssFeed = require('../models/RssFeed');
const Segment = require('../models/Segment');
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
  const segments = await Segment.find({ active: true }).populate('siteId', 'name').lean();
  res.render('pages/campaign-new', { sites, segments });
});

router.post('/campaigns', async (req, res) => {
  try {
    const { siteId, title, body, url, icon, image, utmSource, utmMedium,
      utmCampaign, utmTerm, utmContent, targetAll, targetTags, targetSegment,
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
      targetAll: targetAll === 'true' || targetAll === true,
      targetTags: targetTags ? targetTags.split(',').map(t => t.trim()) : [],
      targetSegment: (targetAll === 'segment' && targetSegment) ? targetSegment : undefined,
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

// ── Automations (Drip Campaigns) ────────────────────────────────
const Automation = require('../models/Automation');
const AutomationEnrollment = require('../models/AutomationEnrollment');
const { getAutomationStats } = require('../services/automations');

router.get('/automations', async (req, res) => {
  const sites = await Site.find().lean();
  const automations = await Automation.find().sort({ createdAt: -1 }).populate('siteId', 'name').lean();
  // Attach stats
  for (const auto of automations) {
    auto.enrollmentStats = await getAutomationStats(auto._id);
  }
  res.render('pages/automations', { automations, sites });
});

router.get('/automations/new', async (req, res) => {
  const sites = await Site.find({ active: true }).lean();
  res.render('pages/automation-new', { sites });
});

router.post('/automations', async (req, res) => {
  try {
    const { siteId, name, description, triggerType, triggerValue,
      utmSource, utmMedium, utmCampaign, steps } = req.body;

    let parsedSteps = [];
    try {
      parsedSteps = typeof steps === 'string' ? JSON.parse(steps) : (steps || []);
    } catch (e) {
      req.session.error = 'Invalid steps data';
      return res.redirect('/dashboard/automations/new');
    }

    if (parsedSteps.length === 0) {
      req.session.error = 'At least one step is required';
      return res.redirect('/dashboard/automations/new');
    }

    const automation = new Automation({
      siteId, name, description: description || '',
      trigger: { type: triggerType || 'subscriber.new', value: triggerValue || '' },
      utm: {
        source: utmSource || 'pushhive',
        medium: utmMedium || 'web_push',
        campaign: utmCampaign || 'drip'
      },
      steps: parsedSteps.map((s, i) => ({
        order: i + 1,
        delayMinutes: parseInt(s.delayMinutes) || 0,
        delayHours: parseInt(s.delayHours) || 0,
        delayDays: parseInt(s.delayDays) || 0,
        title: s.title,
        body: s.body,
        url: s.url,
        icon: s.icon || '',
        image: s.image || '',
        condition: {
          type: s.conditionType || 'none',
          value: s.conditionValue || ''
        }
      })),
      active: false
    });

    await automation.save();
    req.session.success = `Automation "${name}" created with ${parsedSteps.length} steps. Activate it to start enrolling subscribers.`;
    res.redirect('/dashboard/automations');
  } catch (err) {
    req.session.error = 'Failed to create automation: ' + err.message;
    res.redirect('/dashboard/automations/new');
  }
});

router.get('/automations/:id', async (req, res) => {
  try {
    const automation = await Automation.findById(req.params.id).populate('siteId', 'name domain').lean();
    if (!automation) { req.session.error = 'Automation not found'; return res.redirect('/dashboard/automations'); }
    const stats = await getAutomationStats(automation._id);
    const recentEnrollments = await AutomationEnrollment.find({ automationId: automation._id })
      .sort({ enrolledAt: -1 }).limit(20)
      .populate('subscriberId', 'browser os device').lean();
    res.render('pages/automation-detail', { automation, stats, recentEnrollments });
  } catch (err) {
    req.session.error = 'Failed to load automation';
    res.redirect('/dashboard/automations');
  }
});

router.post('/automations/:id/toggle', async (req, res) => {
  try {
    const automation = await Automation.findById(req.params.id);
    if (!automation) { req.session.error = 'Not found'; return res.redirect('/dashboard/automations'); }
    automation.active = !automation.active;
    await automation.save();
    req.session.success = `Automation ${automation.active ? 'activated' : 'paused'}`;
    res.redirect('/dashboard/automations');
  } catch (err) {
    req.session.error = 'Failed to toggle';
    res.redirect('/dashboard/automations');
  }
});

router.post('/automations/:id/delete', async (req, res) => {
  try {
    await Automation.findByIdAndDelete(req.params.id);
    await AutomationEnrollment.deleteMany({ automationId: req.params.id });
    req.session.success = 'Automation deleted';
    res.redirect('/dashboard/automations');
  } catch (err) {
    req.session.error = 'Failed to delete';
    res.redirect('/dashboard/automations');
  }
});

// ── Segments ────────────────────────────────────────────────────
router.get('/segments', async (req, res) => {
  const sites = await Site.find().lean();
  const segments = await Segment.find().sort({ createdAt: -1 }).populate('siteId', 'name').lean();
  res.render('pages/segments', { segments, sites });
});

router.post('/segments', async (req, res) => {
  try {
    const { siteId, name, description, logic, rules } = req.body;

    // Parse rules from form — comes as JSON string from the visual builder
    let parsedGroups = [];
    try {
      const rulesData = typeof rules === 'string' ? JSON.parse(rules) : rules;
      if (Array.isArray(rulesData)) {
        parsedGroups = rulesData;
      }
    } catch (e) {
      req.session.error = 'Invalid segment rules';
      return res.redirect('/dashboard/segments');
    }

    const segment = new Segment({
      siteId, name, description: description || '',
      logic: logic || 'AND',
      groups: parsedGroups
    });

    // Calculate initial count
    const query = segment.buildQuery();
    segment.estimatedCount = await Subscriber.countDocuments(query);
    segment.lastCountedAt = new Date();

    await segment.save();
    req.session.success = `Segment "${name}" created — ${segment.estimatedCount} subscribers match`;
    res.redirect('/dashboard/segments');
  } catch (err) {
    req.session.error = 'Failed to create segment: ' + err.message;
    res.redirect('/dashboard/segments');
  }
});

router.get('/segments/:id', async (req, res) => {
  try {
    const segment = await Segment.findById(req.params.id).populate('siteId', 'name domain').lean();
    if (!segment) { req.session.error = 'Segment not found'; return res.redirect('/dashboard/segments'); }

    // Recount
    const segModel = await Segment.findById(req.params.id);
    const query = segModel.buildQuery();
    const count = await Subscriber.countDocuments(query);
    segModel.estimatedCount = count;
    segModel.lastCountedAt = new Date();
    await segModel.save();

    // Sample subscribers
    const sampleSubs = await Subscriber.find(query).limit(10)
      .select('browser os device tags createdAt lastActive totalClicks').lean();

    res.render('pages/segment-detail', { segment: { ...segment, estimatedCount: count }, sampleSubs });
  } catch (err) {
    req.session.error = 'Failed to load segment';
    res.redirect('/dashboard/segments');
  }
});

// API: count subscribers matching segment (for live preview)
router.post('/segments/count', async (req, res) => {
  try {
    const { siteId, logic, rules } = req.body;
    const parsedGroups = typeof rules === 'string' ? JSON.parse(rules) : rules;

    const tempSegment = new Segment({
      siteId, logic: logic || 'AND',
      groups: Array.isArray(parsedGroups) ? parsedGroups : []
    });

    const query = tempSegment.buildQuery();
    const count = await Subscriber.countDocuments(query);
    res.json({ success: true, count });
  } catch (err) {
    res.json({ success: false, count: 0, error: err.message });
  }
});

router.post('/segments/:id/delete', async (req, res) => {
  try {
    await Segment.findByIdAndDelete(req.params.id);
    req.session.success = 'Segment deleted';
    res.redirect('/dashboard/segments');
  } catch (err) {
    req.session.error = 'Failed to delete segment';
    res.redirect('/dashboard/segments');
  }
});

// ── RSS Feeds ───────────────────────────────────────────────────
router.get('/rss', async (req, res) => {
  const sites = await Site.find().lean();
  const feeds = await RssFeed.find().sort({ createdAt: -1 }).populate('siteId', 'name').lean();
  res.render('pages/rss', { feeds, sites });
});

router.post('/rss', async (req, res) => {
  try {
    const { siteId, name, feedUrl, pollInterval, titlePrefix, titleField, customTitle,
      bodyField, customBody, icon, extractImage, utmSource, utmMedium, utmCampaign,
      targetAll, targetTags } = req.body;

    // Validate feed first
    const { validateFeed } = require('../services/rss');
    const validation = await validateFeed(feedUrl);
    if (!validation.valid) {
      req.session.error = `Invalid feed: ${validation.error}`;
      return res.redirect('/dashboard/rss');
    }

    const feed = new RssFeed({
      siteId, name, feedUrl,
      pollInterval: parseInt(pollInterval) || 10,
      template: {
        titlePrefix: titlePrefix || '',
        titleField: titleField || 'title',
        customTitle: customTitle || '',
        bodyField: bodyField || 'description',
        customBody: customBody || '',
        icon: icon || '',
        extractImage: extractImage === 'on'
      },
      utm: {
        source: utmSource || 'pushhive',
        medium: utmMedium || 'web_push',
        campaign: utmCampaign || 'rss_auto'
      },
      targetAll: targetAll !== 'false',
      targetTags: targetTags ? targetTags.split(',').map(t => t.trim()) : []
    });

    await feed.save();
    req.session.success = `RSS feed "${name}" added. Found ${validation.itemCount} items — latest: "${validation.latestTitle}"`;
    res.redirect('/dashboard/rss');
  } catch (err) {
    req.session.error = 'Failed to add feed: ' + err.message;
    res.redirect('/dashboard/rss');
  }
});

router.get('/rss/:id', async (req, res) => {
  try {
    const feed = await RssFeed.findById(req.params.id).populate('siteId', 'name domain').lean();
    if (!feed) { req.session.error = 'Feed not found'; return res.redirect('/dashboard/rss'); }
    const campaigns = await Campaign.find({ _id: { $in: feed.campaignIds || [] } })
      .sort({ createdAt: -1 }).limit(20).lean();
    res.render('pages/rss-detail', { feed, campaigns });
  } catch (err) {
    req.session.error = 'Failed to load feed';
    res.redirect('/dashboard/rss');
  }
});

router.post('/rss/:id/toggle', async (req, res) => {
  try {
    const feed = await RssFeed.findById(req.params.id);
    if (!feed) { req.session.error = 'Feed not found'; return res.redirect('/dashboard/rss'); }
    feed.active = !feed.active;
    if (feed.active) { feed.autoDisabled = false; feed.errorCount = 0; }
    await feed.save();
    req.session.success = `Feed ${feed.active ? 'enabled' : 'disabled'}`;
    res.redirect('/dashboard/rss');
  } catch (err) {
    req.session.error = 'Failed to toggle feed';
    res.redirect('/dashboard/rss');
  }
});

router.post('/rss/:id/poll', async (req, res) => {
  try {
    const feed = await RssFeed.findById(req.params.id);
    if (!feed) { req.session.error = 'Feed not found'; return res.redirect('/dashboard/rss'); }
    const { pollFeed } = require('../services/rss');
    const result = await pollFeed(feed);
    if (result.error) {
      req.session.error = `Poll failed: ${result.error}`;
    } else {
      req.session.success = `Polled "${feed.name}": ${result.newItems} new items${result.campaigns ? ', ' + result.campaigns + ' campaigns created' : ''}`;
    }
    res.redirect(`/dashboard/rss/${feed._id}`);
  } catch (err) {
    req.session.error = 'Poll failed: ' + err.message;
    res.redirect('/dashboard/rss');
  }
});

router.post('/rss/:id/delete', async (req, res) => {
  try {
    await RssFeed.findByIdAndDelete(req.params.id);
    req.session.success = 'Feed deleted';
    res.redirect('/dashboard/rss');
  } catch (err) {
    req.session.error = 'Failed to delete feed';
    res.redirect('/dashboard/rss');
  }
});

// ── Webhooks ────────────────────────────────────────────────────
router.get('/webhooks', async (req, res) => {
  const sites = await Site.find().lean();
  const webhooks = await Webhook.find().sort({ createdAt: -1 }).populate('siteId', 'name').lean();
  res.render('pages/webhooks', { webhooks, sites });
});

router.post('/webhooks', async (req, res) => {
  try {
    const { siteId, name, url, events } = req.body;
    const eventList = Array.isArray(events) ? events : (events ? [events] : []);
    const webhook = new Webhook({ siteId, name, url, events: eventList });
    await webhook.save();
    req.session.success = `Webhook "${name}" created`;
    res.redirect('/dashboard/webhooks');
  } catch (err) {
    req.session.error = 'Failed to create webhook: ' + err.message;
    res.redirect('/dashboard/webhooks');
  }
});

router.get('/webhooks/:id', async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id).populate('siteId', 'name domain').lean();
    if (!webhook) { req.session.error = 'Webhook not found'; return res.redirect('/dashboard/webhooks'); }
    const logs = await WebhookLog.find({ webhookId: webhook._id })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.render('pages/webhook-detail', { webhook, logs });
  } catch (err) {
    req.session.error = 'Failed to load webhook';
    res.redirect('/dashboard/webhooks');
  }
});

router.post('/webhooks/:id/toggle', async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) { req.session.error = 'Webhook not found'; return res.redirect('/dashboard/webhooks'); }
    webhook.active = !webhook.active;
    if (webhook.active) { webhook.autoDisabled = false; webhook.failCount = 0; }
    await webhook.save();
    req.session.success = `Webhook ${webhook.active ? 'enabled' : 'disabled'}`;
    res.redirect('/dashboard/webhooks');
  } catch (err) {
    req.session.error = 'Failed to toggle webhook';
    res.redirect('/dashboard/webhooks');
  }
});

router.post('/webhooks/:id/delete', async (req, res) => {
  try {
    await Webhook.findByIdAndDelete(req.params.id);
    await WebhookLog.deleteMany({ webhookId: req.params.id });
    req.session.success = 'Webhook deleted';
    res.redirect('/dashboard/webhooks');
  } catch (err) {
    req.session.error = 'Failed to delete webhook';
    res.redirect('/dashboard/webhooks');
  }
});

router.post('/webhooks/:id/test', async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    if (!webhook) { req.session.error = 'Webhook not found'; return res.redirect('/dashboard/webhooks'); }
    const webhookService = require('../services/webhooks');
    await webhookService.fire('test', webhook.siteId, { message: 'Test webhook from PushHive', timestamp: new Date().toISOString() });
    req.session.success = 'Test webhook queued';
    res.redirect(`/dashboard/webhooks/${webhook._id}`);
  } catch (err) {
    req.session.error = 'Failed to send test webhook';
    res.redirect('/dashboard/webhooks');
  }
});

// ── API Documentation ───────────────────────────────────────────
router.get('/api-docs', async (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const sites = await Site.find({ active: true }).select('name domain apiKey').lean();
  res.render('pages/api-docs', { serverUrl, sites });
});

// ── Team Management ─────────────────────────────────────────────
const { requireAdmin } = require('../middleware/roles');

router.get('/team', requireAdmin, async (req, res) => {
  const users = await Admin.find().sort({ createdAt: -1 }).lean();
  const sites = await Site.find().lean();
  res.render('pages/team', { users, sites, roleLabels: Admin.ROLE_LABELS, roleDescriptions: Admin.ROLE_DESCRIPTIONS });
});

router.post('/team/invite', requireAdmin, async (req, res) => {
  try {
    const { email, name, role, siteAccess } = req.body;

    if (!email || !role) {
      req.session.error = 'Email and role are required';
      return res.redirect('/dashboard/team');
    }

    // Check if already exists
    const existing = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      req.session.error = `User with email ${email} already exists`;
      return res.redirect('/dashboard/team');
    }

    // Prevent editors/viewers from inviting admins
    if (['super', 'admin'].includes(role) && req.session.admin.role !== 'super') {
      req.session.error = 'Only super admins can invite admins';
      return res.redirect('/dashboard/team');
    }

    const admin = new Admin({
      email: email.toLowerCase().trim(),
      password: require('crypto').randomBytes(32).toString('hex'), // Temp password, will be set on invite accept
      name: name || 'Invited User',
      role,
      siteAccess: siteAccess ? (Array.isArray(siteAccess) ? siteAccess : [siteAccess]) : [],
      invitedBy: req.session.admin.id,
      inviteAccepted: false
    });

    const token = admin.generateInviteToken();
    await admin.save();

    const inviteUrl = `${req.protocol}://${req.get('host')}/auth/invite/${token}`;

    req.session.success = `Invitation created for ${email}. Share this link: ${inviteUrl}`;
    res.redirect('/dashboard/team');
  } catch (err) {
    req.session.error = 'Failed to invite user: ' + err.message;
    res.redirect('/dashboard/team');
  }
});

router.post('/team/:id/role', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const target = await Admin.findById(req.params.id);
    if (!target) { req.session.error = 'User not found'; return res.redirect('/dashboard/team'); }

    // Cannot change super admin's role (unless you're super)
    if (target.role === 'super' && req.session.admin.role !== 'super') {
      req.session.error = 'Cannot modify super admin';
      return res.redirect('/dashboard/team');
    }

    // Cannot promote to super unless you're super
    if (role === 'super' && req.session.admin.role !== 'super') {
      req.session.error = 'Only super admins can promote to super admin';
      return res.redirect('/dashboard/team');
    }

    target.role = role;
    await target.save();
    req.session.success = `${target.name}'s role updated to ${Admin.ROLE_LABELS[role]}`;
    res.redirect('/dashboard/team');
  } catch (err) {
    req.session.error = 'Failed to update role';
    res.redirect('/dashboard/team');
  }
});

router.post('/team/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const target = await Admin.findById(req.params.id);
    if (!target) { req.session.error = 'User not found'; return res.redirect('/dashboard/team'); }
    if (target._id.toString() === req.session.admin.id) {
      req.session.error = 'Cannot disable your own account';
      return res.redirect('/dashboard/team');
    }
    if (target.role === 'super' && req.session.admin.role !== 'super') {
      req.session.error = 'Cannot disable super admin';
      return res.redirect('/dashboard/team');
    }
    target.active = !target.active;
    await target.save();
    req.session.success = `${target.name} ${target.active ? 'enabled' : 'disabled'}`;
    res.redirect('/dashboard/team');
  } catch (err) {
    req.session.error = 'Failed to toggle user';
    res.redirect('/dashboard/team');
  }
});

router.post('/team/:id/delete', requireAdmin, async (req, res) => {
  try {
    const target = await Admin.findById(req.params.id);
    if (!target) { req.session.error = 'User not found'; return res.redirect('/dashboard/team'); }
    if (target._id.toString() === req.session.admin.id) {
      req.session.error = 'Cannot delete your own account';
      return res.redirect('/dashboard/team');
    }
    if (target.role === 'super') {
      req.session.error = 'Cannot delete super admin';
      return res.redirect('/dashboard/team');
    }
    await Admin.findByIdAndDelete(req.params.id);
    req.session.success = `${target.name} deleted`;
    res.redirect('/dashboard/team');
  } catch (err) {
    req.session.error = 'Failed to delete user';
    res.redirect('/dashboard/team');
  }
});

router.post('/team/:id/reinvite', requireAdmin, async (req, res) => {
  try {
    const target = await Admin.findById(req.params.id);
    if (!target) { req.session.error = 'User not found'; return res.redirect('/dashboard/team'); }
    if (target.inviteAccepted) {
      req.session.error = 'User has already accepted their invitation';
      return res.redirect('/dashboard/team');
    }
    const token = target.generateInviteToken();
    await target.save();
    const inviteUrl = `${req.protocol}://${req.get('host')}/auth/invite/${token}`;
    req.session.success = `New invite link for ${target.email}: ${inviteUrl}`;
    res.redirect('/dashboard/team');
  } catch (err) {
    req.session.error = 'Failed to resend invite';
    res.redirect('/dashboard/team');
  }
});

// ── WordPress Plugin Download ────────────────────────────────────
router.get('/download/wordpress-plugin', (req, res) => {
  const pluginPath = require('path').join(__dirname, '..', 'wordpress', 'pushhive-wp-plugin.zip');
  const fs = require('fs');
  if (fs.existsSync(pluginPath)) {
    res.download(pluginPath, 'pushhive-wp-plugin.zip');
  } else {
    req.session.error = 'Plugin file not found. Rebuild with install script.';
    res.redirect('/dashboard/settings');
  }
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
