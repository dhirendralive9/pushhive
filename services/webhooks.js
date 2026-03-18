const { Queue, Worker } = require('bullmq');
const { getConnection, createConnection } = require('./redis');
const Webhook = require('../models/Webhook');
const WebhookLog = require('../models/WebhookLog');

const QUEUE_NAME = 'webhook.deliver';
const MAX_FAIL_COUNT = 10; // Auto-disable after 10 consecutive failures

let queue = null;
let worker = null;

function getWebhookQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 24 * 3600, count: 5000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 10000 },
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 }
      }
    });
  }
  return queue;
}

// ── Fire a webhook event ────────────────────────────────────────
// Called from anywhere in the app: webhook.fire('subscriber.new', siteId, { data })
async function fire(eventName, siteId, data) {
  try {
    // Find all active webhooks for this site that listen for this event
    const webhooks = await Webhook.find({
      siteId,
      active: true,
      autoDisabled: false,
      events: eventName
    }).lean();

    if (webhooks.length === 0) return;

    const q = getWebhookQueue();
    const jobs = webhooks.map(wh =>
      q.add('deliver', {
        webhookId: wh._id.toString(),
        siteId: siteId.toString(),
        event: eventName,
        url: wh.url,
        secret: wh.secret,
        headers: wh.headers || {},
        payload: {
          event: eventName,
          timestamp: new Date().toISOString(),
          data
        }
      }, {
        jobId: `wh-${wh._id}-${Date.now()}`
      })
    );

    await Promise.all(jobs);
  } catch (err) {
    console.error(`[Webhook] Error firing ${eventName}:`, err.message);
  }
}

// ── Start the webhook delivery worker ───────────────────────────
function startWorker() {
  if (worker) return worker;

  worker = new Worker(QUEUE_NAME, async (job) => {
    const { webhookId, siteId, event, url, secret, headers, payload } = job.data;
    const startTime = Date.now();

    const crypto = require('crypto');
    const payloadStr = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

    const requestHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'PushHive-Webhook/2.0',
      'X-PushHive-Event': event,
      'X-PushHive-Signature': signature,
      'X-PushHive-Delivery': job.id,
      ...Object.fromEntries(headers instanceof Map ? headers : Object.entries(headers || {}))
    };

    let statusCode = 0;
    let responseBody = '';
    let success = false;
    let error = '';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body: payloadStr,
        signal: controller.signal
      });

      clearTimeout(timeout);
      statusCode = response.status;
      responseBody = await response.text().catch(() => '');
      if (responseBody.length > 2000) responseBody = responseBody.substring(0, 2000);

      success = statusCode >= 200 && statusCode < 300;

      if (!success) {
        error = `HTTP ${statusCode}`;
        throw new Error(error);
      }
    } catch (err) {
      error = err.message || 'Unknown error';
      if (err.name === 'AbortError') error = 'Timeout (10s)';

      // Update webhook fail count
      const wh = await Webhook.findById(webhookId);
      if (wh) {
        wh.failCount = (wh.failCount || 0) + 1;
        wh.lastError = error;
        wh.lastStatus = statusCode;
        wh.lastTriggered = new Date();

        if (wh.failCount >= MAX_FAIL_COUNT) {
          wh.autoDisabled = true;
          wh.autoDisabledAt = new Date();
          console.log(`[Webhook] Auto-disabled webhook ${wh.name} after ${MAX_FAIL_COUNT} failures`);
        }

        await wh.save();
      }

      // Log the failed attempt
      await WebhookLog.create({
        webhookId, siteId, event, url,
        payload, statusCode, responseBody,
        responseTime: Date.now() - startTime,
        success: false, error, attempt: job.attemptsMade + 1
      });

      throw new Error(error); // Triggers BullMQ retry
    }

    // Success — update webhook health
    await Webhook.findByIdAndUpdate(webhookId, {
      lastTriggered: new Date(),
      lastStatus: statusCode,
      lastError: '',
      failCount: 0,
      $inc: { successCount: 1 }
    });

    // Log successful delivery
    await WebhookLog.create({
      webhookId, siteId, event, url,
      payload, statusCode, responseBody,
      responseTime: Date.now() - startTime,
      success: true, attempt: job.attemptsMade + 1
    });

    return { statusCode, responseTime: Date.now() - startTime };

  }, {
    connection: createConnection(),
    concurrency: 5,
    limiter: { max: 20, duration: 1000 } // Max 20 webhook deliveries per second
  });

  worker.on('failed', (job, err) => {
    if (job.attemptsMade >= job.opts.attempts) {
      console.error(`[Webhook] Delivery permanently failed: ${job.data.event} → ${job.data.url}: ${err.message}`);
    }
  });

  worker.on('error', (err) => {
    console.error('[Webhook Worker] Error:', err.message);
  });

  console.log('✓ Webhook delivery worker started');
  return worker;
}

async function close() {
  if (worker) await worker.close();
  if (queue) await queue.close();
  worker = null;
  queue = null;
}

module.exports = { fire, startWorker, close, getWebhookQueue };
