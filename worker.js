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

// ═══════════════════════════════════════════════════════════════
// Worker 1: Campaign Orchestrator
// Splits campaign into batches. Handles both normal and A/B sends.
// ═══════════════════════════════════════════════════════════════
const campaignWorker = new Worker(QUEUE_NAMES.CAMPAIGN_SEND, async (job) => {
  const { campaignId, batchSize = 500, sendWinner = false, winnerVariant = '' } = job.data;
  console.log(`[${WORKER_ID}] Processing campaign: ${campaignId}${sendWinner ? ' (winner: ' + winnerVariant + ')' : ''}`);

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // Build subscriber filter
  let filter = { siteId: campaign.siteId, active: true };

  // If targeting a segment, use the segment's query
  if (campaign.targetSegment) {
    const Segment = require('./models/Segment');
    const segment = await Segment.findById(campaign.targetSegment);
    if (segment) {
      filter = segment.buildQuery();
      console.log(`[${WORKER_ID}] Using segment "${segment.name}" for targeting`);
    }
  } else if (!campaign.targetAll) {
    if (campaign.targetTags && campaign.targetTags.length > 0) {
      filter.tags = { $in: campaign.targetTags };
    }
    if (campaign.targetBrowsers && campaign.targetBrowsers.length > 0) {
      filter.browser = { $in: campaign.targetBrowsers };
    }
    if (campaign.targetDevices && campaign.targetDevices.length > 0) {
      filter.device = { $in: campaign.targetDevices };
    }
  }

  const totalSubs = await Subscriber.countDocuments(filter);

  if (totalSubs === 0) {
    campaign.status = 'sent';
    campaign.sentAt = new Date();
    await campaign.save();
    return { campaignId, totalSubs: 0, batches: 0 };
  }

  // ── A/B Test: Send to test group only ─────────────────────
  if (campaign.abTest.enabled && !sendWinner && campaign.abTest.variants.length === 2) {
    campaign.status = 'ab_testing';
    campaign.abTest.status = 'testing';
    campaign.stats.targeted = totalSubs;
    await campaign.save();

    const testCount = Math.ceil(totalSubs * (campaign.abTest.testPercentage / 100));
    const perVariant = Math.ceil(testCount / 2);

    console.log(`[${WORKER_ID}] A/B Test: ${testCount} test subs (${perVariant} per variant), ${totalSubs - testCount} remaining for winner`);

    // Fetch test subscribers
    const testSubscribers = await Subscriber.find(filter)
      .select('_id subscription browser os device')
      .limit(testCount)
      .lean();

    const halfPoint = Math.ceil(testSubscribers.length / 2);
    const groupA = testSubscribers.slice(0, halfPoint);
    const groupB = testSubscribers.slice(halfPoint);

    const variantA = campaign.abTest.variants[0];
    const variantB = campaign.abTest.variants[1];

    // Build payloads for each variant
    const payloadA = JSON.stringify(campaign.getVariantPayload(variantA.name));
    const payloadB = JSON.stringify(campaign.getVariantPayload(variantB.name));

    // Queue batches for variant A
    const batchesA = Math.ceil(groupA.length / batchSize);
    for (let i = 0; i < groupA.length; i += batchSize) {
      const batch = groupA.slice(i, i + batchSize);
      await queueBatch({
        campaignId: campaign._id.toString(),
        siteId: campaign.siteId.toString(),
        batchNum: Math.ceil(i / batchSize) + 1,
        totalBatches: batchesA + Math.ceil(groupB.length / batchSize),
        payload: payloadA,
        variantName: variantA.name,
        variantId: variantA._id.toString(),
        subscribers: batch.map(s => ({ _id: s._id.toString(), subscription: s.subscription, browser: s.browser, os: s.os, device: s.device }))
      });
    }

    // Queue batches for variant B
    for (let i = 0; i < groupB.length; i += batchSize) {
      const batch = groupB.slice(i, i + batchSize);
      await queueBatch({
        campaignId: campaign._id.toString(),
        siteId: campaign.siteId.toString(),
        batchNum: batchesA + Math.ceil(i / batchSize) + 1,
        totalBatches: batchesA + Math.ceil(groupB.length / batchSize),
        payload: payloadB,
        variantName: variantB.name,
        variantId: variantB._id.toString(),
        subscribers: batch.map(s => ({ _id: s._id.toString(), subscription: s.subscription, browser: s.browser, os: s.os, device: s.device }))
      });
    }

    // Update variant targeted counts
    variantA.stats.targeted = groupA.length;
    variantB.stats.targeted = groupB.length;
    await campaign.save();

    // Schedule winner evaluation
    const { getQueue } = require('./services/queue');
    const abQueue = getQueue(QUEUE_NAMES.CAMPAIGN_COMPLETE);
    await abQueue.add('evaluate-ab', {
      campaignId: campaign._id.toString(),
      type: 'ab_evaluate'
    }, {
      delay: campaign.abTest.waitHours * 60 * 60 * 1000,
      jobId: `ab-evaluate-${campaignId}`
    });

    console.log(`[${WORKER_ID}] A/B test sent. Winner evaluation in ${campaign.abTest.waitHours}h`);
    return { campaignId, mode: 'ab_test', groupA: groupA.length, groupB: groupB.length };
  }

  // ── Normal send (or winner send) ──────────────────────────
  if (sendWinner) {
    campaign.status = 'ab_sending_winner';
    campaign.abTest.status = 'winner_sent';
  } else {
    campaign.status = 'sending';
  }
  campaign.stats.targeted = totalSubs;
  await campaign.save();

  // Determine payload
  let payload;
  if (sendWinner && winnerVariant) {
    payload = JSON.stringify(campaign.getVariantPayload(winnerVariant));
  } else {
    payload = JSON.stringify({
      title: campaign.title, body: campaign.body,
      icon: campaign.icon || '', image: campaign.image || '',
      badge: campaign.badge || '', url: campaign.buildUrl(),
      campaignId: campaign._id.toString(), siteId: campaign.siteId.toString(),
      actions: campaign.actions || [], utm: campaign.utm
    });
  }

  // For winner sends, exclude subscribers who already received the test
  let skipIds = [];
  if (sendWinner) {
    const alreadySent = await Event.find({
      campaignId: campaign._id,
      type: 'delivered'
    }).select('subscriberId').lean();
    skipIds = alreadySent.map(e => e.subscriberId.toString());
    if (skipIds.length > 0) {
      filter._id = { $nin: skipIds.map(id => new mongoose.Types.ObjectId(id)) };
    }
  }

  const remainingSubs = await Subscriber.countDocuments(filter);
  const totalBatches = Math.ceil(remainingSubs / batchSize);
  let batchNum = 0;

  for (let skip = 0; skip < remainingSubs; skip += batchSize) {
    const subscriberBatch = await Subscriber.find(filter)
      .select('_id subscription browser os device')
      .skip(skip).limit(batchSize).lean();

    if (subscriberBatch.length === 0) break;
    batchNum++;

    await queueBatch({
      campaignId: campaign._id.toString(),
      siteId: campaign.siteId.toString(),
      batchNum, totalBatches, payload,
      variantName: winnerVariant || '',
      subscribers: subscriberBatch.map(s => ({ _id: s._id.toString(), subscription: s.subscription, browser: s.browser, os: s.os, device: s.device }))
    });

    await job.updateProgress(Math.round((batchNum / totalBatches) * 100));
  }

  await queueCompletion(campaign._id);
  console.log(`[${WORKER_ID}] Campaign ${campaignId}: queued ${batchNum} batches for ${remainingSubs} subscribers`);
  return { campaignId, totalSubs: remainingSubs, batches: batchNum };

}, {
  connection: createConnection(),
  concurrency: 2,
  limiter: { max: 5, duration: 60000 }
});

