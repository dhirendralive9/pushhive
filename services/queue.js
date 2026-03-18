const { Queue, FlowProducer } = require('bullmq');
const { getConnection } = require('./redis');

// ── Queue Definitions ───────────────────────────────────────────
// campaign.send    → Orchestrator: splits campaign into batches
// push.batch       → Worker: sends a batch of 500 notifications
// push.cleanup     → Worker: removes stale subscriptions
// campaign.complete → Finalizer: aggregates results, updates stats

const QUEUE_NAMES = {
  CAMPAIGN_SEND: 'campaign.send',
  PUSH_BATCH: 'push.batch',
  PUSH_CLEANUP: 'push.cleanup',
  CAMPAIGN_COMPLETE: 'campaign.complete'
};

let queues = {};

function getQueue(name) {
  if (!queues[name]) {
    queues[name] = new Queue(name, {
      connection: getConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      }
    });
  }
  return queues[name];
}

// ── Queue a campaign for sending ────────────────────────────────
async function queueCampaign(campaignId, options = {}) {
  const queue = getQueue(QUEUE_NAMES.CAMPAIGN_SEND);
  const jobId = options.sendWinner
    ? `campaign-winner-${campaignId}`
    : `campaign-${campaignId}`;

  const job = await queue.add('send', {
    campaignId: campaignId.toString(),
    batchSize: options.batchSize || 500,
    concurrency: options.concurrency || 10,
    priority: options.priority || 0,
    sendWinner: options.sendWinner || false,
    winnerVariant: options.winnerVariant || ''
  }, {
    priority: options.priority || 0,
    jobId
  });
  console.log(`[Queue] Campaign ${campaignId} queued as job ${job.id}${options.sendWinner ? ' (winner send)' : ''}`);
  return job;
}

// ── Queue a batch of push notifications ─────────────────────────
async function queueBatch(batchData) {
  const queue = getQueue(QUEUE_NAMES.PUSH_BATCH);
  const job = await queue.add('send-batch', batchData, {
    priority: batchData.priority || 0
  });
  return job;
}

// ── Queue campaign completion (aggregate stats) ─────────────────
async function queueCompletion(campaignId) {
  const queue = getQueue(QUEUE_NAMES.CAMPAIGN_COMPLETE);
  return queue.add('finalize', {
    campaignId: campaignId.toString()
  }, {
    delay: 5000, // Wait 5s for last batch events to flush
    jobId: `complete-${campaignId}`
  });
}

// ── Queue a cleanup job ─────────────────────────────────────────
async function queueCleanup(siteId) {
  const queue = getQueue(QUEUE_NAMES.PUSH_CLEANUP);
  return queue.add('cleanup', {
    siteId: siteId.toString()
  }, {
    jobId: `cleanup-${siteId}`
  });
}

// ── Get queue stats for dashboard ───────────────────────────────
async function getQueueStats() {
  const stats = {};
  for (const [key, name] of Object.entries(QUEUE_NAMES)) {
    const q = getQueue(name);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount()
    ]);
    stats[key] = { name, waiting, active, completed, failed, delayed };
  }
  return stats;
}

// ── Get active jobs for a campaign ──────────────────────────────
async function getCampaignJobProgress(campaignId) {
  const queue = getQueue(QUEUE_NAMES.CAMPAIGN_SEND);
  const job = await queue.getJob(`campaign-${campaignId}`);
  if (!job) return null;

  const state = await job.getState();
  const progress = job.progress || 0;
  return { state, progress, data: job.data, returnvalue: job.returnvalue };
}

// ── Clean up all queues (for graceful shutdown) ─────────────────
async function closeAll() {
  for (const q of Object.values(queues)) {
    await q.close();
  }
  queues = {};
}

module.exports = {
  QUEUE_NAMES,
  getQueue,
  queueCampaign,
  queueBatch,
  queueCompletion,
  queueCleanup,
  getQueueStats,
  getCampaignJobProgress,
  closeAll
};
