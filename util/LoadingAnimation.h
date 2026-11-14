// LoadingAnimation.h
#ifndef LOADINGANIMATION_H
#define LOADINGANIMATION_H

#include <atomic>
#include <thread>
#include <iostream>
#include <chrono>
#include <string>
#include <mutex>

class LoadingAnimation {
public:
    LoadingAnimation() {
        loadingDone = false;
        setStatus("Loading");
    }

    ~LoadingAnimation() {
        stop();
    }

    void start() {
        loadingDone = false;
        loadingThread = std::thread(&LoadingAnimation::showLoadingAnimation, this);
    }

    void stop() {
        if (!loadingDone) {
            loadingDone = true;
            if (loadingThread.joinable()) {
                loadingThread.join();
            }
            // Clear current line cleanly
            std::cout << "\r" << std::string(90, ' ') << "\r" << std::flush;
        }
    }

    static void setStatus(const std::string& status) {
        std::lock_guard<std::mutex> lock(getStatusMutex());
        getCurrentStatus() = status;
    }

private:
    std::atomic<bool> loadingDone;
    std::thread loadingThread;

    static std::string& getCurrentStatus() {
        static std::string currentStatus = "Loading";
        return currentStatus;
    }

    static std::mutex& getStatusMutex() {
        static std::mutex statusMutex;
        return statusMutex;
    }

    void showLoadingAnimation() {
        const char* animation = "|/-\\";
        int i = 0;
        while (!loadingDone) {
            std::string status;
            {
                std::lock_guard<std::mutex> lock(getStatusMutex());
                status = getCurrentStatus();
            }
            std::cout << "\r" << status << " " << animation[i++ % 4] << "   " << std::flush;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
};

#endif // LOADINGANIMATION_H