// ═══════════════════════════════════════════════════════════════
// Worker 2: Push Batch Sender (handles both normal and A/B batches)
// ═══════════════════════════════════════════════════════════════
const batchWorker = new Worker(QUEUE_NAMES.PUSH_BATCH, async (job) => {
  const { campaignId, siteId, batchNum, totalBatches, payload, subscribers, variantName, variantId } = job.data;
  let sent = 0, failed = 0;
  const failedEndpoints = [];

  const CONCURRENT = 50;
  for (let i = 0; i < subscribers.length; i += CONCURRENT) {
    const chunk = subscribers.slice(i, i + CONCURRENT);
    await Promise.allSettled(
      chunk.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          sent++;
          Event.create({
            siteId, campaignId, subscriberId: sub._id, type: 'delivered',
            browser: sub.browser, os: sub.os, device: sub.device,
            variantName: variantName || '', variantId: variantId || undefined
          }).catch(() => {});
        } catch (err) {
          failed++;
          if (err.statusCode === 410 || err.statusCode === 404) {
            failedEndpoints.push(sub._id);
          }
          Event.create({
            siteId, campaignId, subscriberId: sub._id, type: 'failed',
            variantName: variantName || '', variantId: variantId || undefined
          }).catch(() => {});
        }
      })
    );
  }

  if (failedEndpoints.length > 0) {
    await Subscriber.updateMany({ _id: { $in: failedEndpoints } }, { active: false, unsubscribedAt: new Date() });
  }

  // Update campaign stats atomically
  await Campaign.findByIdAndUpdate(campaignId, {
    $inc: { 'stats.sent': sent, 'stats.delivered': sent, 'stats.failed': failed }
  });

  // Update variant stats if A/B
  if (variantName) {
    await Campaign.findOneAndUpdate(
      { _id: campaignId, 'abTest.variants.name': variantName },
      { $inc: {
        'abTest.variants.$.stats.sent': sent,
        'abTest.variants.$.stats.delivered': sent,
        'abTest.variants.$.stats.failed': failed
      }}
    );
  }

  await job.updateProgress(Math.round((batchNum / totalBatches) * 100));
  return { batchNum, sent, failed, cleaned: failedEndpoints.length };

}, {
  connection: createConnection(),
  concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 10,
  limiter: { max: parseInt(process.env.WORKER_RATE_LIMIT) || 50, duration: 1000 }
});

