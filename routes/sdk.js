const express = require('express');
const router = express.Router();

// Custom CORS for SDK — must allow cross-origin script loading
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Serve PushHive JS SDK ───────────────────────────────────────
const pkg = require('../package.json');
const crypto = require('crypto');

router.get('/pushhive.js', (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const sdkContent = generateSDK(serverUrl);
  const etag = crypto.createHash('md5').update(sdkContent).digest('hex');

  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('ETag', `"${etag}"`);
  // Short cache (5 min) so Cloudflare refreshes frequently, but still caches
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.set('X-PushHive-Version', pkg.version);

  // Return 304 if content unchanged
  if (req.headers['if-none-match'] === `"${etag}"`) {
    return res.status(304).end();
  }

  res.send(sdkContent);
});

// ── Serve Service Worker ────────────────────────────────────────
router.get('/pushhive-sw.js', (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const swContent = generateServiceWorker(serverUrl);
  const etag = crypto.createHash('md5').update(swContent).digest('hex');

  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Service-Worker-Allowed', '/');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('ETag', `"${etag}"`);
  // Service worker should never be cached long — browsers check for updates
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.set('X-PushHive-Version', pkg.version);

  if (req.headers['if-none-match'] === `"${etag}"`) {
    return res.status(304).end();
  }

  res.send(swContent);
});

// ── Serve manifest.json for PWA (required for iOS push) ─────────
router.get('/manifest.json', (req, res) => {
  const apiKey = req.query.apiKey || '';
  const Site = require('../models/Site');

  Site.findOne({ apiKey, active: true }).then(site => {
    const name = site ? site.name : 'Web App';
    const domain = site ? site.domain : req.get('host');

    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      name: name,
      short_name: name.substring(0, 12),
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#6366f1',
      icons: [
        { src: (site && site.icon) || '/favicon.ico', sizes: '192x192', type: 'image/png' },
        { src: (site && site.icon) || '/favicon.ico', sizes: '512x512', type: 'image/png' }
      ]
    });
  }).catch(() => {
    res.json({
      name: 'Web App', short_name: 'App', start_url: '/',
      display: 'standalone', background_color: '#ffffff', theme_color: '#6366f1',
      icons: [{ src: '/favicon.ico', sizes: '192x192', type: 'image/png' }]
    });
  });
});

