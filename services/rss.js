const RssFeed = require('../models/RssFeed');
const Campaign = require('../models/Campaign');
const { queueCampaign } = require('./queue');

// ── Lightweight RSS/Atom parser (no dependencies) ───────────────
function parseXml(xml) {
  const items = [];
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

  if (isAtom) {
    // Atom feed
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const entry of entries) {
      items.push({
        title: extractTag(entry, 'title'),
        link: extractAtomLink(entry),
        description: extractTag(entry, 'summary') || extractTag(entry, 'content'),
        pubDate: extractTag(entry, 'published') || extractTag(entry, 'updated'),
        guid: extractTag(entry, 'id') || extractAtomLink(entry),
        image: extractImage(entry)
      });
    }
  } else {
    // RSS 2.0
    const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const item of rssItems) {
      items.push({
        title: extractTag(item, 'title'),
        link: extractTag(item, 'link'),
        description: stripHtml(extractTag(item, 'description')),
        pubDate: extractTag(item, 'pubDate') || extractTag(item, 'dc:date'),
        guid: extractTag(item, 'guid') || extractTag(item, 'link'),
        image: extractImage(item)
      });
    }
  }

  return items;
}

function extractTag(xml, tag) {
  // Handle CDATA
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function extractAtomLink(entry) {
  // <link href="..." rel="alternate" />
  const match = entry.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*\/?>/i)
    || entry.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i)
    || entry.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return match ? match[1] : '';
}

function extractImage(content) {
  // Try media:content, media:thumbnail, enclosure, or <img> in description
  const mediaMatch = content.match(/<media:content[^>]*url=["']([^"']+)["']/i)
    || content.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i)
    || content.match(/<enclosure[^>]*url=["']([^"']+\.(jpg|jpeg|png|gif|webp))[^"']*["']/i)
    || content.match(/<img[^>]*src=["']([^"']+)["']/i);
  return mediaMatch ? mediaMatch[1] : '';
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 250);
}

// ── Poll a single feed ──────────────────────────────────────────
async function pollFeed(feed) {
  try {
    const response = await fetch(feed.feedUrl, {
      headers: { 'User-Agent': 'PushHive-RSS/2.4 (+https://github.com/dhirendralive9/pushhive)' },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const items = parseXml(xml);

    if (items.length === 0) {
      feed.lastPolledAt = new Date();
      await feed.save();
      return { feed: feed.name, newItems: 0 };
    }

    // Find new items since last poll
    let newItems = [];

    if (feed.lastItemGuid) {
      // Find items newer than the last seen one
      const lastIdx = items.findIndex(i => i.guid === feed.lastItemGuid || i.link === feed.lastItemGuid);
      if (lastIdx > 0) {
        newItems = items.slice(0, lastIdx);
      } else if (lastIdx === -1) {
        // Last item not found — could be feed restructured; take first item only
        newItems = items.slice(0, 1);
      }
      // lastIdx === 0 means no new items
    } else if (feed.lastItemDate) {
      const lastDate = new Date(feed.lastItemDate);
      newItems = items.filter(i => i.pubDate && new Date(i.pubDate) > lastDate);
    } else {
      // First poll — don't spam all items, just mark the latest as seen
      feed.lastItemGuid = items[0].guid || items[0].link;
      feed.lastItemDate = items[0].pubDate ? new Date(items[0].pubDate) : new Date();
      feed.lastPolledAt = new Date();
      feed.errorCount = 0;
      feed.lastError = '';
      await feed.save();
      return { feed: feed.name, newItems: 0, message: 'First poll — marked latest item as baseline' };
    }

    if (newItems.length === 0) {
      feed.lastPolledAt = new Date();
      feed.errorCount = 0;
      feed.lastError = '';
      await feed.save();
      return { feed: feed.name, newItems: 0 };
    }

    // Limit to 3 new items max per poll to avoid spam
    newItems = newItems.slice(0, 3);

    // Create campaigns for each new item
    const campaigns = [];
    for (const item of newItems) {
      const title = feed.template.titleField === 'custom'
        ? feed.template.customTitle
        : (feed.template.titlePrefix || '') + (item.title || 'New Post');

      const body = feed.template.bodyField === 'custom'
        ? feed.template.customBody
        : (item.description || 'Check out our latest update');

      const image = feed.template.extractImage
        ? (item.image || feed.template.image || '')
        : (feed.template.image || '');

      const campaign = new Campaign({
        siteId: feed.siteId,
        title: title.substring(0, 100),
        body: body.substring(0, 250),
        url: item.link || feed.feedUrl,
        icon: feed.template.icon || '',
        image,
        utm: {
          source: feed.utm.source || 'pushhive',
          medium: feed.utm.medium || 'web_push',
          campaign: feed.utm.campaign || 'rss_auto'
        },
        targetAll: feed.targetAll,
        targetTags: feed.targetTags || [],
        status: 'queued'
      });

      await campaign.save();
      await queueCampaign(campaign._id);

      campaigns.push(campaign._id);
      console.log(`[RSS] Auto-campaign created: "${title}" → ${item.link}`);
    }

    // Update feed state
    feed.lastItemGuid = items[0].guid || items[0].link;
    feed.lastItemDate = items[0].pubDate ? new Date(items[0].pubDate) : new Date();
    feed.lastPolledAt = new Date();
    feed.errorCount = 0;
    feed.lastError = '';
    feed.totalSent += campaigns.length;
    feed.campaignIds.push(...campaigns);
    await feed.save();

    return { feed: feed.name, newItems: newItems.length, campaigns: campaigns.length };

  } catch (err) {
    feed.errorCount = (feed.errorCount || 0) + 1;
    feed.lastError = err.message;
    feed.lastPolledAt = new Date();

    // Auto-disable after 20 consecutive errors
    if (feed.errorCount >= 20) {
      feed.autoDisabled = true;
      console.log(`[RSS] Auto-disabled feed "${feed.name}" after 20 errors`);
    }

    await feed.save();
    console.error(`[RSS] Poll failed for "${feed.name}": ${err.message}`);
    return { feed: feed.name, error: err.message };
  }
}

// ── Poll all active feeds that are due ──────────────────────────
async function pollAllFeeds() {
  const now = new Date();

  const feeds = await RssFeed.find({ active: true, autoDisabled: false });
  let polled = 0;

  for (const feed of feeds) {
    // Check if enough time has passed since last poll
    if (feed.lastPolledAt) {
      const elapsed = (now - feed.lastPolledAt) / 60000; // minutes
      if (elapsed < feed.pollInterval) continue;
    }

    polled++;
    await pollFeed(feed);

    // Small delay between feeds to be nice to servers
    await new Promise(r => setTimeout(r, 500));
  }

  return { totalFeeds: feeds.length, polled };
}

// ── Validate a feed URL (test parse) ────────────────────────────
async function validateFeed(feedUrl) {
  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'PushHive-RSS/2.4' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const xml = await response.text();
    const items = parseXml(xml);

    if (items.length === 0) throw new Error('No items found in feed');

    return {
      valid: true,
      itemCount: items.length,
      latestTitle: items[0].title,
      latestLink: items[0].link,
      latestDate: items[0].pubDate
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = { pollFeed, pollAllFeeds, validateFeed, parseXml };