// ═══════════════════════════════════════════════════════════════
// Worker 3: Campaign Completion + A/B Winner Evaluation
// ═══════════════════════════════════════════════════════════════
const completionWorker = new Worker(QUEUE_NAMES.CAMPAIGN_COMPLETE, async (job) => {
  const { campaignId, type } = job.data;

  // ── A/B Winner Evaluation ───────────────────────────────────
  if (type === 'ab_evaluate') {
    console.log(`[${WORKER_ID}] Evaluating A/B winner for campaign ${campaignId}`);
    const campaign = await Campaign.findById(campaignId);
    if (!campaign || !campaign.abTest.enabled) return;

    const variantA = campaign.abTest.variants[0];
    const variantB = campaign.abTest.variants[1];

    // Get click stats per variant from events
    const [clicksA, clicksB] = await Promise.all([
      Event.countDocuments({ campaignId, variantName: variantA.name, type: 'clicked' }),
      Event.countDocuments({ campaignId, variantName: variantB.name, type: 'clicked' })
    ]);

    variantA.stats.clicked = clicksA;
    variantB.stats.clicked = clicksB;

    // Calculate CTR
    const ctrA = variantA.stats.sent > 0 ? (clicksA / variantA.stats.sent) * 100 : 0;
    const ctrB = variantB.stats.sent > 0 ? (clicksB / variantB.stats.sent) * 100 : 0;

    let winner;
    if (campaign.abTest.winnerMetric === 'clicks') {
      winner = clicksA >= clicksB ? variantA.name : variantB.name;
    } else {
      winner = ctrA >= ctrB ? variantA.name : variantB.name;
    }

    campaign.abTest.winnerVariant = winner;
    campaign.abTest.status = 'winner_sent';
    campaign.status = 'ab_sending_winner';
    await campaign.save();

    console.log(`[${WORKER_ID}] A/B Winner: ${winner} (A: ${ctrA.toFixed(1)}% CTR, ${clicksA} clicks | B: ${ctrB.toFixed(1)}% CTR, ${clicksB} clicks)`);

    // Fire webhook
    const webhooks = require('./services/webhooks');
    webhooks.fire('ab_test.winner', campaign.siteId, {
      campaignId, winner,
      variantA: { ctr: ctrA.toFixed(2), clicks: clicksA, sent: variantA.stats.sent },
      variantB: { ctr: ctrB.toFixed(2), clicks: clicksB, sent: variantB.stats.sent }
    }).catch(() => {});

    // Queue the winner send to remaining subscribers
    const { queueCampaign } = require('./services/queue');
    await queueCampaign(campaignId, { sendWinner: true, winnerVariant: winner });

    return { campaignId, winner, ctrA: ctrA.toFixed(2), ctrB: ctrB.toFixed(2) };
  }

  // ── Normal Campaign Completion ──────────────────────────────
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return;

  const [delivered, failedCount] = await Promise.all([
    Event.countDocuments({ campaignId, type: 'delivered' }),
    Event.countDocuments({ campaignId, type: 'failed' })
  ]);

  campaign.stats.delivered = delivered;
  campaign.stats.sent = delivered;
  campaign.stats.failed = failedCount;
  campaign.status = 'sent';
  campaign.sentAt = new Date();

  if (campaign.abTest.enabled) {
    campaign.abTest.status = 'complete';
  }

  await campaign.save();

  const activeCount = await Subscriber.countDocuments({ siteId: campaign.siteId, active: true });
  await Site.findByIdAndUpdate(campaign.siteId, { subscriberCount: activeCount });

  // Fire webhook
  const webhooks = require('./services/webhooks');
  webhooks.fire('campaign.sent', campaign.siteId, {
    campaignId, title: campaign.title, delivered, failed: failedCount,
    ctr: delivered > 0 ? ((campaign.stats.clicked / delivered) * 100).toFixed(2) + '%' : '0%'
  }).catch(() => {});

  console.log(`[${WORKER_ID}] Campaign "${campaign.title}" complete: ${delivered} delivered, ${failedCount} failed`);
  return { campaignId, delivered, failed: failedCount };

}, {
  connection: createConnection(),
  concurrency: 5
});

