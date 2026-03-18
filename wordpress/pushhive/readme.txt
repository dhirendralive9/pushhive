=== PushHive — Web Push Notifications ===
Contributors: pushhive
Tags: push notifications, web push, notifications, engagement, self-hosted
Requires at least: 5.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 2.8.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Self-hosted web push notifications for WordPress. Collect subscribers and send targeted notifications from your own PushHive server.

== Description ==

PushHive is a self-hosted, open source web push notification system. This plugin connects your WordPress site to your PushHive server, enabling:

* **Push notification subscriber collection** — visitors can opt-in to receive notifications
* **Automatic service worker setup** — no manual file editing required
* **In-app browser escape** — automatically redirects Facebook/Instagram in-app browser users to their real browser for subscription
* **iOS PWA support** — guided "Add to Home Screen" prompt for iOS users
* **Full integration** — manage campaigns, analytics, A/B tests, and automations from the PushHive dashboard

= Requirements =

* A self-hosted PushHive server (see [installation guide](https://github.com/dhirendralive9/pushhive))
* A site configured in your PushHive dashboard with an API key

= How it Works =

1. Install and activate the plugin
2. Go to Settings → PushHive
3. Enter your PushHive server URL and site API key
4. Enable the plugin
5. The service worker file is created automatically
6. Visitors will see a notification permission prompt

All notification sending, analytics, and subscriber management happens on your PushHive server dashboard.

== Installation ==

1. Upload the `pushhive` folder to `/wp-content/plugins/`
2. Activate the plugin through the Plugins menu
3. Go to Settings → PushHive and enter your server URL and API key

== Frequently Asked Questions ==

= Do I need a PushHive server? =
Yes. PushHive is self-hosted. You need to set up a PushHive server first. See the [GitHub repository](https://github.com/dhirendralive9/pushhive) for installation instructions.

= Does it work on mobile? =
Yes. Web push works on Android Chrome natively. On iOS Safari, users need to "Add to Home Screen" first — the plugin shows a guided prompt for this.

= Does it work with caching plugins? =
Yes. The PushHive script is loaded from your PushHive server, and the service worker is a static file — both work with any caching plugin.

= What about GDPR? =
Since PushHive is self-hosted, all subscriber data stays on your own server. You maintain full control over the data.

== Changelog ==

= 2.8.0 =
* Initial release
* Settings page with connection testing
* Auto service worker creation
* Script injection via wp_enqueue_scripts
* Service worker auto-cleanup on deactivation