function generateSDK(serverUrl) {
  var vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
  return `
(function() {
  'use strict';

  var PushHive = {
    serverUrl: '${serverUrl}',
    vapidPublicKey: '${vapidPublicKey}',
    apiKey: null,
    siteConfig: null,

    init: function(config) {
      this.apiKey = config.apiKey;
      if (!this.apiKey) { console.error('[PushHive] API key required'); return; }

      var ua = navigator.userAgent || '';
      var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
      var isStandalone = window.navigator.standalone === true ||
                         window.matchMedia('(display-mode: standalone)').matches;

      // Inject manifest.json link if not already present (required for iOS PWA)
      if (!document.querySelector('link[rel="manifest"]')) {
        var manifestLink = document.createElement('link');
        manifestLink.rel = 'manifest';
        manifestLink.href = PushHive.serverUrl + '/sdk/manifest.json?apiKey=' + this.apiKey;
        document.head.appendChild(manifestLink);
        console.log('[PushHive] Manifest injected for PWA support');
      }

      // Also inject apple-mobile-web-app meta tags for iOS
      if (isIOS && !document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
        var meta1 = document.createElement('meta');
        meta1.name = 'apple-mobile-web-app-capable';
        meta1.content = 'yes';
        document.head.appendChild(meta1);
        var meta2 = document.createElement('meta');
        meta2.name = 'apple-mobile-web-app-status-bar-style';
        meta2.content = 'default';
        document.head.appendChild(meta2);
      }

      // 1. Check for social media in-app browsers (FB, IG, TikTok etc.)
      if (this.isInAppBrowser()) {
        this.fetchConfig(function(cfg) {
          if (cfg && cfg.inAppBrowserRedirect) {
            PushHive.escapeInAppBrowser();
          }
        });
        return;
      }

      // 2. iOS non-Safari browsers (Chrome iOS, Firefox iOS, Edge iOS)
      if (isIOS && (/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(ua))) {
        console.warn('[PushHive] iOS non-Safari browser. Push requires Safari.');
        this.fetchConfig(function(cfg) {
          PushHive.siteConfig = cfg;
          setTimeout(function() { PushHive.showIOSSafariPrompt(); }, (cfg && cfg.promptConfig ? cfg.promptConfig.delay : 3) * 1000);
        });
        return;
      }

      // 3. iOS Safari but NOT installed as PWA (not standalone)
      if (isIOS && !isStandalone) {
        console.log('[PushHive] iOS Safari detected, not in standalone mode');
        this.fetchConfig(function(cfg) {
          PushHive.siteConfig = cfg;
          setTimeout(function() { PushHive.showIOSPrompt(); }, (cfg && cfg.promptConfig ? cfg.promptConfig.delay : 3) * 1000);
        });
        return;
      }

      // 4. iOS Safari in standalone mode (PWA) — push is available!
      //    Permission MUST be requested from a user gesture (click handler)
      if (isIOS && isStandalone) {
        console.log('[PushHive] iOS PWA mode detected — push available');
        this.fetchConfig(function(cfg) {
          PushHive.siteConfig = cfg;
          PushHive.registerServiceWorker(function(registration) {
            // Check if already subscribed
            registration.pushManager.getSubscription().then(function(sub) {
              if (sub) {
                console.log('[PushHive] Already subscribed on iOS PWA');
                PushHive.sendSubscription(sub);
              } else {
                // Show our custom prompt — the Allow button triggers permission request (user gesture!)
                console.log('[PushHive] Will show subscribe button for iOS PWA');
                PushHive.showIOSPWAPrompt(registration);
              }
            });
          });
        });
        return;
      }

      // 5. Desktop + Android — normal flow (service worker + push supported)
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[PushHive] Push notifications not supported in this browser');
        return;
      }

      this.fetchConfig(function(cfg) {
        PushHive.siteConfig = cfg;
        PushHive.registerServiceWorker();
      });
    },

    fetchConfig: function(callback) {
      fetch(this.serverUrl + '/api/config?apiKey=' + this.apiKey, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit'
      })
      .then(function(response) {
        if (response.ok) return response.json();
        throw new Error('Config fetch failed: HTTP ' + response.status);
      })
      .then(function(data) {
        console.log('[PushHive] Config loaded successfully');
        callback(data);
      })
      .catch(function(err) {
        console.warn('[PushHive] Config fetch failed:', err.message);
        console.warn('[PushHive] Using embedded config (browser may be blocking cross-origin requests)');
        // Fallback: use the VAPID key embedded at SDK generation time
        callback({
          promptConfig: { style: 'native', delay: 1 },
          vapidPublicKey: PushHive.vapidPublicKey,
          inAppBrowserRedirect: false
        });
      });
    },

    registerServiceWorker: function(callback) {
      navigator.serviceWorker.register('/pushhive-sw.js', { scope: '/' })
        .then(function(registration) {
          console.log('[PushHive] Service Worker registered');
          if (typeof callback === 'function') {
            callback(registration);
          } else {
            PushHive.checkSubscription(registration);
          }
        })
        .catch(function(err) {
          console.error('[PushHive] Service Worker registration failed:', err.message);
          console.error('[PushHive] Make sure /pushhive-sw.js exists at your site root.');
        });
    },

    checkSubscription: function(registration) {
      console.log('[PushHive] Checking existing subscription...');
      registration.pushManager.getSubscription()
        .then(function(subscription) {
          if (subscription) {
            console.log('[PushHive] Already subscribed, updating server');
            PushHive.sendSubscription(subscription);
          } else {
            console.log('[PushHive] Not subscribed, will show prompt');
            PushHive.showPrompt(registration);
          }
        })
        .catch(function(err) {
          console.error('[PushHive] Subscription check failed:', err.message);
        });
    },

    showPrompt: function(registration) {
      var config = this.siteConfig ? this.siteConfig.promptConfig : {};
      var delay = (config.delay || 3) * 1000;
      var style = config.style || 'banner';

      // Check if user previously denied
      try {
        var denied = localStorage.getItem('pushhive_denied');
        if (denied && (Date.now() - parseInt(denied)) < 7 * 24 * 3600 * 1000) {
          console.log('[PushHive] User previously dismissed prompt, waiting 7 days');
          return;
        }
      } catch(e) {}

      // Check browser permission state
      if (Notification.permission === 'denied') {
        console.log('[PushHive] Notification permission is denied by browser');
        return;
      }

      console.log('[PushHive] Showing prompt in ' + (delay/1000) + 's (style: ' + style + ')');
      setTimeout(function() {
        if (style === 'native') {
          PushHive.requestPermission(registration);
        } else {
          PushHive.showCustomPrompt(registration, config, style);
        }
      }, delay);
    },

    showCustomPrompt: function(registration, config, style) {
      // Detect iOS
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      var isStandalone = window.navigator.standalone === true ||
                         window.matchMedia('(display-mode: standalone)').matches;

      if (isIOS && !isStandalone) {
        PushHive.showIOSPrompt();
        return;
      }

      var overlay = document.createElement('div');
      overlay.id = 'pushhive-prompt';
      overlay.innerHTML =
        '<div style="position:fixed;' + (style === 'banner' ? 'top:0;left:0;right:0;' : 'top:50%;left:50%;transform:translate(-50%,-50%);max-width:400px;border-radius:12px;') +
        'background:#fff;color:#333;padding:20px 24px;box-shadow:0 4px 24px rgba(0,0,0,0.15);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;gap:16px;">' +
        '<div style="flex:1"><div style="font-weight:600;font-size:15px;margin-bottom:4px;">' + (config.title || 'Stay Updated!') + '</div>' +
        '<div style="font-size:13px;color:#666;">' + (config.message || 'Get notified about our latest updates.') + '</div></div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button id="pushhive-deny" style="padding:8px 16px;border:1px solid #ddd;background:#fff;color:#666;border-radius:6px;cursor:pointer;font-size:13px;">' + (config.denyButtonText || 'Maybe Later') + '</button>' +
        '<button id="pushhive-allow" style="padding:8px 16px;border:none;background:#4F46E5;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">' + (config.allowButtonText || 'Allow') + '</button>' +
        '</div></div>';

      document.body.appendChild(overlay);

      document.getElementById('pushhive-allow').onclick = function() {
        overlay.remove();
        PushHive.requestPermission(registration);
      };
      document.getElementById('pushhive-deny').onclick = function() {
        overlay.remove();
        // Don't ask again for 7 days
        try { localStorage.setItem('pushhive_denied', Date.now()); } catch(e) {}
      };
    },

    showIOSPrompt: function() {
      var overlay = document.createElement('div');
      overlay.id = 'pushhive-ios-prompt';
      overlay.innerHTML =
        '<div style="position:fixed;bottom:0;left:0;right:0;background:#fff;color:#333;padding:24px;box-shadow:0 -4px 24px rgba(0,0,0,0.15);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;border-radius:16px 16px 0 0;">' +
        '<div style="font-weight:600;font-size:16px;margin-bottom:8px;">Get Push Notifications</div>' +
        '<div style="font-size:14px;color:#666;margin-bottom:16px;">To receive notifications on iOS:</div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:12px;background:#f5f5f5;border-radius:8px;">' +
        '<span style="font-size:24px;">1.</span><span>Tap the <strong>Share</strong> button <span style="font-size:20px;">&#x2191;</span> at the bottom of Safari</span></div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px;background:#f5f5f5;border-radius:8px;">' +
        '<span style="font-size:24px;">2.</span><span>Select <strong>"Add to Home Screen"</strong></span></div>' +
        '<button id="pushhive-ios-close" style="width:100%;padding:12px;border:none;background:#4F46E5;color:#fff;border-radius:8px;cursor:pointer;font-size:15px;font-weight:500;">Got it</button>' +
        '</div>';
      document.body.appendChild(overlay);
      document.getElementById('pushhive-ios-close').onclick = function() { overlay.remove(); };
    },

    showIOSPWAPrompt: function(registration) {
      // iOS PWA mode — permission MUST be requested from user gesture (click)
      var overlay = document.createElement('div');
      overlay.id = 'pushhive-ios-pwa-prompt';
      overlay.innerHTML =
        '<div style="position:fixed;bottom:0;left:0;right:0;background:#fff;color:#333;padding:24px;box-shadow:0 -4px 24px rgba(0,0,0,0.15);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;border-radius:16px 16px 0 0;">' +
        '<div style="font-weight:600;font-size:16px;margin-bottom:8px;">Enable Notifications</div>' +
        '<div style="font-size:14px;color:#666;margin-bottom:16px;">Stay updated with the latest content and offers.</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button id="pushhive-ios-pwa-allow" style="flex:1;padding:14px;border:none;background:#4F46E5;color:#fff;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;">Enable Notifications</button>' +
        '<button id="pushhive-ios-pwa-deny" style="padding:14px 20px;border:1px solid #ddd;background:#fff;color:#666;border-radius:8px;cursor:pointer;font-size:15px;">Not Now</button>' +
        '</div></div>';
      document.body.appendChild(overlay);

      // The click handler IS the user gesture required by iOS
      document.getElementById('pushhive-ios-pwa-allow').onclick = function() {
        overlay.remove();
        console.log('[PushHive] iOS PWA: requesting permission via user gesture');
        Notification.requestPermission().then(function(permission) {
          console.log('[PushHive] iOS PWA permission result:', permission);
          if (permission === 'granted') {
            PushHive.subscribe(registration);
          }
        });
      };
      document.getElementById('pushhive-ios-pwa-deny').onclick = function() {
        overlay.remove();
        try { localStorage.setItem('pushhive_denied', Date.now()); } catch(e) {}
      };
    },

    showIOSSafariPrompt: function() {
      var overlay = document.createElement('div');
      overlay.id = 'pushhive-safari-prompt';
      overlay.innerHTML =
        '<div style="position:fixed;bottom:0;left:0;right:0;background:#fff;color:#333;padding:24px;box-shadow:0 -4px 24px rgba(0,0,0,0.15);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;border-radius:16px 16px 0 0;">' +
        '<div style="font-weight:600;font-size:16px;margin-bottom:8px;">Open in Safari</div>' +
        '<div style="font-size:14px;color:#666;margin-bottom:16px;">Push notifications on iOS require Safari. You are currently using a different browser.</div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:12px;background:#f5f5f5;border-radius:8px;">' +
        '<span style="font-size:24px;">1.</span><span>Copy this page URL</span></div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px;background:#f5f5f5;border-radius:8px;">' +
        '<span style="font-size:24px;">2.</span><span>Open <strong>Safari</strong> and paste the URL</span></div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button id="pushhive-copy-url" style="flex:1;padding:12px;border:none;background:#4F46E5;color:#fff;border-radius:8px;cursor:pointer;font-size:15px;font-weight:500;">Copy URL</button>' +
        '<button id="pushhive-safari-close" style="padding:12px 20px;border:1px solid #ddd;background:#fff;color:#666;border-radius:8px;cursor:pointer;font-size:15px;">Close</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      document.getElementById('pushhive-safari-close').onclick = function() { overlay.remove(); };
      document.getElementById('pushhive-copy-url').onclick = function() {
        navigator.clipboard.writeText(window.location.href).then(function() {
          document.getElementById('pushhive-copy-url').textContent = 'Copied!';
          setTimeout(function() { document.getElementById('pushhive-copy-url').textContent = 'Copy URL'; }, 2000);
        }).catch(function() {
          prompt('Copy this URL and open it in Safari:', window.location.href);
        });
      };
    },

    requestPermission: function(registration) {
      console.log('[PushHive] Requesting notification permission...');
      Notification.requestPermission().then(function(permission) {
        console.log('[PushHive] Permission result:', permission);
        if (permission === 'granted') {
          PushHive.subscribe(registration);
        }
      });
    },

    subscribe: function(registration) {
      console.log('[PushHive] Creating push subscription...');
      var vapidKey = (PushHive.siteConfig && PushHive.siteConfig.vapidPublicKey) || PushHive.vapidPublicKey;
      if (!vapidKey) {
        console.error('[PushHive] No VAPID public key available. Check server .env VAPID_PUBLIC_KEY');
        return;
      }
      console.log('[PushHive] VAPID key length:', vapidKey.length, '| starts with:', vapidKey.substring(0, 10) + '...');
      var convertedKey = PushHive.urlBase64ToUint8Array(vapidKey);
      console.log('[PushHive] Converted key length:', convertedKey.length, '(should be 65)');

      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      })
      .then(function(subscription) {
        console.log('[PushHive] Push subscription created, sending to server');
        PushHive.sendSubscription(subscription);
      })
      .catch(function(err) {
        console.error('[PushHive] Subscribe failed:', err.name + ':', err.message);
        if (err.name === 'AbortError') {
          console.error('[PushHive] This usually means:');
          console.error('[PushHive]   1. Browser Tracking Prevention is blocking push (Edge, Brave)');
          console.error('[PushHive]   2. VAPID key mismatch - regenerate keys and update .env');
          console.error('[PushHive]   3. Existing subscription with different VAPID key - clear site data');
          console.error('[PushHive]   Edge users: Settings > Privacy > Tracking Prevention > set to Basic, or add site to exceptions');
        }
      });
    },

    sendSubscription: function(subscription) {
      var ua = navigator.userAgent;
      var data = {
        apiKey: PushHive.apiKey,
        subscription: subscription.toJSON(),
        browser: PushHive.detectBrowser(ua),
        browserVersion: PushHive.detectBrowserVersion(ua),
        os: PushHive.detectOS(ua),
        device: PushHive.detectDevice(ua),
        referrer: document.referrer,
        landingPage: window.location.href
      };

      fetch(PushHive.serverUrl + '/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': PushHive.apiKey
        },
        body: JSON.stringify(data),
        mode: 'cors',
        credentials: 'omit'
      })
      .then(function(response) {
        return response.json();
      })
      .then(function(result) {
        if (result.success) {
          console.log('[PushHive] Subscribed successfully');
        } else {
          console.error('[PushHive] Subscribe failed:', result.error || 'Unknown error');
        }
      })
      .catch(function(err) {
        console.warn('[PushHive] Fetch subscribe blocked, trying beacon fallback');
        // Fallback: use navigator.sendBeacon which is less likely to be blocked
        if (navigator.sendBeacon) {
          var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
          var sent = navigator.sendBeacon(PushHive.serverUrl + '/api/subscribe?apiKey=' + PushHive.apiKey, blob);
          if (sent) {
            console.log('[PushHive] Subscribed via beacon');
          } else {
            console.error('[PushHive] Beacon also failed');
          }
        } else {
          console.error('[PushHive] Subscribe request blocked by browser tracking prevention');
        }
      });
    },

    // ── In-App Browser Detection & Escape ──────────────────────
    isInAppBrowser: function() {
      var ua = navigator.userAgent || '';
      var rules = [
        'FBAN', 'FBAV',           // Facebook
        'Instagram',               // Instagram
        'Line/',                   // Line
        'Twitter',                 // Twitter/X
        'LinkedIn',                // LinkedIn
        'MicroMessenger',          // WeChat
        'Snapchat',                // Snapchat
        'Pinterest',               // Pinterest
        'TikTok'                   // TikTok
      ];
      for (var i = 0; i < rules.length; i++) {
        if (ua.indexOf(rules[i]) > -1) return true;
      }
      return false;
    },

    escapeInAppBrowser: function() {
      var currentUrl = window.location.href;
      // Add marker to prevent redirect loop
      if (currentUrl.indexOf('_phesc=1') > -1) return;
      var separator = currentUrl.indexOf('?') > -1 ? '&' : '?';
      var targetUrl = currentUrl + separator + '_phesc=1';

      var ua = navigator.userAgent || '';
      var isAndroid = /Android/i.test(ua);
      var isIOS = /iPad|iPhone|iPod/i.test(ua);

      if (isAndroid) {
        // Use intent:// to open in Chrome
        var intentUrl = 'intent://' + targetUrl.replace('https://', '').replace('http://', '') +
          '#Intent;scheme=https;package=com.android.chrome;end';
        window.location.href = intentUrl;
      } else if (isIOS) {
        // Use x-safari-https:// to open in Safari
        window.location.href = 'x-safari-' + targetUrl;
      } else {
        // Fallback: try to open in new window
        window.open(targetUrl, '_system');
      }
    },

    // ── Utility Methods ────────────────────────────────────────
    urlBase64ToUint8Array: function(base64String) {
      var padding = '='.repeat((4 - base64String.length % 4) % 4);
      var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      var rawData = window.atob(base64);
      var outputArray = new Uint8Array(rawData.length);
      for (var i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    },

    detectBrowser: function(ua) {
      if (ua.indexOf('Edg/') > -1) return 'Edge';
      if (ua.indexOf('Chrome') > -1) return 'Chrome';
      if (ua.indexOf('Firefox') > -1) return 'Firefox';
      if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) return 'Safari';
      return 'Other';
    },

    detectBrowserVersion: function(ua) {
      var browsers = ['Chrome/', 'Firefox/', 'Safari/', 'Edg/'];
      for (var i = 0; i < browsers.length; i++) {
        var idx = ua.indexOf(browsers[i]);
        if (idx > -1) {
          var start = idx + browsers[i].length;
          var end = start;
          while (end < ua.length && (ua[end] === '.' || (ua[end] >= '0' && ua[end] <= '9'))) end++;
          if (end > start) return ua.substring(start, end);
        }
      }
      return '';
    },

    detectOS: function(ua) {
      if (ua.indexOf('Windows') > -1) return 'Windows';
      if (ua.indexOf('Mac OS') > -1) return 'macOS';
      if (ua.indexOf('Android') > -1) return 'Android';
      if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) return 'iOS';
      if (ua.indexOf('Linux') > -1) return 'Linux';
      return 'Other';
    },

    detectDevice: function(ua) {
      if (ua.indexOf('Mobile') > -1 || ua.indexOf('iPhone') > -1) return 'mobile';
      if (ua.indexOf('iPad') > -1 || ua.indexOf('Tablet') > -1) return 'tablet';
      return 'desktop';
    }
  };

  // Auto-init if data attributes present
  var script = document.currentScript || document.querySelector('script[data-pushhive]');
  if (script && script.getAttribute('data-api-key')) {
    PushHive.init({ apiKey: script.getAttribute('data-api-key') });
  }

  // Expose globally
  window.PushHive = PushHive;
})();
`;
}

