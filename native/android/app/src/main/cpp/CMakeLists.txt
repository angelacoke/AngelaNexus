cmake_minimum_required(VERSION 3.22.1)
project("angelanexus_mihomo_jni")

add_library(mihomo-jni SHARED mihomo_jni.cpp)

target_compile_features(mihomo-jni PRIVATE cxx_std_17)
target_compile_options(mihomo-jni PRIVATE -fvisibility=hidden -Wall -Wextra -Werror)
target_link_libraries(mihomo-jni PRIVATE log dl)
