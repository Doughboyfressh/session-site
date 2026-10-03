// Exercise the actual host callbacks with a constrained view and hidden Win32
// window. This executable and its test view are not shipped in the companion.
#define wmain session_companion_cli_main
#include "../host.cpp"
#undef wmain

class ConstrainedView final : public U::Implements<U::Directly<IPlugView>> {
public:
  ViewRect current{0, 0, 400, 200}; int notifications = 0, constraints = 0;
  tresult PLUGIN_API isPlatformTypeSupported(FIDString) override { return kResultOk; }
  tresult PLUGIN_API attached(void*, FIDString) override { return kResultOk; }
  tresult PLUGIN_API removed() override { return kResultOk; }
  tresult PLUGIN_API onWheel(float) override { return kResultFalse; }
  tresult PLUGIN_API onKeyDown(char16, int16, int16) override { return kResultFalse; }
  tresult PLUGIN_API onKeyUp(char16, int16, int16) override { return kResultFalse; }
  tresult PLUGIN_API getSize(ViewRect* size) override { if (!size) return kInvalidArgument; *size = current; return kResultOk; }
  tresult PLUGIN_API onSize(ViewRect* size) override {
    if (!size || size->getWidth() <= 0 || size->getHeight() <= 0) return kInvalidArgument;
    ++notifications; current = *size; return kResultOk;
  }
  tresult PLUGIN_API onFocus(TBool) override { return kResultOk; }
  tresult PLUGIN_API setFrame(IPlugFrame*) override { return kResultOk; }
  tresult PLUGIN_API canResize() override { return kResultOk; }
  tresult PLUGIN_API checkSizeConstraint(ViewRect* size) override {
    if (!size) return kInvalidArgument;
    ++constraints;
    size->right = size->left + std::clamp(size->getWidth(), 320, 1000);
    size->bottom = size->top + size->getWidth() / 2;
    return kResultOk;
  }
};
void expect(bool value, const char* name) { if (!value) throw std::runtime_error(name); }
int wmain() {
  try {
    Handler handler;
    expect(handler.restartComponent(kParamValuesChanged) == kResultOk, "supported restart rejected");
    const auto before = handler.restart;
    expect(handler.restartComponent(kReloadComponent | kIoChanged) == kNotImplemented, "unsupported full reload accepted");
    expect(handler.restart == before, "rejected reload queued flags");
    auto view = owned(new ConstrainedView);
    EditorWindow context{}; context.view = view; context.size = view->current;
    WNDCLASS cls{}; cls.lpfnWndProc = windowProc; cls.hInstance = GetModuleHandle(nullptr);
    cls.lpszClassName = L"SessionCompanionRegression"; RegisterClass(&cls);
    const DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_THICKFRAME;
    HWND window = CreateWindowEx(0, cls.lpszClassName, L"Hidden SESSION test", style, 0, 0, 440, 300,
      nullptr, nullptr, cls.hInstance, &context);
    expect(window != nullptr, "hidden test window failed");
    view->notifications = 0;
    SendMessage(window, WM_SIZE, SIZE_MINIMIZED, 0);
    SendMessage(window, WM_SIZE, SIZE_RESTORED, MAKELPARAM(0, 40));
    expect(view->notifications == 0, "minimized/zero editor was resized");
    RECT decorations{0, 0, 0, 40}; AdjustWindowRect(&decorations, style, FALSE);
    const auto extraWidth = decorations.right - decorations.left, extraHeight = decorations.bottom - decorations.top;
    RECT proposed{100, 100, 100 + 120 + extraWidth, 100 + 100 + extraHeight};
    expect(SendMessage(window, WM_SIZING, WMSZ_BOTTOMRIGHT, reinterpret_cast<LPARAM>(&proposed)) != 0, "user resize not constrained");
    expect(view->constraints > 0, "view constraints were not consulted");
    expect(proposed.right - proposed.left - extraWidth == 320 && proposed.bottom - proposed.top - extraHeight == 160,
      "minimum/aspect editor size not respected");
    expect(proposed.left == 100 && proposed.top == 100, "right/bottom resize moved fixed edges");
    RECT fromLeft{100, 100, 100 + 120 + extraWidth, 100 + 100 + extraHeight};
    const auto right = fromLeft.right, bottom = fromLeft.bottom;
    SendMessage(window, WM_SIZING, WMSZ_TOPLEFT, reinterpret_cast<LPARAM>(&fromLeft));
    expect(fromLeft.right == right && fromLeft.bottom == bottom, "top/left resize moved fixed edges");
    Frame frame; frame.window = window; frame.view = view; frame.context = &context;
    view->notifications = 0;
    ViewRect requested(0, 0, 640, 320);
    expect(frame.resizeView(view, &requested) == kResultOk, "plugin resize failed");
    expect(view->notifications == 1, "plugin resize recursively notified the view");
    RECT client{}; GetClientRect(window, &client);
    expect(client.right == 640 && client.bottom == 360, "plugin frame/footer size differs from view");
    expect(context.size.getWidth() == 640 && context.size.getHeight() == 320, "plugin size was not retained");
    ViewRect invalid(0, 0, 9000, 320);
    expect(frame.resizeView(view, &invalid) == kInvalidArgument, "oversized plugin resize accepted");
    expect(view->notifications == 1, "invalid plugin resize changed view");
    context.resizing = true;
    expect(frame.resizeView(view, &requested) == kResultFalse, "recursive plugin resize accepted");
    context.resizing = false;
    DestroyWindow(window);
    std::cout << "{\"ok\":true,\"checks\":6}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n'; return 1;
  }
}
