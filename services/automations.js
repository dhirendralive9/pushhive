const Automation = require('../models/Automation');
const AutomationEnrollment = require('../models/AutomationEnrollment');
const Subscriber = require('../models/Subscriber');
const Campaign = require('../models/Campaign');
const Event = require('../models/Event');
const { queueCampaign } = require('./queue');
const webpush = require('web-push');

// ── Enroll a subscriber into matching automations ───────────────
async function enrollSubscriber(triggerType, siteId, subscriberId, triggerValue = '') {
  try {
    const filter = {
      siteId,
      active: true,
      'trigger.type': triggerType
    };
    if (triggerType === 'tag.added' && triggerValue) {
      filter['trigger.value'] = triggerValue;
    }

    const automations = await Automation.find(filter);

    for (const automation of automations) {
      if (automation.steps.length === 0) continue;

      // Check if already enrolled
      const existing = await AutomationEnrollment.findOne({
        automationId: automation._id,
        subscriberId
      });
      if (existing) continue;

      const firstStep = automation.steps[0];
      const delayMs = firstStep.getTotalDelayMs();

      const enrollment = new AutomationEnrollment({
        automationId: automation._id,
        subscriberId,
        siteId,
        currentStep: 0,
        status: 'active',
        nextStepAt: new Date(Date.now() + delayMs)
      });

      await enrollment.save();
      await Automation.findByIdAndUpdate(automation._id, { $inc: { totalEnrolled: 1 } });

      console.log(`[Automation] Enrolled subscriber ${subscriberId} in "${automation.name}" — first step in ${delayMs / 60000} min`);
    }
  } catch (err) {
    console.error('[Automation] Enrollment error:', err.message);
  }
}

