#include "CurlRequest.h"
#include <curl/curl.h>
#include <iostream>

size_t WriteCallback(void* contents, size_t size, size_t nmemb, std::string* userp) {
    size_t totalSize = size * nmemb;
    userp->append(reinterpret_cast<char*>(contents), totalSize);
    return totalSize;
}

std::string CurlRequest::makeRequest(const std::string& url, const std::vector<std::string>& headers) {
    CURL* curl;
    CURLcode res;
    std::string readBuffer;

    curl = curl_easy_init();
    if (curl) {
        struct curl_slist* headerList = nullptr;
        for (const auto& header : headers) {
            headerList = curl_slist_append(headerList, header.c_str());
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headerList);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

        res = curl_easy_perform(curl);
        if (res != CURLE_OK) {
            std::cerr << "CURL error: " << curl_easy_strerror(res) << " for URL: " << url << std::endl;
        }

        curl_slist_free_all(headerList);
        curl_easy_cleanup(curl);
    }

    return readBuffer;
}