const Campaign = require('../models/Campaign');
const { queueCampaign, getCampaignJobProgress } = require('./queue');

class Scheduler {
  constructor() {
    this.interval = null;
  }

  start(intervalMs = 30000) {
    console.log('✓ Campaign scheduler started (checking every 30s)');
    this.interval = setInterval(() => this.checkScheduled(), intervalMs);
    this.checkScheduled();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkScheduled() {
    try {
      const now = new Date();
      const dueCampaigns = await Campaign.find({
        status: 'scheduled',
        scheduledAt: { $lte: now }
      });

      for (const campaign of dueCampaigns) {
        console.log(`[Scheduler] Queuing scheduled campaign: ${campaign.title}`);
        campaign.status = 'queued';
        await campaign.save();
        await queueCampaign(campaign._id);
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err.message);
    }
  }

  // Send a campaign immediately via queue
  async sendCampaign(campaign) {
    campaign.status = 'queued';
    await campaign.save();
    return queueCampaign(campaign._id);
  }

  // Check campaign progress
  async getProgress(campaignId) {
    return getCampaignJobProgress(campaignId);
  }
}

module.exports = new Scheduler();