// ═══════════════════════════════════════════════════════════════
// Worker 4: Subscription Cleanup
// ═══════════════════════════════════════════════════════════════
const cleanupWorker = new Worker(QUEUE_NAMES.PUSH_CLEANUP, async (job) => {
  const { siteId } = job.data;
  const subscribers = await Subscriber.find({ siteId, active: true }).select('_id subscription').lean();
  let cleaned = 0;
  const BATCH = 200;

  for (let i = 0; i < subscribers.length; i += BATCH) {
    const batch = subscribers.slice(i, i + BATCH);
    const stale = [];
    await Promise.allSettled(
      batch.map(sub =>
        webpush.sendNotification(sub.subscription, null, { TTL: 0 })
          .catch(err => { if (err.statusCode === 410 || err.statusCode === 404) stale.push(sub._id); })
      )
    );
    if (stale.length > 0) {
      await Subscriber.updateMany({ _id: { $in: stale } }, { active: false, unsubscribedAt: new Date() });
      cleaned += stale.length;
    }
    await job.updateProgress(Math.round(((i + BATCH) / subscribers.length) * 100));
  }

  const remaining = await Subscriber.countDocuments({ siteId, active: true });
  await Site.findByIdAndUpdate(siteId, { subscriberCount: remaining });
  return { cleaned, remaining };
}, { connection: createConnection(), concurrency: 2 });

// ═══════════════════════════════════════════════════════════════
// Worker 5: Webhook Delivery
// Sends HTTP POST to webhook URLs with signed payloads
// ═══════════════════════════════════════════════════════════════
const { WEBHOOK_QUEUE } = require('./services/webhooks');
const Webhook = require('./models/Webhook');
const WebhookLog = require('./models/WebhookLog');

