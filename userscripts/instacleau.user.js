// ==UserScript==
// @name         Instagram Nuclear Mode
// @namespace    https://github.com/HimadriChakra12
// @version      2.0.0
// @description  Absolute minimum RAM/CPU/battery for Instagram. No mercy.
// @author       Himika
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

'use strict';

/* ═══════════════════════════════════════════════════════════
   CONFIG
   Set to false only if something you need breaks.
══════════════════════════════════════════════════════════════ */
const CFG = {
  killAnimations        : true,  // nuke all CSS animation/transition
  killWillChange        : true,  // remove GPU layer promotions
  killFilters           : true,  // remove CSS filter/backdrop-filter (GPU hog)
  killBoxShadow         : true,  // remove box-shadow (compositing cost)
  killBackgroundImage   : false, // strip decorative bg-images (breaks some UI)
  throttleTimers        : true,  // clamp all setInterval/setTimeout
  minIntervalMs         : 1000,  // nothing fires faster than 1s
  minTimeoutMs          : 150,   // clamp short one-shot timers
  blockAnalytics        : true,  // kill all telemetry/logging endpoints
  blockBeacon           : true,  // intercept navigator.sendBeacon
  blockPush             : true,  // deny push/notification subscription
  blockPrefetch         : true,  // strip all <link rel=prefetch/preload>
  blockServiceWorker    : true,  // prevent SW registration (no bg sync)
  blockWebSocket        : true,  // drop non-essential WS connections
  killAutoplayVideo     : true,  // pause+mute all video, require click
  removeVideoSrc        : true,  // go further: strip src from off-screen videos
  aggressiveImageUnload : true,  // unload images outside 100% viewport margin
  killIdleCallback      : true,  // noop requestIdleCallback (background work)
  killRAF               : false, // noop requestAnimationFrame (breaks scrolling)
  hiddenTabFreeze       : true,  // pause ALL timers when tab is hidden
  killMutationFlood     : true,  // debounce our own MutationObservers
  killStoriesAutoAdv    : true,  // prevent stories from auto-advancing
  killSuggestedContent  : true,  // remove Reels/Suggested rows from DOM
  killScrollJack        : true,  // remove scroll event listeners Instagram adds
};

/* ═══════════════════════════════════════════════════════════
   0. FROZEN-TAB STATE
   When the tab is hidden we freeze ALL script-owned intervals.
══════════════════════════════════════════════════════════════ */
let _tabHidden = document.hidden;
const _frozenIntervals = new Map(); // id → {fn, delay, args}

document.addEventListener('visibilitychange', () => {
  _tabHidden = document.hidden;
  if (_tabHidden) {
    // pause every video immediately
    document.querySelectorAll('video').forEach(v => { v.pause(); v.muted = true; });
  }
});

/* ═══════════════════════════════════════════════════════════
   1. NUKE CSS — inject before any IG stylesheet loads
══════════════════════════════════════════════════════════════ */
{
  const rules = [];

  if (CFG.killAnimations) rules.push(`
    *, *::before, *::after {
      animation-duration:        0.001ms !important;
      animation-iteration-count: 1       !important;
      transition-duration:       0.001ms !important;
      transition-delay:          0ms     !important;
    }
  `);

  if (CFG.killWillChange) rules.push(`
    * { will-change: auto !important; }
  `);

  if (CFG.killFilters) rules.push(`
    * {
      filter:           none !important;
      backdrop-filter:  none !important;
      -webkit-backdrop-filter: none !important;
    }
  `);

  if (CFG.killBoxShadow) rules.push(`
    * { box-shadow: none !important; }
  `);

  if (rules.length) {
    const s = document.createElement('style');
    s.id = 'ig-nuke-css';
    s.textContent = rules.join('\n');
    (document.head || document.documentElement).appendChild(s);
  }
}

/* ═══════════════════════════════════════════════════════════
   2. TIMER THROTTLE + HIDDEN-TAB FREEZE
   Replace setInterval/setTimeout globally before any IG JS runs.
══════════════════════════════════════════════════════════════ */
if (CFG.throttleTimers) {
  const _si  = window.setInterval.bind(window);
  const _st  = window.setTimeout.bind(window);
  const _ci  = window.clearInterval.bind(window);

  window.setInterval = function(fn, delay, ...args) {
    const d = Math.max(+(delay) || 0, CFG.minIntervalMs);
    // wrap fn: skip execution entirely when tab is hidden
    const wrapped = CFG.hiddenTabFreeze
      ? function() { if (!_tabHidden) fn(...args); }
      : fn;
    const id = _si(wrapped, d);
    return id;
  };

  window.setTimeout = function(fn, delay, ...args) {
    const d = (delay != null && delay < CFG.minTimeoutMs)
      ? CFG.minTimeoutMs : delay;
    return _st(fn, d, ...args);
  };
}