// ── Process all due automation steps ────────────────────────────
async function processDueSteps() {
  const now = new Date();

  const dueEnrollments = await AutomationEnrollment.find({
    status: 'active',
    nextStepAt: { $lte: now }
  }).limit(100); // Process 100 at a time

  if (dueEnrollments.length === 0) return { processed: 0 };

  let processed = 0, sent = 0, skipped = 0;

  for (const enrollment of dueEnrollments) {
    try {
      const automation = await Automation.findById(enrollment.automationId);
      if (!automation || !automation.active) {
        enrollment.status = 'cancelled';
        enrollment.cancelledAt = new Date();
        await enrollment.save();
        continue;
      }

      const stepIndex = enrollment.currentStep;
      if (stepIndex >= automation.steps.length) {
        // All steps done
        enrollment.status = 'completed';
        enrollment.completedAt = new Date();
        await enrollment.save();
        await Automation.findByIdAndUpdate(automation._id, { $inc: { totalCompleted: 1 } });
        continue;
      }

      const step = automation.steps[stepIndex];
      const subscriber = await Subscriber.findById(enrollment.subscriberId);

      if (!subscriber || !subscriber.active) {
        enrollment.status = 'cancelled';
        enrollment.cancelledAt = new Date();
        await enrollment.save();
        continue;
      }

      // Check step condition
      const shouldSend = await checkCondition(step, enrollment, subscriber);
      if (!shouldSend) {
        // Skip this step, move to next
        enrollment.stepsSent.push({
          stepOrder: step.order,
          stepId: step._id,
          sentAt: new Date(),
          clicked: false
        });

        await Automation.findOneAndUpdate(
          { _id: automation._id, 'steps._id': step._id },
          { $inc: { 'steps.$.stats.skipped': 1 } }
        );

        skipped++;
        advanceToNextStep(enrollment, automation, stepIndex);
        await enrollment.save();
        continue;
      }

      // Send the notification
      webpush.setVapidDetails(
        `mailto:${process.env.VAPID_EMAIL}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );

      const notificationUrl = buildStepUrl(step, automation);
      const payload = JSON.stringify({
        title: step.title,
        body: step.body,
        icon: step.icon || '',
        image: step.image || '',
        url: notificationUrl,
        campaignId: `auto-${automation._id}-${step._id}`,
        siteId: automation.siteId.toString(),
        automationId: automation._id.toString(),
        stepId: step._id.toString()
      });

      try {
        await webpush.sendNotification(subscriber.subscription, payload);

        enrollment.stepsSent.push({
          stepOrder: step.order,
          stepId: step._id,
          sentAt: new Date(),
          clicked: false
        });

        await Automation.findOneAndUpdate(
          { _id: automation._id, 'steps._id': step._id },
          { $inc: { 'steps.$.stats.sent': 1 } }
        );

        // Log event
        Event.create({
          siteId: automation.siteId,
          campaignId: automation._id, // Use automation ID as campaign ref
          subscriberId: subscriber._id,
          type: 'delivered',
          browser: subscriber.browser,
          os: subscriber.os,
          device: subscriber.device
        }).catch(() => {});

        sent++;
      } catch (pushErr) {
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          await Subscriber.findByIdAndUpdate(subscriber._id, { active: false, unsubscribedAt: new Date() });
          enrollment.status = 'cancelled';
          enrollment.cancelledAt = new Date();
          await enrollment.save();
          continue;
        }
      }

      // Advance to next step
      advanceToNextStep(enrollment, automation, stepIndex);
      await enrollment.save();
      processed++;

    } catch (err) {
      console.error(`[Automation] Step processing error for enrollment ${enrollment._id}:`, err.message);
    }
  }

  if (processed > 0 || skipped > 0) {
    console.log(`[Automation] Processed ${processed} steps, sent ${sent}, skipped ${skipped}`);
  }

  return { processed, sent, skipped };
}

function advanceToNextStep(enrollment, automation, currentIndex) {
  const nextIndex = currentIndex + 1;
  if (nextIndex >= automation.steps.length) {
    enrollment.currentStep = nextIndex;
    enrollment.status = 'completed';
    enrollment.completedAt = new Date();
    Automation.findByIdAndUpdate(automation._id, { $inc: { totalCompleted: 1 } }).catch(() => {});
  } else {
    const nextStep = automation.steps[nextIndex];
    const delayMs = nextStep.getTotalDelayMs();
    enrollment.currentStep = nextIndex;
    enrollment.nextStepAt = new Date(Date.now() + delayMs);
  }
}

async function checkCondition(step, enrollment, subscriber) {
  if (!step.condition || step.condition.type === 'none') return true;

  switch (step.condition.type) {
    case 'clicked_previous': {
      if (enrollment.stepsSent.length === 0) return true;
      const lastStep = enrollment.stepsSent[enrollment.stepsSent.length - 1];
      return lastStep.clicked === true;
    }
    case 'not_clicked_previous': {
      if (enrollment.stepsSent.length === 0) return true;
      const lastStep = enrollment.stepsSent[enrollment.stepsSent.length - 1];
      return lastStep.clicked !== true;
    }
    case 'has_tag':
      return subscriber.tags && subscriber.tags.includes(step.condition.value);
    case 'not_has_tag':
      return !subscriber.tags || !subscriber.tags.includes(step.condition.value);
    default:
      return true;
  }
}

function buildStepUrl(step, automation) {
  try {
    const urlObj = new URL(step.url);
    urlObj.searchParams.set('utm_source', automation.utm.source || 'pushhive');
    urlObj.searchParams.set('utm_medium', automation.utm.medium || 'web_push');
    urlObj.searchParams.set('utm_campaign', automation.utm.campaign || 'drip');
    urlObj.searchParams.set('utm_content', `step_${step.order}`);
    return urlObj.toString();
  } catch {
    return step.url;
  }
}

// ── Get stats for an automation ─────────────────────────────────
async function getAutomationStats(automationId) {
  const [active, completed, cancelled] = await Promise.all([
    AutomationEnrollment.countDocuments({ automationId, status: 'active' }),
    AutomationEnrollment.countDocuments({ automationId, status: 'completed' }),
    AutomationEnrollment.countDocuments({ automationId, status: 'cancelled' })
  ]);
  return { active, completed, cancelled, total: active + completed + cancelled };
}

module.exports = { enrollSubscriber, processDueSteps, getAutomationStats };
