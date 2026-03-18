# PushHive 🐝

**Self-hosted, open source web push notification platform.**

A free, privacy-first alternative to OneSignal, PushEngage, Pushwoosh, and similar services. Host it on your own server, own your data, and send unlimited web push notifications — no per-subscriber pricing, no vendor lock-in, no data leaving your infrastructure.

PushHive gives you everything the paid services offer — A/B testing, drip campaigns, audience segments, webhooks, RSS automation, team management — running on your own server with a single install command.

---

## Why PushHive?

| | OneSignal / PushEngage | PushHive |
|---|---|---|
| **Pricing** | Free tier limits, then $9-$99+/mo | Free forever (self-hosted) |
| **Data ownership** | Their servers, their rules | Your server, your data |
| **Subscriber limit** | Capped per plan | Unlimited |
| **Vendor lock-in** | Proprietary APIs | Open source, MIT license |
| **GDPR compliance** | Shared infrastructure | Full control, single-tenant |
| **Customization** | Limited | Full source code access |

---

## Features

### Core Push Notifications
- **Web Push via VAPID** — Standard W3C Push API with VAPID authentication. No Firebase or Apple developer account required.
- **Cross-platform** — Works on Chrome, Firefox, Edge, Safari on desktop. Chrome, Firefox, Edge on Android. Safari on iOS (via PWA).
- **Multi-site support** — Manage multiple websites from a single PushHive installation. Each site gets its own API key, subscriber pool, and configuration.
- **Customizable permission prompts** — Three styles: top banner, center modal, or native browser prompt. Configurable delay, title, message, and button text per site.
- **Welcome notifications** — Automatically send a notification when someone subscribes. Configurable title, body, and click URL per site.
- **Notification actions** — Add up to 2 clickable buttons per notification (e.g., "Learn More", "Dismiss").
- **Large image support** — Attach hero images to notifications for higher engagement.

### In-App Browser Escape (Unique Feature)
- **Detects Facebook, Instagram, TikTok, LinkedIn, Twitter, WeChat, Snapchat, Pinterest, and Line in-app browsers** — These WebView browsers don't support service workers, so push subscriptions silently fail on every other platform.
- **Automatic redirect** — Android users are redirected to Chrome via `intent://`, iOS users to Safari via `x-safari-https://`. The subscription flow then works normally.
- **Configurable per site** — Toggle on/off from the site settings page.
- **Loop prevention** — Uses a query parameter to prevent infinite redirect loops.

### iOS Support
- **Guided "Add to Home Screen" prompt** — iOS Safari requires PWA mode for push notifications. PushHive detects iOS users and shows a step-by-step overlay explaining how to add the site to their home screen.
- **Works with iOS 16.4+** — Once added to the home screen, push notifications work like native app notifications.

### Campaign Management
- **Campaign composer** — Title, body, icon, large image, click URL, action buttons, all from a clean dashboard form.
- **UTM parameter builder** — Set utm_source, utm_medium, utm_campaign, utm_term, utm_content per campaign. Auto-appended to click URLs for Google Analytics tracking.
- **Scheduling** — Schedule campaigns for future delivery. The worker checks every 30 seconds and sends when the time arrives.
- **Campaign statuses** — Draft → Scheduled → Queued → Sending → Sent (or Failed). For A/B tests: AB Testing → AB Waiting → AB Sending Winner → Sent.
- **Duplicate campaigns** — One-click copy of any campaign with all settings preserved.
- **Campaign detail page** — Full analytics per campaign: targeted, delivered, clicked, CTR, failed counts. Click breakdown by browser, device, and time.

### A/B Testing
- **Two-variant testing** — Create variant A and variant B with different title, body, and icon.
- **Configurable test group** — Send the test to 5–50% of subscribers (split evenly between A and B).
- **Configurable wait period** — Wait 1–72 hours after the test send before evaluating the winner.
- **Winner metric** — Choose between click-through rate (CTR) or total clicks.
- **Automatic winner send** — After the wait period, the winning variant is automatically sent to all remaining subscribers who didn't receive the test.
- **Per-variant stats** — Sent, delivered, clicked, CTR displayed side-by-side with a winner badge.
- **Full API support** — Create A/B test campaigns via the REST API.

