#include <windows.h>

struct AngelaNexusTunState {
    HMODULE wintun = nullptr;
    bool running = false;
};

bool angelanexus_load_wintun(AngelaNexusTunState& state, const wchar_t* dllPath) {
    if (state.wintun != nullptr) return true;
    state.wintun = LoadLibraryW(dllPath);
    return state.wintun != nullptr;
}

void angelanexus_unload_wintun(AngelaNexusTunState& state) {
    if (state.wintun != nullptr) {
        FreeLibrary(state.wintun);
        state.wintun = nullptr;
    }
    state.running = false;
}
