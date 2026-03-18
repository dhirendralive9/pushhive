# PushHive 🐝

**Self-hosted, open source web push notification system.**

A free alternative to OneSignal, PushEngage, and similar services. Host it yourself, own your data, and send unlimited web push notifications.

## Features

- **Web Push Notifications** — Works on Chrome, Firefox, Edge, Safari (desktop & mobile)
- **Multi-Site Support** — Manage multiple websites from one dashboard
- **Campaign Management** — Compose, schedule, and send notifications
- **UTM Tracking** — Built-in UTM parameter support for analytics
- **Click Analytics** — Track deliveries, clicks, CTR by browser, device, and OS
- **In-App Browser Escape** — Automatically redirects users from Facebook/Instagram's in-app browser to their real browser for subscription
- **iOS PWA Support** — Guided "Add to Home Screen" prompt for iOS users
- **Subscriber Segmentation** — Filter and target by tags, device, browser
- **Welcome Notifications** — Auto-send on new subscription
- **Customizable Prompts** — Banner, modal, or native browser prompt
- **REST API** — Programmatic access for all operations
- **One-Command Install** — Full setup script with SSL

## Quick Install (Docker — Recommended)

```bash
git clone https://github.com/yourusername/pushhive.git
cd pushhive
sudo bash install.sh
```

The installer will:
1. Install Docker & Docker Compose (if not present)
2. Install Nginx for reverse proxy
3. Generate VAPID keys automatically
4. Build and start containers (Node.js app + MongoDB)
5. Create your admin account in MongoDB
6. Configure Nginx with SSL (Let's Encrypt)

**Requirements:** Any Linux server (Ubuntu, Debian, CentOS, etc.) with 1GB+ RAM. Works on x86_64 and ARM64.

## Manual Docker Setup

```bash
git clone https://github.com/yourusername/pushhive.git
cd pushhive
cp .env.example .env
```

Generate VAPID keys:
```bash
docker run --rm node:20-alpine sh -c "npm install web-push --silent && npx web-push generate-vapid-keys"
```

Edit `.env` with your VAPID keys and session secret, then:
```bash
docker compose up -d
docker compose exec app node seed.js admin@example.com yourpassword Admin
```

## Manual Setup (Without Docker)

```bash
git clone https://github.com/yourusername/pushhive.git
cd pushhive
npm install
cp .env.example .env
npx web-push generate-vapid-keys
```

Edit `.env` with your settings, then:
```bash
node seed.js admin@example.com yourpassword Admin
npm start
```

## Embedding on Your Website

After adding a site in the dashboard, add this to your website:

```html
<script src="https://your-pushhive-server.com/sdk/pushhive.js"
        data-pushhive
        data-api-key="YOUR_API_KEY"></script>
```

And create a service worker file at your website root (`/pushhive-sw.js`):
```javascript
importScripts('https://your-pushhive-server.com/sdk/pushhive-sw.js');
```

## Tech Stack

- **Backend:** Node.js, Express, MongoDB, Mongoose
- **Frontend:** EJS, Custom CSS (dark theme), Chart.js
- **Push:** Web Push API, VAPID, Service Workers
- **Infra:** Docker, Docker Compose, Nginx, Let's Encrypt

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/subscribe` | API Key | Register push subscription |
| POST | `/api/unsubscribe` | API Key | Remove subscription |
| POST | `/api/track` | API Key | Track click/dismiss events |
| GET | `/api/config` | API Key | Get site config for SDK |

## Requirements

- Any Linux server (Ubuntu, Debian, CentOS, Amazon Linux, etc.)
- 1GB RAM minimum
- Domain name with DNS pointing to your server
- Ports 80 and 443 open
- Docker will be installed automatically if not present

## Project Structure

```
pushhive/
├── server.js              # Express app entry point
├── seed.js                # Admin account seeder
├── install.sh             # One-command Docker installer
├── Dockerfile             # Node.js app container
├── docker-compose.yml     # App + MongoDB orchestration
├── package.json
├── .env.example
├── models/
│   ├── Admin.js           # Admin accounts
│   ├── Site.js            # Registered websites
│   ├── Subscriber.js      # Push subscriptions
│   ├── Campaign.js        # Notification campaigns
│   └── Event.js           # Tracking events
├── routes/
│   ├── auth.js            # Login/logout
│   ├── dashboard.js       # Admin dashboard
│   ├── api.js             # SDK API (subscribe/track)
│   ├── external-api.js    # REST API v1
│   └── sdk.js             # JS SDK & service worker
├── services/
│   ├── scheduler.js       # Campaign scheduler (cron)
│   └── notifications.js   # Push send helpers
├── middleware/
│   └── auth.js            # Session & API key auth
├── views/
│   ├── partials/
│   └── pages/
└── public/
    ├── css/
    └── js/
```

## License

MIT — use it however you want.
