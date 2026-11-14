/**
 * InstaExtract In-Browser Standalone Auditor
 * Self-contained extraction engine designed to run directly on instagram.com
 * Immune to CSP, CORS, and bot bans.
 */
(async function() {
  // Prevent duplicate instances
  if (document.getElementById('instaextract-hud')) {
    alert('InstaExtract is already running! Check the bottom-right corner of your screen.');
    return;
  }

  // Verify hostname
  if (!window.location.hostname.includes('instagram.com')) {
    alert('Please open https://www.instagram.com where you are logged in, then run this script or bookmarklet!');
    return;
  }

  // 1. Inject Floating HUD
  const hud = document.createElement('div');
  hud.id = 'instaextract-hud';
  hud.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'right: 24px',
    'z-index: 2147483647',
    'width: 380px',
    'background: #161b22',
    'color: #f0f6fc',
    'border: 1px solid #30363d',
    'border-radius: 14px',
    'padding: 20px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'box-shadow: 0 16px 48px rgba(0,0,0,0.85)',
    'font-size: 14px',
    'line-height: 1.5'
  ].join(';');

  hud.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:18px;">⚡</span>
        <strong style="font-size:16px; background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">InstaExtract</strong>
      </div>
      <button id="ie-close-btn" style="background:none; border:none; color:#8b949e; font-size:20px; cursor:pointer; line-height:1;" title="Close">&times;</button>
    </div>
    <div id="ie-status" style="font-weight:600; color:#58a6ff; margin-bottom:6px;">Initializing audit...</div>
    <div id="ie-substatus" style="color:#8b949e; font-size:12px; margin-bottom:12px;">Reading session context...</div>
    <div style="height:8px; background:#21262d; border-radius:99px; overflow:hidden; margin-bottom:14px;">
      <div id="ie-progress" style="width:0%; height:100%; background:linear-gradient(45deg,#f09433,#dc2743,#bc1888); transition:width 0.3s ease;"></div>
    </div>
    <div id="ie-action-container" style="display:none; margin-bottom:14px;"></div>
    <div style="font-size:11px; color:#8b949e; display:flex; justify-content:space-between; border-top:1px solid #30363d; padding-top:10px;">
      <span>🔒 100% Client-Side (No Passwords)</span>
      <span>🏡 Residential Paced</span>
    </div>
  `;
  document.body.appendChild(hud);

  const statusEl = document.getElementById('ie-status');
  const substatusEl = document.getElementById('ie-substatus');
  const progressEl = document.getElementById('ie-progress');
  const actionContainer = document.getElementById('ie-action-container');
  const closeBtn = document.getElementById('ie-close-btn');

  let isAborted = false;
  closeBtn.onclick = () => {
    isAborted = true;
    hud.remove();
  };

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  // 2. Resolve CSRF Token and Viewer Profile
  function getCsrfToken() {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  async function resolveViewer(csrf) {
    let userId = '';
    let username = '';
    let fullName = '';
    let profilePicUrl = '';

    // 1. Check ds_user_id cookie
    const m = document.cookie.match(/ds_user_id=([0-9]+)/);
    if (m && m[1]) userId = m[1];

    // 2. Try window._sharedData
    try {
      if (window._sharedData && window._sharedData.config) {
        if (window._sharedData.config.viewerId) userId = userId || String(window._sharedData.config.viewerId);
        if (window._sharedData.config.viewer) {
          username = username || window._sharedData.config.viewer.username || '';
          fullName = fullName || window._sharedData.config.viewer.full_name || '';
          profilePicUrl = profilePicUrl || window._sharedData.config.viewer.profile_pic_url || '';
        }
      }
    } catch(e) {}

    // 3. Try /api/v1/accounts/current_user/?edit=true
    try {
      const res = await fetch('/api/v1/accounts/current_user/?edit=true', {
        headers: {
          'x-csrftoken': csrf,
          'x-ig-app-id': '936619743392459',
          'x-asbd-id': '129477',
          'x-requested-with': 'XMLHttpRequest'
        }
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.user) {
          userId = userId || String(d.user.pk || d.user.id || '');
          username = username || d.user.username || '';
          fullName = fullName || d.user.full_name || '';
          profilePicUrl = profilePicUrl || d.user.profile_pic_url || '';
        }
      }
    } catch(e) {}

    // 4. Try scanning DOM links for profile link
    if (!username) {
      try {
        const links = Array.from(document.querySelectorAll('a[href^="/"]'));
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          const match = href.match(/^\/([a-zA-Z0-9._]+)\/?$/);
          if (match && !['explore', 'reels', 'direct', 'stories', 'your_activity', 'accounts'].includes(match[1])) {
            const img = a.querySelector('img');
            if (img && (img.alt?.includes('profile picture') || a.getAttribute('role') === 'link')) {
              username = match[1];
              break;
            }
          }
        }
      } catch(e) {}
    }

    // 5. Try scanning script tags for actor/viewer data
    if (!userId || !username) {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        const txt = s.textContent || '';
        if (!userId) {
          const matchId = txt.match(/"viewerId":"([0-9]+)"/) || txt.match(/"actorID":"([0-9]+)"/) || txt.match(/"id":"([0-9]+)","username"/);
          if (matchId && matchId[1]) userId = matchId[1];
        }
        if (!username) {
          const matchUser = txt.match(/"username":"([a-zA-Z0-9._]+)"/);
          if (matchUser && matchUser[1]) username = matchUser[1];
        }
      }
    }

    // 6. If userId found but not username or fullName, fetch /api/v1/users/{userId}/info/
    if (userId && !username) {
      try {
        const res = await fetch(`/api/v1/users/${userId}/info/`, {
          headers: {
            'x-csrftoken': csrf,
            'x-ig-app-id': '936619743392459',
            'x-asbd-id': '129477',
            'x-requested-with': 'XMLHttpRequest'
          }
        });
        if (res.ok) {
          const d = await res.json();
          if (d && d.user) {
            username = d.user.username || '';
            fullName = d.user.full_name || '';
            profilePicUrl = d.user.profile_pic_url || '';
          }
        }
      } catch(e) {}
    }

    // 7. Prompt fallback
    if (!userId) {
      const promptUsername = prompt('InstaExtract: Could not auto-detect your user ID. Please enter your Instagram username:');
      if (promptUsername && promptUsername.trim()) {
        username = promptUsername.trim();
        try {
          const res = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
            headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf }
          });
          if (res.ok) {
            const d = await res.json();
            if (d && d.data && d.data.user) {
              userId = String(d.data.user.id || '');
              fullName = d.data.user.full_name || '';
              profilePicUrl = d.data.user.profile_pic_url || '';
            }
          }
        } catch(e) {}
      }
    }

    return { userId, username, fullName, profilePicUrl };
  }

  const csrf = getCsrfToken();
  if (!csrf) {
    statusEl.innerText = '❌ Authentication Error';
    substatusEl.innerText = 'Could not find csrftoken cookie. Please make sure you are logged in to instagram.com!';
    return;
  }

  statusEl.innerText = 'Resolving user profile...';
  const viewer = await resolveViewer(csrf);
  if (!viewer.userId) {
    statusEl.innerText = '❌ Login session not found';
    substatusEl.innerText = 'Please ensure you are fully logged into instagram.com and refresh.';
    return;
  }
  const userId = viewer.userId;

  // 3. Helper to fetch paginated friendships
  async function fetchAll(type, userId, csrf) {
    const users = [];
    let maxId = '';
    let pageCount = 0;

    while (true) {
      if (isAborted) throw new Error('Audit cancelled by user.');
      pageCount++;

      let url = `/api/v1/friendships/${userId}/${type}/?count=50`;
      if (type === 'followers') {
        url += '&search_surface=follow_list_page';
      }
      if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`;

      statusEl.innerText = `Fetching ${type === 'followers' ? 'Followers' : 'Following'}...`;
      substatusEl.innerText = `Collected ${users.length} ${type} (Page ${pageCount})...`;

      const res = await fetch(url, {
        headers: {
          'x-csrftoken': csrf,
          'x-ig-app-id': '936619743392459',
          'x-asbd-id': '129477',
          'x-requested-with': 'XMLHttpRequest'
        }
      });

      if (!res.ok) {
        if (res.status === 429) {
          substatusEl.innerText = 'Rate limited. Pausing 10s before residential retry...';
          await sleep(10000);
          continue;
        }
        let errDetails = '';
        try {
          const errData = await res.json();
          if (errData && errData.message) errDetails = ` (${errData.message})`;
        } catch(e) {}
        throw new Error(`Failed to fetch ${type}: HTTP ${res.status}${errDetails}`);
      }

      const data = await res.json();
      const list = data.users || [];
      for (const u of list) {
        users.push({
          username: u.username,
          pk: String(u.pk),
          fullName: u.full_name || '',
          isPrivate: !!u.is_private,
          isVerified: !!u.is_verified,
          profilePicUrl: u.profile_pic_url || '',
          hasAnonymousProfilePicture: !!u.has_anonymous_profile_picture,
          latestReelMedia: u.latest_reel_media || 0
        });
      }

      if (type === 'followers') {
        progressEl.style.width = '25%';
      } else {
        progressEl.style.width = '65%';
      }

      if (!data.next_max_id) break;
      maxId = data.next_max_id;

      // Humanized jitter pause (1.2s - 2.2s)
      const delay = Math.floor(Math.random() * 1000) + 1200;
      await sleep(delay);
    }

    return users;
  }

  try {
    // 4. Fetch Followers and Following
    const followers = await fetchAll('followers', userId, csrf);
    progressEl.style.width = '50%';
    await sleep(1500);

    const following = await fetchAll('following', userId, csrf);
    progressEl.style.width = '85%';

    // 5. Relational Analysis
    statusEl.innerText = 'Analyzing relationships...';
    substatusEl.innerText = `Comparing ${followers.length} followers vs ${following.length} following...`;

    const followerMap = new Map();
    followers.forEach(u => followerMap.set(u.username.toLowerCase(), u));

    const followingMap = new Map();
    following.forEach(u => followingMap.set(u.username.toLowerCase(), u));

    const mutuals = [];
    const notFollowingBack = [];
    const fans = [];

    // Analyze Following
    following.forEach(u => {
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
    });

    // Analyze Fans (Followers you do not follow)
    followers.forEach(u => {
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
    });

    // Unified list
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

    const analyzedUsers = Array.from(uniqueUsers.values());

    const activeUsername = viewer.username || (viewer.userId ? `user_${viewer.userId}` : 'personal_account');
    const resultDataset = {
      account: {
        username: activeUsername,
        fullName: viewer.fullName || '',
        profilePicUrl: viewer.profilePicUrl || '',
        isSampleDemo: false
      },
      stats: {
        notFollowingBack: notFollowingBack.length,
        fans: fans.length,
        mutuals: mutuals.length,
        following: following.length,
        followers: followers.length
      },
      users: analyzedUsers
    };

    progressEl.style.width = '100%';
    statusEl.innerText = `✅ Audit Complete for @${activeUsername}!`;
    substatusEl.innerText = `Found ${notFollowingBack.length} non-mutuals (${mutuals.length} mutuals, ${fans.length} fans).`;

    // 6. Launch Dashboard with Zero-CSP cross-window data transfer
    const serialized = JSON.stringify(resultDataset);
    const dashboardUrl = 'https://instaextract.in/dashboard.html';

    function openDashboardWindow() {
      const win = window.open(dashboardUrl, '_blank');
      if (win) {
        win.name = serialized; // Transferred via window.name (immune to CSP & CORS)
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          try {
            win.postMessage({ type: 'INSTA_DATASET', data: resultDataset }, 'https://instaextract.in');
          } catch(e) {}
          if (attempts >= 10) clearInterval(interval);
        }, 500);
        return true;
      }
      return false;
    }

    const autoOpened = openDashboardWindow();

    // 7. Render Completion Actions inside HUD
    actionContainer.style.display = 'block';
    actionContainer.innerHTML = `
      <div style="background:#0d1117; border:1px solid #30363d; border-radius:8px; padding:10px; margin-bottom:10px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #21262d;">
          <span style="color:#58a6ff; font-weight:700;">👤 Audited Account:</span>
          <span style="color:#f0f6fc; font-weight:700; font-family:monospace;">@${activeUsername}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="color:#ff7b72;">🚫 Don't Follow Back:</span>
          <strong>${notFollowingBack.length}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="color:#58a6ff;">🤝 Mutual Friends:</span>
          <strong>${mutuals.length}</strong>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:#e3b341;">⭐ Fans (Not Followed):</span>
          <strong>${fans.length}</strong>
        </div>
      </div>
      <button id="ie-open-btn" style="width:100%; background:linear-gradient(45deg,#f09433,#dc2743,#bc1888); color:white; border:none; border-radius:8px; padding:11px; font-weight:700; cursor:pointer; font-size:14px; margin-bottom:8px; box-shadow:0 4px 14px rgba(225,48,108,0.4);">
        ${autoOpened ? '🚀 View Dashboard Tab' : '🚀 Open Dashboard Now (Click)'}
      </button>
      <div style="display:flex; gap:8px;">
        <button id="ie-copy-btn" style="flex:1; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; padding:7px; font-size:11px; cursor:pointer;">📋 Copy JSON</button>
        <button id="ie-dl-btn" style="flex:1; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; padding:7px; font-size:11px; cursor:pointer;">💾 Download</button>
      </div>
    `;

    document.getElementById('ie-open-btn').onclick = () => {
      openDashboardWindow();
    };

    document.getElementById('ie-copy-btn').onclick = async function() {
      try {
        await navigator.clipboard.writeText(serialized);
        this.innerText = '✓ Copied!';
        setTimeout(() => this.innerText = '📋 Copy JSON', 2500);
      } catch(e) {
        prompt('Copy your dataset JSON:', serialized);
      }
    };

    document.getElementById('ie-dl-btn').onclick = () => {
      const blob = new Blob([serialized], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `instaextract_${userId}_${Date.now()}.json`;
      a.click();
    };

  } catch(err) {
    if (!isAborted) {
      statusEl.innerText = '⚠️ Audit Error';
      substatusEl.innerText = err.message || 'An unexpected error occurred.';
    }
  }
})();
