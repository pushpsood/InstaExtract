#ifndef HTML_REPORT_GENERATOR_H
#define HTML_REPORT_GENERATOR_H

#include <vector>
#include <string>
#include "../model/InstagramUser.h"
#include "../controller/Controller.h"

class HtmlReportGenerator {
public:
    static bool generateReport(const AuditDataset& dataset,
                               const std::string& outputPath = "profiles.html");

    static bool generateReport(const std::vector<InstagramUser>& nonFollowers,
                               const std::string& outputPath = "profiles.html");

    static void openInBrowser(const std::string& filePath = "profiles.html");
};

#endif // HTML_REPORT_GENERATOR_H