const webhookWorker = new Worker(WEBHOOK_QUEUE, async (job) => {
  const { webhookId, siteId, event, url, signature, payload, timeoutMs } = job.data;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 10000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PushHive-Event': event,
        'X-PushHive-Signature': signature,
        'X-PushHive-Timestamp': payload.timestamp,
        'User-Agent': 'PushHive-Webhook/2.0'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const responseTimeMs = Date.now() - startTime;
    const responseBody = await response.text().catch(() => '');

    // Log the attempt
    await WebhookLog.create({
      webhookId, siteId, event, url, payload,
      statusCode: response.status,
      responseBody: responseBody.substring(0, 2000),
      responseTimeMs,
      success: response.ok,
      attempt: job.attemptsMade + 1
    });

    // Update webhook stats
    if (response.ok) {
      await Webhook.findByIdAndUpdate(webhookId, {
        $inc: { 'stats.totalSent': 1, 'stats.totalSuccess': 1 },
        'stats.lastTriggered': new Date(),
        'stats.lastSuccess': new Date(),
        'stats.lastError': ''
      });
    } else {
      await Webhook.findByIdAndUpdate(webhookId, {
        $inc: { 'stats.totalSent': 1, 'stats.totalFailed': 1 },
        'stats.lastTriggered': new Date(),
        'stats.lastFailure': new Date(),
        'stats.lastError': `HTTP ${response.status}`
      });
      throw new Error(`Webhook returned HTTP ${response.status}`);
    }

    return { statusCode: response.status, responseTimeMs };

  } catch (err) {
    const responseTimeMs = Date.now() - startTime;
    const errorMsg = err.name === 'AbortError' ? 'Timeout' : err.message;

    await WebhookLog.create({
      webhookId, siteId, event, url, payload,
      responseTimeMs, success: false,
      attempt: job.attemptsMade + 1,
      error: errorMsg
    });

    await Webhook.findByIdAndUpdate(webhookId, {
      $inc: { 'stats.totalSent': 1, 'stats.totalFailed': 1 },
      'stats.lastTriggered': new Date(),
      'stats.lastFailure': new Date(),
      'stats.lastError': errorMsg
    });

    throw err; // Triggers retry
  }
}, {
  connection: createConnection(),
  concurrency: 20,
  limiter: { max: 100, duration: 1000 } // Max 100 webhooks/sec
});

// ── Error Handlers ──────────────────────────────────────────────
[campaignWorker, batchWorker, completionWorker, cleanupWorker, webhookWorker].forEach(w => {
  w.on('failed', (job, err) => console.error(`[${WORKER_ID}] Job ${job?.id} failed on ${w.name}:`, err.message));
  w.on('error', (err) => console.error(`[${WORKER_ID}] Worker ${w.name} error:`, err.message));
});

// ── Scheduled Campaign Checker ──────────────────────────────────
const { queueCampaign } = require('./services/queue');
async function checkScheduledCampaigns() {
  try {
    const due = await Campaign.find({ status: 'scheduled', scheduledAt: { $lte: new Date() } });
    for (const campaign of due) {
      campaign.status = 'queued';
      await campaign.save();
      await queueCampaign(campaign._id);
    }
  } catch (err) {
    console.error(`[${WORKER_ID}] Schedule check error:`, err.message);
  }
}
setInterval(checkScheduledCampaigns, 30000);
checkScheduledCampaigns();

// ── RSS Feed Poller ─────────────────────────────────────────────
const { pollAllFeeds } = require('./services/rss');

async function checkRssFeeds() {
  try {
    const result = await pollAllFeeds();
    if (result.polled > 0) {
      console.log(`[${WORKER_ID}] RSS: polled ${result.polled}/${result.totalFeeds} feeds`);
    }
  } catch (err) {
    console.error(`[${WORKER_ID}] RSS poll error:`, err.message);
  }
}
// Check RSS feeds every 60 seconds
setInterval(checkRssFeeds, 60000);
setTimeout(checkRssFeeds, 10000); // First run after 10s delay
console.log(`[${WORKER_ID}] ✓ RSS feed poller started (checking every 60s)`);

// ── Start Webhook Delivery Worker ───────────────────────────────
const webhookService = require('./services/webhooks');
webhookService.startWorker();

// ── Graceful Shutdown ───────────────────────────────────────────
async function shutdown(signal) {
  console.log(`[${WORKER_ID}] ${signal} received, shutting down...`);
  await Promise.all([
    campaignWorker.close(), batchWorker.close(),
    completionWorker.close(), cleanupWorker.close(),
    webhookService.close()
  ]);
  await mongoose.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[${WORKER_ID}] ✓ All workers started (concurrency: ${process.env.WORKER_CONCURRENCY || 10})`);
