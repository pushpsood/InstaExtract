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

  if (!window.location.hostname.includes('instagram.com')) {
    alert('Please switch to your active tab on https://www.instagram.com where you are logged in, then paste this script!');
    return;
  }

  const old = document.getElementById('insta-follow-suite');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'insta-follow-suite';
  panel.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:2147483647; background:#161b22; color:#f0f6fc; border:1px solid #30363d; border-radius:14px; padding:20px; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; width:360px; box-shadow:0 16px 48px rgba(0,0,0,0.85); font-size:13px; line-height:1.5;';
  panel.innerHTML = [
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">',
      '<div style="display:flex; align-items:center; gap:8px;">',
        '<span style="font-size:18px;">➕</span>',
        '<strong style="background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);-webkit-background-clip:text;-webkit-text-fill-color:transparent; font-size:1.15rem; font-weight:700;">InstaExtract Follow Bot</strong>',
      '</div>',
      '<button id="ief-close-btn" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:1.4rem;line-height:1;" title="Close">&times;</button>',
    '</div>',
    '<div style="font-size:0.85rem; color:#8b949e; margin-bottom:10px; display:flex; justify-content:space-between;">',
      '<span>Queue: <strong>' + targets.length + '</strong> profiles</span>',
      '<span id="ief-counts" style="color:#58a6ff; font-weight:600;">0 followed</span>',
    '</div>',
    '<div style="background:#21262d; border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:12px; display:flex; justify-content:space-between; align-items:center;">',
      '<span style="color:#8b949e;">Pacing Speed:</span>',
      '<select id="ief-speed-select" style="background:#161b22; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">',
        '<option value="fast"' + (speed === 'fast' ? ' selected' : '') + '>⚡ Fast (5s - 9s)</option>',
        '<option value="normal"' + (speed === 'normal' ? ' selected' : '') + '>🚶 Normal (10s - 18s)</option>',
        '<option value="safe"' + (speed === 'safe' ? ' selected' : '') + '>🛡️ Safe (20s - 35s)</option>',
      '</select>',
    '</div>',
    '<div id="ief-status" style="font-size:0.88rem; font-weight:600; margin-bottom:4px; color:#58a6ff;">Ready to start follow automation</div>',
    '<div id="ief-substatus" style="font-size:0.78rem; color:#8b949e; margin-bottom:10px;">Click Start to begin processing queue</div>',
    '<div style="height:6px; background:#30363d; border-radius:3px; overflow:hidden; margin-bottom:14px;">',
      '<div id="ief-prog-bar" style="height:100%; width:0%; background:linear-gradient(45deg,#f09433,#dc2743,#bc1888); transition:width 0.3s;"></div>',
    '</div>',
    '<div style="display:flex; gap:8px;">',
      '<button id="ief-toggle-btn" style="flex:1; background:linear-gradient(45deg,#f09433,#dc2743,#bc1888); color:white; border:none; border-radius:6px; padding:9px; font-weight:700; cursor:pointer;">▶ Start Auto-Pilot</button>',
      '<button id="ief-stop-btn" style="background:#21262d; color:#ff7b72; border:1px solid #30363d; border-radius:6px; padding:9px 14px; cursor:pointer;">Stop</button>',
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

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function getCsrfToken() {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
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

  function navigateToProfile(username) {
    const cleanUser = String(username).replace(/^@+/, '').trim().toLowerCase();
    const targetPath = '/' + encodeURIComponent(cleanUser) + '/';
    const currentPath = window.location.pathname.replace(new RegExp('/+$'), '').toLowerCase() + '/';
    if (currentPath === targetPath) {
      return;
    }

    // Trigger SPA client-side routing via synthetic anchor click (React router delegation)
    const a = document.createElement('a');
    a.href = targetPath;
    a.style.display = 'none';
    document.body.appendChild(a);

    try {
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      a.dispatchEvent(evt);
    } catch(e) {}

    try {
      if (typeof a.click === 'function') a.click();
    } catch(e) {}

    a.remove();
  }

  function getElementLabel(el) {
    if (!el) return '';
    const aria = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    const childAria = (el.querySelector('[aria-label]') || {}).ariaLabel || '';
    return (aria + ' ' + title + ' ' + text + ' ' + childAria).trim();
  }

  function classifyButtonLabel(label) {
    if (!label) return null;
    if (/\\d+[\\s,.]*(followers?|following)/i.test(label)) return null;

    const lower = label.toLowerCase();

    // Check self profile
    if (/\\b(edit profile|view archive|ad tools|settings|saved|editar perfil|modifier profil|profil bearbeiten)\\b/i.test(lower)) {
      return 'self_profile';
    }

    // Check already following
    if (/\\b(following|siguiendo|abonné|abonné\\(e\\)|gefolgt|seguito|segui già|팔로잉|フォロー中|已关注|seguindo|takip ediliyor)\\b/i.test(lower)) {
      return 'already_following';
    }

    // Check already requested (pending follow request)
    if (/\\b(requested|request sent|pending request|cancel request|solicitado|demandé|demande envoyée|angefordert|richiesta inviata|solicitada|solicitud enviada|solicitação enviada|요청됨|リクエスト済み|已请求|gesendet)\\b/i.test(lower)) {
      return 'already_requested';
    }

    // Check ready to follow
    if (/\\b(follow|follow back|seguir|suivre|folgen|segui|फ़ॉलो|팔로우|フォローする|关注|takip et)\\b/i.test(lower) && !/\\bfollowers\\b/i.test(lower)) {
      return 'ready_to_follow';
    }

    return null;
  }

  function findProfileFollowButton(targetUser) {
    const cleanUser = String(targetUser || '').replace(/^@+/, '').trim().toLowerCase();

    // Primary scopes: Profile header, then main content
    const header = document.querySelector('header') || 
                   document.querySelector('main header') || 
                   document.querySelector('main section') ||
                   document.querySelector('section[role="region"]');
    const main = document.querySelector('main') || document.body;
    const scopes = [];
    if (header) scopes.push(header);
    scopes.push(main);

    for (const scope of scopes) {
      const candidates = Array.from(scope.querySelectorAll('button, div[role="button"], a[role="button"]'));

      for (const btn of candidates) {
        if (btn.closest('#insta-follow-suite')) continue;
        if (btn.closest('nav') || btn.closest('[role="navigation"]')) continue;
        if (btn.closest('article')) continue;
        if (btn.closest('footer')) continue;

        const href = btn.getAttribute('href') || '';
        if (href.includes('/followers') || href.includes('/following') || href.includes('/saved')) continue;

        const label = getElementLabel(btn);
        const status = classifyButtonLabel(label);
        if (status) {
          return { element: btn, status, label };
        }
      }
    }

    // Secondary leaf search (catches nested spans or text inside divs)
    const allLeaves = Array.from(main.querySelectorAll('button, div[role="button"], a[role="button"], span, div'));
    for (const el of allLeaves) {
      if (el.children.length > 0) continue;
      if (el.closest('#insta-follow-suite') || el.closest('nav') || el.closest('article') || el.closest('footer')) continue;

      const text = (el.innerText || el.textContent || '').trim();
      const status = classifyButtonLabel(text);
      if (status) {
        const clickable = el.closest('button, div[role="button"], a[role="button"]') || el;
        return { element: clickable, status, label: text };
      }
    }

    return null;
  }

  async function waitForProfileRender(username, maxWaitMs = 8000) {
    const cleanUser = String(username).replace(/^@+/, '').trim().toLowerCase();
    const start = Date.now();
    let reNavigated = false;

    while (Date.now() - start < maxWaitMs) {
      if (isStopped) return null;

      const title = (document.title || '').toLowerCase();
      const bodyText = document.body ? (document.body.innerText || '') : '';

      // Check genuine 404 / Unavailable profile
      if (
        title.includes("profile isn't available") ||
        title.includes("page not found") ||
        bodyText.includes("Sorry, this page isn't available") ||
        bodyText.includes("Profile isn't available") ||
        bodyText.includes("The link you followed may be broken") ||
        bodyText.includes("The link may be broken or the profile may have been removed")
      ) {
        return { notFound: true };
      }

      // Check if target user has loaded in DOM or Title
      const h2Match = Array.from(document.querySelectorAll('h2, h1')).some(h => {
        const txt = (h.innerText || '').trim().toLowerCase();
        return txt === cleanUser;
      });

      const currentPath = window.location.pathname.replace(new RegExp('/+$'), '').toLowerCase();
      const pathMatches = currentPath === '/' + cleanUser || currentPath.endsWith('/' + cleanUser);
      const titleMatches = title.includes(cleanUser);

      // If route or title or h2 matches, try finding the follow button
      if (pathMatches || titleMatches || h2Match) {
        const btn = findProfileFollowButton(cleanUser);
        if (btn) return btn;
      }

      // Fallback: If after 2.5s navigation hasn't triggered path change, retry navigation
      if (!reNavigated && Date.now() - start > 2500 && !pathMatches) {
        reNavigated = true;
        navigateToProfile(username);
      }

      await sleep(250);
    }

    // Final attempt before returning timeout
    const finalBtn = findProfileFollowButton(cleanUser);
    if (finalBtn) return finalBtn;

    return { timedOut: true };
  }

  function clickFollowButton(btn) {
    try {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch(e) {}

    const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of eventTypes) {
      try {
        const evt = new MouseEvent(type, {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        btn.dispatchEvent(evt);
      } catch(e) {}
    }

    try {
      if (typeof btn.click === 'function') btn.click();
    } catch(e) {}
  }

  async function verifyFollowOutcome(maxWaitMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (isStopped) return { error: 'Stopped' };

      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        const text = (dialog.innerText || '').toLowerCase();
        if (text.includes('try again later') || text.includes('action blocked') || text.includes('limit how often') || text.includes('restricted')) {
          const okBtn = Array.from(dialog.querySelectorAll('button')).find(b => /ok|close|cancel/i.test(b.innerText || ''));
          if (okBtn) okBtn.click();
          return { rateLimited: true };
        }
      }

      const btn = findProfileFollowButton();
      if (btn) {
        if (btn.status === 'already_following') {
          return { success: true, mode: 'followed' };
        }
        if (btn.status === 'already_requested') {
          return { success: true, mode: 'requested' };
        }
      }

      await sleep(300);
    }

    const finalBtn = findProfileFollowButton();
    if (finalBtn) {
      if (finalBtn.status === 'already_following') return { success: true, mode: 'followed' };
      if (finalBtn.status === 'already_requested') return { success: true, mode: 'requested' };
      if (finalBtn.status === 'ready_to_follow') {
        return { error: 'Button did not update to Following or Requested' };
      }
    }
    return { error: 'Could not verify follow state in DOM' };
  }

  async function processNext() {
    if (isPaused || isStopped || currentIndex >= targets.length) return;
    const rawUser = targets[currentIndex];
    const username = String(rawUser || '').replace(/^@+/, '').trim();

    if (!username) {
      skippedCount++;
      currentIndex++;
      updateCounts();
      processNext();
      return;
    }

    statusText.innerText = 'Opening @' + username + ' (' + (currentIndex + 1) + '/' + targets.length + ')...';
    substatusText.innerText = 'Navigating profile in active Instagram session...';

    navigateToProfile(username);

    const btnInfo = await waitForProfileRender(username, 8000);

    if (!btnInfo || btnInfo.notFound) {
      skippedCount++;
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Account Not Found</span>';
      substatusText.innerText = '@' + username + ' does not exist or has been disabled.';
    } else if (btnInfo.timedOut) {
      skippedCount++;
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Load Timeout</span>';
      substatusText.innerText = '@' + username + ' took too long to load. Skipped to prevent blocking queue.';
    } else if (btnInfo.status === 'self_profile') {
      skippedCount++;
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Your Own Account</span>';
      substatusText.innerText = '@' + username + ' is your logged-in account.';
    } else if (btnInfo.status === 'already_following') {
      skippedCount++;
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Already Following</span>';
      substatusText.innerText = 'You are already following @' + username + '.';
    } else if (btnInfo.status === 'already_requested') {
      skippedCount++;
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Already Requested</span>';
      substatusText.innerText = 'Follow request is already pending for private account @' + username + '.';
    } else if (btnInfo.status === 'ready_to_follow') {
      statusText.innerText = 'Clicking Follow on @' + username + '...';
      substatusText.innerText = 'Dispatching genuine native follow action...';

      clickFollowButton(btnInfo.element);

      const outcome = await verifyFollowOutcome(5000);

      if (outcome.rateLimited) {
        statusText.innerHTML = '<span style="color:#ff7b72;">⚠️ Instagram Action Limit Detected</span>';
        substatusText.innerText = 'Instagram cooldown triggered. Pausing 60s to protect account...';
        await sleep(60000);
        return;
      } else if (outcome.success) {
        if (outcome.mode === 'requested') {
          requestedCount++;
          statusText.innerHTML = '<span style="color:#3fb950;">📩 Follow Request Sent @' + username + '</span>';
          substatusText.innerText = 'Private profile request confirmed in DOM!';
        } else {
          followedCount++;
          statusText.innerHTML = '<span style="color:#3fb950;">✓ Followed @' + username + '</span>';
          substatusText.innerText = 'Now following (' + followedCount + ' total followed)';
        }
      } else {
        failedCount++;
        statusText.innerHTML = '<span style="color:#ff7b72;">✗ Action not confirmed for @' + username + '</span>';
        substatusText.innerText = outcome.error || 'Instagram did not update button state.';
      }
    } else {
      skippedCount++;
      statusText.innerHTML = '<span style="color:#e3b341;">⏭ SKIPPED: Unknown State (@' + username + ')</span>';
      substatusText.innerText = 'Unhandled button state: ' + btnInfo.status;
    }

    currentIndex++;
    updateCounts();
    progBar.style.width = Math.round((currentIndex / targets.length) * 100) + '%';

    if (currentIndex < targets.length) {
      const delay = getDelay();
      let remaining = Math.round(delay / 1000);
      const timer = setInterval(() => {
        if (isPaused || isStopped) { clearInterval(timer); return; }
        remaining--;
        if (remaining > 0) {
          substatusText.innerText = 'Next profile in ' + remaining + 's (Pacing delay)...';
        } else {
          clearInterval(timer);
          processNext();
        }
      }, 1000);
    } else {
      let headline = '🎉 Bulk Follow Finished!';
      let headlineColor = '#3fb950';

      if (followedCount === 0 && requestedCount === 0 && skippedCount > 0) {
        headline = 'ℹ️ Completed (All Accounts Skipped)';
        headlineColor = '#e3b341';
      } else if (failedCount > 0 && followedCount === 0 && requestedCount === 0) {
        headline = '⚠️ Completed with Issues';
        headlineColor = '#ff7b72';
      } else if (skippedCount > 0) {
        headline = '✓ Completed (' + followedCount + ' followed, ' + skippedCount + ' skipped)';
      }

      statusText.innerHTML = '<span style="color:' + headlineColor + ';">' + headline + '</span>';
      substatusText.innerHTML = '<strong style="color:#3fb950;">' + followedCount + '</strong> followed · ' +
        (requestedCount > 0 ? '<strong style="color:#58a6ff;">' + requestedCount + '</strong> requested · ' : '') +
        '<strong style="color:#e3b341;">' + skippedCount + '</strong> skipped · ' +
        '<strong style="color:#ff7b72;">' + failedCount + '</strong> failed';

      toggleBtn.innerText = '✓ Finished';
      toggleBtn.disabled = true;

      try {
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch(e) {}
    }
  }

  toggleBtn.onclick = () => {
    if (toggleBtn.disabled) return;
    if (isPaused) {
      isPaused = false;
      toggleBtn.innerText = '⏸ Pause';
      processNext();
    } else {
      isPaused = true;
      toggleBtn.innerText = '▶ Resume';
      substatusText.innerText = 'Automation paused by user';
    }
  };

  stopBtn.onclick = () => {
    isStopped = true;
    isPaused = true;
    statusText.innerText = '🛑 Automation Stopped';
    substatusText.innerText = 'Queue halted at index ' + currentIndex + '/' + targets.length;
    toggleBtn.disabled = true;
  };

  closeBtn.onclick = () => {
    isStopped = true;
    isPaused = true;
    panel.remove();
  };

  // Auto-start on load
  toggleBtn.innerText = '⏸ Pause';
  isPaused = false;
  processNext();
})();`;
}
