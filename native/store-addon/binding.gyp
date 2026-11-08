{
  # softglaze_store.node: Windows.Services.Store bridge for the Microsoft Store build.
  # Built by scripts/build-store-native.js (node-gyp against Electron's headers). Windows only.
  "targets": [
    {
      "target_name": "softglaze_store",
      "sources": ["store_addon.cpp"],
      "defines": ["NAPI_VERSION=8", "UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX", "_HAS_EXCEPTIONS=1"],
      "defines!": ["_HAS_EXCEPTIONS=0"],
      "libraries": ["WindowsApp.lib", "ole32.lib", "user32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          # C++/WinRT needs C++17 and exceptions. /permissive keeps older SDK headers compiling
          # (C++/WinRT 2.0.190620 in the Windows 10 2004 SDK fails under /permissive-). In C++17 the
          # C++/WinRT headers use the pre-C++20 coroutine header, which newer compilers accept only
          # with /await (this file uses no coroutines itself).
          "LanguageStandard": "stdcpp17",
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/permissive", "/await", "/bigobj", "/guard:cf"],
          # Electron's common.gypi adds -std:c++20 for V8; this file only uses the C Node-API.
          "AdditionalOptions!": ["-std:c++20"]
        },
        "VCLinkerTool": {
          "AdditionalOptions": ["/guard:cf"]
        }
      }
    }
  ]
}
