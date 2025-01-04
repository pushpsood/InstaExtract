#include "Controller.h"
#include "../service/FollowersService.h"
#include "../service/FollowingService.h"
#include <unordered_set>
#include <algorithm>
#include <iostream>

std::vector<std::string> Controller::getFollowers() {
    FollowersService service;
    return service.fetchFollowers();
}

std::vector<std::string> Controller::getFollowing() {
    FollowingService service;
    return service.fetchFollowing();
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