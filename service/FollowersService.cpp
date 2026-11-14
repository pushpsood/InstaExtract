#include "FollowersService.h"
#include "../curl/CurlRequest.h"
#include "../curl/CurlConfigGenerator.h"
#include "../nlohmann/json.hpp"
#include "../constants/JsonKeys.h"
#include "../constants/ConfigConstants.h"
#include "../util/LoadingAnimation.h"
#include "../util/HumanPacer.h"
#include <iostream>
#include <fstream>
#include <regex>
#include <thread>
#include <chrono>

using json = nlohmann::json;

static std::string updateUrlMaxId(const std::string& baseUrl, const std::string& maxId) {
    std::regex max_id_regex(R"([?&]max_id=[^&]*)");
    if (std::regex_search(baseUrl, max_id_regex)) {
        return std::regex_replace(baseUrl, max_id_regex, "&max_id=" + maxId);
    }
    char sep = (baseUrl.find('?') != std::string::npos) ? '&' : '?';
    return baseUrl + sep + "max_id=" + maxId;
}

static InstagramUser parseUser(const json& userJson) {
    InstagramUser u;
    if (userJson.contains(JsonKeys::USERNAME_KEY)) {
        u.username = userJson[JsonKeys::USERNAME_KEY].get<std::string>();
    } else if (userJson.contains("username") && userJson["username"].is_string()) {
        u.username = userJson["username"].get<std::string>();
    }

    if (userJson.contains(JsonKeys::PK_KEY)) {
        if (userJson[JsonKeys::PK_KEY].is_string()) {
            u.pk = userJson[JsonKeys::PK_KEY].get<std::string>();
        } else if (userJson[JsonKeys::PK_KEY].is_number()) {
            u.pk = std::to_string(userJson[JsonKeys::PK_KEY].get<long long>());
        }
    } else if (userJson.contains("pk")) {
        if (userJson["pk"].is_string()) {
            u.pk = userJson["pk"].get<std::string>();
        } else if (userJson["pk"].is_number()) {
            u.pk = std::to_string(userJson["pk"].get<long long>());
        }
    } else if (userJson.contains("id")) {
        if (userJson["id"].is_string()) {
            u.pk = userJson["id"].get<std::string>();
        } else if (userJson["id"].is_number()) {
            u.pk = std::to_string(userJson["id"].get<long long>());
        }
    }

    if (userJson.contains(JsonKeys::FULL_NAME_KEY) && userJson[JsonKeys::FULL_NAME_KEY].is_string()) {
        u.fullName = userJson[JsonKeys::FULL_NAME_KEY].get<std::string>();
    } else if (userJson.contains("fullName") && userJson["fullName"].is_string()) {
        u.fullName = userJson["fullName"].get<std::string>();
    } else if (userJson.contains("full_name") && userJson["full_name"].is_string()) {
        u.fullName = userJson["full_name"].get<std::string>();
    }

    if (userJson.contains(JsonKeys::IS_PRIVATE_KEY) && userJson[JsonKeys::IS_PRIVATE_KEY].is_boolean()) {
        u.isPrivate = userJson[JsonKeys::IS_PRIVATE_KEY].get<bool>();
    } else if (userJson.contains("isPrivate") && userJson["isPrivate"].is_boolean()) {
        u.isPrivate = userJson["isPrivate"].get<bool>();
    } else if (userJson.contains("is_private") && userJson["is_private"].is_boolean()) {
        u.isPrivate = userJson["is_private"].get<bool>();
    }

    if (userJson.contains(JsonKeys::IS_VERIFIED_KEY) && userJson[JsonKeys::IS_VERIFIED_KEY].is_boolean()) {
        u.isVerified = userJson[JsonKeys::IS_VERIFIED_KEY].get<bool>();
    } else if (userJson.contains("isVerified") && userJson["isVerified"].is_boolean()) {
        u.isVerified = userJson["isVerified"].get<bool>();
    } else if (userJson.contains("is_verified") && userJson["is_verified"].is_boolean()) {
        u.isVerified = userJson["is_verified"].get<bool>();
    }

    if (userJson.contains(JsonKeys::PROFILE_PIC_URL_KEY) && userJson[JsonKeys::PROFILE_PIC_URL_KEY].is_string()) {
        u.profilePicUrl = userJson[JsonKeys::PROFILE_PIC_URL_KEY].get<std::string>();
    } else if (userJson.contains("profilePicUrl") && userJson["profilePicUrl"].is_string()) {
        u.profilePicUrl = userJson["profilePicUrl"].get<std::string>();
    } else if (userJson.contains("profile_pic_url") && userJson["profile_pic_url"].is_string()) {
        u.profilePicUrl = userJson["profile_pic_url"].get<std::string>();
    }

    if (userJson.contains(JsonKeys::HAS_ANONYMOUS_PROFILE_PICTURE_KEY) && userJson[JsonKeys::HAS_ANONYMOUS_PROFILE_PICTURE_KEY].is_boolean()) {
        u.hasAnonymousProfilePicture = userJson[JsonKeys::HAS_ANONYMOUS_PROFILE_PICTURE_KEY].get<bool>();
    } else if (userJson.contains("hasAnonymousProfilePicture") && userJson["hasAnonymousProfilePicture"].is_boolean()) {
        u.hasAnonymousProfilePicture = userJson["hasAnonymousProfilePicture"].get<bool>();
    } else if (userJson.contains("has_anonymous_profile_picture") && userJson["has_anonymous_profile_picture"].is_boolean()) {
        u.hasAnonymousProfilePicture = userJson["has_anonymous_profile_picture"].get<bool>();
    }

    if (userJson.contains(JsonKeys::LATEST_REEL_MEDIA_KEY) && userJson[JsonKeys::LATEST_REEL_MEDIA_KEY].is_number()) {
        u.latestReelMedia = userJson[JsonKeys::LATEST_REEL_MEDIA_KEY].get<long long>();
    } else if (userJson.contains("latestReelMedia") && userJson["latestReelMedia"].is_number()) {
        u.latestReelMedia = userJson["latestReelMedia"].get<long long>();
    } else if (userJson.contains("latest_reel_media") && userJson["latest_reel_media"].is_number()) {
        u.latestReelMedia = userJson["latest_reel_media"].get<long long>();
    }

    u.followsViewer = true;
    return u;
}

