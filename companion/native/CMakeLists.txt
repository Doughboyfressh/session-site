cmake_minimum_required(VERSION 3.25)
project(session_companion VERSION 0.1.1 LANGUAGES CXX)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(SMTG_USE_STATIC_CRT ON CACHE BOOL "" FORCE)
if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "SESSION's native companion requires 64-bit Windows")
endif()
if(NOT SESSION_VST3_SDK OR NOT SESSION_JSON_INCLUDE)
  message(FATAL_ERROR "Run node scripts/build-companion.mjs to prepare pinned dependencies")
endif()
set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES ON CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT ON CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_MODULE_INFO OFF CACHE BOOL "" FORCE)
add_subdirectory("${SESSION_VST3_SDK}" sdk)
add_executable(session-vst3-host
  host.cpp
  "${SESSION_VST3_SDK}/public.sdk/source/vst/hosting/module_win32.cpp"
  "${SESSION_VST3_SDK}/public.sdk/source/vst/hosting/plugprovider.cpp"
)
target_compile_features(session-vst3-host PRIVATE cxx_std_17)
target_compile_definitions(session-vst3-host PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_include_directories(session-vst3-host PRIVATE "${SESSION_JSON_INCLUDE}")
target_compile_options(session-vst3-host PRIVATE /W4 /EHsc /utf-8)
target_link_libraries(session-vst3-host PRIVATE sdk_hosting ole32 uuid winmm shell32)
set_target_properties(session-vst3-host PROPERTIES RUNTIME_OUTPUT_DIRECTORY_RELEASE "${SESSION_OUTPUT_DIR}")

# Regression artifacts are built separately and are excluded from the release ZIP.
smtg_add_vst3plugin(session-strict-fixture tests/strict-plugin.cpp)
target_compile_features(session-strict-fixture PRIVATE cxx_std_17)
target_link_libraries(session-strict-fixture PRIVATE sdk)
add_executable(session-vst3-host-checks tests/host-checks.cpp
  "${SESSION_VST3_SDK}/public.sdk/source/vst/hosting/module_win32.cpp"
  "${SESSION_VST3_SDK}/public.sdk/source/vst/hosting/plugprovider.cpp")
target_compile_features(session-vst3-host-checks PRIVATE cxx_std_17)
target_compile_definitions(session-vst3-host-checks PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_include_directories(session-vst3-host-checks PRIVATE "${SESSION_JSON_INCLUDE}")
target_compile_options(session-vst3-host-checks PRIVATE /W4 /EHsc /utf-8)
target_link_libraries(session-vst3-host-checks PRIVATE sdk_hosting ole32 uuid winmm shell32)
set_target_properties(session-vst3-host-checks PROPERTIES RUNTIME_OUTPUT_DIRECTORY_RELEASE "${SESSION_OUTPUT_DIR}")
