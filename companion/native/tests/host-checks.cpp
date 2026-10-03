// Exercise the actual host callbacks with a constrained view and hidden Win32
// window. This executable and its test view are not shipped in the companion.
#define wmain session_companion_cli_main
#include "../host.cpp"
#undef wmain

class ConstrainedView final : public U::Implements<U::Directly<IPlugView>> {
public:
  ViewRect current{0, 0, 400, 200}; int notifications = 0, constraints = 0;
  IPlugFrame* frame = nullptr; bool acknowledgeResize = false;
  tresult lastCallback = kNotImplemented, repeatedCallback = kNotImplemented, additionalCallback = kNotImplemented;
  int callbackHeightDelta = 0; bool zoomAspect = false, tryAdditionalCorrection = false, unchangedZoomSkipsCallback = false;
  tresult PLUGIN_API isPlatformTypeSupported(FIDString) override { return kResultOk; }
  tresult PLUGIN_API attached(void*, FIDString) override { return kResultOk; }
  tresult PLUGIN_API removed() override { return kResultOk; }
  tresult PLUGIN_API onWheel(float) override { return kResultFalse; }
  tresult PLUGIN_API onKeyDown(char16, int16, int16) override { return kResultFalse; }
  tresult PLUGIN_API onKeyUp(char16, int16, int16) override { return kResultFalse; }
  tresult PLUGIN_API getSize(ViewRect* size) override { if (!size) return kInvalidArgument; *size = current; return kResultOk; }
  tresult PLUGIN_API onSize(ViewRect* size) override {
    if (!size || size->getWidth() <= 0 || size->getHeight() <= 0) return kInvalidArgument;
    ++notifications;
    if (unchangedZoomSkipsCallback && size->getWidth() == current.getWidth()) return kResultOk;
    auto accepted = *size;
    if (acknowledgeResize && frame) {
      accepted.bottom += callbackHeightDelta;
      lastCallback = frame->resizeView(this, &accepted);
      if (lastCallback != kResultOk) return lastCallback;
      repeatedCallback = frame->resizeView(this, &accepted);
      if (tryAdditionalCorrection) {
        auto additional = accepted; --additional.bottom;
        additionalCallback = frame->resizeView(this, &additional);
      }
    }
    current = accepted; return kResultOk;
  }
  tresult PLUGIN_API onFocus(TBool) override { return kResultOk; }
  tresult PLUGIN_API setFrame(IPlugFrame* value) override { frame = value; return kResultOk; }
  tresult PLUGIN_API canResize() override { return kResultOk; }
  tresult PLUGIN_API checkSizeConstraint(ViewRect* size) override {
    if (!size) return kInvalidArgument;
    ++constraints;
    size->right = size->left + std::clamp(size->getWidth(), 320, 1000);
    size->bottom = size->top + (zoomAspect ? static_cast<int>(198.0 * (size->getWidth() / 330.0)) : size->getWidth() / 2);
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
    view->setFrame(&frame); view->acknowledgeResize = true;
    view->notifications = 0;
    ViewRect requested(0, 0, 640, 320);
    expect(frame.resizeView(view, &requested) == kResultOk, "plugin resize failed");
    expect(view->notifications == 1, "plugin resize recursively notified the view");
    expect(view->lastCallback == kResultOk, "legitimate plugin resize acknowledgement rejected");
    RECT client{}; GetClientRect(window, &client);
    expect(client.right == 640 && client.bottom == 360, "plugin frame/footer size differs from view");
    expect(context.size.getWidth() == 640 && context.size.getHeight() == 320, "plugin size was not retained");
    view->notifications = 0; view->lastCallback = kNotImplemented;
    expect(SetWindowPos(window, nullptr, 0, 0, 800 + extraWidth, 400 + extraHeight, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE) != 0, "user resize failed");
    expect(view->notifications == 1 && view->lastCallback == kResultOk, "user resize acknowledgement rejected or repeated");
    expect(view->current.getWidth() == 800 && context.size.getWidth() == 800, "user resize left stale view geometry");
    ViewRect invalid(0, 0, 9000, 320);
    expect(frame.resizeView(view, &invalid) == kInvalidArgument, "oversized plugin resize accepted");
    expect(view->notifications == 1, "invalid plugin resize changed view");
    context.resizing = true;
    context.resizeTarget = requested;
    expect(frame.resizeView(view, &requested) == kResultOk, "matching nested resize rejected");
    ViewRect other(0, 0, 960, 480);
    expect(frame.resizeView(view, &other) == kResultFalse, "different recursive resize accepted");
    context.resizing = false;
    context.resizeTarget.reset();
    // Same two zoom steps as the pinned SDK: its reconstructed height can lose
    // one pixel after floor(), even though the constraint calculation returns 201.
    volatile double firstScale = 428.0 / 330.0;
    volatile double firstHeight = 198.0 * firstScale;
    volatile double reconstructedHeight = firstHeight / firstScale;
    volatile double nextScale = 335.0 / 330.0;
    const auto constrainedHeight = static_cast<int>(198.0 * nextScale);
    const auto callbackHeight = static_cast<int>(std::floor(reconstructedHeight * nextScale));
    expect(constrainedHeight == 201 && callbackHeight == 200, "SDK rounding fixture differs");
    ViewRect firstZoom(0, 0, 428, static_cast<int>(firstHeight));
    expect(frame.resizeView(view, &firstZoom) == kResultOk, "first zoom failed");
    view->zoomAspect = true; view->callbackHeightDelta = callbackHeight - constrainedHeight;
    view->tryAdditionalCorrection = true; view->notifications = 0;
    expect(SetWindowPos(window, nullptr, 0, 0, 335 + extraWidth, constrainedHeight + extraHeight, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE) != 0, "rounded user zoom failed");
    GetClientRect(window, &client);
    expect(view->notifications == 1 && view->lastCallback == kResultOk && view->repeatedCallback == kResultOk, "rounded/repeated resize acknowledgement rejected");
    expect(view->additionalCallback == kResultFalse, "more than one resize correction accepted");
    expect(view->current.getHeight() == 200 && context.size.getHeight() == 200 && client.bottom == 240, "rounded view/window/footer geometry disagrees");
    view->unchangedZoomSkipsCallback = true;
    const auto notificationsBeforeRestore = view->notifications;
    SendMessage(window, WM_SIZE, SIZE_MINIMIZED, 0);
    SendMessage(window, WM_SIZE, SIZE_RESTORED, MAKELPARAM(335, 240));
    GetClientRect(window, &client);
    expect(view->notifications == notificationsBeforeRestore && context.size.getHeight() == 200 && client.bottom == 240,
      "restore undid the accepted zoom correction");
    RECT verticalDrag{100, 100, 100 + 335 + extraWidth, 100 + 400 + extraHeight};
    SendMessage(window, WM_SIZING, WMSZ_BOTTOM, reinterpret_cast<LPARAM>(&verticalDrag));
    expect(verticalDrag.bottom - verticalDrag.top - extraHeight == 200, "vertical drag undid accepted zoom correction");
    for (int attempt = 0; attempt < 2; ++attempt) {
      SetWindowPos(window, nullptr, 0, 0, 335 + extraWidth, 400 + extraHeight, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
      GetClientRect(window, &client);
      expect(view->notifications == notificationsBeforeRestore && context.size.getHeight() == 200 && client.bottom == 240,
        "same-factor resize lost its remembered correction");
    }
    view->unchangedZoomSkipsCallback = false;
    view->callbackHeightDelta = -2; view->tryAdditionalCorrection = false;
    ViewRect refused(0, 0, 500, 300);
    expect(frame.resizeView(view, &refused) == kResultFalse, "unbounded resize correction accepted");
    GetClientRect(window, &client);
    expect(client.right == 335 && client.bottom == 240 && context.size.getHeight() == 200, "refused resize changed the committed geometry");
    view->setFrame(nullptr);
    DestroyWindow(window);
    std::cout << "{\"ok\":true,\"checks\":11}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n'; return 1;
  }
}
