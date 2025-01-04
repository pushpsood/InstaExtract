// main.cpp
#include <iostream>
#include <unordered_set>
#include <vector>
#include <algorithm>
#include "controller/Controller.h"
#include "util/LoadingAnimation.h"


void sortUnorderedSet(const std::unordered_set<std::string>& uset) {
    std::vector<std::string> elements(uset.begin(), uset.end());
    std::sort(elements.begin(), elements.end());
}

int main() {
    Controller controller;

    LoadingAnimation loadingAnimation;
    loadingAnimation.start();

    std::vector<std::string> followersList = controller.getFollowers();
    std::cout << "\nSize of followers list: " << followersList.size() << std::endl;

    std::vector<std::string> followingList = controller.getFollowing();
    std::cout << "\nSize of following list: " << followingList.size() << std::endl;

    std::unordered_set<std::string> uniqueStrings = controller.findUniqueStrings(followingList, followersList);

    loadingAnimation.stop();

    std::cout << "Users in followingList but not in followersList: " << uniqueStrings.size() << std::endl;
    sortUnorderedSet(uniqueStrings);

    for (const auto& str : uniqueStrings) {
        std::cout << str << std::endl;
    }

    return 0;
}