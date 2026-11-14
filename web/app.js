/**
 * InstaExtract Client Engine
 * - Client-side humanized extraction
 * - Relational analysis (Mutuals, Don't Follow Back, Fans)
 * - Mobile deep-linking to native Instagram app
 * - AWS Ephemeral Session sync for QR hand-off
 */

const API_BASE = '/api';

// Check if current user is on mobile
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Deep-link to Instagram mobile app or fallback to web
function openProfile(username) {
  if (isMobileDevice()) {
    const nativeUri = `instagram://user?username=${username}`;
    const webUri = `https://www.instagram.com/${username}/`;
    
    // Attempt opening native app
    const start = Date.now();
    window.location.href = nativeUri;
    
    // Fallback if app not installed or not responsive
    setTimeout(() => {
      if (Date.now() - start < 1500) {
        window.open(webUri, '_blank');
      }
    }, 800);
  } else {
    window.open(`https://www.instagram.com/${username}/`, '_blank');
  }
}

// Upload dataset to AWS S3 via Lambda for QR sync
async function syncSessionToCloud(dataset) {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dataset)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create cloud session (${res.status})`);
  }

  const result = await res.json();
  return result.sessionId;
}

// Fetch ephemeral session from AWS S3 via Lambda
async function fetchSessionFromCloud(sessionId) {
  const cleanId = encodeURIComponent(sessionId);
  const res = await fetch(`${API_BASE}/sessions/${cleanId}`);

  if (!res.ok) {
    throw new Error(`Session expired or not found (${res.status})`);
  }

  return await res.json();
}

// Relational Analyzer
function analyzeRelationships(following, followers) {
  const followerMap = new Map();
  const dedupFollowers = [];
  const seenFollowers = new Set();

  for (const u of followers) {
    if (!u.username) continue;
    const lower = u.username.toLowerCase();
    if (!seenFollowers.has(lower)) {
      seenFollowers.add(lower);
      dedupFollowers.push(u);
      followerMap.set(lower, u);
    }
  }

  const followingMap = new Map();
  const dedupFollowing = [];
  const seenFollowing = new Set();

  for (const u of following) {
    if (!u.username) continue;
    const lower = u.username.toLowerCase();
    if (!seenFollowing.has(lower)) {
      seenFollowing.add(lower);
      dedupFollowing.push(u);
      followingMap.set(lower, u);
    }
  }

  const mutuals = [];
  const notFollowingBack = [];
  const fans = [];

  // Following: mutuals vs not following back
  for (const u of dedupFollowing) {
    const lower = u.username.toLowerCase();
    u.followedByViewer = true;
    if (followerMap.has(lower)) {
      u.followsViewer = true;
      u.relationship = 'mutual';
      mutuals.push(u);
    } else {
      u.followsViewer = false;
      u.relationship = 'not_following_back';
      notFollowingBack.push(u);
    }
  }

  // Followers: fans (not followed back)
  for (const u of dedupFollowers) {
    const lower = u.username.toLowerCase();
    u.followsViewer = true;
    if (!followingMap.has(lower)) {
      u.followedByViewer = false;
      u.relationship = 'fan';
      fans.push(u);
    } else {
      u.followedByViewer = true;
      u.relationship = 'mutual';
    }
  }

  const uniqueUsers = new Map();
  const addUser = (u) => {
    const l = u.username.toLowerCase();
    if (!uniqueUsers.has(l)) uniqueUsers.set(l, { ...u });
    else {
      const existing = uniqueUsers.get(l);
      if (u.followedByViewer) existing.followedByViewer = true;
      if (u.followsViewer) existing.followsViewer = true;
      if (u.relationship) existing.relationship = u.relationship;
    }
  };

  mutuals.forEach(addUser);
  notFollowingBack.forEach(addUser);
  fans.forEach(addUser);

  // Normalize relationships
  const usersArray = Array.from(uniqueUsers.values()).map(u => {
    if (u.followedByViewer && u.followsViewer) u.relationship = 'mutual';
    else if (u.followedByViewer && !u.followsViewer) u.relationship = 'not_following_back';
    else if (!u.followedByViewer && u.followsViewer) u.relationship = 'fan';
    return u;
  });

  return {
    stats: {
      notFollowingBack: notFollowingBack.length,
      fans: fans.length,
      mutuals: mutuals.length,
      following: dedupFollowing.length,
      followers: dedupFollowers.length
    },
    users: usersArray
  };
}

// Parse cURL command text into URL, headers, and cookies
function parseCurl(curlText) {
  const urlMatch = curlText.match(/curl(?:\s+--url)?\s+['"]([^'"]+)['"]/);
  if (!urlMatch) throw new Error('Could not parse URL from cURL text.');
  const url = urlMatch[1];

  const headerMatches = Array.from(curlText.matchAll(/(?:-H|--header)\s+['"]([^'"]+)['"]/g)).map(m => m[1]);
  const cookieMatches = Array.from(curlText.matchAll(/(?:-b|--cookie)\s+['"]([^'"]+)['"]/g)).map(m => m[1]);

  const headers = {};
  headerMatches.forEach(h => {
    const idx = h.indexOf(':');
    if (idx !== -1) {
      const k = h.slice(0, idx).trim().toLowerCase();
      const v = h.slice(idx + 1).trim();
      headers[k] = v;
    }
  });

  if (cookieMatches.length > 0) {
    headers['cookie'] = cookieMatches.join('; ');
  }

  return { url, headers };
}

// Generate QR Code into DOM container
function renderQrCode(elementId, text) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: text,
      width: 220,
      height: 220,
      colorDark: '#0d1117',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    container.innerHTML = `<a href="${text}" target="_blank" style="color:#58a6ff;">${text}</a>`;
  }
}

// Bulk Follow Utilities (One Username Per Line)
function parseUsernamesList(text) {
  if (!text) return { usernames: [], count: 0, duplicatesCount: 0 };
  const lines = text.split(/[\r\n]+/);
  const seen = new Set();
  const usernames = [];
  let duplicatesCount = 0;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Handle URLs e.g. https://instagram.com/username
    if (line.includes('instagram.com/')) {
      const match = line.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
      if (match && match[1]) line = match[1];
    }

    // Strip leading @
    if (line.startsWith('@')) {
      line = line.substring(1).trim();
    }

    // Sanitize valid Instagram username characters
    line = line.replace(/[^a-zA-Z0-9._]/g, '');
    if (!line) continue;

    const lower = line.toLowerCase();
    if (seen.has(lower)) {
      duplicatesCount++;
    } else {
      seen.add(lower);
      usernames.push(line);
    }
  }

  return {
    usernames,
    count: usernames.length,
    duplicatesCount
  };
}

// Standalone in-browser follow bot generator
function generateBulkFollowScript(usernames, speed) {
  return `(async function() {
  const targets = ${JSON.stringify(usernames)};
  let speed = ${JSON.stringify(speed || 'normal')};
  let isPaused = false;
  let isStopped = false;
  let currentIndex = 0;
  let followedCount = 0;
  let requestedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const followedList = [];
  const requestedList = [];
  const skippedList = [];
  const failedList = [];

  if (!window.location.hostname.includes('instagram.com')) {
    alert('Please switch to your active tab on https://www.instagram.com where you are logged in, then paste this script in DevTools console!');
    return;
  }

  const old = document.getElementById('insta-follow-suite');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'insta-follow-suite';
  panel.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:2147483647; background:#161b22; color:#f0f6fc; border:1px solid #30363d; border-radius:14px; padding:18px; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; width:390px; max-height:92vh; overflow-y:auto; box-shadow:0 16px 48px rgba(0,0,0,0.85); font-size:13px; line-height:1.5; box-sizing:border-box;';
  panel.innerHTML = [
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">',
      '<div style="display:flex; align-items:center; gap:8px;">',
        '<span style="font-size:18px;">➕</span>',
        '<strong style="background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);-webkit-background-clip:text;-webkit-text-fill-color:transparent; font-size:1.15rem; font-weight:700;">InstaExtract Follow Bot</strong>',
      '</div>',
      '<button id="ief-close-btn" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:1.4rem;line-height:1;padding:0;" title="Close">&times;</button>',
    '</div>',
    '<div style="font-size:0.84rem; color:#8b949e; margin-bottom:8px; display:flex; justify-content:space-between;">',
      '<span>Queue: <strong>' + targets.length + '</strong> profiles</span>',
      '<span id="ief-counts" style="color:#58a6ff; font-weight:600;">0 followed</span>',
    '</div>',
    '<div style="background:#21262d; border-radius:8px; padding:6px 10px; margin-bottom:10px; font-size:12px; display:flex; justify-content:space-between; align-items:center;">',
      '<span style="color:#8b949e;">Pacing Speed:</span>',
      '<select id="ief-speed-select" style="background:#161b22; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:2px 6px; font-size:11px; cursor:pointer;">',
        '<option value="fast"' + (speed === 'fast' ? ' selected' : '') + '>⚡ Fast (5s - 9s)</option>',
        '<option value="normal"' + (speed === 'normal' ? ' selected' : '') + '>🚶 Normal (10s - 18s)</option>',
        '<option value="safe"' + (speed === 'safe' ? ' selected' : '') + '>🛡️ Safe (20s - 35s)</option>',
      '</select>',
    '</div>',
    '<div id="ief-status" style="font-size:0.86rem; font-weight:600; margin-bottom:2px; color:#58a6ff;">Ready to start follow automation</div>',
    '<div id="ief-substatus" style="font-size:0.76rem; color:#8b949e; margin-bottom:8px;">Initializing queue of ' + targets.length + ' accounts...</div>',
    '<div style="height:5px; background:#30363d; border-radius:3px; overflow:hidden; margin-bottom:10px;">',
      '<div id="ief-prog-bar" style="height:100%; width:0%; background:linear-gradient(45deg,#f09433,#dc2743,#bc1888); transition:width 0.3s;"></div>',
    '</div>',
    '<div id="ief-log" style="height:95px; overflow-y:auto; background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:6px 8px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:#8b949e; margin-bottom:10px; line-height:1.45; word-break:break-word;"></div>',
    '<div style="display:flex; gap:8px;">',
      '<button id="ief-toggle-btn" style="flex:1; background:linear-gradient(45deg,#f09433,#dc2743,#bc1888); color:white; border:none; border-radius:6px; padding:8px; font-weight:700; cursor:pointer; font-size:12px;">⏸ Pause</button>',
      '<button id="ief-stop-btn" style="background:#21262d; color:#ff7b72; border:1px solid #30363d; border-radius:6px; padding:8px 14px; cursor:pointer; font-size:12px;">Stop</button>',
    '</div>',
    '<div id="ief-results-container" style="display:none; margin-top:12px; background:#0d1117; border:1px solid #30363d; border-radius:8px; padding:10px 12px;">',
      '<div style="font-weight:700; font-size:12px; color:#f0f6fc; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">',
        '<span>📊 Export Individual Lists:</span>',
        '<button id="ief-dl-all-btn" style="background:none; border:none; color:#58a6ff; font-size:11px; cursor:pointer; text-decoration:underline; padding:0;" title="Download complete JSON report">Download All (JSON)</button>',
      '</div>',
      '<div style="display:flex; flex-direction:column; gap:6px;">',
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; background:#161b22; padding:5px 8px; border-radius:6px; border:1px solid #21262d;">',
          '<span style="color:#3fb950; font-weight:600;">✓ Followed (<span id="ief-res-followed-count">0</span>)</span>',
          '<div style="display:flex; gap:4px;">',
            '<button id="ief-copy-followed-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Copy followed usernames (one per line)">📋 Copy</button>',
            '<button id="ief-dl-followed-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Download followed usernames (.txt)">💾 .txt</button>',
          '</div>',
        '</div>',
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; background:#161b22; padding:5px 8px; border-radius:6px; border:1px solid #21262d;">',
          '<span style="color:#58a6ff; font-weight:600;">📩 Requested (<span id="ief-res-requested-count">0</span>)</span>',
          '<div style="display:flex; gap:4px;">',
            '<button id="ief-copy-requested-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Copy requested usernames (one per line)">📋 Copy</button>',
            '<button id="ief-dl-requested-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Download requested usernames (.txt)">💾 .txt</button>',
          '</div>',
        '</div>',
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; background:#161b22; padding:5px 8px; border-radius:6px; border:1px solid #21262d;">',
          '<span style="color:#e3b341; font-weight:600;">⏭ Skipped (<span id="ief-res-skipped-count">0</span>)</span>',
          '<div style="display:flex; gap:4px;">',
            '<button id="ief-copy-skipped-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Copy skipped usernames (one per line)">📋 Copy</button>',
            '<button id="ief-dl-skipped-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Download skipped usernames (.txt)">💾 .txt</button>',
          '</div>',
        '</div>',
        '<div id="ief-res-failed-row" style="display:none; justify-content:space-between; align-items:center; font-size:11.5px; background:#161b22; padding:5px 8px; border-radius:6px; border:1px solid #21262d;">',
          '<span style="color:#ff7b72; font-weight:600;">✗ Failed (<span id="ief-res-failed-count">0</span>)</span>',
          '<div style="display:flex; gap:4px;">',
            '<button id="ief-copy-failed-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Copy failed usernames (one per line)">📋 Copy</button>',
            '<button id="ief-dl-failed-btn" style="background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;" title="Download failed usernames (.txt)">💾 .txt</button>',
          '</div>',
        '</div>',
      '</div>',
    '</div>'
  ].join('');
  document.body.appendChild(panel);

  const statusText = document.getElementById('ief-status');
  const substatusText = document.getElementById('ief-substatus');
  const progBar = document.getElementById('ief-prog-bar');
  const toggleBtn = document.getElementById('ief-toggle-btn');
  const stopBtn = document.getElementById('ief-stop-btn');
  const closeBtn = document.getElementById('ief-close-btn');
  const speedSelect = document.getElementById('ief-speed-select');
  const countsText = document.getElementById('ief-counts');
  const logBox = document.getElementById('ief-log');

  const copyFollowedBtn = document.getElementById('ief-copy-followed-btn');
  const dlFollowedBtn = document.getElementById('ief-dl-followed-btn');
  const copyRequestedBtn = document.getElementById('ief-copy-requested-btn');
  const dlRequestedBtn = document.getElementById('ief-dl-requested-btn');
  const copySkippedBtn = document.getElementById('ief-copy-skipped-btn');
  const dlSkippedBtn = document.getElementById('ief-dl-skipped-btn');
  const copyFailedBtn = document.getElementById('ief-copy-failed-btn');
  const dlFailedBtn = document.getElementById('ief-dl-failed-btn');
  const dlAllBtn = document.getElementById('ief-dl-all-btn');

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function log(msg, color) {
    console.log('[InstaExtract FollowBot]', msg);
    if (!logBox) return;
    const item = document.createElement('div');
    if (color) item.style.color = color;
    item.innerText = msg;
    logBox.appendChild(item);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function getCsrfToken() {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  function getViewerId() {
    const m = document.cookie.match(/ds_user_id=([0-9]+)/);
    return m ? m[1] : '';
  }

  function getRolloutHash() {
    try {
      const m = document.documentElement.innerHTML.match(/"rollout_hash":"([^"]+)"/) ||
                document.documentElement.innerHTML.match(/"rev":([0-9]+)/);
      return m ? m[1] : '1';
    } catch(e) {
      return '1';
    }
  }

  function getDtsgToken() {
    try {
      const el = document.querySelector('input[name="fb_dtsg"]');
      if (el && el.value) return el.value;
    } catch(e) {}
    try {
      const m = document.documentElement.innerHTML.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                document.documentElement.innerHTML.match(/"dtsg":\{"token":"([^"]+)"/) ||
                document.documentElement.innerHTML.match(/"token":"([A-Za-z0-9_-]{12,})"/);
      if (m && m[1]) return m[1];
    } catch(e) {}
    return '';
  }

  function getLsdToken() {
    try {
      const el = document.querySelector('input[name="lsd"]');
      if (el && el.value) return el.value;
    } catch(e) {}
    try {
      const m = document.documentElement.innerHTML.match(/"LSD",\[\],\{"token":"([^"]+)"\}/);
      if (m && m[1]) return m[1];
    } catch(e) {}
    return '';
  }

  function getJazoest(token) {
    if (!token) return '';
    let sum = 0;
    for (let i = 0; i < token.length; i++) {
      sum += token.charCodeAt(i);
    }
    return '2' + sum;
  }

  async function tryNativeModuleFollow(userId) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) { done = true; reject(new Error('native_timeout')); }
      }, 3500);

      // Attempt 1: window.requireInterop
      try {
        if (typeof window.requireInterop === 'function') {
          const api = window.requireInterop('PolarisSharedAPI');
          if (api && typeof api.followUser === 'function') {
            api.followUser(userId).then(res => {
              if (!done) { done = true; clearTimeout(timeout); resolve(res); }
            }).catch(err => {
              if (!done) { done = true; clearTimeout(timeout); reject(err); }
            });
            return;
          }
        }
      } catch(e) {}

      // Attempt 2: window.requireLazy
      try {
        if (typeof window.requireLazy === 'function') {
          window.requireLazy(['PolarisSharedAPI'], function(api) {
            if (api && typeof api.followUser === 'function') {
              api.followUser(userId).then(res => {
                if (!done) { done = true; clearTimeout(timeout); resolve(res); }
              }).catch(err => {
                if (!done) { done = true; clearTimeout(timeout); reject(err); }
              });
            } else {
              if (!done) { done = true; clearTimeout(timeout); reject(new Error('no_api')); }
            }
          });
          return;
        }
      } catch(e) {}

      if (!done) { done = true; clearTimeout(timeout); reject(new Error('no_require')); }
    });
  }

  async function domFollowFallback(username) {
    log('Attempting DOM-level follow fallback for @' + username + '...', '#8b949e');
    return new Promise((resolve) => {
      let resolved = false;
      const win = window.open('/' + encodeURIComponent(username) + '/', 'ief_tab_' + Date.now(), 'width=460,height=580,top=120,left=120');
      if (!win) {
        resolve({ success: false, error: 'Popup blocked by browser' });
        return;
      }

      const finish = (result) => {
        if (resolved) return;
        resolved = true;
        try { win.close(); } catch(e) {}
        resolve(result);
      };

      let interval = setInterval(() => {
        try {
          if (win.closed) {
            clearInterval(interval);
            finish({ success: false, error: 'Window closed' });
            return;
          }
          const doc = win.document;
          if (!doc) return;

          const buttons = Array.from(doc.querySelectorAll('button'));
          const followBtn = buttons.find(b => {
            const txt = (b.innerText || '').trim().toLowerCase();
            return txt === 'follow' || txt === 'follow back';
          });
          const alreadyDone = buttons.find(b => {
            const txt = (b.innerText || '').trim().toLowerCase();
            return txt === 'following' || txt === 'requested';
          });

          if (alreadyDone) {
            clearInterval(interval);
            const txt = (alreadyDone.innerText || '').trim().toLowerCase();
            finish({ success: true, mode: txt === 'requested' ? 'requested' : 'followed' });
            return;
          }

          if (followBtn) {
            followBtn.click();
            clearInterval(interval);
            setTimeout(() => {
              try {
                const updatedButtons = Array.from(win.document.querySelectorAll('button'));
                const isReq = updatedButtons.some(b => (b.innerText || '').trim().toLowerCase() === 'requested');
                finish({ success: true, mode: isReq ? 'requested' : 'followed' });
              } catch(e) {
                finish({ success: true, mode: 'followed' });
              }
            }, 1200);
          }
        } catch(e) {}
      }, 400);

      setTimeout(() => {
        clearInterval(interval);
        finish({ success: false, error: 'DOM operation timed out' });
      }, 10000);
    });
  }

  function getDelay() {
    const s = speedSelect ? speedSelect.value : 'normal';
    if (s === 'fast') return Math.floor(Math.random() * 4000) + 5000;
    if (s === 'safe') return Math.floor(Math.random() * 15000) + 20000;
    return Math.floor(Math.random() * 8000) + 10000;
  }

  function updateCounts() {
    if (countsText) {
      countsText.innerHTML = '<span style="color:#3fb950; font-weight:700;">' + followedCount + ' followed</span>' +
        (requestedCount > 0 ? ' · <span style="color:#58a6ff; font-weight:700;">' + requestedCount + ' requested</span>' : '') +
        ' · <span style="color:#e3b341; font-weight:700;">' + skippedCount + ' skipped</span>' +
        (failedCount > 0 ? ' · <span style="color:#ff7b72; font-weight:700;">' + failedCount + ' failed</span>' : '') +
        ' <span style="color:#8b949e;">(' + currentIndex + '/' + targets.length + ')</span>';
    }
  }

  async function resolveTargetUser(username) {
    const cleanUser = String(username || '').replace(/^@+/, '').trim().toLowerCase();
    if (!cleanUser) return { invalid: true };

    try {
      const res = await fetch('/' + encodeURIComponent(cleanUser) + '/', {
        credentials: 'include'
      });
      const html = await res.text();

      // Check explicit 404
      if (html.includes('PolarisErrorRoot') && !html.includes('PolarisProfilePostsTabRoot')) {
        return { notFound: true, username: cleanUser };
      }

      // Extract user id from SSR profile payload
      const m = html.match(/"profile_id":"([0-9]+)"/) ||
                html.match(/"page_id":"profilePage_([0-9]+)"/) ||
                html.match(/"props":\{[^}]*"id":"([0-9]+)"/) ||
                html.match(/"user_id":"([0-9]+)"/) ||
                html.match(/"pk":"([0-9]{5,20})"/) ||
                html.match(/"pk_id":"([0-9]{5,20})"/) ||
                html.match(/"id":"([0-9]{5,20})"/);

      if (m && m[1]) {
        return {
          success: true,
          userId: m[1],
          username: cleanUser
        };
      }

      if (html.includes('PolarisErrorRoot') || res.status === 404) {
        return { notFound: true, username: cleanUser };
      }

      // Fallback: search via topsearch
      const csrf = getCsrfToken();
      if (csrf) {
        try {
          const sRes = await fetch('/api/v1/web/search/topsearch/?query=' + encodeURIComponent(cleanUser), {
            credentials: 'include',
            headers: {
              'x-csrftoken': csrf,
              'x-ig-app-id': '936619743392459',
              'x-asbd-id': '129477',
              'x-requested-with': 'XMLHttpRequest'
            }
          });
          if (sRes.ok) {
            const sData = await sRes.json();
            const hit = (sData.users || []).find(u => u.user && u.user.username.toLowerCase() === cleanUser);
            if (hit && hit.user && hit.user.pk) {
              return { success: true, userId: String(hit.user.pk), username: cleanUser };
            }
          }
        } catch(e) {}
      }

      return { notFound: true, username: cleanUser };
    } catch(e) {
      return { error: e.message, username: cleanUser };
    }
  }

  async function checkFriendshipStatus(userId, csrf) {
    if (!userId) return null;
    const rolloutHash = getRolloutHash();
    try {
      const res = await fetch('/api/v1/friendships/show/' + encodeURIComponent(userId) + '/', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'x-csrftoken': csrf,
          'x-instagram-ajax': rolloutHash,
          'x-ig-app-id': '936619743392459',
          'x-asbd-id': '129477',
          'x-ig-www-claim': '0',
          'x-requested-with': 'XMLHttpRequest'
        }
      });
      if (res.ok) {
        let text = await res.text();
        if (text && text.startsWith('for (;;);')) text = text.substring(9).trim();
        if (text && !text.startsWith('<')) {
          const d = JSON.parse(text);
          return {
            following: !!d.following,
            outgoing_request: !!d.outgoing_request,
            is_private: !!d.is_private,
            raw: d
          };
        }
      }
    } catch(e) {
      console.warn('[InstaExtract] checkFriendshipStatus error:', e);
    }
    return null;
  }

  async function sendFollowRequest(userId, username, csrf) {
    if (!userId) return { error: 'Missing userId' };
    const rolloutHash = getRolloutHash();
    const dtsg = getDtsgToken();
    const lsd = getLsdToken();
    const jazoestToken = dtsg || lsd || csrf;
    const jazoest = getJazoest(jazoestToken);

    // Layer 1: Native Instagram internal module call
    try {
      log('Attempting native internal Polaris follow call...', '#8b949e');
      const nativeRes = await tryNativeModuleFollow(userId);
      if (nativeRes) {
        log('Native follow call dispatched successfully (' + JSON.stringify(nativeRes) + ')', '#3fb950');
        if (nativeRes.result === 'requested') return { success: true, mode: 'requested' };
        return { success: true, mode: 'followed' };
      }
    } catch(e) {
      log('Native module bypass (' + (e.message || 'not loaded') + '), falling back to REST/GraphQL...', '#8b949e');
    }

    // Layer 2: Authenticated REST endpoint with complete Meta payload
    const headers = {
      'x-csrftoken': csrf,
      'x-instagram-ajax': rolloutHash,
      'x-ig-app-id': '936619743392459',
      'x-asbd-id': '129477',
      'x-ig-www-claim': '0',
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/x-www-form-urlencoded'
    };

    const bodyParams = new URLSearchParams();
    bodyParams.append('container_module', 'profile');
    bodyParams.append('nav_chain', 'PolarisFeedRoot:feedPage:1:unexpected');
    bodyParams.append('user_id', userId);
    bodyParams.append('include_follow_friction_check', 'true');
    if (dtsg) bodyParams.append('fb_dtsg', dtsg);
    if (jazoest) bodyParams.append('jazoest', jazoest);

    try {
      log('Dispatching REST follow mutation to userId: ' + userId + '...', '#8b949e');
      const res = await fetch('/api/v1/friendships/create/' + encodeURIComponent(userId) + '/', {
        method: 'POST',
        credentials: 'include',
        headers: headers,
        body: bodyParams.toString()
      });

      let text = await res.text();
      if (text.startsWith('for (;;);')) text = text.substring(9).trim();
      let data = null;
      try { data = JSON.parse(text); } catch(e) {}

      log('REST response HTTP ' + res.status + (data && data.status ? ' (' + data.status + ')' : ''), '#8b949e');

      if (res.status === 429 || (data && (data.message === 'feedback_required' || data.spam))) {
        return { rateLimited: true };
      }

      if (res.ok && data) {
        if (data.friendship_status) {
          if (data.friendship_status.following === true) return { success: true, mode: 'followed' };
          if (data.friendship_status.outgoing_request === true) return { success: true, mode: 'requested' };
        }
        if (data.result === 'following') return { success: true, mode: 'followed' };
        if (data.result === 'requested') return { success: true, mode: 'requested' };
        if (data.status === 'ok') return { success: true, mode: 'followed' };
      }
    } catch(e) {
      log('REST endpoint exception: ' + e.message, '#ff7b72');
    }

    // Layer 3: Native Web GraphQL Mutation (doc_id: 27767812149509802)
    try {
      log('Trying GraphQL follow mutation...', '#8b949e');
      const gqlParams = new URLSearchParams();
      gqlParams.append('doc_id', '27767812149509802');
      gqlParams.append('fb_api_req_friendly_name', 'usePolarisFollowUserFollowMutation');
      gqlParams.append('variables', JSON.stringify({
        data: { include_follow_friction_check: true },
        target_user_id: userId
      }));
      gqlParams.append('server_timestamps', 'true');
      if (dtsg) gqlParams.append('fb_dtsg', dtsg);
      if (jazoest) gqlParams.append('jazoest', jazoest);

      const gqlEndpoints = ['/api/graphql', '/graphql/query'];
      for (const ep of gqlEndpoints) {
        const gqlRes = await fetch(ep, {
          method: 'POST',
          credentials: 'include',
          headers: {
            ...headers,
            'x-fb-friendly-name': 'usePolarisFollowUserFollowMutation'
          },
          body: gqlParams.toString()
        });

        if (gqlRes.ok) {
          let gText = await gqlRes.text();
          if (gText.startsWith('for (;;);')) gText = gText.substring(9).trim();
          let gData = null;
          try { gData = JSON.parse(gText); } catch(e) {}
          if (gData && gData.data) {
            const fs = gData.data.xdt_create_friendship?.friendship_status;
            if (fs) {
              if (fs.following === true) return { success: true, mode: 'followed' };
              if (fs.outgoing_request === true) return { success: true, mode: 'requested' };
            }
          }
        }
      }
    } catch(e) {
      log('GraphQL follow exception: ' + e.message, '#ff7b72');
    }

    // Layer 4: Verification check - check if friendship status changed to following or requested
    await sleep(800);
    const verify = await checkFriendshipStatus(userId, csrf);
    if (verify) {
      if (verify.following) return { success: true, mode: 'followed' };
      if (verify.outgoing_request) return { success: true, mode: 'requested' };
    }

    // Layer 5: DOM-assisted fallback window if API was shielded
    if (username) {
      const domResult = await domFollowFallback(username);
      if (domResult && domResult.success) {
        return domResult;
      }
    }

    return { error: 'Action unconfirmed by server' };
  }

  async function processNext() {
    if (isPaused || isStopped || currentIndex >= targets.length) return;
    const rawUser = targets[currentIndex];
    const username = String(rawUser || '').replace(/^@+/, '').trim().toLowerCase();

    if (!username) {
      skippedCount++;
      if (rawUser) skippedList.push(String(rawUser).trim());
      currentIndex++;
      updateCounts();
      processNext();
      return;
    }

    const csrf = getCsrfToken();
    if (!csrf) {
      statusText.innerHTML = '<span style="color:#ff7b72;">❌ Authentication Error</span>';
      substatusText.innerText = 'Could not find csrftoken cookie. Please make sure you are logged in to instagram.com!';
      log('❌ csrftoken cookie not found in active session', '#ff7b72');
      return;
    }

    const viewerId = getViewerId();

    statusText.innerText = 'Auditing @' + username + ' (' + (currentIndex + 1) + '/' + targets.length + ')...';
    substatusText.innerText = 'Resolving user profile & friendship status in background...';
    log('[' + (currentIndex + 1) + '/' + targets.length + '] Resolving @' + username + '...', '#58a6ff');

    const info = await resolveTargetUser(username);

    if (info.invalid || info.notFound) {
      skippedCount++;
      skippedList.push(username);
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Account Not Found</span>';
      substatusText.innerText = '@' + username + ' does not exist or has been disabled.';
      log('⏭ @' + username + ': Account not found or disabled', '#e3b341');
    } else if (info.error) {
      skippedCount++;
      skippedList.push(username);
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Network Error</span>';
      substatusText.innerText = '@' + username + ': ' + info.error;
      log('⏭ @' + username + ': Network error (' + info.error + ')', '#e3b341');
    } else if (viewerId && info.userId === viewerId) {
      skippedCount++;
      skippedList.push(username);
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Your Own Account</span>';
      substatusText.innerText = '@' + username + ' is your logged-in account.';
      log('⏭ @' + username + ': Logged-in viewer account skipped', '#e3b341');
    } else {
      // Pre-check friendship status
      statusText.innerText = 'Checking @' + username + '...';
      log('Checking friendship status for @' + username + ' (ID: ' + info.userId + ')...', '#8b949e');
      const status = await checkFriendshipStatus(info.userId, csrf);

      if (status && status.following) {
        skippedCount++;
        skippedList.push(username);
        statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Already Following</span>';
        substatusText.innerText = 'You are already following @' + username + '.';
        log('⏭ @' + username + ': Already following', '#e3b341');
      } else if (status && status.outgoing_request) {
        skippedCount++;
        skippedList.push(username);
        statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Already Requested</span>';
        substatusText.innerText = 'Follow request is already pending for private account @' + username + '.';
        log('⏭ @' + username + ': Follow request already pending (Private account)', '#e3b341');
      } else {
        // Send follow request
        statusText.innerText = 'Sending Follow Request to @' + username + '...';
        substatusText.innerText = 'Dispatching authenticated friendship mutation...';

        const outcome = await sendFollowRequest(info.userId, username, csrf);

        if (outcome.rateLimited) {
          statusText.innerHTML = '<span style="color:#ff7b72;">⚠️ Instagram Action Limit Detected</span>';
          substatusText.innerText = 'Instagram cooldown triggered. Pausing 60s to protect account...';
          log('⚠️ Action limit detected! Pausing 60s cooldown...', '#ff7b72');
          await sleep(60000);
          return;
        } else if (outcome.success) {
          if (outcome.mode === 'requested') {
            requestedCount++;
            requestedList.push(username);
            statusText.innerHTML = '<span style="color:#58a6ff;">📩 Follow Request Sent @' + username + '</span>';
            substatusText.innerText = 'Private profile request sent successfully!';
            log('📩 @' + username + ': Follow request sent (Private account)', '#58a6ff');
          } else {
            followedCount++;
            followedList.push(username);
            statusText.innerHTML = '<span style="color:#3fb950;">✓ Followed @' + username + '</span>';
            substatusText.innerText = 'Now following (' + followedCount + ' total followed)';
            log('✓ @' + username + ': Followed successfully', '#3fb950');
          }
        } else {
          failedCount++;
          failedList.push(username);
          statusText.innerHTML = '<span style="color:#ff7b72;">✗ Action not confirmed for @' + username + '</span>';
          substatusText.innerText = outcome.error || 'Follow request could not be completed.';
          log('✗ @' + username + ': Action unconfirmed (' + (outcome.error || 'error') + ')', '#ff7b72');
        }
      }
    }

    currentIndex++;
    updateCounts();
    progBar.style.width = Math.round((currentIndex / targets.length) * 100) + '%';

    if (currentIndex < targets.length) {
      const delay = getDelay();
      let remaining = Math.round(delay / 1000);
      const nextUser = String(targets[currentIndex] || '').replace(/^@+/, '').trim();
      substatusText.innerText = 'Next profile (@' + nextUser + ') in ' + remaining + 's (Pacing delay)...';
      log('⏳ Pacing delay ' + remaining + 's before next profile (@' + nextUser + ')...', '#8b949e');
      const timer = setInterval(() => {
        if (isPaused || isStopped) { clearInterval(timer); return; }
        remaining--;
        if (remaining > 0) {
          substatusText.innerText = 'Next profile (@' + nextUser + ') in ' + remaining + 's (Pacing delay)...';
        } else {
          clearInterval(timer);
          processNext();
        }
      }, 1000);
    } else {
      let headline = '🎉 Bulk Follow Finished!';
      let headlineColor = '#3fb950';

      if (failedCount > 0 && followedCount === 0 && requestedCount === 0 && skippedCount === 0) {
        headline = '❌ All Follow Requests Failed';
        headlineColor = '#ff7b72';
      } else if (failedCount > 0 && followedCount === 0 && requestedCount === 0) {
        headline = '⚠️ Completed with Issues (' + failedCount + ' failed, ' + skippedCount + ' skipped)';
        headlineColor = '#ff7b72';
      } else if (followedCount === 0 && requestedCount === 0 && skippedCount > 0) {
        headline = 'ℹ️ Completed (All Accounts Skipped)';
        headlineColor = '#e3b341';
      } else if (failedCount > 0) {
        headline = '✓ Completed (' + (followedCount + requestedCount) + ' success, ' + failedCount + ' failed, ' + skippedCount + ' skipped)';
        headlineColor = '#e3b341';
      } else {
        headline = '🎉 Bulk Follow Finished (' + (followedCount + requestedCount) + ' followed/requested)';
        headlineColor = '#3fb950';
      }

      statusText.innerHTML = '<span style="color:' + headlineColor + ';">' + headline + '</span>';
      substatusText.innerHTML = '<strong style="color:#3fb950;">' + followedCount + '</strong> followed · ' +
        (requestedCount > 0 ? '<strong style="color:#58a6ff;">' + requestedCount + '</strong> requested · ' : '') +
        '<strong style="color:#e3b341;">' + skippedCount + '</strong> skipped · ' +
        '<strong style="color:#ff7b72;">' + failedCount + '</strong> failed';

      log('🎉 Completed queue: ' + followedCount + ' followed, ' + (requestedCount > 0 ? requestedCount + ' requested, ' : '') + skippedCount + ' skipped, ' + failedCount + ' failed.', '#3fb950');

      toggleBtn.innerText = '✓ Finished';
      toggleBtn.disabled = true;

      showResultsSection();
    }
  }

  function copyList(name, list, btn) {
    if (!list || list.length === 0) {
      alert('The ' + name + ' list is currently empty.');
      return;
    }
    const text = list.join(String.fromCharCode(10));
    const oldText = btn ? btn.innerText : '';
    const oldColor = btn ? btn.style.color : '';
    navigator.clipboard.writeText(text).then(() => {
      if (btn) {
        btn.innerText = '✓ Copied!';
        btn.style.color = '#3fb950';
        setTimeout(() => {
          btn.innerText = oldText;
          btn.style.color = oldColor;
        }, 2200);
      }
      log('📋 Copied ' + list.length + ' ' + name + ' username(s) to clipboard', '#3fb950');
    }).catch(() => {
      prompt('Copy the ' + name + ' list below (one per line):', text);
    });
  }

  function downloadList(name, list, btn) {
    if (!list || list.length === 0) {
      alert('The ' + name + ' list is currently empty.');
      return;
    }
    const blob = new Blob([list.join(String.fromCharCode(10))], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'instagram_' + name.toLowerCase() + '_' + Date.now() + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (btn) {
      const oldText = btn.innerText;
      const oldColor = btn.style.color;
      btn.innerText = '✓ Saved!';
      btn.style.color = '#58a6ff';
      setTimeout(() => {
        btn.innerText = oldText;
        btn.style.color = oldColor;
      }, 2200);
    }
    log('💾 Downloaded ' + list.length + ' ' + name + ' username(s) (.txt)', '#58a6ff');
  }

  function downloadAllReport() {
    const report = {
      timestamp: new Date().toISOString(),
      stats: {
        totalTargets: targets.length,
        processed: currentIndex,
        followed: followedList.length,
        requested: requestedList.length,
        skipped: skippedList.length,
        failed: failedList.length
      },
      followed: followedList,
      requested: requestedList,
      skipped: skippedList,
      failed: failedList
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'follow_results_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('💾 Downloaded full follow results report (.json)', '#58a6ff');
  }

  function updateBtnState(copyBtn, dlBtn, list) {
    if (!copyBtn || !dlBtn) return;
    if (list.length === 0) {
      copyBtn.disabled = true;
      copyBtn.style.opacity = '0.45';
      copyBtn.style.cursor = 'not-allowed';
      dlBtn.disabled = true;
      dlBtn.style.opacity = '0.45';
      dlBtn.style.cursor = 'not-allowed';
    } else {
      copyBtn.disabled = false;
      copyBtn.style.opacity = '1';
      copyBtn.style.cursor = 'pointer';
      dlBtn.disabled = false;
      dlBtn.style.opacity = '1';
      dlBtn.style.cursor = 'pointer';
    }
  }

  function showResultsSection() {
    const resultsContainer = document.getElementById('ief-results-container');
    if (!resultsContainer) return;
    resultsContainer.style.display = 'block';

    const folCount = document.getElementById('ief-res-followed-count');
    if (folCount) folCount.innerText = followedList.length;

    const reqCount = document.getElementById('ief-res-requested-count');
    if (reqCount) reqCount.innerText = requestedList.length;

    const skipCount = document.getElementById('ief-res-skipped-count');
    if (skipCount) skipCount.innerText = skippedList.length;

    const failedRow = document.getElementById('ief-res-failed-row');
    const failedCountEl = document.getElementById('ief-res-failed-count');
    if (failedRow && failedCountEl) {
      if (failedList.length > 0) {
        failedRow.style.display = 'flex';
        failedCountEl.innerText = failedList.length;
      } else {
        failedRow.style.display = 'none';
      }
    }

    updateBtnState(copyFollowedBtn, dlFollowedBtn, followedList);
    updateBtnState(copyRequestedBtn, dlRequestedBtn, requestedList);
    updateBtnState(copySkippedBtn, dlSkippedBtn, skippedList);
    updateBtnState(copyFailedBtn, dlFailedBtn, failedList);

    panel.scrollTop = panel.scrollHeight;
  }

  if (copyFollowedBtn) copyFollowedBtn.onclick = function() { copyList('Followed', followedList, this); };
  if (dlFollowedBtn) dlFollowedBtn.onclick = function() { downloadList('followed', followedList, this); };

  if (copyRequestedBtn) copyRequestedBtn.onclick = function() { copyList('Requested', requestedList, this); };
  if (dlRequestedBtn) dlRequestedBtn.onclick = function() { downloadList('requested', requestedList, this); };

  if (copySkippedBtn) copySkippedBtn.onclick = function() { copyList('Skipped', skippedList, this); };
  if (dlSkippedBtn) dlSkippedBtn.onclick = function() { downloadList('skipped', skippedList, this); };

  if (copyFailedBtn) copyFailedBtn.onclick = function() { copyList('Failed', failedList, this); };
  if (dlFailedBtn) dlFailedBtn.onclick = function() { downloadList('failed', failedList, this); };

  if (dlAllBtn) dlAllBtn.onclick = function() { downloadAllReport(); };

  toggleBtn.onclick = () => {
    if (toggleBtn.disabled) return;
    if (isPaused) {
      isPaused = false;
      toggleBtn.innerText = '⏸ Pause';
      log('▶ Automation resumed by user', '#58a6ff');
      processNext();
    } else {
      isPaused = true;
      toggleBtn.innerText = '▶ Resume';
      substatusText.innerText = 'Automation paused by user';
      log('⏸ Automation paused by user', '#e3b341');
    }
  };

  stopBtn.onclick = () => {
    isStopped = true;
    isPaused = true;
    statusText.innerText = '🛑 Automation Stopped';
    substatusText.innerText = 'Queue halted at index ' + currentIndex + '/' + targets.length;
    log('🛑 Automation stopped by user at ' + currentIndex + '/' + targets.length, '#ff7b72');
    toggleBtn.disabled = true;
    showResultsSection();
  };

  closeBtn.onclick = () => {
    isStopped = true;
    isPaused = true;
    panel.remove();
  };

  // Auto-start on load
  log('🚀 Initialized queue with ' + targets.length + ' targets', '#8b949e');
  toggleBtn.innerText = '⏸ Pause';
  isPaused = false;
  processNext();
})();`;
}
