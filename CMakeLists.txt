cmake_minimum_required(VERSION 3.27)
project(instaExtract)

set(CMAKE_CXX_STANDARD 20)

# Find the libcurl package
find_package(CURL REQUIRED)

# Automatically add all .cpp and .h files, excluding the cmake-build-debug directory
file(GLOB_RECURSE SOURCES
        RELATIVE ${CMAKE_SOURCE_DIR}
        "*.cpp" "*.h"
)

# Filter out files in the cmake-build-debug directory
list(FILTER SOURCES EXCLUDE REGEX "cmake-build-debug/")

# Add the executable and include the necessary source files
add_executable(instaExtract ${SOURCES})

# Link the libcurl library
target_link_libraries(instaExtract CURL::libcurl)

# Copy the config.cfg file to the build directory
configure_file(config/curlRequestFollowing.txt ${CMAKE_BINARY_DIR}/curlRequestFollowing.txt COPYONLY)
configure_file(config/curlRequestFollowers.txt ${CMAKE_BINARY_DIR}/curlRequestFollowers.txt COPYONLY)