std::vector<InstagramUser> FollowersService::fetchFollowers() {
    // 0. Check local cache file
    std::ifstream cacheFile("cache_followers.json");
    if (cacheFile.is_open()) {
        try {
            json cacheJson;
            cacheFile >> cacheJson;
            if (cacheJson.is_array() && !cacheJson.empty()) {
                std::vector<InstagramUser> cachedList;
                for (const auto& item : cacheJson) {
                    cachedList.push_back(parseUser(item));
                }
                LoadingAnimation::setStatus("[Cache] Loaded " + std::to_string(cachedList.size()) + " followers from cache_followers.json");
                return cachedList;
            }
        } catch (...) {
            // If cache invalid, proceed to fetch
        }
    }

    std::string baseUrl = CurlConfigGenerator::getUrl(ConfigConstants::CURL_REQUEST_FOLLOWERS);
    std::vector<std::string> headers = CurlConfigGenerator::getHeaders(ConfigConstants::CURL_REQUEST_FOLLOWERS);

    if (baseUrl.empty() || headers.empty()) {
        std::cerr << "Error: Unable to load followers configuration from "
                  << ConfigConstants::CURL_REQUEST_FOLLOWERS << std::endl;
        return {};
    }

    std::vector<InstagramUser> followersUsers;

    CurlSession session;
    HumanPacer pacer;
    std::string currentUrl = baseUrl;
    int pageIndex = 0;
    int retryCount = 0;
    const int MAX_RETRIES = 3;

    while (!currentUrl.empty()) {
        pageIndex++;
        LoadingAnimation::setStatus("[Followers] Fetching page " + std::to_string(pageIndex) +
                                    " (" + std::to_string(followersUsers.size()) + " collected)...");

        HttpResponse resp = session.get(currentUrl, headers);

        // Handle network transport failure
        if (!resp.error.empty() && resp.statusCode == 0) {
            std::cerr << "\n[!] Network transport error: " << resp.error << std::endl;
            if (++retryCount <= MAX_RETRIES) {
                LoadingAnimation::setStatus("[Followers] Network glitch. Retrying in 5s (" +
                                            std::to_string(retryCount) + "/" + std::to_string(MAX_RETRIES) + ")...");
                std::this_thread::sleep_for(std::chrono::seconds(5));
                pageIndex--;
                continue;
            }
            break;
        }

        // Handle HTTP 429 Too Many Requests
        if (resp.statusCode == 429) {
            if (++retryCount <= MAX_RETRIES) {
                int waitSec = 60 * retryCount;
                LoadingAnimation::setStatus("[Rate-Limited] HTTP 429 from Instagram. Cooling down for " +
                                            std::to_string(waitSec) + "s (Attempt " +
                                            std::to_string(retryCount) + "/" + std::to_string(MAX_RETRIES) + ")...");
                std::this_thread::sleep_for(std::chrono::seconds(waitSec));
                pageIndex--;
                continue;
            } else {
                std::cerr << "\n[!] Instagram rate limit exceeded (HTTP 429). Returning collected data." << std::endl;
                break;
            }
        }

        try {
            json jsonResponse = json::parse(resp.body);

            // Handle Instagram API challenge / fail statuses
            if (jsonResponse.contains("status") && jsonResponse["status"] == "fail") {
                std::string message = jsonResponse.value("message", "Unknown error");

                if (message == "checkpoint_required") {
                    std::cerr << "\n[!] Instagram Security Checkpoint triggered! Open Instagram in your browser to verify your account." << std::endl;
                    break;
                } else if (message == "feedback_required" || message.find("wait a few minutes") != std::string::npos) {
                    if (++retryCount <= MAX_RETRIES) {
                        int waitSec = 60 * retryCount;
                        LoadingAnimation::setStatus("[Throttled] " + message + ". Pausing for " +
                                                    std::to_string(waitSec) + "s (Attempt " +
                                                    std::to_string(retryCount) + "/" + std::to_string(MAX_RETRIES) + ")...");
                        std::this_thread::sleep_for(std::chrono::seconds(waitSec));
                        pageIndex--;
                        continue;
                    }
                    std::cerr << "\n[!] Instagram action throttle active (" << message << "). Returning collected data." << std::endl;
                    break;
                } else if (message == "login_required") {
                    std::cerr << "\n[!] Instagram session expired. Please re-copy the curl command with fresh session cookies." << std::endl;
                    break;
                } else {
                    std::cerr << "\n[!] Instagram API returned error: " << message << std::endl;
                    break;
                }
            }

            // Successfully received response
            retryCount = 0;

            if (jsonResponse.contains(JsonKeys::USERS_KEY)) {
                for (const auto& user : jsonResponse[JsonKeys::USERS_KEY]) {
                    if (user.contains(JsonKeys::USERNAME_KEY)) {
                        followersUsers.push_back(parseUser(user));
                    }
                }
            }

            if (jsonResponse.contains(JsonKeys::GROUPS_KEY)) {
                for (const auto& group : jsonResponse[JsonKeys::GROUPS_KEY]) {
                    if (group.contains(JsonKeys::FACEPILE_KEY)) {
                        for (const auto& user : group[JsonKeys::FACEPILE_KEY]) {
                            if (user.contains(JsonKeys::USERNAME_KEY)) {
                                followersUsers.push_back(parseUser(user));
                            }
                        }
                    }
                }
            }

            // Determine if more pages exist
            if (jsonResponse.contains(JsonKeys::NEXT_MAX_ID_KEY) && !jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].is_null()) {
                std::string nextMaxId;
                if (jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].is_string()) {
                    nextMaxId = jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].get<std::string>();
                } else if (jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].is_number()) {
                    nextMaxId = std::to_string(jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].get<long long>());
                } else {
                    nextMaxId = jsonResponse[JsonKeys::NEXT_MAX_ID_KEY].dump();
                }

                if (!nextMaxId.empty()) {
                    currentUrl = updateUrlMaxId(baseUrl, nextMaxId);

                    // Anti-bot human delay: simulate reading/scrolling
                    int delayMs = pacer.pace(pageIndex);
                    double delaySec = delayMs / 1000.0;
                    char buf[128];
                    snprintf(buf, sizeof(buf), "[Followers] Page %d (%zu users). Human pause: %.1fs",
                             pageIndex, followersUsers.size(), delaySec);
                    LoadingAnimation::setStatus(buf);
                    std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
                } else {
                    currentUrl.clear();
                }
            } else {
                currentUrl.clear();
            }

        } catch (const json::parse_error& e) {
            std::cerr << "\nJSON parse error on page " << pageIndex << ": " << e.what() << std::endl;
            if (!resp.body.empty()) {
                std::cerr << "Response snippet: " << resp.body.substr(0, std::min<size_t>(resp.body.size(), 200)) << std::endl;
            }
            break;
        } catch (const std::exception& e) {
            std::cerr << "\nError processing followers response: " << e.what() << std::endl;
            break;
        }
    }

    if (!followersUsers.empty()) {
        try {
            json cacheArr = json::array();
            for (const auto& u : followersUsers) {
                json uj;
                uj["pk"] = u.pk;
                uj["username"] = u.username;
                uj["fullName"] = u.fullName;
                uj["isPrivate"] = u.isPrivate;
                uj["isVerified"] = u.isVerified;
                uj["profilePicUrl"] = u.profilePicUrl;
                uj["hasAnonymousProfilePicture"] = u.hasAnonymousProfilePicture;
                uj["latestReelMedia"] = u.latestReelMedia;
                cacheArr.push_back(uj);
            }
            std::ofstream cacheOut("cache_followers.json");
            if (cacheOut.is_open()) {
                cacheOut << cacheArr.dump(2);
            }
        } catch (...) {}
    }

    return followersUsers;
}