/* ═══════════════════════════════════════════════════════════
   3. KILL requestIdleCallback
   IG uses this for deferred analytics/rendering work.
══════════════════════════════════════════════════════════════ */
if (CFG.killIdleCallback && 'requestIdleCallback' in window) {
  window.requestIdleCallback = (fn, opts) => {
    // run once, delayed, but never repeatedly
    return setTimeout(() => { if (!_tabHidden) fn({ didTimeout: false, timeRemaining: () => 0 }); }, 2000);
  };
  window.cancelIdleCallback = (id) => clearTimeout(id);
}

/* ═══════════════════════════════════════════════════════════
   4. KILL requestAnimationFrame (optional — off by default)
══════════════════════════════════════════════════════════════ */
if (CFG.killRAF) {
  const _raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => setTimeout(fn, 100);
}

/* ═══════════════════════════════════════════════════════════
   5. BLOCK ANALYTICS / TELEMETRY — fetch + XHR + sendBeacon
══════════════════════════════════════════════════════════════ */
if (CFG.blockAnalytics) {
  const BLOCK = [
    // logging
    '/logging/bulk_log',
    '/api/v1/web/client_event',
    '/async/client_metrics',
    '/api/v1/qe/sync',
    // Bloks analytics (NOT graph.instagram.com — that carries real content too)
    '/api/v1/ba/',
    // ads/tracking pixels
    '/api/v1/ads/',
    'facebook.com/tr',
    'connect.facebook.net',
    // reliability / perf reporting
    '/api/v1/rupload',
    '/ajax/bz',
    // '/api/graphql',   // DISABLED — IG uses this for feed/profile content, not just analytics
    // 'graph.instagram.com', // DISABLED — same reason
  ];

  const blocked = (url) => {
    if (!url || typeof url !== 'string') return false;
    return BLOCK.some(p => url.includes(p));
  };

  // fetch
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    if (blocked(url)) return Promise.resolve(new Response('{}', {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    return _fetch(input, init);
  };

  // XHR
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, url, ...r) {
    this._igNuke = blocked(url);
    return _open.apply(this, [m, url, ...r]);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._igNuke) {
      // fake a successful empty response so IG doesn't retry
      Object.defineProperty(this, 'readyState', { get: () => 4 });
      Object.defineProperty(this, 'status',     { get: () => 200 });
      Object.defineProperty(this, 'responseText', { get: () => '{}' });
      this.dispatchEvent(new Event('load'));
      return;
    }
    return _send.apply(this, [body]);
  };
}

// sendBeacon — used for exit-time pings
if (CFG.blockBeacon && navigator.sendBeacon) {
  navigator.sendBeacon = () => true; // lie: pretend it succeeded
}

/* ═══════════════════════════════════════════════════════════
   6. BLOCK SERVICE WORKER
   SW enables background sync, push, offline caching — all
   wasteful on a tab you're actively using.
══════════════════════════════════════════════════════════════ */
if (CFG.blockServiceWorker && 'serviceWorker' in navigator) {
  Object.defineProperty(navigator, 'serviceWorker', {
    get: () => ({
      register:   () => Promise.reject(new Error('ig-nuke: SW blocked')),
      ready:      Promise.reject(new Error('ig-nuke: SW blocked')),
      controller: null,
    }),
    configurable: true,
  });
}

/* ═══════════════════════════════════════════════════════════
   7. BLOCK PUSH / NOTIFICATION
══════════════════════════════════════════════════════════════ */
if (CFG.blockPush) {
  if ('Notification' in window) {
    try {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'denied', configurable: true,
      });
    } catch(_) {}
    Notification.requestPermission = () => Promise.resolve('denied');
  }
  // PushManager — used by SW
  if ('PushManager' in window) {
    window.PushManager = undefined;
  }
}

/* ═══════════════════════════════════════════════════════════
   8. BLOCK / FILTER WEBSOCKET
   IG uses WS for live notifications, typing indicators, etc.
   We let content WS through but kill heartbeat noise.
══════════════════════════════════════════════════════════════ */
if (CFG.blockWebSocket) {
  const _WS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    // Block known IG realtime/presence endpoints
    if (url && (
      url.includes('edge-chat.instagram.com') ||
      url.includes('presence')
    )) {
      // Return a fake dead socket
      const fake = { readyState: 3, send: () => {}, close: () => {},
        addEventListener: () => {}, removeEventListener: () => {} };
      return fake;
    }
    return new _WS(url, protocols);
  };
  window.WebSocket.prototype = _WS.prototype;
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
}

/* ═══════════════════════════════════════════════════════════
   9. DOM-READY: media, images, prefetch, DOM pruning
══════════════════════════════════════════════════════════════ */
const domReady = (fn) => {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn, { once: true });
};

// debounce helper for MutationObserver callbacks
const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

