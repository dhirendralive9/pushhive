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

## Quick Install

```bash
git clone https://github.com/dhirendralive9/pushhive.git
cd pushhive
sudo bash install.sh
```

The installer will:
1. Install Node.js, MongoDB, Nginx, PM2
2. Generate VAPID keys automatically
3. Create your admin account in the database
4. Configure Nginx with SSL (Let's Encrypt)
5. Start the application with PM2

## Manual Setup

```bash
git clone https://github.com/dhirendralive9/pushhive.git
cd pushhive
npm install
cp .env.example .env
```

Generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

Edit `.env` with your settings, then:
```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./models/Admin');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  await new Admin({ email: 'you@example.com', password: 'yourpassword', name: 'Admin' }).save();
  console.log('Admin created');
  process.exit();
});
"
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
- **Frontend:** EJS, Tailwind-inspired CSS, Chart.js
- **Push:** Web Push API, VAPID, Service Workers
- **Infra:** PM2, Nginx, Let's Encrypt

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/subscribe` | API Key | Register push subscription |
| POST | `/api/unsubscribe` | API Key | Remove subscription |
| POST | `/api/track` | API Key | Track click/dismiss events |
| GET | `/api/config` | API Key | Get site config for SDK |

## Requirements

- Ubuntu 20.04+ / Debian 11+
- 1GB RAM minimum
- Domain name with DNS pointing to your server
- Ports 80 and 443 open

## Project Structure

```
pushhive/
├── server.js           # Express app entry point
├── install.sh          # One-command installer
├── package.json
├── .env.example
├── models/
│   ├── Admin.js        # Admin accounts
│   ├── Site.js         # Registered websites
│   ├── Subscriber.js   # Push subscriptions
│   ├── Campaign.js     # Notification campaigns
│   └── Event.js        # Tracking events
├── routes/
│   ├── auth.js         # Login/logout
│   ├── dashboard.js    # Admin dashboard
│   ├── api.js          # Public API
│   └── sdk.js          # JS SDK & service worker
├── middleware/
│   └── auth.js         # Session & API key auth
├── views/
│   ├── partials/
│   ├── pages/
│   └── layouts/
└── public/
    ├── css/
    └── js/
```

## License

MIT — use it however you want.
