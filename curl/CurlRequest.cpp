#include "CurlRequest.h"
#include <curl/curl.h>
#include <iostream>
#include <mutex>

static std::once_flag curlGlobalInitOnce;

static size_t WriteCallback(void* contents, size_t size, size_t nmemb, std::string* userp) {
    size_t totalSize = size * nmemb;
    userp->append(reinterpret_cast<char*>(contents), totalSize);
    return totalSize;
}

CurlSession::CurlSession() {
    std::call_once(curlGlobalInitOnce, []() {
        curl_global_init(CURL_GLOBAL_DEFAULT);
    });

    CURL* curl = curl_easy_init();
    if (curl) {
        // Automatically handle compression (gzip, deflate, br, zstd) just like modern browsers
        curl_easy_setopt(curl, CURLOPT_ACCEPT_ENCODING, "");
        // Follow redirects if any
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        // Enable TCP Keep-Alive to maintain the TLS/TCP connection across pagination
        curl_easy_setopt(curl, CURLOPT_TCP_KEEPALIVE, 1L);
        curl_easy_setopt(curl, CURLOPT_TCP_KEEPIDLE, 120L);
        curl_easy_setopt(curl, CURLOPT_TCP_KEEPINTVL, 60L);
        // Timeout
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);
        // Callback
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    }
    curlHandle = curl;
}

CurlSession::~CurlSession() {
    if (curlHandle) {
        curl_easy_cleanup(static_cast<CURL*>(curlHandle));
        curlHandle = nullptr;
    }
}

HttpResponse CurlSession::get(const std::string& url, const std::vector<std::string>& headers) {
    HttpResponse response;
    CURL* curl = static_cast<CURL*>(curlHandle);
    if (!curl) {
        response.error = "CURL session not initialized";
        return response;
    }

    struct curl_slist* headerList = nullptr;
    for (const auto& header : headers) {
        headerList = curl_slist_append(headerList, header.c_str());
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headerList);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        response.error = curl_easy_strerror(res);
        response.success = false;
        std::cerr << "CURL error: " << response.error << " for URL: " << url << std::endl;
    } else {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.statusCode);
        response.success = (response.statusCode >= 200 && response.statusCode < 300);
    }

    curl_slist_free_all(headerList);
    return response;
}

std::string CurlRequest::makeRequest(const std::string& url, const std::vector<std::string>& headers) {
    CurlSession session;
    HttpResponse resp = session.get(url, headers);
    return resp.body;
}

HttpResponse CurlRequest::makeDetailedRequest(const std::string& url, const std::vector<std::string>& headers) {
    CurlSession session;
    return session.get(url, headers);
}