function generateServiceWorker(serverUrl) {
  return `
var PUSHHIVE_SERVER = '${serverUrl}';

self.addEventListener('push', function(event) {
  // iOS REQUIRES showNotification in waitUntil — silent pushes kill the subscription
  var data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    // iOS sometimes sends non-JSON payload
    data = {
      title: 'New Notification',
      body: (event.data && event.data.text) ? event.data.text() : ''
    };
  }

  var options = {
    body: data.body || '',
    icon: data.icon || '/favicon.ico',
    image: data.image || '',
    badge: data.badge || '/favicon.ico',
    data: {
      url: data.url || '/',
      campaignId: data.campaignId || '',
      siteId: data.siteId || '',
      utm: data.utm || {}
    },
    requireInteraction: false,
    tag: data.campaignId || 'pushhive-' + Date.now()
  };

  if (data.actions && data.actions.length > 0) {
    options.actions = data.actions.map(function(a) {
      return { action: a.url, title: a.title };
    });
  }

  // ALWAYS call showNotification inside waitUntil — iOS cancels subscription otherwise
  event.waitUntil(
    self.registration.showNotification(data.title || 'Notification', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var data = event.notification.data || {};
  var url = event.action || data.url || '/';

  trackEvent(data, 'clicked');

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          if (clientList[i].url === url && 'focus' in clientList[i]) {
            return clientList[i].focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});

self.addEventListener('notificationclose', function(event) {
  var data = event.notification.data || {};
  trackEvent(data, 'dismissed');
});

function trackEvent(data, type) {
  if (!data.campaignId || data.campaignId === 'welcome') return;

  fetch(PUSHHIVE_SERVER + '/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaignId: data.campaignId,
      siteId: data.siteId,
      type: type,
      utm: data.utm || {}
    }),
    mode: 'cors',
    credentials: 'omit'
  }).catch(function() {});
}
`;
}

module.exports = router;
