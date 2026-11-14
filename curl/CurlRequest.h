#ifndef CURL_REQUEST_H
#define CURL_REQUEST_H

#include <string>
#include <vector>

struct HttpResponse {
    long statusCode = 0;
    std::string body;
    std::string error;
    bool success = false;
};

/**
 * Reusable CurlSession maintains persistent HTTP/2 or Keep-Alive TCP connections
 * and TLS session resumption across pagination queries, mimicking a real browser session.
 */
class CurlSession {
public:
    CurlSession();
    ~CurlSession();

    CurlSession(const CurlSession&) = delete;
    CurlSession& operator=(const CurlSession&) = delete;

    HttpResponse get(const std::string& url, const std::vector<std::string>& headers);

private:
    void* curlHandle = nullptr;
};

class CurlRequest {
public:
    static std::string makeRequest(const std::string& url, const std::vector<std::string>& headers);
    static HttpResponse makeDetailedRequest(const std::string& url, const std::vector<std::string>& headers);
};

#endif // CURL_REQUEST_H
