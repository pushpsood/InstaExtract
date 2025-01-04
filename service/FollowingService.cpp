#include "FollowingService.h"
#include "../curl/CurlRequest.h"
#include "../curl/CurlConfigGenerator.h"
#include "../nlohmann/json.hpp"
#include "../constants/JsonKeys.h"
#include "../constants/ConfigConstants.h"
#include "iostream"

using json = nlohmann::json;

std::vector<std::string> FollowingService::fetchFollowing() {
    std::string url = CurlConfigGenerator::getUrl(ConfigConstants::CURL_REQUEST_FOLLOWING);
    std::vector<std::string> headers = CurlConfigGenerator::getHeaders(ConfigConstants::CURL_REQUEST_FOLLOWING);
    std::vector<std::string> usernames;

    while (!url.empty()) {
        std::string response = CurlRequest::makeRequest(url, headers);

        try {
            json jsonResponse = json::parse(response);

            if (jsonResponse.contains(JsonKeys::USERS_KEY)) {
                for (const auto& user : jsonResponse[JsonKeys::USERS_KEY]) {
                    if (user.contains(JsonKeys::USERNAME_KEY)) {
                        usernames.push_back(user[JsonKeys::USERNAME_KEY].get<std::string>());
                    }
                }
            }

            if (jsonResponse.contains(JsonKeys::NEXT_MAX_ID_KEY)) {
                url = CurlConfigGenerator::getUrl(ConfigConstants::CURL_REQUEST_FOLLOWING) + JsonKeys::MAX_ID + jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].get<std::string>();
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

    return usernames;
}