#ifndef CURL_REQUEST_H
#define CURL_REQUEST_H

#include <string>
#include <vector>

class CurlRequest {
public:
    static std::string makeRequest(const std::string& url, const std::vector<std::string>& headers);
};

#endif // CURL_REQUEST_H