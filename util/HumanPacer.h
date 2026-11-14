#ifndef HUMAN_PACER_H
#define HUMAN_PACER_H

#include <random>
#include <algorithm>
#include <string>

/**
 * HumanPacer generates realistic human-like browsing delays between requests.
 * 
 * Instagram's anti-bot heuristic analyzes:
 * 1. Request frequency (bursts vs human pacing)
 * 2. Delay predictability (fixed vs randomized interval)
 * 3. Scrolling behavior (continuous requests vs occasional reading pauses)
 */
class HumanPacer {
public:
    HumanPacer(int minDelayMs = 2500, int maxDelayMs = 4500,
               int pauseEveryNPossible = 6,
               int minPauseMs = 6000, int maxPauseMs = 10000)
        : minDelay(minDelayMs), maxDelay(maxDelayMs),
          pauseInterval(pauseEveryNPossible),
          minPause(minPauseMs), maxPause(maxPauseMs),
          rng(std::random_device{}()) {}

    /**
     * Calculates the next delay in milliseconds.
     * Every few pages, introduces an extended pause to mimic human reading/profile inspection.
     */
    int pace(int pageIndex) {
        int sleepMs = 0;
        bool isReadingPause = (pageIndex > 1 && (pageIndex % pauseInterval == 0));

        if (isReadingPause) {
            std::uniform_int_distribution<int> dist(minPause, maxPause);
            sleepMs = dist(rng);
        } else {
            std::uniform_int_distribution<int> dist(minDelay, maxDelay);
            sleepMs = dist(rng);
        }

        // Add micro-jitter (+- 200ms)
        std::uniform_int_distribution<int> jitter(-200, 200);
        sleepMs = std::max(minDelay / 2, sleepMs + jitter(rng));

        return sleepMs;
    }

private:
    int minDelay;
    int maxDelay;
    int pauseInterval;
    int minPause;
    int maxPause;
    std::mt19937 rng;
};

#endif // HUMAN_PACER_H
