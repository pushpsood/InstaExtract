#ifndef FOLLOWING_SERVICE_H
#define FOLLOWING_SERVICE_H

#include <vector>
#include <string>
#include "../model/InstagramUser.h"

class FollowingService {
public:
    static std::vector<InstagramUser> fetchFollowing();
};

#endif // FOLLOWING_SERVICE_H
