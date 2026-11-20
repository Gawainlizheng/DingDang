#include <windows.h>
#include <cstdint>

using Env = void*;
using Value = void*;
using CallbackInfo = void*;

template<class Function>
Function nodeApi(const char* name) {
    return reinterpret_cast<Function>(GetProcAddress(GetModuleHandleW(nullptr), name));
}

Value allowWorkerForeground(Env env, CallbackInfo info) {
    auto args = nodeApi<int (*)(Env, CallbackInfo, size_t*, Value*, Value*, void**)>("napi_get_cb_info");
    auto number = nodeApi<int (*)(Env, Value, uint32_t*)>("napi_get_value_uint32");
    auto boolean = nodeApi<int (*)(Env, bool, Value*)>("napi_get_boolean");
    size_t count = 1;
    Value argument = nullptr;
    Value result = nullptr;
    uint32_t pid = 0;
    DWORD foregroundPid = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &foregroundPid);
    if (boolean) boolean(env, args && number && !args(env, info, &count, &argument, nullptr, nullptr)
        && count == 1 && !number(env, argument, &pid) && pid && pid != ASFW_ANY
        && foregroundPid == GetCurrentProcessId() && AllowSetForegroundWindow(pid), &result);
    return result;
}

/** 仅导出一个受限的前台授权函数；动态解析 Node-API，避免依赖 Electron SDK 下载。 */
extern "C" __declspec(dllexport) Value napi_register_module_v1(Env env, Value exports) {
    auto create = nodeApi<int (*)(Env, const char*, size_t, Value (*)(Env, CallbackInfo), void*, Value*)>("napi_create_function");
    auto set = nodeApi<int (*)(Env, Value, const char*, Value)>("napi_set_named_property");
    Value function = nullptr;
    if (create && set && !create(env, "allowWorkerForeground", 21, allowWorkerForeground, nullptr, &function)) {
        set(env, exports, "allowWorkerForeground", function);
    }
    return exports;
}