### Job Queue (BullMQ + Redis)
- **Asynchronous campaign processing** — Campaign sends return immediately. Workers process batches in the background.
- **Batch processing** — Subscribers split into batches of 500. Each batch processed with configurable concurrency (default: 10 parallel batches, 50 concurrent sends per batch).
- **Automatic retry** — Failed batches retry up to 3 times with exponential backoff.
- **Real-time progress tracking** — Queue dashboard page shows live progress bars for active campaigns.
- **Horizontal scaling** — Add more worker containers for higher throughput. `docker compose up -d --scale worker=4` gives you ~2000 sends/sec.
- **Expired subscription cleanup** — 410/404 responses trigger bulk deactivation of stale subscriptions.
- **4 specialized workers** — Campaign orchestrator, batch sender, completion finalizer, subscription cleanup.

### Advanced Segments
- **Visual rule builder** — Create segments with a point-and-click interface. Add rule groups, pick fields, operators, and values.
- **12 filterable fields** — Browser, OS, device type, tags, country, city, subscribed date, last active date, total clicks, total received, referrer URL, landing page URL.
- **12 operators** — Equals, not equals, contains, not contains, in list, not in list, greater than, less than, after date, before date, in last N days, not in last N days.
- **Nested logic** — Rule groups connected by AND/OR at both the group level and the top level.
- **Live preview** — "Preview Count" button shows matching subscriber count before saving.
- **Campaign targeting** — Select a saved segment as the target audience when creating a campaign.
- **Sample subscribers** — Segment detail page shows 10 sample matching subscribers.
- **Estimated count caching** — Counts cached and refreshed on view.
- **REST API** — Full CRUD for segments via `/api/v1/segments`.

### Automation / Drip Campaigns
- **Multi-step notification sequences** — Build a series of notifications sent automatically over time.
- **3 trigger types** — New subscriber, tag added to subscriber, manual enrollment.
- **Configurable delays** — Each step can wait N days, N hours, N minutes before sending.
- **Per-step conditions** — "Only send if clicked previous step", "Only if NOT clicked previous", "Subscriber has tag X", "Subscriber doesn't have tag X".
- **Step skipping** — When a condition isn't met, the step is skipped and the next one is scheduled.
- **Enrollment tracking** — Each subscriber's progress through the automation is tracked individually with status (active, completed, cancelled).
- **Funnel visualization** — Automation detail page shows a funnel chart with drop-off and CTR per step.
- **Activate/pause** — Pausing stops new enrollments but existing ones continue their sequence.
- **Auto-cancel** — Enrollments cancelled when a subscriber becomes inactive.

### Webhooks
- **7 event types** — `subscriber.new`, `subscriber.unsubscribe`, `campaign.sent`, `campaign.failed`, `notification.clicked`, `notification.dismissed`, `ab_test.winner`.
- **HMAC-SHA256 signing** — Every payload is signed with a per-webhook secret. Verify with `X-PushHive-Signature` header.
- **Reliable delivery** — Processed via BullMQ. 5 retries with exponential backoff. 10-second timeout per request.
- **Auto-disable** — Webhooks automatically disabled after 10 consecutive failures.
- **Delivery logs** — Every attempt logged with status code, response time, response body, and attempt count. Logs auto-expire after 30 days.
- **Test webhook** — Send a test payload to verify your endpoint.
- **Custom headers** — Add custom HTTP headers per webhook.
- **REST API** — Full CRUD for webhooks via `/api/v1/webhooks`.

### RSS-to-Push
- **Automatic notifications from RSS/Atom feeds** — When your blog publishes a new post, PushHive detects it and sends a push notification automatically.
- **RSS 2.0 and Atom support** — Zero-dependency XML parser handles both formats.
- **Configurable poll intervals** — 5 minutes to 24 hours.
- **Notification templates** — Use the RSS item's title and description, or set custom text. Optional title prefix (e.g., "New Post: ").
- **Image extraction** — Auto-extracts images from `media:content`, `media:thumbnail`, `enclosure`, or `<img>` tags in the RSS content.
- **Flood prevention** — Maximum 3 new items per poll. First poll establishes a baseline without sending.
- **Auto-disable** — Feeds disabled after 20 consecutive poll errors.
- **Manual poll** — "Poll Now" button for instant testing.
- **Feed validation** — Validates the feed URL on creation, shows item count and latest title.
- **Per-feed UTM parameters** — Track RSS-driven traffic separately in analytics.

### Multi-User & Roles
- **4 roles** with granular permissions:
  - **Super Admin** — Full access to everything. Cannot be deleted.
  - **Admin** — Full access. Can manage users, sites, and all features.
  - **Editor** — Can create/send campaigns, manage segments, view analytics. Cannot manage sites, webhooks, RSS feeds, or users.
  - **Viewer** — Read-only access to analytics and campaign results.
