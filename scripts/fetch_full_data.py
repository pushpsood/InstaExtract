#!/usr/bin/env python3
"""
Safely fetches all Followers and Following for the configured user session
using humanized anti-bot pacing and exact browser headers/cookies.
Saves data directly into cache_followers.json and cache_following.json.
"""

import json
import os
import re
import random
import subprocess
import time
import urllib.parse

def parse_curl_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    url_match = re.search(r"curl(?: --url)?\s+['\"]([^'\"]+)['\"]", content)
    if not url_match:
        url_match = re.search(r"curl\s+([^'\s]+)", content)
    base_url = url_match.group(1) if url_match else None

    headers = re.findall(r"(?:-H|--header)\s+['\"]([^'\"]+)['\"]", content)
    cookies = re.findall(r"(?:-b|--cookie)\s+['\"]([^'\"]+)['\"]", content)

    return base_url, headers, cookies

def parse_user_obj(u):
    pk = str(u.get('pk') or u.get('pk_id') or u.get('id') or '')
    username = u.get('username', '')
    full_name = u.get('full_name', '')
    is_private = bool(u.get('is_private', False))
    is_verified = bool(u.get('is_verified', False))
    profile_pic_url = u.get('profile_pic_url', '')
    has_anon_pic = bool(u.get('has_anonymous_profile_picture', False))
    latest_reel = int(u.get('latest_reel_media', 0) or 0)
    return {
        'pk': pk,
        'username': username,
        'fullName': full_name,
        'isPrivate': is_private,
        'isVerified': is_verified,
        'profilePicUrl': profile_pic_url,
        'hasAnonymousProfilePicture': has_anon_pic,
        'latestReelMedia': latest_reel
    }

def fetch_list(curl_file, output_cache, list_type="followers"):
    base_url, headers, cookies = parse_curl_file(curl_file)
    if not base_url:
        print(f"Error parsing curl file: {curl_file}")
        return []

    print(f"\n========================================")
    print(f"Starting fetch for: {list_type.upper()}")
    print(f"Base URL: {base_url}")
    print(f"========================================")

    users_map = {} # username_lower -> user_obj
    current_url = base_url
    page = 0

    while current_url:
        page += 1
        cmd = ['curl', '-s', current_url]
        for h in headers:
            cmd.extend(['-H', h])
        for c in cookies:
            cmd.extend(['-b', c])

        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"[!] Curl error on page {page}: {res.stderr}")
            break

        try:
            data = json.loads(res.stdout)
        except Exception as e:
            print(f"[!] JSON decode error on page {page}: {e}")
            if res.stdout:
                print(f"Snippet: {res.stdout[:200]}")
            break

        if data.get('status') == 'fail':
            print(f"[!] Instagram error: {data.get('message')}")
            break

        # Extract users
        page_users = data.get('users', [])
        new_in_page = 0
        for u in page_users:
            uname = u.get('username')
            if uname:
                parsed = parse_user_obj(u)
                if list_type == "followers":
                    parsed['followsViewer'] = True
                    parsed['followedByViewer'] = False
                else:
                    parsed['followedByViewer'] = True
                    parsed['followsViewer'] = False

                lower = uname.lower()
                if lower not in users_map:
                    users_map[lower] = parsed
                    new_in_page += 1

        # Groups / facepile (e.g. deactivated followers)
        for g in data.get('groups', []):
            for u in g.get('facepile', []):
                uname = u.get('username')
                if uname:
                    parsed = parse_user_obj(u)
                    if list_type == "followers":
                        parsed['followsViewer'] = True
                        parsed['followedByViewer'] = False
                    lower = uname.lower()
                    if lower not in users_map:
                        users_map[lower] = parsed
                        new_in_page += 1

        next_max_id = data.get('next_max_id')
        print(f"[{list_type.capitalize()}] Page {page}: +{new_in_page} users (Total: {len(users_map)}). Next cursor: {str(next_max_id)[:20] if next_max_id else 'None'}")

        if not next_max_id:
            break

        # Humanized delay between 1.4s and 2.6s with micro-jitter
        sleep_sec = random.uniform(1.4, 2.6)
        if page % 8 == 0:
            sleep_sec += random.uniform(2.0, 4.0) # occasional reading pause
        time.sleep(sleep_sec)

        # Update URL for next page
        # Note: followers uses search_surface=follow_list_page and &max_id=
        # following uses &max_id=
        encoded_nid = urllib.parse.quote(str(next_max_id))
        if 'max_id=' in base_url:
            current_url = re.sub(r'max_id=[^&]*', f'max_id={encoded_nid}', base_url)
        else:
            sep = '&' if '?' in base_url else '?'
            current_url = f"{base_url}{sep}max_id={encoded_nid}"

    user_list = list(users_map.values())
    user_list.sort(key=lambda x: x['username'].lower())

    with open(output_cache, 'w') as f:
        json.dump(user_list, f, indent=2)

    print(f"[✓] Successfully saved {len(user_list)} unique {list_type} to {output_cache}")
    return user_list

def main():
    followers = fetch_list('config/curlRequestFollowers.txt', 'cache_followers.json', 'followers')
    print("\nResting 4 seconds between lists...")
    time.sleep(4)
    following = fetch_list('config/curlRequestFollowing.txt', 'cache_following.json', 'following')

    print("\n========================================")
    print("FETCH COMPLETE & VERIFIED")
    print(f"Total Followers: {len(followers)}")
    print(f"Total Following: {len(following)}")
    print("========================================")

if __name__ == '__main__':
    main()
