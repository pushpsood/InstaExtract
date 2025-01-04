#include "FollowersService.h"
#include "../curl/CurlRequest.h"
#include "../curl/CurlConfigGenerator.h"
#include "../nlohmann/json.hpp"
#include "../constants/JsonKeys.h"
#include "../constants/ConfigConstants.h"
#include "iostream"


using json = nlohmann::json;

std::vector<std::string> FollowersService::fetchFollowers() {
    std::string url = CurlConfigGenerator::getUrl(ConfigConstants::CURL_REQUEST_FOLLOWERS);
    std::vector<std::string> headers = CurlConfigGenerator::getHeaders(ConfigConstants::CURL_REQUEST_FOLLOWERS);

    std::vector<std::string> user_usernames;  // Vector to store usernames from users array
    std::vector<std::string> group_usernames; // Vector to store usernames from groups array

    while (!url.empty()) {
        std::string response = CurlRequest::makeRequest(url, headers);

        try {
            json jsonResponse = json::parse(response);

            if (jsonResponse.contains(JsonKeys::USERS_KEY)) {
                for (const auto& user : jsonResponse[JsonKeys::USERS_KEY]) {
                    if (user.contains(JsonKeys::USERNAME_KEY)) {
                        user_usernames.push_back(user[JsonKeys::USERNAME_KEY].get<std::string>());
                    }
                }
            }

            if (jsonResponse.contains(JsonKeys::GROUPS_KEY)) {
                for (const auto& group : jsonResponse[JsonKeys::GROUPS_KEY]) {
                    if (group.contains(JsonKeys::FACEPILE_KEY)) {
                        for (const auto& user : group[JsonKeys::FACEPILE_KEY]) {
                            if (user.contains(JsonKeys::USERNAME_KEY)) {
                                group_usernames.push_back(user[JsonKeys::USERNAME_KEY].get<std::string>());
                            }
                        }
                    }
                }
            }

            if (jsonResponse.contains(JsonKeys::NEXT_MAX_ID_KEY)) {
                url = CurlConfigGenerator::getUrl(ConfigConstants::CURL_REQUEST_FOLLOWERS) + JsonKeys::MAX_ID + jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].get<std::string>();
            } else {
                url.clear();
            }

        } catch (const json::parse_error& e) {
            std::cerr << "JSON parse error: " << e.what() << std::endl;
            std::cerr << "Response: " << response << std::endl;
            break;
        } catch (const std::exception& e) {
            std::cerr << "Error: " << e.what() << std::endl;
            break;
        }
    }

    std::vector<std::string> all_usernames;
    all_usernames.insert(all_usernames.end(), user_usernames.begin(), user_usernames.end());
    all_usernames.insert(all_usernames.end(), group_usernames.begin(), group_usernames.end());

    return all_usernames;
}



