#ifndef CONFIG_H
#define CONFIG_H

#include <string>
#include <vector>

class CurlConfigGenerator {
public:
    static std::string getUrl(const std::string&);
    static std::vector<std::string> getHeaders(const std::string&);
};

#endif // CONFIG_H