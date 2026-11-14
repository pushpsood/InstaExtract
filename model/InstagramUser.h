#ifndef INSTAGRAM_USER_H
#define INSTAGRAM_USER_H

#include <string>
#include <algorithm>

struct InstagramUser {
    std::string pk; // Instagram internal user ID (needed for unfollow action)
    std::string username;
    std::string fullName;
    bool isPrivate = false;
    bool isVerified = false;
    std::string profilePicUrl;
    bool hasAnonymousProfilePicture = false;
    long long latestReelMedia = 0; // > 0 indicates an active story
    bool followedByViewer = false; // true if you follow them
    bool followsViewer = false;    // true if they follow you
    std::string relationship = "unknown"; // "not_following_back", "mutual", "fan"

    bool operator<(const InstagramUser& other) const {
        std::string a = username;
        std::string b = other.username;
        std::transform(a.begin(), a.end(), a.begin(), ::tolower);
        std::transform(b.begin(), b.end(), b.begin(), ::tolower);
        return a < b;
    }
};

#endif // INSTAGRAM_USER_H
