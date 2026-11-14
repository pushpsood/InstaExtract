// main.cpp
#include <iostream>
#include <unordered_set>
#include <vector>
#include <algorithm>
#include "controller/Controller.h"
#include "util/LoadingAnimation.h"
#include "util/HtmlReportGenerator.h"

int main() {
    std::cout << "========================================" << std::endl;
    std::cout << "      InstaExtract - Account Audit      " << std::endl;
    std::cout << "========================================" << std::endl;

    Controller controller;

    LoadingAnimation loadingAnimation;
    loadingAnimation.start();

    // 1. Fetch followers safely with anti-bot pacing
    std::vector<InstagramUser> followersList = controller.getFollowers();
    std::cout << "\n[✓] Followers fetched: " << followersList.size() << std::endl;

    // 2. Fetch following with anti-bot pacing
    std::vector<InstagramUser> followingList = controller.getFollowing();
    std::cout << "[✓] Following fetched: " << followingList.size() << std::endl;

    // 3. Perform relational audit (not following back, fans, mutuals)
    AuditDataset dataset = controller.analyzeRelationships(followingList, followersList);

    loadingAnimation.stop();

    // 4. Breakdown summary
    size_t publicCount = 0;
    size_t privateCount = 0;
    for (const auto& u : dataset.notFollowingBack) {
        if (u.isPrivate) privateCount++;
        else publicCount++;
    }

    std::cout << "\n----------------------------------------" << std::endl;
    std::cout << "Summary Statistics:" << std::endl;
    std::cout << "  • Following:            " << dataset.allFollowing.size() << " (Accounts you follow)" << std::endl;
    std::cout << "  • Followers:            " << dataset.allFollowers.size() << " (Accounts following you)" << std::endl;
    std::cout << "  • Mutual Friends:       " << dataset.mutuals.size() << " (Both follow each other)" << std::endl;
    std::cout << "  • Fans (Not Followed):  " << dataset.fans.size() << " (They follow you, you don't follow back)" << std::endl;
    std::cout << "  • Don't Follow Back:    " << dataset.notFollowingBack.size() << " (You follow, they don't follow back)" << std::endl;
    std::cout << "     - Public accounts:   " << publicCount << std::endl;
    std::cout << "     - Private accounts:  " << privateCount << std::endl;
    std::cout << "----------------------------------------" << std::endl;

    // 5. Generate fully configurable interactive dashboard directly from code
    std::string reportPath = "profiles.html";
    if (HtmlReportGenerator::generateReport(dataset, reportPath)) {
        std::cout << "\n[✓] Generated interactive dashboard: " << reportPath << std::endl;
        HtmlReportGenerator::openInBrowser(reportPath);
    } else {
        std::cerr << "[!] Failed to generate report file." << std::endl;
    }

    return 0;
}
