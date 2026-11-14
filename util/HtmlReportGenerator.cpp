#include "HtmlReportGenerator.h"
#include "../nlohmann/json.hpp"
#include <fstream>
#include <iostream>
#include <cstdlib>
#include <unordered_map>
#include <algorithm>

using json = nlohmann::json;

bool HtmlReportGenerator::generateReport(const AuditDataset& dataset,
                                        const std::string& outputPath) {
    json root;
    root["stats"] = {
        {"notFollowingBack", dataset.notFollowingBack.size()},
        {"fans", dataset.fans.size()},
        {"mutuals", dataset.mutuals.size()},
        {"following", dataset.allFollowing.size()},
        {"followers", dataset.allFollowers.size()}
    };

    std::unordered_map<std::string, json> uniqueUsersMap;

    auto addUsers = [&](const std::vector<InstagramUser>& users, const std::string& defaultRel) {
        for (const auto& u : users) {
            std::string lower = u.username;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
            
            json j;
            if (uniqueUsersMap.find(lower) != uniqueUsersMap.end()) {
                j = uniqueUsersMap[lower];
            } else {
                j["pk"] = u.pk;
                j["username"] = u.username;
                j["fullName"] = u.fullName;
                j["isPrivate"] = u.isPrivate;
                j["isVerified"] = u.isVerified;
                j["profilePicUrl"] = u.profilePicUrl;
                j["hasAnonymousProfilePicture"] = u.hasAnonymousProfilePicture;
                j["latestReelMedia"] = u.latestReelMedia;
                j["followedByViewer"] = u.followedByViewer;
                j["followsViewer"] = u.followsViewer;
                j["relationship"] = u.relationship.empty() ? defaultRel : u.relationship;
            }

            if (u.followedByViewer) j["followedByViewer"] = true;
            if (u.followsViewer) j["followsViewer"] = true;
            if (!u.relationship.empty() && u.relationship != "unknown") {
                j["relationship"] = u.relationship;
            } else if (j["relationship"] == "unknown") {
                j["relationship"] = defaultRel;
            }

            uniqueUsersMap[lower] = j;
        }
    };

    addUsers(dataset.allFollowing, "following");
    addUsers(dataset.allFollowers, "follower");
    addUsers(dataset.notFollowingBack, "not_following_back");
    addUsers(dataset.fans, "fan");
    addUsers(dataset.mutuals, "mutual");

    json usersArray = json::array();
    for (auto& pair : uniqueUsersMap) {
        json& j = pair.second;
        bool fBy = j.value("followedByViewer", false);
        bool fMe = j.value("followsViewer", false);
        if (fBy && fMe) {
            j["relationship"] = "mutual";
        } else if (fBy && !fMe) {
            j["relationship"] = "not_following_back";
        } else if (!fBy && fMe) {
            j["relationship"] = "fan";
        }
        usersArray.push_back(j);
    }
    root["users"] = usersArray;

    std::string dataJson = root.dump();

    std::string html = R"RAW(<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>InstaExtract - Instagram Audit & Review</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --accent: #e1306c;
      --accent-gradient: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --public-bg: rgba(46, 160, 67, 0.15);
      --public-color: #3fb950;
      --public-border: rgba(46, 160, 67, 0.4);
      --private-bg: rgba(210, 153, 34, 0.15);
      --private-color: #d29922;
      --private-border: rgba(210, 153, 34, 0.4);
      --verified-color: #3897f0;
      --story-border: #e1306c;
      --tag-fan: #a371f7;
      --tag-mutual: #58a6ff;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 20px 16px;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 16px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 1.7rem;
      letter-spacing: -0.5px;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .stats-summary {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .progress-box {
      text-align: right;
    }
    .progress-text {
      color: var(--text-muted);
      font-size: 0.88rem;
      display: block;
      margin-bottom: 4px;
    }
    .progress-track {
      width: 160px;
      height: 6px;
      background: var(--card-border);
      border-radius: 99px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--public-color);
      width: 0%;
      transition: width 0.3s ease;
    }
    /* Popup Blocker Warning Banner */
    .popup-alert {
      display: none;
      background: rgba(248, 81, 73, 0.15);
      border: 1px solid #f85149;
      color: #ff7b72;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 0.92rem;
    }
    .popup-alert strong { color: white; }
    .popup-close {
      background: none;
      border: none;
      color: #ff7b72;
      font-size: 1.2rem;
      cursor: pointer;
    }
    /* Primary Category Tabs */
    .category-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .cat-btn {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 10px 18px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.92rem;
      transition: all 0.2s;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cat-btn:hover {
      background: #21262d;
      color: var(--text);
    }
    .cat-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .pill-count {
      background: rgba(255, 255, 255, 0.2);
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 0.78rem;
    }
    .cat-btn.active .pill-count {
      background: rgba(0, 0, 0, 0.3);
    }
    /* Filter & Controls Panel */
    .controls-panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .filter-chips-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .filter-chip-label {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-right: 4px;
    }
    .chip {
      background: #21262d;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 5px 12px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.15s;
      user-select: none;
    }
    .chip:hover {
      background: #30363d;
      color: var(--text);
    }
    .chip.active {
      background: rgba(225, 48, 108, 0.2);
      border-color: var(--accent);
      color: #ff7b72;
      font-weight: 600;
    }
    .actions-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .search-box {
      background: #0d1117;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 9px 14px;
      border-radius: 6px;
      flex-grow: 1;
      min-width: 220px;
      font-size: 0.9rem;
    }
    .search-box:focus {
      outline: none;
      border-color: var(--accent);
    }
    .sort-select {
      background: #0d1117;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 9px 12px;
      border-radius: 6px;
      font-size: 0.88rem;
      cursor: pointer;
    }
    .btn {
      background: var(--accent-gradient);
      color: white;
      border: none;
      padding: 9px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.88rem;
      transition: opacity 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background: #21262d;
      color: var(--text);
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover { background: #30363d; }
    .btn-danger {
      background: rgba(248, 81, 73, 0.15);
      border: 1px solid rgba(248, 81, 73, 0.4);
      color: #ff7b72;
    }
    .btn-danger:hover { background: rgba(248, 81, 73, 0.3); }

    /* Review Mode Banner */
    .quick-review-bar {
      background: linear-gradient(90deg, rgba(225, 48, 108, 0.12), rgba(88, 166, 255, 0.12));
      border: 1px solid rgba(225, 48, 108, 0.3);
      border-radius: 8px;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 20px;
    }
    .quick-review-info {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.92rem;
    }

    /* Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: border-color 0.15s, transform 0.15s;
    }
    .card:hover {
      border-color: rgba(225, 48, 108, 0.6);
      transform: translateY(-2px);
    }
    .card.reviewed {
      opacity: 0.45;
      background: #0d1117;
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .profile-info {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }
    .chk-custom {
      cursor: pointer;
      width: 18px;
      height: 18px;
      accent-color: var(--accent);
      flex-shrink: 0;
    }
    .avatar-wrap {
      position: relative;
      width: 46px;
      height: 46px;
      flex-shrink: 0;
    }
    .avatar {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
      background: #21262d;
      border: 2px solid transparent;
    }
    .avatar.has-story {
      border: 2px solid var(--story-border);
      padding: 2px;
      background: var(--accent-gradient);
    }
    .user-details {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .user-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .username {
      color: #58a6ff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.98rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .username:hover { text-decoration: underline; }
    .verified-icon {
      color: var(--verified-color);
      font-size: 0.85rem;
      font-weight: bold;
      flex-shrink: 0;
    }
    .full-name {
      color: #c9d1d9;
      font-size: 0.84rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
      margin-top: 3px;
      display: block;
    }
    .card-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid rgba(48, 54, 61, 0.4);
      flex-wrap: wrap;
    }
    .tags-row {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .badge {
      font-size: 0.7rem;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .badge.public {
      background: var(--public-bg);
      color: var(--public-color);
      border: 1px solid var(--public-border);
    }
    .badge.private {
      background: var(--private-bg);
      color: var(--private-color);
      border: 1px solid var(--private-border);
    }
    .badge.story {
      background: rgba(225, 48, 108, 0.2);
      color: #ff7b72;
      border: 1px solid rgba(225, 48, 108, 0.4);
    }
    .badge.rel-mutual {
      background: rgba(88, 166, 255, 0.15);
      color: var(--tag-mutual);
      border: 1px solid rgba(88, 166, 255, 0.4);
    }
    .badge.rel-fan {
      background: rgba(163, 113, 247, 0.15);
      color: var(--tag-fan);
      border: 1px solid rgba(163, 113, 247, 0.4);
    }
    .badge.rel-not-following {
      background: rgba(248, 81, 73, 0.15);
      color: #ff7b72;
      border: 1px solid rgba(248, 81, 73, 0.4);
    }
    .category-desc-bar {
      background: rgba(22, 27, 34, 0.9);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 11px 16px;
      margin-bottom: 16px;
      font-size: 0.92rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .category-desc-bar strong { color: #f0f6fc; }
    .category-desc-bar em { color: #ff7b72; font-style: normal; font-weight: 600; }
    .open-btn {
      background: #21262d;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      border-radius: 5px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
      transition: all 0.15s;
    }
    .open-btn:hover {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .empty-msg {
      grid-column: 1 / -1;
      text-align: center;
      padding: 50px 20px;
      color: var(--text-muted);
      font-size: 1.1rem;
    }
    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #21262d;
      color: var(--text);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px 20px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      font-size: 0.9rem;
      display: none;
      z-index: 1000;
    }
    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: 16px;
    }
    .modal-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      max-width: 600px;
      width: 100%;
      box-shadow: 0 12px 36px rgba(0,0,0,0.6);
      padding: 22px;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .modal-header h2 { margin: 0; font-size: 1.25rem; }
    .modal-close {
      background: none; border: none; color: #8b949e; font-size: 1.5rem; cursor: pointer;
    }
    .modal-close:hover { color: var(--text); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>InstaExtract</h1>
      </div>
      <div class="stats-summary">
        <div class="progress-box">
          <span class="progress-text" id="progressText">0 / 0 reviewed (0%)</span>
          <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
        </div>
      </div>
    </header>

    <!-- Popup Warning Banner -->
    <div class="popup-alert" id="popupWarning">
      <div>
        <strong>⚠️ Pop-ups were blocked by your browser!</strong><br>
        Your browser only allowed 1 tab to open. To open 5 or 10 tabs at once: Click the <em>pop-up icon</em> in your browser address bar (top right) and select <strong>"Always allow pop-ups for this site"</strong>.
      </div>
      <button class="popup-close" onclick="dismissPopupWarning()">&times;</button>
    </div>

    <!-- Category Tabs -->
    <div class="category-tabs">
      <button class="cat-btn active" id="catNotFollowingBack" onclick="setCategory('not_following_back')" title="Accounts you follow that do not follow you back">
        🚫 Don't Follow Back <span class="pill-count" id="countNotFollowingBack">0</span>
      </button>
      <button class="cat-btn" id="catFans" onclick="setCategory('fans')" title="Accounts that follow you, but you don't follow back">
        ⭐ Fans (Not Followed Back) <span class="pill-count" id="countFans">0</span>
      </button>
      <button class="cat-btn" id="catMutuals" onclick="setCategory('mutuals')" title="Accounts where both of you follow each other">
        🤝 Mutual Friends <span class="pill-count" id="countMutuals">0</span>
      </button>
      <button class="cat-btn" id="catFollowers" onclick="setCategory('followers')" title="All accounts following you (Mutual Friends + Fans)">
        📥 All Followers <span class="pill-count" id="countFollowers">0</span>
      </button>
      <button class="cat-btn" id="catFollowing" onclick="setCategory('following')" title="All accounts you follow (Mutual Friends + Don't Follow Back)">
        📤 All Following <span class="pill-count" id="countFollowing">0</span>
      </button>
    </div>

    <!-- Active Category Context Banner -->
    <div class="category-desc-bar" id="categoryDescBar">
      <span>🚫 <strong>Don't Follow Back:</strong> Showing accounts that <em>you follow</em>, but who <em>do not follow you back</em>. These are your prime unfollow candidates.</span>
    </div>

    <!-- Quick Reviewer (Immune to Popup Blockers) -->
    <div class="quick-review-bar">
      <div class="quick-review-info">
        <span>⚡ <strong>Quick Reviewer:</strong> Open next pending profile (never blocked by popup blockers).</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="quickNextBtn" onclick="openNextSingle()">➡️ Open Next Pending (@...)</button>
        <button class="btn btn-secondary" onclick="markNextSingleReviewed()">✓ Mark Next Reviewed</button>
      </div>
    </div>

    <!-- Controls Panel -->
    <div class="controls-panel">
      <!-- Multi-Filter Chips -->
      <div class="filter-chips-row">
        <span class="filter-chip-label">Filters:</span>
        <span class="chip" id="chipPublic" onclick="toggleChip('public')">🌐 Public</span>
        <span class="chip" id="chipPrivate" onclick="toggleChip('private')">🔒 Private</span>
        <span class="chip" id="chipVerified" onclick="toggleChip('verified')">✓ Verified</span>
        <span class="chip" id="chipStory" onclick="toggleChip('story')">⭕ Has Story</span>
        <span class="chip" id="chipCustomAvatar" onclick="toggleChip('customAvatar')">🖼️ Has Avatar</span>
        <span class="chip" id="chipPending" onclick="toggleChip('pending')">⏳ Pending</span>
        <span class="chip" id="chipReviewed" onclick="toggleChip('reviewed')">✓ Reviewed</span>
      </div>

      <!-- Action Toolbar -->
      <div class="actions-row">
        <input type="text" class="search-box" id="searchBox" placeholder="Search by username or full name..." oninput="renderCards()">
        
        <select class="sort-select" id="sortSelect" onchange="renderCards()">
          <option value="user_asc">Sort: Username (A → Z)</option>
          <option value="user_desc">Sort: Username (Z → A)</option>
          <option value="name_asc">Sort: Full Name (A → Z)</option>
          <option value="verified_first">Sort: Verified First</option>
          <option value="story_first">Sort: Active Story First</option>
          <option value="private_first">Sort: Private First</option>
          <option value="public_first">Sort: Public First</option>
        </select>

        <button class="btn" onclick="openNextBatch(5)">Open Next 5 Tabs</button>
        <button class="btn btn-secondary" onclick="openNextBatch(10)">Open Next 10</button>
        <button class="btn btn-secondary" onclick="markAllVisibleReviewed()">Mark Filtered Reviewed</button>
        <button class="btn btn-secondary" onclick="exportToCsv()">📥 Export CSV</button>
        <button class="btn btn-danger" onclick="openUnfollowModal()">🎯 Export Unfollow Queue</button>
        <button class="btn btn-secondary" onclick="resetProgress()">🔄 Reset Progress</button>
      </div>
    </div>

    <!-- Grid -->
    <div class="grid" id="profileGrid"></div>
  </div>

  <!-- Unfollow Target Confirmation Modal -->
  <div id="unfollowModal" class="modal-overlay" style="display:none;">
    <div class="modal-card">
      <div class="modal-header">
        <h2>🎯 Unfollow Target Queue Confirmation</h2>
        <button class="modal-close" onclick="closeUnfollowModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="alert-box" style="background:rgba(46,160,67,0.15); border:1px solid #3fb950; color:#3fb950; padding:12px 14px; border-radius:6px; margin-bottom:12px; font-size:0.9rem;">
          🛡️ <strong>Safety Guarantee:</strong>
          <span id="keepCountText">0 accounts</span> are CHECKED and will be <strong>KEPT (PROTECTED)</strong>. Mutual friends and fans are strictly excluded.
        </div>
        <p style="margin-bottom:8px; font-size:0.95rem;">
          The following <strong id="unfollowCountText" style="color:#ff7b72;">0 accounts</strong> are UNCHECKED in "Not Following Back" and will be queued for unfollowing:
        </p>
        <div id="unfollowPreviewList" style="max-height:220px; overflow-y:auto; background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:10px 14px; font-family:monospace; font-size:0.85rem; margin-bottom:14px; color:#c9d1d9;">
        </div>
        <div style="background:#21262d; border:1px solid #30363d; border-radius:6px; padding:12px 14px; margin-bottom:14px; font-size:0.88rem; color:#8b949e; line-height:1.5;">
          <strong style="color:#f0f6fc;">🌐 Option 1 — Entirely in Browser (No terminal needed):</strong><br>
          Click <em>"🚀 Copy In-Browser Automation Script"</em> below, switch to your <strong style="color:#f0f6fc;">Instagram tab</strong>, open Console (<kbd>Cmd + Option + J</kbd> on Mac or <kbd>F12</kbd>), and press <kbd>Enter</kbd> to paste. A sleek floating control panel will appear right on Instagram with Start/Pause controls and humanized pacing!
          <hr style="border:none; border-top:1px solid #30363d; margin:10px 0;">
          <strong style="color:#f0f6fc;">💻 Option 2 — Terminal Runner:</strong><br>
          Click <em>"💾 Download unfollow_targets.json"</em> into this project folder and run:
          <code style="color:#f0f6fc; display:block; margin-top:4px; font-family:monospace;">./unfollow_runner.py</code>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <button class="btn btn-secondary" onclick="copyUnfollowList()">📋 Copy Usernames</button>
          <button class="btn btn-secondary" onclick="downloadUnfollowJson()">💾 Download JSON</button>
          <button class="btn" style="background:linear-gradient(45deg, #f09433, #dc2743, #bc1888);" onclick="copyInBrowserScript()">🚀 Copy In-Browser Script</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const data = )RAW" + dataJson + R"RAW(;
    const allUsers = data.users || [];

    // Initialize Category Counts
    document.getElementById('countNotFollowingBack').innerText = data.stats.notFollowingBack || 0;
    document.getElementById('countFans').innerText = data.stats.fans || 0;
    document.getElementById('countMutuals').innerText = data.stats.mutuals || 0;
    document.getElementById('countFollowing').innerText = data.stats.following || 0;
    document.getElementById('countFollowers').innerText = data.stats.followers || 0;

    let currentCategory = 'not_following_back';
    let activeChips = {
      public: false,
      private: false,
      verified: false,
      story: false,
      customAvatar: false,
      pending: false,
      reviewed: false
    };

    let reviewed = JSON.parse(localStorage.getItem('instaextract_reviewed_v4') || '{}');

    const categoryDescriptions = {
      not_following_back: "🚫 <strong>Don't Follow Back:</strong> Showing accounts that <em>you follow</em>, but who <em>do not follow you back</em>. These are your prime unfollow candidates.",
      fans: "⭐ <strong>Fans (Not Followed Back):</strong> Showing accounts that <em>follow you</em>, but whom <em>you do not follow back</em>. These are your dedicated followers/fans.",
      mutuals: "🤝 <strong>Mutual Friends:</strong> Showing accounts where <em>both you and they follow each other</em>.",
      followers: "📥 <strong>All Followers:</strong> Showing <em>everyone who follows you</em> — both Mutual Friends and Fans.",
      following: "📤 <strong>All Following:</strong> Showing <em>everyone you follow</em> — both Mutual Friends and Non-followers."
    };

    function setCategory(cat) {
      currentCategory = cat;
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      if (cat === 'not_following_back') document.getElementById('catNotFollowingBack').classList.add('active');
      if (cat === 'fans') document.getElementById('catFans').classList.add('active');
      if (cat === 'mutuals') document.getElementById('catMutuals').classList.add('active');
      if (cat === 'following') document.getElementById('catFollowing').classList.add('active');
      if (cat === 'followers') document.getElementById('catFollowers').classList.add('active');

      const descEl = document.getElementById('categoryDescBar');
      if (descEl && categoryDescriptions[cat]) {
        descEl.innerHTML = categoryDescriptions[cat];
      }
      renderCards();
    }

    function toggleChip(chipName) {
      activeChips[chipName] = !activeChips[chipName];
      const chipEl = document.getElementById('chip' + chipName.charAt(0).toUpperCase() + chipName.slice(1));
      if (chipEl) {
        if (activeChips[chipName]) chipEl.classList.add('active');
        else chipEl.classList.remove('active');
      }
      renderCards();
    }

    function getFilteredAndSortedUsers() {
      const q = document.getElementById('searchBox').value.trim().toLowerCase();
      const sortMode = document.getElementById('sortSelect').value;

      let list = allUsers.filter(u => {
        // Category Filter
        if (currentCategory === 'not_following_back' && !(u.followedByViewer && !u.followsViewer)) return false;
        if (currentCategory === 'fans' && !(!u.followedByViewer && u.followsViewer)) return false;
        if (currentCategory === 'mutuals' && !(u.followedByViewer && u.followsViewer)) return false;
        if (currentCategory === 'following' && !u.followedByViewer) return false;
        if (currentCategory === 'followers' && !u.followsViewer) return false;

        // Multi-Chips
        const isRev = !!reviewed[u.username];
        if (activeChips.public && u.isPrivate) return false;
        if (activeChips.private && !u.isPrivate) return false;
        if (activeChips.verified && !u.isVerified) return false;
        if (activeChips.story && !(u.latestReelMedia > 0)) return false;
        if (activeChips.customAvatar && u.hasAnonymousProfilePicture) return false;
        if (activeChips.pending && isRev) return false;
        if (activeChips.reviewed && !isRev) return false;

        // Search text
        if (q) {
          const matchUser = u.username.toLowerCase().includes(q);
          const matchName = u.fullName ? u.fullName.toLowerCase().includes(q) : false;
          if (!matchUser && !matchName) return false;
        }

        return true;
      });

      // Sorting
      list.sort((a, b) => {
        if (sortMode === 'user_asc') return a.username.localeCompare(b.username);
        if (sortMode === 'user_desc') return b.username.localeCompare(a.username);
        if (sortMode === 'name_asc') return (a.fullName || a.username).localeCompare(b.fullName || b.username);
        if (sortMode === 'verified_first') return (b.isVerified ? 1 : 0) - (a.isVerified ? 1 : 0);
        if (sortMode === 'story_first') return (b.latestReelMedia > 0 ? 1 : 0) - (a.latestReelMedia > 0 ? 1 : 0);
        if (sortMode === 'private_first') return (b.isPrivate ? 1 : 0) - (a.isPrivate ? 1 : 0);
        if (sortMode === 'public_first') return (a.isPrivate ? 1 : 0) - (b.isPrivate ? 1 : 0);
        return 0;
      });

      return list;
    }

    function renderCards() {
      const grid = document.getElementById('profileGrid');
      grid.innerHTML = '';
      const filtered = getFilteredAndSortedUsers();

      // Update Quick Reviewer Next Profile Button
      const pendingInFilter = filtered.filter(u => !reviewed[u.username]);
      const nextBtn = document.getElementById('quickNextBtn');
      if (pendingInFilter.length > 0) {
        nextBtn.innerText = `➡️ Open Next Pending (@${pendingInFilter[0].username})`;
        nextBtn.disabled = false;
      } else {
        nextBtn.innerText = `✓ All Pending Reviewed in Filter`;
        nextBtn.disabled = true;
      }

      if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-msg">No profiles match the current filter or search criteria.</div>';
        updateProgress();
        return;
      }

      filtered.forEach(p => {
        const isRev = !!reviewed[p.username];
        const card = document.createElement('div');
        card.className = 'card' + (isRev ? ' reviewed' : '');

        const hasStory = (p.latestReelMedia > 0);
        const avatarUrl = p.profilePicUrl && !p.hasAnonymousProfilePicture
          ? p.profilePicUrl
          : `https://ui-avatars.com/api/?name=${encodeURIComponent(p.username)}&background=21262d&color=8b949e`;

        let relBadge = '';
        if (p.relationship === 'mutual' || (p.followedByViewer && p.followsViewer)) {
          relBadge = '<span class="badge rel-mutual" title="Mutual: You and this account follow each other">🤝 Mutual Friend</span>';
        } else if (p.relationship === 'fan' || (!p.followedByViewer && p.followsViewer)) {
          relBadge = '<span class="badge rel-fan" title="Fan: Follows you, but you do not follow back">⭐ Fan (Not Followed)</span>';
        } else if (p.relationship === 'not_following_back' || (p.followedByViewer && !p.followsViewer)) {
          relBadge = '<span class="badge rel-not-following" title="You follow, but this account does not follow you back">🚫 Doesn\'t Follow Back</span>';
        }

        const displayName = p.fullName && p.fullName.trim().length > 0 ? p.fullName : '';

        card.innerHTML = `
          <div class="card-top">
            <div class="profile-info">
              <input type="checkbox" class="chk-custom" ${isRev ? 'checked' : ''} onchange="toggleReviewed('${p.username}', this.checked)">
              <div class="avatar-wrap">
                <img class="avatar ${hasStory ? 'has-story' : ''}" src="${avatarUrl}" alt="${p.username}" onerror="this.src='https://ui-avatars.com/api/?name=${p.username}&background=21262d&color=8b949e'">
              </div>
              <div class="user-details">
                <div class="user-row">
                  <a class="username" href="https://www.instagram.com/${p.username}/" target="_blank" onclick="markReviewed('${p.username}')" title="@${p.username}">@${p.username}</a>
                  ${p.isVerified ? '<span class="verified-icon" title="Verified Account">✓</span>' : ''}
                </div>
                ${displayName ? `<span class="full-name" title="${displayName}">${displayName}</span>` : `<span class="full-name" style="opacity:0.45; font-style:italic;">No display name</span>`}
              </div>
            </div>
            <button class="open-btn" onclick="openProfile('${p.username}')">Open ↗</button>
          </div>
          <div class="card-bottom">
            <div class="tags-row">
              ${relBadge}
              ${hasStory ? '<span class="badge story">⭕ Story</span>' : ''}
              <span class="badge ${p.isPrivate ? 'private' : 'public'}">${p.isPrivate ? '🔒 Private' : '🌐 Public'}</span>
            </div>
          </div>
        `;
        grid.appendChild(card);
      });

      updateProgress();
    }

    function toggleReviewed(name, state) {
      if (state) reviewed[name] = true;
      else delete reviewed[name];
      saveAndRefresh();
    }

    function markReviewed(name) {
      reviewed[name] = true;
      saveAndRefresh();
    }

    function openProfile(name) {
      window.open(`https://www.instagram.com/${name}/`, '_blank');
      markReviewed(name);
    }

    // Single profile review (never blocked by browser)
    function openNextSingle() {
      const pending = getFilteredAndSortedUsers().filter(u => !reviewed[u.username]);
      if (pending.length === 0) {
        showToast('No pending profiles to open!');
        return;
      }
      const target = pending[0];
      window.open(`https://www.instagram.com/${target.username}/`, '_blank');
      reviewed[target.username] = true;
      saveAndRefresh();
      showToast(`Opened @${target.username}`);
    }

    function markNextSingleReviewed() {
      const pending = getFilteredAndSortedUsers().filter(u => !reviewed[u.username]);
      if (pending.length === 0) {
        showToast('No pending profiles to mark!');
        return;
      }
      reviewed[pending[0].username] = true;
      saveAndRefresh();
      showToast(`Marked @${pending[0].username} as reviewed`);
    }

    // Batch profile opener with popup blocker detection
    function openNextBatch(count) {
      const candidates = getFilteredAndSortedUsers().filter(u => !reviewed[u.username]);
      if (candidates.length === 0) {
        showToast('No pending profiles to open in this filter!');
        return;
      }

      let opened = 0;
      let blocked = 0;
      const toOpen = candidates.slice(0, count);

      toOpen.forEach(p => {
        const w = window.open(`https://www.instagram.com/${p.username}/`, '_blank');
        if (!w || w.closed || typeof w.closed === 'undefined') {
          blocked++;
        } else {
          opened++;
          reviewed[p.username] = true;
        }
      });

      saveAndRefresh();

      if (blocked > 0) {
        document.getElementById('popupWarning').style.display = 'flex';
        showToast(`Opened ${opened} tab(s). ${blocked} blocked by browser popup blocker.`);
      } else {
        document.getElementById('popupWarning').style.display = 'none';
        showToast(`Opened ${opened} profile tab(s)!`);
      }
    }

    function dismissPopupWarning() {
      document.getElementById('popupWarning').style.display = 'none';
    }

    function markAllVisibleReviewed() {
      const visible = getFilteredAndSortedUsers();
      visible.forEach(p => reviewed[p.username] = true);
      saveAndRefresh();
      showToast(`Marked ${visible.length} profiles as reviewed.`);
    }

    function resetProgress() {
      const count = Object.keys(reviewed).length;
      if (count === 0) {
        showToast('No reviewed items to reset.');
        return;
      }
      if (confirm(`Are you sure you want to reset reviewed progress for all ${count} profile(s)?`)) {
        reviewed = {};
        localStorage.removeItem('instaextract_reviewed_v4');
        saveAndRefresh();
        showToast('All reviewed progress reset!');
      }
    }

    function exportToCsv() {
      const users = getFilteredAndSortedUsers();
      if (users.length === 0) {
        showToast('No profiles to export in current filter!');
        return;
      }

      const headers = ['Username', 'Full Name', 'Relationship', 'Privacy', 'Verified', 'Has Active Story', 'Profile URL'];
      const rows = users.map(u => [
        u.username,
        `"${(u.fullName || '').replace(/"/g, '""')}"`,
        u.relationship || 'unknown',
        u.isPrivate ? 'Private' : 'Public',
        u.isVerified ? 'Yes' : 'No',
        u.latestReelMedia > 0 ? 'Yes' : 'No',
        `https://www.instagram.com/${u.username}/`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `instaextract_${currentCategory}_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(`Exported ${users.length} profiles to CSV!`);
    }

    function saveAndRefresh() {
      localStorage.setItem('instaextract_reviewed_v4', JSON.stringify(reviewed));
      renderCards();
    }

    function updateProgress() {
      const usersInCat = allUsers.filter(u => {
        if (currentCategory === 'not_following_back') return (u.followedByViewer && !u.followsViewer);
        if (currentCategory === 'fans') return (!u.followedByViewer && u.followsViewer);
        if (currentCategory === 'mutuals') return (u.followedByViewer && u.followsViewer);
        if (currentCategory === 'following') return u.followedByViewer;
        if (currentCategory === 'followers') return u.followsViewer;
        return true;
      });

      const total = usersInCat.length;
      let revCount = 0;
      usersInCat.forEach(u => {
        if (reviewed[u.username]) revCount++;
      });

      const pct = total > 0 ? Math.round((revCount / total) * 100) : 0;
      document.getElementById('progressText').innerText = `${revCount} / ${total} reviewed (${pct}%)`;
      document.getElementById('progressFill').style.width = `${pct}%`;
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3200);
    }

    let currentUnfollowTargets = [];

    function openUnfollowModal() {
      const notFollowingBack = allUsers.filter(u => u.followedByViewer && !u.followsViewer);
      const toKeep = notFollowingBack.filter(u => !!reviewed[u.username]);
      const toUnfollow = notFollowingBack.filter(u => !reviewed[u.username]);

      currentUnfollowTargets = toUnfollow;

      document.getElementById('keepCountText').innerText = `${toKeep.length} account(s)`;
      document.getElementById('unfollowCountText').innerText = `${toUnfollow.length} account(s)`;

      const listEl = document.getElementById('unfollowPreviewList');
      if (toUnfollow.length === 0) {
        listEl.innerHTML = '<div style="color:#8b949e; padding:10px;">All accounts in "Not Following Back" are checked to KEEP. None to unfollow!</div>';
      } else {
        listEl.innerHTML = toUnfollow.map((u, i) => `<div>${i + 1}. @${u.username} ${u.fullName ? '(' + u.fullName + ')' : ''} [${u.isPrivate ? 'Private' : 'Public'}]</div>`).join('');
      }

      document.getElementById('unfollowModal').style.display = 'flex';
    }

    function closeUnfollowModal() {
      document.getElementById('unfollowModal').style.display = 'none';
    }

    function copyUnfollowList() {
      if (currentUnfollowTargets.length === 0) {
        showToast('No accounts to copy!');
        return;
      }
      const text = currentUnfollowTargets.map(u => u.username).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        showToast(`Copied ${currentUnfollowTargets.length} usernames to clipboard!`);
      }).catch(() => {
        showToast('Clipboard copy failed. Please download JSON.');
      });
    }

    function downloadUnfollowJson() {
      if (currentUnfollowTargets.length === 0) {
        showToast('No accounts to export!');
        return;
      }

      const payload = {
        exported_at: new Date().toISOString(),
        total_to_unfollow: currentUnfollowTargets.length,
        targets: currentUnfollowTargets.map(u => ({
          username: u.username,
          pk: u.pk || '',
          fullName: u.fullName || '',
          isPrivate: !!u.isPrivate
        }))
      };

      const str = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
      const a = document.createElement('a');
      a.setAttribute('href', str);
      a.setAttribute('download', 'unfollow_targets.json');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`Downloaded unfollow_targets.json (${currentUnfollowTargets.length} accounts)!`);
    }

    function copyInBrowserScript() {
      if (currentUnfollowTargets.length === 0) {
        showToast('No accounts queued to unfollow!');
        return;
      }

      const targetsJson = JSON.stringify(currentUnfollowTargets.map(u => ({ username: u.username, pk: u.pk || '' })));
      const script = `(function() {
  const targets = ${targetsJson};
  let isRunning = false;
  let isPaused = false;
  let currentIndex = 0;
  let processedCount = 0;
  const batchLimit = 25;

  const old = document.getElementById('ie-floating-panel');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'ie-floating-panel';
  panel.style.cssText = 'position:fixed; top:24px; right:24px; width:360px; background:#161b22; color:#f0f6fc; border:1px solid #30363d; border-radius:12px; padding:18px; box-shadow:0 12px 36px rgba(0,0,0,0.6); z-index:9999999; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; font-size:13px;';

  panel.innerHTML = \`
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #30363d; padding-bottom:8px;">
      <h3 style="margin:0; font-size:14px; color:#ff7b72;">🎯 InstaExtract In-Browser Unfollower</h3>
      <button id="ie-close" style="background:none; border:none; color:#8b949e; font-size:20px; cursor:pointer;">&times;</button>
    </div>
    <div style="font-size:12px; color:#8b949e; margin-bottom:10px;">
      Queue: <strong id="ie-count" style="color:#f0f6fc;">\${targets.length}</strong> accounts remaining.<br>
      Checked accounts & mutuals are protected.
    </div>
    <div id="ie-status" style="background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:10px; margin-bottom:12px; font-family:monospace; font-size:11px; min-height:48px; color:#c9d1d9; white-space:pre-line;">
      Ready. Click "Start" to begin human-paced unfollowing.
    </div>
    <div style="display:flex; gap:8px;">
      <button id="ie-start" style="flex:1; background:#238636; color:white; border:none; padding:9px 12px; border-radius:6px; font-weight:600; cursor:pointer;">▶️ Start</button>
      <button id="ie-pause" style="flex:1; background:#30363d; color:#f0f6fc; border:none; padding:9px 12px; border-radius:6px; font-weight:600; cursor:pointer; display:none;">⏸️ Pause</button>
      <button id="ie-stop" style="background:#da3633; color:white; border:none; padding:9px 12px; border-radius:6px; font-weight:600; cursor:pointer; display:none;">⏹️ Stop</button>
    </div>
    <div style="margin-top:10px; font-size:11px; color:#8b949e; text-align:center;">
      Pacing: 20–35s random delay per account to avoid action blocks.
    </div>
  \`;

  document.body.appendChild(panel);

  const startBtn = document.getElementById('ie-start');
  const pauseBtn = document.getElementById('ie-pause');
  const stopBtn = document.getElementById('ie-stop');
  const closeBtn = document.getElementById('ie-close');
  const statusEl = document.getElementById('ie-status');
  const countEl = document.getElementById('ie-count');

  closeBtn.onclick = () => { isRunning = false; panel.remove(); };

  startBtn.onclick = () => {
    isRunning = true;
    isPaused = false;
    startBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-block';
    stopBtn.style.display = 'inline-block';
    runNext();
  };

  pauseBtn.onclick = () => {
    isPaused = !isPaused;
    pauseBtn.innerText = isPaused ? '▶️ Resume' : '⏸️ Pause';
    statusEl.innerText = isPaused ? 'Paused. Click Resume.' : 'Resuming...';
    if (!isPaused) runNext();
  };

  stopBtn.onclick = () => {
    isRunning = false;
    startBtn.style.display = 'inline-block';
    pauseBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    statusEl.innerText = 'Stopped.';
  };

  async function resolvePk(username) {
    try {
      const r = await fetch('/api/v1/users/web_profile_info/?username=' + username, {
        headers: { 'x-ig-app-id': '936619743392459', 'x-asbd-id': '129477' }
      });
      const d = await r.json();
      return d.data?.user?.id;
    } catch (e) { return null; }
  }

  async function runNext() {
    if (!isRunning || isPaused) return;
    if (currentIndex >= targets.length || processedCount >= batchLimit) {
      statusEl.innerText = processedCount >= batchLimit
        ? 'Batch limit reached (25). Take a break to protect your account!'
        : 'All targets unfollowed successfully!';
      startBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'none';
      return;
    }

    const t = targets[currentIndex];
    statusEl.innerText = '[' + (processedCount + 1) + '/' + batchLimit + '] Unfollowing @' + t.username + '...';

    let pk = t.pk;
    if (!pk) {
      statusEl.innerText = 'Resolving ID for @' + t.username + '...';
      pk = await resolvePk(t.username);
      if (!pk) {
        statusEl.innerText = 'Could not resolve @' + t.username + '. Skipping.';
        currentIndex++;
        runNext();
        return;
      }
    }

    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
    try {
      const res = await fetch('/api/v1/friendships/destroy/' + pk + '/', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-csrftoken': csrf,
          'x-ig-app-id': '936619743392459',
          'x-asbd-id': '129477',
          'x-requested-with': 'XMLHttpRequest'
        },
        body: 'user_id=' + pk
      });

      const json = await res.json();
      if (res.ok && json.status === 'ok') {
        processedCount++;
        currentIndex++;
        countEl.innerText = targets.length - currentIndex;

        if (currentIndex < targets.length && processedCount < batchLimit) {
          const delaySec = Math.floor(Math.random() * 15) + 20;
          let left = delaySec;
          statusEl.innerText = '✓ Unfollowed @' + t.username + '.\\nNext in ' + left + 's (safe pacing)...';

          const timer = setInterval(() => {
            if (!isRunning || isPaused) { clearInterval(timer); return; }
            left--;
            if (left <= 0) {
              clearInterval(timer);
              runNext();
            } else {
              statusEl.innerText = '✓ Unfollowed @' + t.username + '.\\nNext in ' + left + 's (safe pacing)...';
            }
          }, 1000);
        } else {
          runNext();
        }
      } else {
        statusEl.innerText = '[!] Action Blocked or Error: ' + (json.message || 'Limit reached') + '. Halting.';
        stopBtn.click();
      }
    } catch (err) {
      statusEl.innerText = 'Network error: ' + err.message + '. Halting.';
      stopBtn.click();
    }
  }
})();`;

      navigator.clipboard.writeText(script).then(() => {
        showToast('🚀 In-Browser Script Copied! Paste into Console on instagram.com tab.');
      }).catch(() => {
        showToast('Clipboard permission denied.');
      });
    }

    // Keyboard shortcut: Spacebar opens next pending profile
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        openNextSingle();
      }
    });

    renderCards();
  </script>
</body>
</html>)RAW";

    // Write to target output path
    std::ofstream out(outputPath);
    if (!out.is_open()) {
        std::cerr << "Failed to write HTML report to " << outputPath << std::endl;
        return false;
    }
    out << html;
    out.close();

    // Also write to ../outputPath if running inside build subdirectory
    std::ofstream parentOut("../" + outputPath);
    if (parentOut.is_open()) {
        parentOut << html;
        parentOut.close();
    }

    return true;
}

bool HtmlReportGenerator::generateReport(const std::vector<InstagramUser>& nonFollowers,
                                        const std::string& outputPath) {
    AuditDataset dataset;
    dataset.notFollowingBack = nonFollowers;
    dataset.allFollowing = nonFollowers;
    return generateReport(dataset, outputPath);
}

void HtmlReportGenerator::openInBrowser(const std::string& filePath) {
#if defined(_WIN32)
    std::string cmd = "start \"\" \"" + filePath + "\"";
#elif defined(__APPLE__)
    std::string cmd = "open \"" + filePath + "\"";
#else
    std::string cmd = "xdg-open \"" + filePath + "\" 2>/dev/null &";
#endif
    std::cout << "Opening report in browser..." << std::endl;
    int res = std::system(cmd.c_str());
    (void)res;
}
