require('dotenv').config();
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const webpush = require('web-push');
const { createConnection } = require('./services/redis');
const { QUEUE_NAMES, queueBatch, queueCompletion } = require('./services/queue');
const Campaign = require('./models/Campaign');
const Subscriber = require('./models/Subscriber');
const Site = require('./models/Site');
const Event = require('./models/Event');

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

console.log(`[${WORKER_ID}] Starting PushHive worker...`);

// ── MongoDB Connection ──────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log(`[${WORKER_ID}] ✓ MongoDB connected`))
  .catch(err => { console.error('✗ MongoDB error:', err); process.exit(1); });

// ── Configure web-push ──────────────────────────────────────────
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── Worker 1: Campaign Orchestrator ─────────────────────────────
// Takes a campaign, splits subscribers into batches, queues each batch
const campaignWorker = new Worker(QUEUE_NAMES.CAMPAIGN_SEND, async (job) => {
  const { campaignId, batchSize = 500 } = job.data;
  console.log(`[${WORKER_ID}] Processing campaign: ${campaignId}`);

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  campaign.status = 'sending';
  await campaign.save();

  // Build subscriber filter
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

  // Count total
  const totalSubs = await Subscriber.countDocuments(filter);
  campaign.stats.targeted = totalSubs;
  await campaign.save();

  if (totalSubs === 0) {
    campaign.status = 'sent';
    campaign.sentAt = new Date();
    campaign.stats.sent = 0;
    await campaign.save();
    return { campaignId, totalSubs: 0, batches: 0 };
  }

  // Build notification payload
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

  // Fetch subscriber IDs in batches using cursor for memory efficiency
  const totalBatches = Math.ceil(totalSubs / batchSize);
  let batchNum = 0;

  for (let skip = 0; skip < totalSubs; skip += batchSize) {
    const subscriberBatch = await Subscriber.find(filter)
      .select('_id subscription browser os device')
      .skip(skip)
      .limit(batchSize)
      .lean();

    if (subscriberBatch.length === 0) break;

    batchNum++;
    await queueBatch({
      campaignId: campaign._id.toString(),
      siteId: campaign.siteId.toString(),
      batchNum,
      totalBatches,
      payload,
      subscribers: subscriberBatch.map(s => ({
        _id: s._id.toString(),
        subscription: s.subscription,
        browser: s.browser,
        os: s.os,
        device: s.device
      }))
    });

    // Update progress
    await job.updateProgress(Math.round((batchNum / totalBatches) * 100));
  }

  // Queue the completion job (runs after batches finish)
  await queueCompletion(campaign._id);

  console.log(`[${WORKER_ID}] Campaign ${campaignId}: queued ${batchNum} batches for ${totalSubs} subscribers`);
  return { campaignId, totalSubs, batches: batchNum };

}, {
  connection: createConnection(),
  concurrency: 2, // Process 2 campaigns simultaneously
  limiter: { max: 5, duration: 60000 } // Max 5 campaigns per minute
});

// ── Worker 2: Push Batch Sender ─────────────────────────────────
// Receives a batch of ~500 subscribers and sends notifications
const batchWorker = new Worker(QUEUE_NAMES.PUSH_BATCH, async (job) => {
  const { campaignId, siteId, batchNum, totalBatches, payload, subscribers } = job.data;
  let sent = 0, failed = 0;
  const failedEndpoints = [];

  // Send all in parallel with concurrency limit
  const CONCURRENT = 50; // 50 simultaneous sends
  for (let i = 0; i < subscribers.length; i += CONCURRENT) {
    const chunk = subscribers.slice(i, i + CONCURRENT);

    await Promise.allSettled(
      chunk.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          sent++;

          // Log delivery event (fire and forget)
          Event.create({
            siteId,
            campaignId,
            subscriberId: sub._id,
            type: 'delivered',
            browser: sub.browser,
            os: sub.os,
            device: sub.device
          }).catch(() => {});

        } catch (err) {
          failed++;

          // Mark gone subscriptions for cleanup
          if (err.statusCode === 410 || err.statusCode === 404) {
            failedEndpoints.push(sub._id);
          }

          Event.create({
            siteId,
            campaignId,
            subscriberId: sub._id,
            type: 'failed'
          }).catch(() => {});
        }
      })
    );
  }

  // Deactivate gone subscriptions in bulk
  if (failedEndpoints.length > 0) {
    await Subscriber.updateMany(
      { _id: { $in: failedEndpoints } },
      { active: false, unsubscribedAt: new Date() }
    );
  }

  // Update campaign stats atomically
  await Campaign.findByIdAndUpdate(campaignId, {
    $inc: {
      'stats.sent': sent,
      'stats.delivered': sent,
      'stats.failed': failed
    }
  });

  const progress = Math.round((batchNum / totalBatches) * 100);
  await job.updateProgress(progress);

  return { batchNum, sent, failed, cleaned: failedEndpoints.length };

}, {
  connection: createConnection(),
  concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 10,
  limiter: {
    max: parseInt(process.env.WORKER_RATE_LIMIT) || 50,
    duration: 1000 // Max 50 batches per second
  }
});

