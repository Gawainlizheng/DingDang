#define UNICODE
#define _UNICODE
#define NOMINMAX
#include <windows.h>
#include <shlobj.h>
#include <wrl/client.h>
#include <cstdlib>
#include <chrono>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <optional>

using Microsoft::WRL::ComPtr;
using Clock = std::chrono::steady_clock;
struct Request { std::wstring path; int x; int y; bool folder; };
std::mutex requestMutex;
std::condition_variable requestDone;
std::optional<Request> pendingRequest;
constexpr UINT showRequest = WM_APP + 1;
constexpr UINT stopWorker = WM_APP + 2;
int showMenu(HWND owner, const Request& request);

struct MenuHandlers {
    ComPtr<IContextMenu2> second;
    ComPtr<IContextMenu3> third;
};

// 将子菜单初始化和自绘消息交给提供菜单项的 Shell 扩展。
LRESULT CALLBACK menuWindow(HWND window, UINT message, WPARAM word, LPARAM data) {
    if (message == showRequest) {
        std::unique_lock<std::mutex> lock(requestMutex);
        if (!pendingRequest) return 0;
        const Request request = *pendingRequest;
        lock.unlock();
        std::cout << "done " << showMenu(window, request) << std::endl;
        lock.lock();
        pendingRequest.reset();
        requestDone.notify_one();
        return 0;
    }
    if (message == stopWorker) { PostQuitMessage(0); return 0; }
    auto handlers = reinterpret_cast<MenuHandlers*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (handlers && (message == WM_INITMENUPOPUP || message == WM_DRAWITEM ||
                     message == WM_MEASUREITEM || message == WM_MENUCHAR)) {
        LRESULT result = 0;
        if (handlers->third && SUCCEEDED(handlers->third->HandleMenuMsg2(message, word, data, &result))) return result;
        if (handlers->second && message != WM_MENUCHAR &&
            SUCCEEDED(handlers->second->HandleMenuMsg(message, word, data))) return 0;
    }
    return DefWindowProcW(window, message, word, data);
}

int showMenu(HWND owner, const Request& request) {
    const int x = request.x;
    const int y = request.y;
    const auto start = Clock::now();
    PIDLIST_ABSOLUTE item = nullptr;
    if (FAILED(SHParseDisplayName(request.path.c_str(), nullptr, &item, 0, nullptr))) return 2;
    ComPtr<IShellFolder> folder;
    PCUITEMID_CHILD child = nullptr;
    HRESULT status = SHBindToParent(item, IID_PPV_ARGS(folder.GetAddressOf()), &child);

    const auto parsed = Clock::now();
    HMENU menu = CreatePopupMenu();
    ComPtr<IContextMenu> context;
    int result = 2;
    if (owner && menu && SUCCEEDED(status) && SUCCEEDED(folder->GetUIObjectOf(
            owner, 1, &child, IID_IContextMenu, nullptr, reinterpret_cast<void**>(context.GetAddressOf())))) {
        constexpr UINT firstCommand = 1;
        if (SUCCEEDED(context->QueryContextMenu(menu, 0, firstCommand, 0x7fff, CMF_NORMAL)) &&
            GetMenuItemCount(menu) > 0) {
            MenuHandlers handlers;
            context.As(&handlers.second);
            context.As(&handlers.third);
            SetWindowLongPtrW(owner, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&handlers));
            SetWindowPos(owner, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            ShowWindow(owner, SW_SHOWNOACTIVATE);
            if (!SetForegroundWindow(owner) || GetForegroundWindow() != owner) {
                SetWindowLongPtrW(owner, GWLP_USERDATA, 0);
                DestroyMenu(menu);
                ShowWindow(owner, SW_HIDE);
                CoTaskMemFree(item);
                return 2;
            }
            const auto milliseconds = [](auto duration) { return std::chrono::duration<double, std::milli>(duration).count(); };
            std::cout << "show " << milliseconds(parsed - start) << ' '
                      << milliseconds(Clock::now() - parsed) << std::endl;
            SetLastError(ERROR_SUCCESS);
            const UINT command = TrackPopupMenuEx(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, x, y, owner, nullptr);
            result = command ? 0 : GetLastError() == ERROR_SUCCESS ? 1 : 2;
            PostMessageW(owner, WM_NULL, 0, 0);
            if (command) {
                char verb[128]{};
                if (request.folder && SUCCEEDED(context->GetCommandString(command - firstCommand,
                        GCS_VERBA, nullptr, verb, sizeof(verb))) && _stricmp(verb, "open") == 0) {
                    result = 4;
                } else {
                    CMINVOKECOMMANDINFOEX invocation{};
                    invocation.cbSize = sizeof(invocation);
                    invocation.fMask = CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE;
                    invocation.hwnd = owner;
                    invocation.lpVerb = MAKEINTRESOURCEA(command - firstCommand);
                    invocation.lpVerbW = MAKEINTRESOURCEW(command - firstCommand);
                    invocation.nShow = SW_SHOWNORMAL;
                    invocation.ptInvoke = { x, y };
                    if (FAILED(context->InvokeCommand(reinterpret_cast<LPCMINVOKECOMMANDINFO>(&invocation)))) result = 3;
                }
            }
            SetWindowLongPtrW(owner, GWLP_USERDATA, 0);
        }
    }
    if (menu) DestroyMenu(menu);
    ShowWindow(owner, SW_HIDE);
    CoTaskMemFree(item);
    return result;
}

/** 管道只读数据；界面及 COM 调用留在持续处理消息的 STA 线程。 */
void receiveRequests(HWND owner) {
    std::string line;
    while (std::getline(std::cin, line)) {
        Request request{};
        std::string encoded;
        std::istringstream input(line);
        if (!(input >> request.x >> request.y >> request.folder >> encoded) || encoded.size() % 4 ||
            encoded.find_first_not_of("0123456789abcdef") != std::string::npos) {
            std::cout << "done 2" << std::endl;
            continue;
        }
        for (size_t offset = 0; offset < encoded.size(); offset += 4) {
            const auto low = std::stoul(encoded.substr(offset, 2), nullptr, 16);
            const auto high = std::stoul(encoded.substr(offset + 2, 2), nullptr, 16);
            request.path.push_back(static_cast<wchar_t>(low | (high << 8)));
        }
        std::unique_lock<std::mutex> lock(requestMutex);
        pendingRequest = std::move(request);
        if (!PostMessageW(owner, showRequest, 0, 0)) {
            pendingRequest.reset();
            std::cout << "done 2" << std::endl;
            continue;
        }
        requestDone.wait(lock, [] { return !pendingRequest; });
    }
    PostMessageW(owner, stopWorker, 0, 0);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    if (FAILED(OleInitialize(nullptr))) return 2;
    WNDCLASSW definition{};
    definition.lpfnWndProc = menuWindow;
    definition.hInstance = instance;
    definition.lpszClassName = L"DingDangShellMenu";
    RegisterClassW(&definition);
    HWND owner = CreateWindowExW(WS_EX_TOOLWINDOW, definition.lpszClassName, L"", WS_POPUP,
                                 0, 0, 1, 1, nullptr, nullptr, instance, nullptr);
    if (!owner) { OleUninitialize(); return 2; }
    std::cout << "ready" << std::endl;
    std::thread reader(receiveRequests, owner);
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    reader.join();
    DestroyWindow(owner);
    OleUninitialize();
    return 0;
}
