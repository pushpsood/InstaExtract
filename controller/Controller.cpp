#include "Controller.h"
#include "../service/FollowersService.h"
#include "../service/FollowingService.h"
#include "../util/LoadingAnimation.h"
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <iostream>
#include <thread>
#include <chrono>

static std::string toLower(const std::string& str) {
    std::string lower = str;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    return lower;
}

std::vector<InstagramUser> Controller::getFollowers() {
    FollowersService service;
    return service.fetchFollowers();
}

std::vector<InstagramUser> Controller::getFollowing() {
    // Natural human pause before switching from followers to following
    LoadingAnimation::setStatus("Resting before fetching following list...");
    std::this_thread::sleep_for(std::chrono::milliseconds(3500));

    FollowingService service;
    return service.fetchFollowing();
}

AuditDataset Controller::performFullAudit() {
    std::vector<InstagramUser> followers = getFollowers();
    std::vector<InstagramUser> following = getFollowing();
    return analyzeRelationships(following, followers);
}

AuditDataset Controller::analyzeRelationships(const std::vector<InstagramUser>& following,
                                              const std::vector<InstagramUser>& followers) {
    AuditDataset dataset;

    // 1. Deduplicate Following by lowercase username
    std::unordered_set<std::string> seenFollowing;
    std::vector<InstagramUser> dedupFollowing;
    for (const auto& u : following) {
        if (u.username.empty()) continue;
        std::string lower = toLower(u.username);
        if (seenFollowing.insert(lower).second) {
            dedupFollowing.push_back(u);
        }
    }

    // 2. Deduplicate Followers by lowercase username
    std::unordered_set<std::string> seenFollowers;
    std::vector<InstagramUser> dedupFollowers;
    for (const auto& u : followers) {
        if (u.username.empty()) continue;
        std::string lower = toLower(u.username);
        if (seenFollowers.insert(lower).second) {
            dedupFollowers.push_back(u);
        }
    }

    std::unordered_map<std::string, InstagramUser> followerMap;
    for (const auto& u : dedupFollowers) {
        followerMap[toLower(u.username)] = u;
    }

    std::unordered_map<std::string, InstagramUser> followingMap;
    for (const auto& u : dedupFollowing) {
        followingMap[toLower(u.username)] = u;
    }

    // Process Following
    for (auto u : dedupFollowing) {
        std::string lowerName = toLower(u.username);
        u.followedByViewer = true;
        if (followerMap.find(lowerName) != followerMap.end()) {
            u.followsViewer = true;
            u.relationship = "mutual";
            dataset.mutuals.push_back(u);
        } else {
            u.followsViewer = false;
            u.relationship = "not_following_back";
            dataset.notFollowingBack.push_back(u);
        }
        dataset.allFollowing.push_back(u);
    }

    // Process Followers (to find Fans who you don't follow back)
    for (auto u : dedupFollowers) {
        std::string lowerName = toLower(u.username);
        u.followsViewer = true;
        if (followingMap.find(lowerName) == followingMap.end()) {
            u.followedByViewer = false;
            u.relationship = "fan";
            dataset.fans.push_back(u);
        } else {
            u.followedByViewer = true;
            u.relationship = "mutual";
        }
        dataset.allFollowers.push_back(u);
    }

    std::sort(dataset.notFollowingBack.begin(), dataset.notFollowingBack.end());
    std::sort(dataset.fans.begin(), dataset.fans.end());
    std::sort(dataset.mutuals.begin(), dataset.mutuals.end());
    std::sort(dataset.allFollowing.begin(), dataset.allFollowing.end());
    std::sort(dataset.allFollowers.begin(), dataset.allFollowers.end());

    return dataset;
}

std::vector<InstagramUser> Controller::findNonFollowers(const std::vector<InstagramUser>& following,
                                                        const std::unordered_set<std::string>& followers) {
    std::vector<InstagramUser> nonFollowers;
    for (const auto& user : following) {
        if (followers.find(user.username) == followers.end()) {
            nonFollowers.push_back(user);
        }
    }
    std::sort(nonFollowers.begin(), nonFollowers.end());
    return nonFollowers;
}

std::unordered_set<std::string> Controller::findUniqueStrings(const std::vector<std::string>& vec1, const std::vector<std::string>& vec2) {
    std::unordered_set<std::string> set2(vec2.begin(), vec2.end());
    std::unordered_set<std::string> result;

    for (const auto& str : vec1) {
        if (set2.find(str) == set2.end()) {
            result.insert(str);
        }
    }

    return result;
}