// ── Worker 3: Campaign Completion ───────────────────────────────
// Runs after all batches, finalizes campaign stats
const completionWorker = new Worker(QUEUE_NAMES.CAMPAIGN_COMPLETE, async (job) => {
  const { campaignId } = job.data;

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return;

  // Final stats from events collection (source of truth)
  const [delivered, failedCount] = await Promise.all([
    Event.countDocuments({ campaignId, type: 'delivered' }),
    Event.countDocuments({ campaignId, type: 'failed' })
  ]);

  campaign.stats.delivered = delivered;
  campaign.stats.sent = delivered;
  campaign.stats.failed = failedCount;
  campaign.status = 'sent';
  campaign.sentAt = new Date();
  await campaign.save();

  // Update site subscriber count
  const activeCount = await Subscriber.countDocuments({
    siteId: campaign.siteId,
    active: true
  });
  await Site.findByIdAndUpdate(campaign.siteId, { subscriberCount: activeCount });

  console.log(`[${WORKER_ID}] Campaign "${campaign.title}" complete: ${delivered} delivered, ${failedCount} failed`);
  return { campaignId, delivered, failed: failedCount };

}, {
  connection: createConnection(),
  concurrency: 5
});

// ── Worker 4: Subscription Cleanup ──────────────────────────────
const cleanupWorker = new Worker(QUEUE_NAMES.PUSH_CLEANUP, async (job) => {
  const { siteId } = job.data;
  console.log(`[${WORKER_ID}] Cleaning stale subscriptions for site ${siteId}`);

  const subscribers = await Subscriber.find({ siteId, active: true })
    .select('_id subscription').lean();

  let cleaned = 0;
  const BATCH = 200;

  for (let i = 0; i < subscribers.length; i += BATCH) {
    const batch = subscribers.slice(i, i + BATCH);
    const stale = [];

    await Promise.allSettled(
      batch.map(sub =>
        webpush.sendNotification(sub.subscription, null, { TTL: 0 })
          .catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              stale.push(sub._id);
            }
          })
      )
    );

    if (stale.length > 0) {
      await Subscriber.updateMany(
        { _id: { $in: stale } },
        { active: false, unsubscribedAt: new Date() }
      );
      cleaned += stale.length;
    }

    await job.updateProgress(Math.round(((i + BATCH) / subscribers.length) * 100));
  }

  const remaining = await Subscriber.countDocuments({ siteId, active: true });
  await Site.findByIdAndUpdate(siteId, { subscriberCount: remaining });

  console.log(`[${WORKER_ID}] Cleanup done: ${cleaned} removed, ${remaining} active`);
  return { cleaned, remaining };

}, {
  connection: createConnection(),
  concurrency: 2
});

// ── Error Handlers ──────────────────────────────────────────────
[campaignWorker, batchWorker, completionWorker, cleanupWorker].forEach(w => {
  w.on('failed', (job, err) => {
    console.error(`[${WORKER_ID}] Job ${job?.id} failed on ${w.name}:`, err.message);
  });
  w.on('error', (err) => {
    console.error(`[${WORKER_ID}] Worker ${w.name} error:`, err.message);
  });
});

// ── Scheduled Campaign Checker ──────────────────────────────────
// Polls MongoDB for scheduled campaigns and queues them
const { queueCampaign } = require('./services/queue');

async function checkScheduledCampaigns() {
  try {
    const now = new Date();
    const dueCampaigns = await Campaign.find({
      status: 'scheduled',
      scheduledAt: { $lte: now }
    });

    for (const campaign of dueCampaigns) {
      console.log(`[${WORKER_ID}] Scheduled campaign due: ${campaign.title}`);
      campaign.status = 'queued';
      await campaign.save();
      await queueCampaign(campaign._id);
    }
  } catch (err) {
    console.error(`[${WORKER_ID}] Schedule check error:`, err.message);
  }
}

// Check every 30 seconds
setInterval(checkScheduledCampaigns, 30000);
checkScheduledCampaigns(); // Run immediately

// ── Graceful Shutdown ───────────────────────────────────────────
async function shutdown(signal) {
  console.log(`[${WORKER_ID}] ${signal} received, shutting down gracefully...`);
  await Promise.all([
    campaignWorker.close(),
    batchWorker.close(),
    completionWorker.close(),
    cleanupWorker.close()
  ]);
  await mongoose.disconnect();
  console.log(`[${WORKER_ID}] Shutdown complete`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[${WORKER_ID}] ✓ All workers started`);
console.log(`[${WORKER_ID}]   Batch concurrency: ${process.env.WORKER_CONCURRENCY || 10}`);
console.log(`[${WORKER_ID}]   Rate limit: ${process.env.WORKER_RATE_LIMIT || 50} batches/sec`);
