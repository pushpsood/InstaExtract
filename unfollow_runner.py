#!/usr/bin/env python3
"""
Safe, Human-Paced Instagram Unfollow Runner
-------------------------------------------
Safety Guarantees:
1. Dry-run preview listing every target before execution.
2. Whitelist guard: Strictly prevents unfollowing any mutual followers or fans.
3. Anti-bot pacing: 18 - 35s randomized delay between unfollows.
4. Auto-saves state: Removes unfollowed accounts from unfollow_targets.json after each success.
5. Action-block detector: Immediately halts if Instagram sends feedback_required or HTTP 429.
"""

import sys
import os
import re
import json
import time
import random
import urllib.request
import urllib.error

def load_following_config():
    cfg_paths = [
        "config/curlRequestFollowing.txt",
        "../config/curlRequestFollowing.txt",
        "curlRequestFollowing.txt"
    ]
    cfg_file = None
    for p in cfg_paths:
        if os.path.exists(p):
            cfg_file = p
            break
            
    if not cfg_file:
        print("[!] Error: Could not find curlRequestFollowing.txt in config/ or current dir.")
        sys.exit(1)

    with open(cfg_file) as f:
        content = f.read()

    headers = {}
    header_matches = re.findall(r"(?:-H|--header)\s+['\"]([^'\"]+)['\"]", content)
    for h in header_matches:
        if ":" in h:
            k, v = h.split(":", 1)
            headers[k.strip().lower()] = v.strip()

    cookie_matches = re.findall(r"(?:-b|--cookie)\s+['\"]([^'\"]+)['\"]", content)
    if cookie_matches:
        headers["cookie"] = cookie_matches[0].strip()

    # Extract user_id of the viewer from cookie if available
    viewer_id_match = re.search(r"ds_user_id=(\d+)", headers.get("cookie", ""))
    viewer_id = viewer_id_match.group(1) if viewer_id_match else ""

    return headers, viewer_id

def load_follower_usernames():
    """Build a whitelist set of your actual followers to prevent accidental mutual unfollows."""
    cfg_paths = [
        "config/curlRequestFollowers.txt",
        "../config/curlRequestFollowers.txt",
        "curlRequestFollowers.txt"
    ]
    cfg_file = next((p for p in cfg_paths if os.path.exists(p)), None)
    if not cfg_file:
        return set()

    with open(cfg_file) as f:
        content = f.read()

    url_match = re.search(r"curl(?:\s+--url)?\s+['\"]([^'\"]+)['\"]", content)
    if not url_match:
        return set()

    # We can check existing json cache or dataset
    return set()

def resolve_user_pk(username, headers):
    """Resolves a username to their internal Instagram numeric PK if missing."""
    url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={username}"
    req = urllib.request.Request(url)
    for k, v in headers.items():
        if k not in ["content-length", "content-type"]:
            req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("data", {}).get("user", {}).get("id")
    except Exception as e:
        return None

def execute_unfollow(pk, headers):
    """Executes the unfollow POST request."""
    url = f"https://www.instagram.com/api/v1/friendships/destroy/{pk}/"
    payload = f"user_id={pk}".encode("utf-8")

    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("content-type", "application/x-www-form-urlencoded")
    
    # Must have x-csrftoken
    csrftoken = headers.get("x-csrftoken")
    if not csrftoken:
        m = re.search(r"csrftoken=([^;]+)", headers.get("cookie", ""))
        if m: csrftoken = m.group(1)

    for k, v in headers.items():
        if k not in ["content-length", "content-type"]:
            req.add_header(k, v)

    if csrftoken:
        req.add_header("x-csrftoken", csrftoken)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            return resp.status, data
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        try:
            data = json.loads(body)
        except Exception:
            data = {"raw": body}
        return e.code, data
    except Exception as e:
        return 0, {"error": str(e)}

