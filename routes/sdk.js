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
router.get('/pushhive.js', (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(generateSDK(serverUrl));
});

// ── Serve Service Worker ────────────────────────────────────────
router.get('/pushhive-sw.js', (req, res) => {
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Service-Worker-Allowed', '/');
  res.set('Cache-Control', 'no-cache');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(generateServiceWorker(serverUrl));
});

function generateSDK(serverUrl) {
  return `
(function() {
  'use strict';

  var PushHive = {
    serverUrl: '${serverUrl}',
    apiKey: null,
    siteConfig: null,

    init: function(config) {
      this.apiKey = config.apiKey;
      if (!this.apiKey) { console.error('[PushHive] API key required'); return; }

      var ua = navigator.userAgent || '';
      var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;

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
      //    These use WKWebView — no service worker support, can't subscribe
      //    Don't redirect — just show a "use Safari" message
      if (isIOS && (/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(ua))) {
        console.warn('[PushHive] iOS non-Safari browser detected. Push requires Safari.');
        this.fetchConfig(function(cfg) {
          PushHive.siteConfig = cfg;
          setTimeout(function() { PushHive.showIOSSafariPrompt(); }, (cfg && cfg.promptConfig ? cfg.promptConfig.delay : 3) * 1000);
        });
        return;
      }

      // 3. Check service worker & push support
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        // iOS Safari not in standalone/PWA mode
        if (isIOS) {
          this.fetchConfig(function(cfg) {
            PushHive.siteConfig = cfg;
            setTimeout(function() { PushHive.showIOSPrompt(); }, (cfg && cfg.promptConfig ? cfg.promptConfig.delay : 3) * 1000);
          });
          return;
        }
        console.warn('[PushHive] Push notifications not supported in this browser');
        return;
      }

      // 4. Normal flow — service workers supported
      this.fetchConfig(function(cfg) {
        PushHive.siteConfig = cfg;
        PushHive.registerServiceWorker();
      });
    },

    fetchConfig: function(callback) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', this.serverUrl + '/api/config?apiKey=' + this.apiKey);
      xhr.onload = function() {
        if (xhr.status === 200) {
          callback(JSON.parse(xhr.responseText));
        }
      };
      xhr.send();
    },

    registerServiceWorker: function() {
      navigator.serviceWorker.register(this.serverUrl + '/sdk/pushhive-sw.js', { scope: '/' })
        .then(function(registration) {
          console.log('[PushHive] Service Worker registered');
          PushHive.checkSubscription(registration);
        })
        .catch(function(err) {
          // Fallback: try registering from same origin
          console.warn('[PushHive] Cross-origin SW failed, attempting local registration');
          console.error(err);
        });
    },

    checkSubscription: function(registration) {
      registration.pushManager.getSubscription()
        .then(function(subscription) {
          if (subscription) {
            PushHive.sendSubscription(subscription);
          } else {
            PushHive.showPrompt(registration);
          }
        });
    },

    showPrompt: function(registration) {
      var config = this.siteConfig ? this.siteConfig.promptConfig : {};
      var delay = (config.delay || 3) * 1000;
      var style = config.style || 'banner';

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

    showIOSSafariPrompt: function() {
      var overlay = document.createElement('div');
      overlay.id = 'pushhive-safari-prompt';
      overlay.innerHTML =
        '<div style="position:fixed;bottom:0;left:0;right:0;background:#fff;color:#333;padding:24px;box-shadow:0 -4px 24px rgba(0,0,0,0.15);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;border-radius:16px 16px 0 0;">' +
        '<div style="font-weight:600;font-size:16px;margin-bottom:8px;">Open in Safari</div>' +
        '<div style="font-size:14px;color:#666;margin-bottom:16px;">Push notifications on iOS require Safari. You\'re currently using a different browser.</div>' +
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
      Notification.requestPermission().then(function(permission) {
        if (permission === 'granted') {
          PushHive.subscribe(registration);
        }
      });
    },

    subscribe: function(registration) {
      var vapidKey = PushHive.siteConfig.vapidPublicKey;
      var convertedKey = PushHive.urlBase64ToUint8Array(vapidKey);

      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      })
      .then(function(subscription) {
        PushHive.sendSubscription(subscription);
      })
      .catch(function(err) {
        console.error('[PushHive] Subscribe failed:', err);
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

      var xhr = new XMLHttpRequest();
      xhr.open('POST', PushHive.serverUrl + '/api/subscribe');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('X-API-Key', PushHive.apiKey);
      xhr.send(JSON.stringify(data));
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
      var m = ua.match(/(?:Chrome|Firefox|Safari|Edg)\/([0-9.]+)/i);
      return m ? m[1] : '';
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
      if (/Mobile|Android.*Mobile|iPhone/i.test(ua)) return 'mobile';
      if (/iPad|Tablet/i.test(ua)) return 'tablet';
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
  if (!event.data) return;

  try {
    var data = event.data.json();
    var options = {
      body: data.body || '',
      icon: data.icon || '',
      image: data.image || '',
      badge: data.badge || '/favicon.ico',
      data: {
        url: data.url || '/',
        campaignId: data.campaignId || '',
        siteId: data.siteId || '',
        utm: data.utm || {}
      },
      requireInteraction: true,
      vibrate: [200, 100, 200]
    };

    if (data.actions && data.actions.length > 0) {
      options.actions = data.actions.map(function(a) {
        return { action: a.url, title: a.title };
      });
    }

    event.waitUntil(
      self.registration.showNotification(data.title || 'Notification', options)
    );
  } catch (e) {
    console.error('[PushHive SW] Push parse error:', e);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var data = event.notification.data || {};
  var url = event.action || data.url || '/';

  // Track click
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
      utm: data.utm || {},
      apiKey: data.apiKey || ''
    })
  }).catch(function(err) {
    console.error('[PushHive SW] Track error:', err);
  });
}
`;
}

module.exports = router;
