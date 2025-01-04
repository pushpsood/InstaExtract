// LoadingAnimation.h
#ifndef LOADINGANIMATION_H
#define LOADINGANIMATION_H

#include <atomic>
#include <thread>
#include <iostream>
#include <chrono>

class LoadingAnimation {
public:
    LoadingAnimation() : loadingDone(false) {}

    void start() {
        loadingThread = std::thread(&LoadingAnimation::showLoadingAnimation, this);
    }

    void stop() {
        loadingDone = true;
        if (loadingThread.joinable()) {
            loadingThread.join();
        }
    }

private:
    std::atomic<bool> loadingDone;
    std::thread loadingThread;

    void showLoadingAnimation() {
        const char* animation = "|/-\\";
        int i = 0;
        while (!loadingDone) {
            std::cout << "\rLoading " << animation[i++ % 4] << std::flush;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
};

#endif // LOADINGANIMATION_H