- **Invitation system** — Generate invite links (valid 7 days). Invitee sets their own password.
- **Site-level access control** — Restrict editors and viewers to specific sites.
- **Role-based sidebar** — Nav items hidden based on permissions.
- **Account management** — Enable/disable accounts, change roles, resend invites, delete users.
- **Protection rules** — Cannot delete own account, cannot delete super admin, only super admin can promote to super admin.

### WordPress Plugin
- **One-click installation** — Upload ZIP, activate, enter server URL and API key.
- **Auto service worker creation** — Creates `pushhive-sw.js` in WordPress root automatically. No FTP or file editing needed.
- **Connection testing** — Settings page tests the connection to your PushHive server and shows status.
- **Auto-cleanup** — Removes service worker on plugin deactivation.
- **Compatible with caching plugins** — Script loaded from external server, service worker is a static file.
- **Downloadable from dashboard** — The WordPress plugin ZIP is available for download directly from the site detail page in the PushHive dashboard.

### Analytics
- **Subscriber growth chart** — Daily new subscribers over configurable time periods (7, 30, 90 days).
- **Event breakdown** — Delivered, clicked, dismissed, failed counts.
- **Browser distribution** — Doughnut chart showing Chrome, Firefox, Safari, Edge, etc.
- **Device distribution** — Desktop vs mobile vs tablet breakdown.
- **UTM performance table** — Clicks grouped by utm_source, utm_medium, utm_campaign.
- **Per-campaign analytics** — Click timeline, browser breakdown, device breakdown per campaign.
- **Filterable by site** — All analytics can be filtered by specific site.

### Security
- **Helmet.js** — Security headers: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, HSTS, and more.
- **Login rate limiting** — 5 attempts per 15 minutes per IP.
- **Account lockout** — Locks after 10 failed password attempts for 30 minutes.
- **Cloudflare Turnstile** — Optional bot protection on login page. Add your Turnstile keys to `.env` to enable.
- **CSRF protection** — All dashboard forms protected with CSRF tokens.
- **MongoDB injection guard** — `express-mongo-sanitize` strips `$` operators from all inputs.
- **XSS sanitization** — HTML/script tags stripped from all string inputs.
- **Session fixation prevention** — Session ID regenerated on login.
- **Bcrypt password hashing** — 12 salt rounds.
- **Suspicious request logging** — Detects and logs NoSQL injection, SQL injection, XSS, and path traversal patterns.
- **Body size limits** — JSON and form data capped at 1MB.
- **Non-root Docker user** — App runs as `pushhive` user inside the container.

### Infrastructure
- **Docker-based** — MongoDB, Redis, App, and Worker run as Docker containers.
- **Docker health checks** — Auto-restart containers on failure. MongoDB and app health checked every 30 seconds.
- **Log rotation** — JSON log driver with 10MB max size, 3-5 file rotation.
- **Health endpoint** — `GET /health` returns status, version, uptime, MongoDB state, Redis state, memory usage.
- **Version endpoint** — `GET /version` returns current version.
- **One-command update** — `bash update.sh` pulls latest from GitHub, backs up data, rebuilds, and restarts.
- **Automatic backup** — Update script backs up `.env` and MongoDB before updating.
- **Horizontal scaling** — Scale workers with `docker compose up -d --scale worker=N`.
- **Any Linux distro** — Install script supports Ubuntu, Debian, CentOS, RHEL, Amazon Linux, Fedora, Alpine, Arch, openSUSE.
- **ARM64 support** — Works on ARM servers (Oracle Cloud, AWS Graviton, Raspberry Pi).

