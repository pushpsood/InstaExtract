#include "CurlConfigGenerator.h"
#include "../constants/ConfigConstants.h"
#include <fstream>
#include <sstream>
#include <regex>
#include <iostream>

static std::ifstream openConfigFile(const std::string& fileName) {
    // 1. Check config/ (relative to project root)
    std::string path = "config/" + fileName + ConfigConstants::TEXT_FILE;
    std::ifstream file(path);
    if (file.is_open()) return file;

    // 2. Check ../config/ (if running inside cmake-build-debug/ or build/)
    path = "../config/" + fileName + ConfigConstants::TEXT_FILE;
    file.open(path);
    if (file.is_open()) return file;

    // 3. Fallback to current working directory
    path = fileName + ConfigConstants::TEXT_FILE;
    file.open(path);
    return file;
}

std::string CurlConfigGenerator::getUrl(const std::string& fileName) {
    std::ifstream file = openConfigFile(fileName);
    if (!file.is_open()) {
        std::cerr << "Failed to open config file for " << fileName << " (checked current dir and config/)" << std::endl;
        return "";
    }

    std::string line;
    std::regex url_regex(R"(curl(?:\s+--url)?\s+['"]([^'"]+)['"])");
    std::smatch match;

    while (std::getline(file, line)) {
        if (std::regex_search(line, match, url_regex)) {
            std::string url = match[1];
            // NOTE: We intentionally PRESERVE the browser's count (e.g., count=12)
            // instead of overriding with count=200. Requesting count=200 is a major
            // bot fingerprint that triggers Instagram's checkpoint and rate limits.
            return url;
        }
    }

    std::cerr << "URL not found in " << fileName << std::endl;
    return "";
}

std::vector<std::string> CurlConfigGenerator::getHeaders(const std::string& fileName) {
    std::ifstream file = openConfigFile(fileName);
    if (!file.is_open()) {
        std::cerr << "Failed to open config file for " << fileName << " (checked current dir and config/)" << std::endl;
        return {};
    }

    std::string line;
    std::vector<std::string> headers;
    std::regex header_regex(R"((?:-H|--header)\s+['"]([^'"]+)['"])");
    std::regex cookie_regex(R"((?:-b|--cookie)\s+['"]([^'"]+)['"])");

    while (std::getline(file, line)) {
        std::smatch match;
        if (std::regex_search(line, match, header_regex)) {
            headers.push_back(match[1]);
        } else if (std::regex_search(line, match, cookie_regex)) {
            headers.push_back("cookie: " + std::string(match[1]));
        }
    }

    if (headers.empty()) {
        std::cerr << "No headers found in " << fileName << std::endl;
    }

    return headers;
}
