#include "CurlConfigGenerator.h"
#include "../constants/ConfigConstants.h"
#include <fstream>
#include <sstream>
#include <regex>
#include <iostream>

// TODO: Add model for the parameters
std::string CurlConfigGenerator::getUrl(const std::string& fileName) {
    std::ifstream file(fileName + ConfigConstants::TEXT_FILE);
    if (!file.is_open()) {
        std::cerr << "Failed to open " << fileName << std::endl;
        return "";
    }

    std::string line;
    std::regex url_regex(R"(curl '([^']+)')");
    std::smatch match;

    while (std::getline(file, line)) {
        if (std::regex_search(line, match, url_regex)) {
            std::string url = match[1];
            std::regex count_regex(R"(count=\d+)");
            url = std::regex_replace(url, count_regex, "count=200");
            return url;
        }
    }

    std::cerr << "URL not found in " << fileName << std::endl;
    return "";
}


// TODO: Add model for the parameters
std::vector<std::string> CurlConfigGenerator::getHeaders(const std::string& fileName) {
    std::ifstream file(fileName + ConfigConstants::TEXT_FILE);
    if (!file.is_open()) {
        std::cerr << "Failed to open " << fileName << std::endl;
        return {};
    }

    std::string line;
    std::vector<std::string> headers;
    std::regex header_regex(R"(-H '([^']+)')");
    std::regex cookie_regex(R"(-b '([^']+)')");

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