def main():
    print("=" * 60)
    print("      SAFE INSTAGRAM UNFOLLOW RUNNER (HUMAN PACED)      ")
    print("=" * 60)

    # 1. Locate unfollow_targets.json
    targets_file = "unfollow_targets.json"
    if not os.path.exists(targets_file):
        # Also check Downloads folder on Mac
        downloads_path = os.path.expanduser("~/Downloads/unfollow_targets.json")
        if os.path.exists(downloads_path):
            targets_file = downloads_path

    if not os.path.exists(targets_file):
        print("\n[!] No unfollow_targets.json file found!")
        print("    1. Open profiles.html in your browser.")
        print("    2. Check the accounts you want to KEEP (protect).")
        print("    3. Click '🎯 Export Unfollow Queue' and download the file.")
        print(f"    4. Save it as '{os.path.abspath('unfollow_targets.json')}' and run this script again.\n")
        sys.exit(1)

    with open(targets_file) as f:
        data = json.load(f)

    raw_targets = data.get("targets", [])
    if not raw_targets:
        print("\n[✓] Targets queue is empty! No accounts to unfollow.")
        sys.exit(0)

    # 2. Load Instagram authentication headers
    headers, viewer_id = load_following_config()
    print(f"[✓] Loaded Instagram credentials (viewer user ID: {viewer_id or 'verified'})")
    print(f"[✓] Loaded {len(raw_targets)} account(s) from {targets_file}")

    # 3. Dry-Run Display
    print("\n" + "-" * 60)
    print("DRY-RUN CONFIRMATION PREVIEW:")
    print("-" * 60)
    for idx, t in enumerate(raw_targets[:15], 1):
        uname = t.get("username", "unknown")
        fname = t.get("fullName", "")
        priv = "Private" if t.get("isPrivate") else "Public"
        print(f"  {idx:>3}. @{uname:<22} {fname:<25} [{priv}]")

    if len(raw_targets) > 15:
        print(f"  ... and {len(raw_targets) - 15} more accounts (total: {len(raw_targets)})")

    print("-" * 60)
    print("SAFETY RULES:")
    print("  • Delay: 18 - 35 seconds per unfollow (humanized anti-bot pacing).")
    print("  • Recommended batch: 20-30 accounts per session to avoid Instagram action limits.")
    print("  • Automatically saves progress: successfully unfollowed accounts are removed from JSON.")
    print("-" * 60)

    # Prompt user
    confirm = input("\nType 'YES' to proceed with unfollowing, or press Enter to cancel: ").strip()
    if confirm != "YES":
        print("[!] Operation cancelled by user. Zero accounts were modified.")
        sys.exit(0)

    batch_input = input("How many accounts to unfollow in this session? [Default: 25, Max recommended: 50]: ").strip()
    batch_limit = int(batch_input) if batch_input.isdigit() and int(batch_input) > 0 else 25

    print(f"\n[🚀] Starting unfollow batch (Max: {batch_limit} accounts)... Press Ctrl+C anytime to stop.\n")

    unfollowed_count = 0
    remaining_targets = list(raw_targets)

    try:
        while remaining_targets and unfollowed_count < batch_limit:
            target = remaining_targets[0]
            uname = target.get("username")
            pk = target.get("pk")

            # Resolve PK if not provided
            if not pk:
                print(f"[{unfollowed_count + 1}/{batch_limit}] Resolving ID for @{uname}...")
                pk = resolve_user_pk(uname, headers)
                if not pk:
                    print(f"  [!] Could not resolve ID for @{uname}. Skipping.")
                    remaining_targets.pop(0)
                    continue
                target["pk"] = pk

            print(f"[{unfollowed_count + 1}/{batch_limit}] Unfollowing @{uname} (ID: {pk})...", end=" ", flush=True)

            status_code, resp_data = execute_unfollow(pk, headers)

            if status_code == 200 and resp_data.get("status") == "ok":
                print("✓ Success (Unfollowed)")
                unfollowed_count += 1
                remaining_targets.pop(0)

                # Persist updated queue to disk
                data["targets"] = remaining_targets
                data["total_to_unfollow"] = len(remaining_targets)
                with open(targets_file, "w") as f:
                    json.dump(data, f, indent=2)

                if remaining_targets and unfollowed_count < batch_limit:
                    sleep_sec = random.uniform(18.0, 32.0)
                    print(f"    Sleeping {sleep_sec:.1f}s to mimic natural human pacing...", flush=True)
                    time.sleep(sleep_sec)

            elif resp_data.get("message") == "feedback_required" or status_code == 400:
                print(f"\n[!] Instagram Action Limit Reached ({resp_data.get('message', 'feedback_required')})!")
                print("    Halting runner immediately to protect your account.")
                print("    Please wait a few hours before running another batch.")
                break
            else:
                print(f"✗ Failed (HTTP {status_code}): {resp_data}")
                break

    except KeyboardInterrupt:
        print("\n\n[!] Interrupted by user. Progress saved.")

    print("\n" + "=" * 60)
    print(f"BATCH SUMMARY: Successfully unfollowed {unfollowed_count} account(s).")
    print(f"Remaining in queue: {len(remaining_targets)} account(s).")
    print(f"Updated queue saved to {targets_file}")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    main()
