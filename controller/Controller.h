#ifndef CONTROLLER_H
#define CONTROLLER_H

#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include "../model/InstagramUser.h"

struct AuditDataset {
    std::vector<InstagramUser> allFollowing;
    std::vector<InstagramUser> allFollowers;
    std::vector<InstagramUser> notFollowingBack; // People you follow who don't follow back
    std::vector<InstagramUser> fans;             // People who follow you that you don't follow back
    std::vector<InstagramUser> mutuals;          // Mutual followers
};

class Controller {
public:
    std::vector<InstagramUser> getFollowers();
    std::vector<InstagramUser> getFollowing();
    AuditDataset performFullAudit();

    AuditDataset analyzeRelationships(const std::vector<InstagramUser>& following,
                                      const std::vector<InstagramUser>& followers);

    std::vector<InstagramUser> findNonFollowers(const std::vector<InstagramUser>& following,
                                                const std::unordered_set<std::string>& followers);
    std::unordered_set<std::string> findUniqueStrings(const std::vector<std::string>& vec1,
                                                      const std::vector<std::string>& vec2);
};

#endif // CONTROLLER_H
