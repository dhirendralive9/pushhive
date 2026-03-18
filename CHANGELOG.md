# Changelog

All notable changes to PushHive will be documented in this file.

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
