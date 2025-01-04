#ifndef CONTROLLER_H
#define CONTROLLER_H

#include <vector>
#include <string>
#include <unordered_set>

class Controller {
public:
    std::vector<std::string> getFollowers();
    std::vector<std::string> getFollowing();
    std::unordered_set<std::string> findUniqueStrings(const std::vector<std::string>& vec1, const std::vector<std::string>& vec2);
};

#endif // CONTROLLER_H