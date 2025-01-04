#ifndef FOLLOWING_SERVICE_H
#define FOLLOWING_SERVICE_H

#include <vector>
#include <string>

class FollowingService {
public:
    static std::vector<std::string> fetchFollowing();
};

#endif // FOLLOWING_SERVICE_H