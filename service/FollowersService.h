#ifndef FOLLOWERS_SERVICE_H
#define FOLLOWERS_SERVICE_H

#include <vector>
#include <string>
#include "../model/InstagramUser.h"

class FollowersService {
public:
    static std::vector<InstagramUser> fetchFollowers();
};

#endif // FOLLOWERS_SERVICE_H
