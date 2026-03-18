# Changelog

All notable changes to PushHive will be documented in this file.

## [2.4.0] - 2026-03-18

### Added
- **RSS-to-Push** — automatically send push notifications when RSS/Atom feeds publish new content
  - Supports both RSS 2.0 and Atom feed formats
  - Zero-dependency XML parser (no external libraries)
  - Configurable poll intervals (5 min to 24 hours)
  - Notification template system: use RSS title/description or set custom text, optional title prefix
  - Auto-extract images from `media:content`, `media:thumbnail`, `enclosure`, or `<img>` tags
  - UTM parameters per feed for analytics tracking
  - Target all subscribers or specific tags per feed
  - First poll establishes baseline — doesn't spam all existing items
  - Max 3 new items per poll to prevent notification flooding
  - Auto-disable after 20 consecutive poll failures
  - Manual "Poll Now" button for instant testing
  - Feed validation on creation (checks URL, parses items, shows latest title)
  - Feed detail page with configuration view and recent auto-created campaigns
  - Dashboard pages for managing feeds (add, toggle, delete, view)
  - RSS nav item in sidebar

### Changed
- Worker process now includes RSS feed poller (checks every 60 seconds)
- Version bumped to 2.4.0

## [2.0.0] - 2026-03-18

### Added
- **BullMQ + Redis job queue** — campaigns are now processed asynchronously via a dedicated worker process
  - Campaign sends return immediately (queued), workers process batches in the background
  - Batches of 500 subscribers sent with configurable concurrency (default: 10 parallel batches)
  - Automatic retry with exponential backoff (3 attempts per failed batch)
  - Progress tracking: real-time percentage visible in dashboard and via API
  - Bulk deactivation of expired subscriptions (410/404) in single MongoDB operation
- **A/B Testing** — split test notifications to optimize engagement
  - Create two variants (A and B) with different title, body, and icon
  - Configurable test group size (5%-50% of subscribers)
  - Configurable wait period (1-72 hours) before picking winner
  - Winner decided by CTR or total clicks
  - Automatic winner send to remaining subscribers after wait period
  - Per-variant stats: sent, delivered, clicked, CTR
  - A/B badge and results panel on campaign detail page
  - Full A/B support in REST API
- **Separate worker process** (`worker.js`) — runs independently from the API server
  - 4 specialized workers: campaign orchestrator, batch sender, completion finalizer, subscription cleanup
  - A/B test orchestrator: splits test group, queues variant-specific batches, schedules winner evaluation
  - Configurable concurrency via `WORKER_CONCURRENCY` env var
  - Graceful shutdown on SIGTERM/SIGINT
- **Redis** added to Docker stack — used for job queue, future caching
  - Persistent storage with AOF, 256MB memory limit
  - Health check integrated
- **Queue status dashboard** — new "Queue" page in admin panel
  - Live stats, active campaign progress bars with auto-refresh
  - Queue breakdown table, scaling guide with throughput estimates
- **Horizontal scaling** — `docker compose up -d --scale worker=4`
- **Campaign progress API** — `GET /api/v1/campaigns/:id/progress`
- **New campaign statuses**: `queued`, `ab_testing`, `ab_waiting`, `ab_sending_winner`
- **Webhooks** — real-time HTTP callbacks for event-driven integrations
  - 7 event types: `subscriber.new`, `subscriber.unsubscribe`, `campaign.sent`, `campaign.failed`, `notification.clicked`, `notification.dismissed`, `ab_test.winner`
  - HMAC-SHA256 payload signing with per-webhook secret key
  - 5 retries with exponential backoff per delivery
  - Auto-disable after 10 consecutive failures
  - Delivery logs with status codes, response times, attempt counts (auto-expire after 30 days)
  - Dashboard: create, toggle, delete, test webhooks; view delivery logs
  - REST API: full webhook CRUD via `/api/v1/webhooks`
  - Rate limited: max 20 deliveries/second

### Changed
- Campaign sends are now non-blocking (returns immediately with job ID)
- Health check endpoint now includes Redis connection status
- Scheduler service is now a thin wrapper that queues campaigns via Bull instead of processing them in-process
- Notifications service refactored to use queue for bulk operations, direct sends for test notifications
- Events are created with `Event.create()` (fire-and-forget) instead of `new Event().save()` for better performance
- Subscriber deactivation uses bulk `updateMany` instead of individual updates

### Infrastructure
- Docker Compose now runs 4 services: mongo, redis, app, worker
- Redis data persisted in `redis_data` Docker volume

## [1.1.0] - 2026-03-18

### Added
- **Versioning system** — `/health` and `/version` endpoints for version detection
- **Docker health checks** — auto-restart on container failure
- **Update script** (`update.sh`) — one-command updates from GitHub with automatic backup
- **Security: Cloudflare Turnstile** — optional bot protection on login page
- **Security: Login rate limiting** — 5 attempts per 15 minutes per IP
- **Security: Account lockout** — locks after 10 failed login attempts for 30 minutes
- **Security: CSRF protection** — on all dashboard forms
- **Security: Helmet.js** — security headers (XSS, clickjacking, MIME sniffing, CSP)
- **Security: MongoDB injection guard** — sanitizes all inputs
- **Security: XSS sanitization** — strips HTML/script tags from inputs
- **Security: Session fixation prevention** — regenerates session ID on login
- **Security: Suspicious request logging** — detects injection patterns
- **REST API v1** — full programmatic access (`/api/v1`)
  - Quick send, campaign CRUD, subscriber management, analytics
  - Tag management, stale subscription cleanup, test notifications
- **API Docs page** — interactive docs in dashboard with real API keys and site selector
- **Campaign scheduler** — automatic sending of scheduled campaigns
- **Campaign duplicate & delete** — from dashboard
- **Notification service** — reusable send logic, cleanup, live stats
- **Log rotation** — Docker JSON log driver with size limits
- **Version display** — shown in dashboard sidebar

### Changed
- Install script now uses Docker (no more MongoDB repo issues)
- VAPID keys generated using local Node.js (faster, no Docker pull needed)
- Service worker setup instructions rewritten with platform-specific examples
- Password prompt now requires confirmation + shows credentials at end of install

## [1.0.0] - 2026-03-18

### Initial Release
- Web push notifications via VAPID/Web Push API
- Multi-site support with API keys
- Campaign management with UTM tracking
- Subscriber management with browser/device/OS detection
- Click, delivery, and dismiss analytics with Chart.js
- In-app browser escape (Facebook, Instagram, TikTok, etc.)
- iOS "Add to Home Screen" guided prompt
- Customizable permission prompts (banner, modal, native)
- Welcome notifications on subscribe
- Admin dashboard with EJS + dark theme
- Session-based auth with MongoDB store
- One-command Docker install script
- Nginx reverse proxy with SSL (Let's Encrypt)