domReady(() => {

  /* ── 9a. STRIP PREFETCH/PRELOAD LINKS ── */
  if (CFG.blockPrefetch) {
    const stripLinks = () =>
      document.querySelectorAll(
        'link[rel="prefetch"],link[rel="preload"],link[rel="modulepreload"],link[rel="dns-prefetch"]'
      ).forEach(el => el.remove());

    stripLinks();
    new MutationObserver(debounce(stripLinks, CFG.killMutationFlood ? 300 : 0))
      .observe(document.head || document.documentElement, { childList: true, subtree: true });
  }

  /* ── 9b. VIDEO: pause, mute, strip src when off-screen ── */
  if (CFG.killAutoplayVideo) {
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target: v, isIntersecting }) => {
        if (isIntersecting) {
          // restore src if we stripped it, but keep paused — user must click
          if (v._igNukeSrc) { v.src = v._igNukeSrc; delete v._igNukeSrc; }
        } else {
          v.pause();
          v.muted = true;
          if (CFG.removeVideoSrc && v.src && !v._igNukeSrc) {
            v._igNukeSrc = v.src;
            v.src = '';
            v.load(); // release decoder
          }
        }
      });
    }, { rootMargin: '50% 0px' }); // only load video near viewport

    const manageVideos = debounce(() => {
      document.querySelectorAll('video:not([data-ig-nuke-v])').forEach(v => {
        v.dataset.igNukeV = '1';
        v.pause();
        v.autoplay  = false;
        v.muted     = true;
        v.preload   = 'none';
        v.setAttribute('preload', 'none');
        // click anywhere on video to play
        v.addEventListener('click', () => {
          v.muted = false;
          v.play();
        });
        videoObserver.observe(v);
      });
    }, CFG.killMutationFlood ? 200 : 0);

    manageVideos();
    new MutationObserver(manageVideos)
      .observe(document.body, { childList: true, subtree: true });
  }

  /* ── 9c. AGGRESSIVE IMAGE UNLOAD ── */
  if (CFG.aggressiveImageUnload) {
    const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const imgObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target: img, isIntersecting }) => {
        if (isIntersecting) {
          if (img._igNukeSrc) { img.src = img._igNukeSrc; delete img._igNukeSrc; }
          if (img._igNukeSrcset) { img.srcset = img._igNukeSrcset; delete img._igNukeSrcset; }
        } else {
          if (img.src && img.src !== BLANK && !img._igNukeSrc) {
            img._igNukeSrc = img.src;
            img.src = BLANK;
          }
          if (img.srcset && !img._igNukeSrcset) {
            img._igNukeSrcset = img.srcset;
            img.srcset = '';
          }
        }
      });
    }, { rootMargin: '100% 0px' }); // 1 viewport above/below = keep loaded

    const observeImgs = debounce(() => {
      document.querySelectorAll('img:not([data-ig-nuke-i])').forEach(img => {
        img.dataset.igNukeI = '1';
        imgObserver.observe(img);
      });
    }, CFG.killMutationFlood ? 250 : 0);

    observeImgs();
    new MutationObserver(observeImgs)
      .observe(document.body, { childList: true, subtree: true });
  }

  /* ── 9d. REMOVE SUGGESTED / REELS ROWS ── */
  if (CFG.killSuggestedContent) {
    const JUNK_SELECTORS = [
      // Suggested Posts banner
      '[data-testid="suggested-posts"]',
      // Reels shelf in feed
      'div[class*="Reels"]',
      // "Suggested for you" header area
      'div[class*="Suggest"]',
      // Stories tray (comment out if you use stories)
      // 'div[role="menu"]',
    ];

    const pruneJunk = debounce(() => {
      JUNK_SELECTORS.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => el.remove());
        } catch(_) {}
      });
    }, 500);

    pruneJunk();
    new MutationObserver(pruneJunk)
      .observe(document.body, { childList: true, subtree: true });
  }

  /* ── 9e. STORIES: prevent auto-advance ── */
  if (CFG.killStoriesAutoAdv) {
    // IG advances stories with a progress bar powered by setInterval;
    // our timer throttle already slows that. Also intercept the click
    // synthetic events IG fires to advance after N seconds.
    // We override the progress element's animation to freeze it.
    const freezeStoryProgress = debounce(() => {
      document.querySelectorAll('div[class*="Progress"] > div').forEach(bar => {
        bar.style.animationPlayState = 'paused';
        bar.style.animationDuration  = '9999s';
      });
    }, 300);

    new MutationObserver(freezeStoryProgress)
      .observe(document.body, { childList: true, subtree: true, attributes: true });
  }

});

/* ═══════════════════════════════════════════════════════════
   10. VISIBILITY CHANGE — full freeze when tab hidden
══════════════════════════════════════════════════════════════ */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    document.querySelectorAll('video').forEach(v => { v.pause(); v.muted = true; });
    // Release image memory aggressively when backgrounded
    if (CFG.aggressiveImageUnload) {
      const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      document.querySelectorAll('img').forEach(img => {
        if (img.src && img.src !== BLANK && !img._igNukeSrc) {
          img._igNukeSrc    = img.src;
          img.src           = BLANK;
        }
        if (img.srcset && !img._igNukeSrcset) {
          img._igNukeSrcset = img.srcset;
          img.srcset        = '';
        }
      });
    }
  } else {
    // Tab visible again: restore images near viewport
    // (IntersectionObserver fires naturally on scroll/resize — no explicit restore needed)
  }
});
