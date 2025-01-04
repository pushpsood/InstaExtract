#ifndef FOLLOWERS_SERVICE_H
#define FOLLOWERS_SERVICE_H

#include <vector>
#include <string>

class FollowersService {
public:
    static std::vector<std::string> fetchFollowers();
};

#endif // FOLLOWERS_SERVICE_H