### REST API
Full programmatic access via `/api/v1`. All endpoints require an API key header (`X-API-Key`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/send` | Quick send notification (create + queue in one call) |
| GET | `/api/v1/campaigns` | List campaigns with pagination and status filter |
| POST | `/api/v1/campaigns` | Create campaign (with optional A/B test) |
| POST | `/api/v1/campaigns/:id/send` | Send/queue a campaign |
| GET | `/api/v1/campaigns/:id/stats` | Get campaign stats with CTR |
| GET | `/api/v1/campaigns/:id/progress` | Get live sending progress from queue |
| GET | `/api/v1/subscribers` | List subscribers with filters and pagination |
| GET | `/api/v1/subscribers/count` | Get active and total subscriber counts |
| POST | `/api/v1/subscribers/:id/tags` | Add tags to a subscriber |
| DELETE | `/api/v1/subscribers/:id/tags` | Remove tags from a subscriber |
| POST | `/api/v1/subscribers/cleanup` | Purge expired/invalid subscriptions |
| POST | `/api/v1/test/:subscriberId` | Send a test notification |
| GET | `/api/v1/analytics` | Get analytics data (growth, events, browser, device) |
| GET | `/api/v1/segments` | List saved segments |
| POST | `/api/v1/segments` | Create segment with rules |
| GET | `/api/v1/segments/:id` | Get segment with live count |
| DELETE | `/api/v1/segments/:id` | Delete segment |
| GET | `/api/v1/webhooks` | List webhooks |
| POST | `/api/v1/webhooks` | Create webhook |
| DELETE | `/api/v1/webhooks/:id` | Delete webhook |
| POST | `/api/v1/webhooks/:id/toggle` | Enable/disable webhook |

### SDK Endpoints (used by embedded JS)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subscribe` | Register push subscription |
| POST | `/api/unsubscribe` | Remove subscription |
| POST | `/api/track` | Track click/dismiss events |
| GET | `/api/config` | Get site configuration |

---

## Quick Install (Docker — Recommended)

```bash
git clone https://github.com/dhirendralive9/pushhive.git
cd pushhive
sudo bash install.sh
```

The installer will:
1. Detect your Linux distro and install Docker, Docker Compose, Nginx
2. Generate VAPID keys automatically
3. Prompt for domain, admin email, password (with confirmation)
4. Optionally configure Cloudflare Turnstile
5. Build and start 4 Docker containers (MongoDB, Redis, App, Worker)
6. Create your admin account in MongoDB
7. Configure Nginx reverse proxy with SSL (Let's Encrypt)
8. Display login credentials and security status

**Supports:** Ubuntu, Debian, CentOS, RHEL, Amazon Linux, Fedora, Alpine, Arch, openSUSE — both x86_64 and ARM64.

## Manual Docker Setup

```bash
git clone https://github.com/dhirendralive9/pushhive.git
cd pushhive
cp .env.example .env
```

Generate VAPID keys:
```bash
docker run --rm node:20-alpine sh -c "npm install web-push --silent && npx web-push generate-vapid-keys"
```

Edit `.env` with your VAPID keys, session secret, and other settings, then:
```bash
docker compose up -d
docker compose exec app node seed.js admin@example.com yourpassword Admin
```

## Manual Setup (Without Docker)

```bash
git clone https://github.com/dhirendralive9/pushhive.git
cd pushhive
npm install
cp .env.example .env
npx web-push generate-vapid-keys
```

Edit `.env`, then:
```bash
node seed.js admin@example.com yourpassword Admin
npm start
# In another terminal:
npm run worker
```

Note: Without Docker, you need MongoDB and Redis running separately.

---

## Embedding on Your Website

After adding a site in the dashboard, add this single line to your website:

```html
<script src="https://your-pushhive-server.com/sdk/pushhive.js"
        data-pushhive
        data-api-key="YOUR_API_KEY"></script>
```

Then create a file called `pushhive-sw.js` at your website's root with this single line:

```javascript
importScripts('https://your-pushhive-server.com/sdk/pushhive-sw.js');
```

**Where to put the service worker file:**

| Platform | Location |
|----------|----------|
| Static HTML | Same directory as `index.html` |
| WordPress | Use the PushHive WordPress plugin (auto-creates it) |
| React / Next.js | `/public` folder |
| Laravel / PHP | `/public` folder |
| Nginx / Apache | Webroot (e.g., `/var/www/html/`) |

---

## WordPress Installation

1. Download the plugin from your PushHive dashboard (Sites → your site → WordPress Plugin section)
2. In WordPress admin → Plugins → Add New → Upload Plugin
3. Upload the ZIP and activate
4. Go to Settings → PushHive
5. Enter your PushHive server URL and site API key
6. Check "Enable PushHive" and save

The plugin auto-creates the service worker file. No manual file editing needed.

---

## Updating

```bash
cd /opt/pushhive
sudo bash update.sh
```

The update script:
1. Backs up `.env` and MongoDB data
2. Pulls the latest code from GitHub
3. Preserves your `.env` and auto-adds any new config variables
4. Rebuilds Docker containers
5. Verifies everything is running
6. Shows version comparison and rollback instructions

---

## Configuration

All configuration is in the `.env` file:

```env
# Server
PORT=3000
MONGODB_URI=mongodb://mongo:27017/pushhive
SESSION_SECRET=<auto-generated>

# VAPID (generated during install — DO NOT LOSE)
VAPID_PUBLIC_KEY=<auto-generated>
VAPID_PRIVATE_KEY=<auto-generated>
VAPID_EMAIL=admin@example.com

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Workers
WORKER_CONCURRENCY=10    # Parallel batches per worker
WORKER_RATE_LIMIT=50     # Max batches per second

# Security (optional)
TURNSTILE_SITE_KEY=      # Cloudflare Turnstile
TURNSTILE_SECRET_KEY=
```

---

## Scaling

| Workers | Throughput | 1M subscribers |
|---------|-----------|----------------|
| 1 | ~500 sends/sec | ~33 minutes |
| 4 | ~2,000 sends/sec | ~8 minutes |
| 10 | ~5,000 sends/sec | ~3 minutes |

Scale workers:
```bash
docker compose up -d --scale worker=4
```

Or uncomment additional worker services in `docker-compose.yml` for persistent scaling.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express 4, Mongoose 8 |
| Database | MongoDB 7 |
| Queue | BullMQ, Redis 7 |
| Frontend | EJS, Custom CSS (dark theme), Chart.js |
| Push | W3C Web Push API, VAPID, Service Workers |
| Security | Helmet, bcrypt, express-rate-limit, CSRF, mongo-sanitize |
| Infrastructure | Docker, Docker Compose, Nginx, Let's Encrypt, PM2 (optional) |

---

## Project Structure

```
pushhive/
├── server.js                    # Express app entry point
├── worker.js                    # Queue worker process (campaigns, batches, webhooks, RSS, automations)
├── seed.js                      # Admin account seeder
├── install.sh                   # One-command Docker installer (any Linux distro)
├── update.sh                    # One-command updater from GitHub
├── Dockerfile                   # Node.js app container with health check
├── docker-compose.yml           # MongoDB + Redis + App + Worker
├── package.json
├── .env.example
├── CHANGELOG.md
│
├── models/
│   ├── Admin.js                 # Admin accounts with roles and invitations
│   ├── Site.js                  # Registered websites
│   ├── Subscriber.js            # Push subscriptions with device/browser/tag data
│   ├── Campaign.js              # Campaigns with A/B testing and segment targeting
│   ├── Event.js                 # Delivery/click/dismiss tracking events
│   ├── Segment.js               # Saved audience segments with query builder
│   ├── Webhook.js               # Webhook configurations
│   ├── WebhookLog.js            # Webhook delivery logs (TTL: 30 days)
│   ├── RssFeed.js               # RSS feed configurations
│   ├── Automation.js            # Drip campaign definitions
│   └── AutomationEnrollment.js  # Per-subscriber automation progress
│
├── routes/
│   ├── auth.js                  # Login, logout, invite acceptance
│   ├── dashboard.js             # Admin dashboard (all pages)
│   ├── api.js                   # SDK API (subscribe, unsubscribe, track)
│   ├── external-api.js          # REST API v1 (campaigns, subscribers, segments, webhooks)
│   └── sdk.js                   # JS SDK and service worker generator
│
├── services/
│   ├── queue.js                 # BullMQ queue definitions and job creators
│   ├── redis.js                 # Redis connection singleton
│   ├── scheduler.js             # Scheduled campaign checker
│   ├── notifications.js         # Push send helpers and stats
│   ├── webhooks.js              # Webhook event dispatcher and delivery worker
│   ├── rss.js                   # RSS/Atom feed parser and poller
│   └── automations.js           # Drip campaign enrollment and step processor
│
├── middleware/
│   ├── auth.js                  # Session auth and API key validation
│   ├── security.js              # Rate limiting, Turnstile, CSRF, sanitization, Helmet
│   └── roles.js                 # Role-based access control
│
├── views/pages/                 # 20+ EJS dashboard pages
├── public/                      # CSS and client-side JS
│
└── wordpress/
    ├── pushhive/
    │   ├── pushhive.php         # WordPress plugin
    │   └── readme.txt           # WP plugin readme
    └── pushhive-wp-plugin.zip   # Installable plugin ZIP
```

---

## Requirements

- Any Linux server (Ubuntu, Debian, CentOS, RHEL, Amazon Linux, Fedora, Alpine, Arch, openSUSE)
- 1GB RAM minimum (2GB+ recommended for production)
- Domain name with DNS pointing to your server
- Ports 80 and 443 open
- Docker will be installed automatically by the install script

---

## License

MIT — use it however you want. Free for personal and commercial use.

---

## Contributing

Contributions welcome! Please open an issue or pull request on [GitHub](https://github.com/dhirendralive9/pushhive).

---

## Support

- **Issues:** [GitHub Issues](https://github.com/dhirendralive9/pushhive/issues)
- **Docs:** API documentation available in the dashboard under API Docs page
