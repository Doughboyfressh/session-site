// SESSION's Windows companion. Plug-ins are loaded only in this disposable process.
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <ksmedia.h>
#include <wrl/client.h>
#include <nlohmann/json.hpp>
#include "pluginterfaces/base/funknownimpl.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vstspeaker.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;
using Json = nlohmann::json;
namespace fs = std::filesystem;
using Microsoft::WRL::ComPtr;
constexpr size_t maxState = 8 * 1024 * 1024;
constexpr int blockSize = 512;
class HostError final : public std::runtime_error { public: explicit HostError(const char* message) : std::runtime_error(message) {} };
void require(bool condition, const char* message) { if (!condition) throw HostError(message); }
void check(tresult result, const char* message) { require(result == kResultOk, message); }
std::string lower(std::string value) { for (auto& c : value) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c))); return value; }
std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  auto size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  require(size > 0, "Invalid path encoding");
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}
fs::path absolutePath(const std::string& text, const char* message) {
  require(!text.empty() && text.size() < 32768 && text.find('\0') == std::string::npos, message);
  auto result = fs::u8path(text);
  require(result.is_absolute() && result.has_root_name() && result.root_name().wstring().size() == 2, message);
  // Reject device paths, alternate data streams and directory traversal spelling.
  require(text.find(':', 2) == std::string::npos, message);
  for (const auto& part : result) require(part != L"..", message);
  return result.lexically_normal();
}
std::string stringField(const Json& request, const char* name) {
  require(request.contains(name) && request[name].is_string(), "Missing or invalid string field");
  return request[name].get<std::string>();
}
double number(const Json& request, const char* name, double minimum, double maximum) {
  require(request.contains(name) && request[name].is_number(), "Missing or invalid numeric field");
  auto value = request[name].get<double>();
  require(std::isfinite(value) && value >= minimum && value <= maximum, "Numeric field outside supported bounds");
  return value;
}
void fields(const Json& value, std::initializer_list<const char*> names) {
  require(value.is_object(), "Request must be an object");
  for (auto it = value.begin(); it != value.end(); ++it) {
    require(std::find_if(names.begin(), names.end(), [&](const char* name) { return it.key() == name; }) != names.end(), "Unexpected request field");
  }
}
std::string encode(const std::vector<uint8_t>& data) {
  constexpr char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string result;
  result.reserve((data.size() + 2) / 3 * 4);
  for (size_t i = 0; i < data.size(); i += 3) {
    auto value = static_cast<uint32_t>(data[i]) << 16;
    if (i + 1 < data.size()) value |= static_cast<uint32_t>(data[i + 1]) << 8;
    if (i + 2 < data.size()) value |= data[i + 2];
    result += table[(value >> 18) & 63]; result += table[(value >> 12) & 63];
    result += i + 1 < data.size() ? table[(value >> 6) & 63] : '=';
    result += i + 2 < data.size() ? table[value & 63] : '=';
  }
  return result;
}
std::vector<uint8_t> decode(const std::string& text) {
  require(text.size() <= (maxState + 2) / 3 * 4 && text.size() % 4 == 0, "Invalid or oversized plug-in state");
  const std::string table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::vector<uint8_t> result;
  result.reserve(text.size() / 4 * 3);
  for (size_t i = 0; i < text.size(); i += 4) {
    uint32_t value = 0; int padding = 0;
    for (int j = 0; j < 4; ++j) {
      const auto c = text[i + j];
      if (c == '=') { require(i + 4 == text.size() && j >= 2, "Invalid plug-in state encoding"); ++padding; value <<= 6; }
      else { auto index = table.find(c); require(!padding && index != std::string::npos, "Invalid plug-in state encoding"); value = (value << 6) | static_cast<uint32_t>(index); }
    }
    require(padding <= 2 && (!padding || (value & (padding == 2 ? 0xffff : 0xff)) == 0), "Noncanonical plug-in state encoding");
    result.push_back(static_cast<uint8_t>(value >> 16));
    if (padding < 2) result.push_back(static_cast<uint8_t>(value >> 8));
    if (padding < 1) result.push_back(static_cast<uint8_t>(value));
  }
  require(result.size() <= maxState, "Plug-in state too large");
  return result;
}
class StateStream final : public U::Implements<U::Directly<IBStream>> {
public:
  std::vector<uint8_t> bytes; size_t cursor = 0; bool exceeded = false;
  StateStream() = default;
  explicit StateStream(std::vector<uint8_t> data) : bytes(std::move(data)) {}
  tresult PLUGIN_API read(void* target, int32 length, int32* count) override {
    if (count) *count = 0;
    if (length < 0 || (!target && length)) return kInvalidArgument;
    auto available = cursor <= bytes.size() ? bytes.size() - cursor : 0;
    auto size = std::min(static_cast<size_t>(length), available);
    if (size) memcpy(target, bytes.data() + cursor, size);
    cursor += size; if (count) *count = static_cast<int32>(size);
    return size == static_cast<size_t>(length) ? kResultOk : kResultFalse;
  }
  tresult PLUGIN_API write(void* source, int32 length, int32* count) override {
    if (count) *count = 0;
    if (length < 0 || (!source && length)) return kInvalidArgument;
    if (cursor > maxState || static_cast<size_t>(length) > maxState - cursor) { exceeded = true; return kOutOfMemory; }
    bytes.resize(std::max(bytes.size(), cursor + static_cast<size_t>(length)));
    if (length) memcpy(bytes.data() + cursor, source, length);
    cursor += length; if (count) *count = length; return kResultOk;
  }
  tresult PLUGIN_API seek(int64 offset, int32 mode, int64* position) override {
    int64 base = mode == kIBSeekSet ? 0 : mode == kIBSeekCur ? static_cast<int64>(cursor) : mode == kIBSeekEnd ? static_cast<int64>(bytes.size()) : -1;
    if (base < 0 || offset < -base || offset > static_cast<int64>(maxState) - base) return kInvalidArgument;
    cursor = static_cast<size_t>(base + offset); if (position) *position = cursor; return kResultOk;
  }
  tresult PLUGIN_API tell(int64* position) override { if (!position) return kInvalidArgument; *position = cursor; return kResultOk; }
};
struct State { bool supplied = false; std::vector<uint8_t> component, controller; };
State stateInput(const Json& request) {
  State result;
  if (!request.contains("state")) return result;
  const auto& value = request["state"]; fields(value, {"component", "controller"});
  result.supplied = true;
  result.component = decode(stringField(value, "component"));
  result.controller = decode(stringField(value, "controller"));
  require(result.component.size() + result.controller.size() <= maxState, "Combined plug-in state too large");
  return result;
}
class Handler final : public U::Implements<U::Directly<IComponentHandler, IComponentHandler2>> {
public:
  std::map<ParamID, ParamValue> pending; int32 restart = 0;
  tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API performEdit(ParamID id, ParamValue value) override {
    if (!std::isfinite(value) || value < 0 || value > 1 || pending.size() > 65536) return kInvalidArgument;
    pending[id] = value; return kResultOk;
  }
  tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
  tresult PLUGIN_API restartComponent(int32 flags) override { restart |= flags; return kResultOk; }
  tresult PLUGIN_API setDirty(TBool) override { return kResultOk; }
  tresult PLUGIN_API requestOpenEditor(FIDString) override { return kResultFalse; }
  tresult PLUGIN_API startGroupEdit() override { return kResultOk; }
  tresult PLUGIN_API finishGroupEdit() override { return kResultOk; }
};
bool instrument(const VST3::Hosting::ClassInfo& info) {
  return info.category() == kVstAudioEffectClass && std::find(info.subCategories().begin(), info.subCategories().end(), "Instrument") != info.subCategories().end();
}
class Plugin {
  // Member order ensures the module remains loaded until all plug-in interfaces are released.
  HostApplication application;
  VST3::Hosting::Module::Ptr module;
  IPtr<Handler> handler;
  std::unique_ptr<PlugProvider> provider;
  bool active = false, processing = false;
public:
  IPtr<IComponent> component; IPtr<IEditController> controller; IPtr<IAudioProcessor> processor;
  HostProcessData data; ProcessContext context{}; EventList events{1024}; EventList outputEvents{1024};
  ParameterChanges parameters{64}, outputParameters{64};
  int sampleRate = 48000; int mode = kOffline; double bpm = 120; int64 position = 0;
  std::string name;
  Plugin(const fs::path& path, const std::string& classId, const State& state) {
    require(classId.size() == 32 && std::all_of(classId.begin(), classId.end(), [](unsigned char c) { return std::isxdigit(c); }), "Invalid plug-in class ID");
    std::string error; module = VST3::Hosting::Module::create(path.u8string(), error);
    require(module != nullptr, "Could not load VST3 module");
    auto& factory = module->getFactory(); factory.setHostContext(&application);
    auto infos = factory.classInfos();
    auto selected = std::find_if(infos.begin(), infos.end(), [&](const auto& info) { return lower(info.ID().toString()) == lower(classId) && instrument(info); });
    require(selected != infos.end(), "Instrument class not found in selected module");
    name = selected->name();
    PluginContextFactory::instance().setPluginContext(&application);
    PlugProvider::setErrorStream(nullptr);
    provider = std::make_unique<PlugProvider>(factory, *selected, true);
    require(provider->initialize(), "Could not initialize VST3 instrument");
    component = provider->getComponentPtr(); controller = provider->getControllerPtr(); processor = U::cast<IAudioProcessor>(component);
    require(component && processor, "Plug-in has no audio processor");
    handler = owned(new Handler);
    if (controller) {
      check(controller->setComponentHandler(handler), "Plug-in refused editor handler");
      auto count = controller->getParameterCount(); require(count >= 0 && count <= 65536, "Unsupported parameter count"); parameters.setMaxParameters(count); outputParameters.setMaxParameters(count);
    }
    restore(state);
  }
  ~Plugin() {
    stop(); data.unprepare();
    if (controller) controller->setComponentHandler(nullptr);
    processor.reset(); controller.reset(); component.reset(); provider.reset(); handler.reset();
    PluginContextFactory::instance().setPluginContext(nullptr);
  }
  void restore(const State& state) {
    if (state.supplied && !state.component.empty()) {
      auto stream = owned(new StateStream(state.component));
      check(component->setState(stream), "Plug-in rejected component state");
    }
    if (controller) {
      auto stream = owned(new StateStream);
      if (state.supplied) stream->bytes = state.component;
      else { const auto result = component->getState(stream); require(result == kResultOk || result == kNotImplemented, "Could not read initial component state"); }
      stream->cursor = 0;
      if (!stream->bytes.empty()) { const auto result = controller->setComponentState(stream); require(result == kResultOk || result == kNotImplemented, "Controller rejected component state"); }
      if (state.supplied && !state.controller.empty()) {
        auto control = owned(new StateStream(state.controller));
        check(controller->setState(control), "Plug-in rejected controller state");
      }
    }
    handler->pending.clear(); handler->restart = 0;
  }
  Json save() {
    auto part = owned(new StateStream); auto ui = owned(new StateStream);
    auto result = component->getState(part);
    require(result == kResultOk || result == kNotImplemented, "Could not save component state");
    if (controller) { result = controller->getState(ui); require(result == kResultOk || result == kNotImplemented, "Could not save controller state"); }
    require(!part->exceeded && !ui->exceeded && part->bytes.size() + ui->bytes.size() <= maxState, "Saved plug-in state exceeds limit");
    return {{"component", encode(part->bytes)}, {"controller", encode(ui->bytes)}};
  }
  void stop() noexcept {
    if (processing && processor) processor->setProcessing(false);
    if (active && component) component->setActive(false);
    processing = active = false;
  }
  void start(int rate, double tempo, int processMode) {
    stop(); sampleRate = rate; bpm = tempo; mode = processMode;
    check(processor->canProcessSampleSize(kSample32), "Plug-in does not support float32 audio");
    const auto inputCount = component->getBusCount(kAudio, kInput), outputCount = component->getBusCount(kAudio, kOutput);
    require(inputCount >= 0 && inputCount <= 32 && outputCount > 0 && outputCount <= 32, "Unsupported plug-in bus count");
    std::vector<SpeakerArrangement> inputs(inputCount), outputs(outputCount);
    for (int i = 0; i < inputCount; ++i) check(processor->getBusArrangement(kInput, i, inputs[i]), "Could not query audio input layout");
    for (int i = 0; i < outputCount; ++i) check(processor->getBusArrangement(kOutput, i, outputs[i]), "Could not query audio output layout");
    outputs[0] = SpeakerArr::kStereo;
    // A mono instrument may reject stereo; retain its declared layout in that case.
    processor->setBusArrangements(inputs.data(), inputCount, outputs.data(), outputCount);
    for (const auto direction : {kInput, kOutput}) {
      for (int i = 0; i < component->getBusCount(kAudio, direction); ++i) {
        BusInfo info{}; check(component->getBusInfo(kAudio, direction, i, info), "Could not query audio bus");
        require(info.channelCount >= 0 && info.channelCount <= 64, "Unsupported audio channel count");
        component->activateBus(kAudio, direction, i, direction == kOutput && i == 0);
      }
      const auto count = component->getBusCount(kEvent, direction);
      require(count >= 0 && count <= 32, "Unsupported event bus count");
      for (int i = 0; i < count; ++i) component->activateBus(kEvent, direction, i, direction == kInput && i == 0);
    }
    require(component->getBusCount(kEvent, kInput) > 0, "Instrument has no note input");
    ProcessSetup setup{processMode, kSample32, blockSize, static_cast<double>(rate)};
    check(processor->setupProcessing(setup), "Plug-in refused audio setup");
    require(data.prepare(*component, blockSize, kSample32), "Could not allocate plug-in audio buffers");
    require(data.numOutputs > 0 && data.outputs[0].numChannels > 0, "Instrument has no audio output");
    data.processMode = processMode; data.processContext = &context; data.inputEvents = &events; data.outputEvents = &outputEvents;
    data.inputParameterChanges = &parameters; data.outputParameterChanges = &outputParameters;
    check(component->setActive(true), "Could not activate instrument"); active = true;
    const auto result = processor->setProcessing(true); require(result == kResultOk || result == kNotImplemented, "Could not start instrument processor"); processing = true;
  }
  void addNote(bool on, int pitch, float velocity, int id, int offset, double beat) {
    Event event{}; event.busIndex = 0; event.sampleOffset = offset; event.ppqPosition = beat; event.flags = Event::kIsLive;
    event.type = on ? Event::kNoteOnEvent : Event::kNoteOffEvent;
    if (on) { event.noteOn.channel = 0; event.noteOn.pitch = static_cast<int16>(pitch); event.noteOn.velocity = velocity; event.noteOn.noteId = id; }
    else { event.noteOff.channel = 0; event.noteOff.pitch = static_cast<int16>(pitch); event.noteOff.velocity = 0; event.noteOff.noteId = id; }
    check(events.addEvent(event), "Too many simultaneous note events");
  }
  void queueParameterEdit(ParamID id, ParamValue value) { check(handler->performEdit(id, value), "Editor parameter edit was rejected"); }
  void process(int frames, std::vector<float>& stereo) {
    if (handler->restart) {
      auto flags = handler->restart; handler->restart = 0;
      if (controller && (flags & kParamValuesChanged)) {
        const auto count = controller->getParameterCount(); require(count >= 0 && count <= 65536, "Unsupported parameter count");
        for (int i = 0; i < count; ++i) { ParameterInfo info{}; if (controller->getParameterInfo(i, info) == kResultOk && !(info.flags & ParameterInfo::kIsReadOnly)) handler->pending[info.id] = controller->getParamNormalized(info.id); }
      }
      if (flags & (kIoChanged | kReloadComponent | kLatencyChanged)) start(sampleRate, bpm, mode);
    }
    parameters.clearQueue(); outputParameters.clearQueue(); outputEvents.clear();
    for (const auto& [id, value] : handler->pending) { int32 queueIndex = 0, pointIndex = 0; if (auto queue = parameters.addParameterData(id, queueIndex)) queue->addPoint(0, value, pointIndex); }
    handler->pending.clear();
    data.numSamples = frames;
    for (int i = 0; i < data.numInputs; ++i) { data.inputs[i].silenceFlags = HostProcessData::kAllChannelsSilent; for (int c = 0; c < data.inputs[i].numChannels; ++c) std::fill_n(data.inputs[i].channelBuffers32[c], frames, 0.f); }
    for (int i = 0; i < data.numOutputs; ++i) { data.outputs[i].silenceFlags = 0; for (int c = 0; c < data.outputs[i].numChannels; ++c) std::fill_n(data.outputs[i].channelBuffers32[c], frames, 0.f); }
    context.state = ProcessContext::kTempoValid | ProcessContext::kTimeSigValid | ProcessContext::kProjectTimeMusicValid | ProcessContext::kBarPositionValid | ProcessContext::kContTimeValid | ProcessContext::kPlaying;
    context.sampleRate = sampleRate; context.tempo = bpm; context.timeSigNumerator = 4; context.timeSigDenominator = 4;
    context.projectTimeSamples = position; context.continousTimeSamples = position;
    context.projectTimeMusic = position * bpm / (60.0 * sampleRate); context.barPositionMusic = std::floor(context.projectTimeMusic / 4) * 4;
    check(processor->process(data), "Instrument audio processing failed");
    stereo.resize(static_cast<size_t>(frames) * 2);
    for (int i = 0; i < frames; ++i) for (int c = 0; c < 2; ++c) {
      const auto source = std::min(c, data.outputs[0].numChannels - 1);
      auto value = data.outputs[0].silenceFlags & (uint64(1) << source) ? 0.f : data.outputs[0].channelBuffers32[source][i];
      require(std::isfinite(value), "Plug-in produced nonfinite audio; adjust its settings in the plug-in editor");
      require(std::abs(value) <= 1.f, "Plug-in output exceeds full scale; lower its output level in the plug-in editor");
      stereo[i * 2 + c] = value;
    }
    if (controller) for (int i = 0; i < outputParameters.getParameterCount(); ++i) {
      auto queue = outputParameters.getParameterData(i); int32 offset; ParamValue value;
      if (queue && queue->getPointCount() && queue->getPoint(queue->getPointCount() - 1, offset, value) == kResultOk) controller->setParamNormalized(queue->getParameterId(), value);
    }
    position += frames; events.clear();
  }
};

struct ScheduledNote { int64 sample; int pitch, id; bool on; float velocity; double beat; };
class Wav {
  std::ofstream stream;
public:
  Wav(const fs::path& path, int rate, uint32_t frames) : stream(path, std::ios::binary | std::ios::trunc) {
    require(stream.good(), "Could not create audio output");
    auto u16 = [&](uint16_t x) { stream.put(static_cast<char>(x & 255)); stream.put(static_cast<char>(x >> 8)); };
    auto u32 = [&](uint32_t x) { u16(static_cast<uint16_t>(x)); u16(static_cast<uint16_t>(x >> 16)); };
    stream.write("RIFF", 4); u32(36 + frames * 4); stream.write("WAVEfmt ", 8); u32(16); u16(1); u16(2); u32(rate); u32(rate * 4); u16(4); u16(16); stream.write("data", 4); u32(frames * 4);
  }
  void write(const std::vector<float>& values) {
    std::vector<int16_t> pcm(values.size());
    for (size_t i = 0; i < values.size(); ++i) pcm[i] = static_cast<int16_t>(std::lround(values[i] * 32767.f));
    stream.write(reinterpret_cast<const char*>(pcm.data()), static_cast<std::streamsize>(pcm.size() * 2));
    require(stream.good(), "Could not write audio output");
  }
  void finish() { stream.flush(); require(stream.good(), "Could not finalize audio output"); }
};
Json render(const Json& request, const fs::path& response) {
  fields(request, {"modulePath", "classId", "state", "bpm", "beats", "sampleRate", "notes", "audioPath"});
  auto path = absolutePath(stringField(request, "modulePath"), "Invalid VST3 module path");
  auto audio = absolutePath(stringField(request, "audioPath"), "Invalid audio output path");
  require(lower(audio.extension().u8string()) == ".wav" && fs::equivalent(audio.parent_path(), response.parent_path()), "Audio output must be a WAV in the private request directory");
  require(!fs::exists(audio), "Audio output must be a new file");
  auto bpm = number(request, "bpm", 40, 240), beats = number(request, "beats", 0.000001, 512);
  auto sampleRate = number(request, "sampleRate", 44100, 48000); require(sampleRate == 44100 || sampleRate == 48000, "Unsupported sample rate");
  const auto duration = beats * 60 / bpm + 0.5; require(duration <= 300, "Render exceeds 300 seconds");
  require(request.contains("notes") && request["notes"].is_array() && request["notes"].size() <= 256, "Invalid note list");
  std::vector<ScheduledNote> notes;
  int id = 0;
  for (const auto& note : request["notes"]) {
    fields(note, {"pitch", "start", "length", "velocity"});
    auto pitch = number(note, "pitch", 0, 127), start = number(note, "start", 0, beats), length = number(note, "length", 0.000001, beats), velocity = number(note, "velocity", 0, 1);
    require(pitch == std::floor(pitch) && start + length <= beats + 1e-9, "Invalid note timing or pitch");
    auto from = static_cast<int64>(std::llround(start * 60 * sampleRate / bpm)), to = static_cast<int64>(std::llround((start + length) * 60 * sampleRate / bpm));
    require(to > from, "Note shorter than one sample");
    notes.push_back({from, static_cast<int>(pitch), id, true, static_cast<float>(velocity), start});
    notes.push_back({to, static_cast<int>(pitch), id++, false, 0.f, start + length});
  }
  std::sort(notes.begin(), notes.end(), [](const auto& a, const auto& b) { return a.sample < b.sample || (a.sample == b.sample && a.on < b.on); });
  Plugin plugin(path, stringField(request, "classId"), stateInput(request)); plugin.start(static_cast<int>(sampleRate), bpm, kOffline);
  const auto total = static_cast<uint32_t>(std::llround(duration * sampleRate));
  Wav wav(audio, static_cast<int>(sampleRate), total); size_t next = 0; std::vector<float> samples;
  for (int64 offset = 0; offset < total; offset += blockSize) {
    auto frames = static_cast<int>(std::min<int64>(blockSize, total - offset));
    while (next < notes.size() && notes[next].sample < offset + frames) { const auto& event = notes[next++]; plugin.addNote(event.on, event.pitch, event.velocity, event.id, static_cast<int>(event.sample - offset), event.beat); }
    plugin.process(frames, samples); wav.write(samples);
  }
  wav.finish(); return {{"ok", true}};
}

// WASAPI shared-mode float stereo output with Windows' automatic sample-rate conversion.
// Processing and editor callbacks share the UI thread; no plug-in object crosses apartments.
class Monitor {
  ComPtr<IMMDeviceEnumerator> enumerator; ComPtr<IMMDevice> device; ComPtr<IAudioClient> client; ComPtr<IAudioRenderClient> renderer; UINT32 capacity = 0;
public:
  bool open() {
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)))) return false;
    if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &device))) return false;
    if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(client.GetAddressOf())))) return false;
    WAVEFORMATEX format{}; format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT; format.nChannels = 2; format.nSamplesPerSec = 48000; format.wBitsPerSample = 32; format.nBlockAlign = 8; format.nAvgBytesPerSec = 384000;
    if (FAILED(client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, 1000000, 0, &format, nullptr))) return false;
    if (FAILED(client->GetBufferSize(&capacity)) || FAILED(client->GetService(IID_PPV_ARGS(&renderer))) || FAILED(client->Start())) return false;
    return true;
  }
  ~Monitor() { if (client) client->Stop(); }
  void pump(Plugin& plugin) {
    UINT32 used = 0; require(SUCCEEDED(client->GetCurrentPadding(&used)) && used <= capacity, "Audio monitor device was disconnected");
    auto available = capacity - used;
    std::vector<float> samples;
    while (available) {
      auto frames = std::min<UINT32>(available, blockSize);
      BYTE* target = nullptr; require(SUCCEEDED(renderer->GetBuffer(frames, &target)), "Audio monitor buffer unavailable");
      try { plugin.process(static_cast<int>(frames), samples); memcpy(target, samples.data(), frames * 8); }
      catch (...) { renderer->ReleaseBuffer(frames, AUDCLNT_BUFFERFLAGS_SILENT); throw; }
      require(SUCCEEDED(renderer->ReleaseBuffer(frames, 0)), "Audio monitor failed"); available -= frames;
    }
  }
};
class Frame final : public U::Implements<U::Directly<IPlugFrame>> {
public:
  HWND window = nullptr; IPlugView* view = nullptr;
  tresult PLUGIN_API resizeView(IPlugView* source, ViewRect* size) override {
    if (!window || source != view || !size || size->getWidth() <= 0 || size->getHeight() <= 0 || size->getWidth() > 8192 || size->getHeight() > 8192) return kInvalidArgument;
    RECT bounds{0, 0, size->getWidth(), size->getHeight() + 40}; AdjustWindowRect(&bounds, static_cast<DWORD>(GetWindowLongPtr(window, GWL_STYLE)), FALSE);
    SetWindowPos(window, nullptr, 0, 0, bounds.right - bounds.left, bounds.bottom - bounds.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    return view->onSize(size);
  }
};
struct EditorWindow { IPlugView* view = nullptr; HWND auditionButton = nullptr; bool closing = false, audition = false; };
LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM w, LPARAM l) {
  auto context = reinterpret_cast<EditorWindow*>(GetWindowLongPtr(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) { context = static_cast<EditorWindow*>(reinterpret_cast<CREATESTRUCT*>(l)->lpCreateParams); SetWindowLongPtr(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(context)); }
  if (context && message == WM_CLOSE) { context->closing = true; return 0; }
  if (context && message == WM_COMMAND && LOWORD(w) == 1 && HIWORD(w) == BN_CLICKED) {
    context->audition = !context->audition; SetWindowText(context->auditionButton, context->audition ? L"Stop A4 — keyboard: Z S X D C V G B H N J M" : L"Play A4 — keyboard: Z S X D C V G B H N J M"); return 0;
  }
  if (context && context->view && message == WM_SIZE) {
    const auto height = std::max(1, static_cast<int>(HIWORD(l)) - 40);
    ViewRect size(0, 0, LOWORD(l), height); context->view->onSize(&size);
    if (context->auditionButton) MoveWindow(context->auditionButton, 8, height + 5, std::max(1, static_cast<int>(LOWORD(l)) - 16), 30, TRUE);
  }
  return DefWindowProc(window, message, w, l);
}
Json editor(const Json& request, bool selfCheck = false) {
  fields(request, {"modulePath", "classId", "state", "bpm"});
  auto path = absolutePath(stringField(request, "modulePath"), "Invalid VST3 module path"); auto bpm = number(request, "bpm", 40, 240);
  if (selfCheck) require(lower(stringField(request, "classId")) == "41466d9bb0654576b641098f686371b3", "Editor self-check requires the official SDK fixture");
  Plugin plugin(path, stringField(request, "classId"), stateInput(request)); require(plugin.controller != nullptr, "Instrument has no edit controller");
  auto view = owned(plugin.controller->createView(ViewType::kEditor)); require(view && view->isPlatformTypeSupported(kPlatformTypeHWND) == kResultOk, "Instrument has no Windows editor");
  ViewRect size; check(view->getSize(&size), "Could not query editor size"); require(size.getWidth() > 0 && size.getHeight() > 0 && size.getWidth() <= 8192 && size.getHeight() <= 8192, "Invalid editor size");
  WNDCLASS cls{}; cls.lpfnWndProc = windowProc; cls.hInstance = GetModuleHandle(nullptr); cls.lpszClassName = L"SessionCompanionEditor"; cls.hCursor = LoadCursor(nullptr, IDC_ARROW); RegisterClass(&cls);
  EditorWindow context{}; auto frame = owned(new Frame);
  DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN;
  if (view->canResize() == kResultOk) style |= WS_THICKFRAME;
  RECT bounds{0, 0, size.getWidth(), size.getHeight() + 40}; AdjustWindowRect(&bounds, style, FALSE);
  auto title = fs::u8path("SESSION — " + plugin.name + " — audition: Z S X D C V G B H N J M").wstring();
  frame->window = CreateWindowEx(0, cls.lpszClassName, title.c_str(), style, CW_USEDEFAULT, CW_USEDEFAULT, bounds.right - bounds.left, bounds.bottom - bounds.top, nullptr, nullptr, cls.hInstance, &context);
  require(frame->window != nullptr, "Could not create editor window"); frame->view = view;
  bool attached = false;
  try {
    check(view->setFrame(frame), "Editor refused native frame"); check(view->attached(frame->window, kPlatformTypeHWND), "Could not attach instrument editor"); attached = true; context.view = view;
    context.auditionButton = CreateWindowEx(0, L"BUTTON", L"Play A4 — keyboard: Z S X D C V G B H N J M", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 8, size.getHeight() + 5, std::max(1, size.getWidth() - 16), 30, frame->window, reinterpret_cast<HMENU>(1), cls.hInstance, nullptr);
    require(context.auditionButton != nullptr, "Could not create audition control");
    plugin.start(48000, bpm, kRealtime);
    Monitor monitor; const auto audioAvailable = monitor.open();
    if (!audioAvailable) SetWindowText(context.auditionButton, L"Audio output unavailable — editor settings can still be saved");
    if (!selfCheck) {
      // The first ShowWindow honors STARTUPINFO from windowsHide. The second explicitly
      // displays the editor requested by the user while keeping CLI console windows hidden.
      ShowWindow(frame->window, SW_SHOW); ShowWindow(frame->window, SW_SHOW); UpdateWindow(frame->window);
    } else {
      // Official fixture's master-volume parameter: simulate its normal editor callback.
      check(plugin.controller->setParamNormalized(10, 0.25), "Self-check could not set controller parameter");
      plugin.queueParameterEdit(10, 0.25);
    }
    const auto checkStarted = GetTickCount64();
    const std::array<int, 12> keys{'Z', 'S', 'X', 'D', 'C', 'V', 'G', 'B', 'H', 'N', 'J', 'M'}; std::array<bool, 12> held{}; bool auditionHeld = false;
    while (!context.closing) {
      MSG message; while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) { if (message.message == WM_QUIT) context.closing = true; TranslateMessage(&message); DispatchMessage(&message); }
      if (selfCheck && GetTickCount64() - checkStarted >= 500) context.closing = true;
      const bool focused = GetForegroundWindow() == frame->window;
      if (!focused && context.audition) { context.audition = false; SetWindowText(context.auditionButton, L"Play A4 — keyboard: Z S X D C V G B H N J M"); }
      if (context.audition != auditionHeld) { plugin.addNote(context.audition, 69, 0.8f, 2000, 0, plugin.position * bpm / (60.0 * 48000)); auditionHeld = context.audition; }
      for (size_t i = 0; i < keys.size(); ++i) {
        // Parent-frame focus only: text fields and plug-in controls own their keys.
        const bool down = focused && (GetFocus() == frame->window || GetFocus() == context.auditionButton) && (GetAsyncKeyState(keys[i]) & 0x8000);
        if (down != held[i]) { plugin.addNote(down, 60 + static_cast<int>(i), 0.8f, 1000 + static_cast<int>(i), 0, plugin.position * bpm / (60.0 * 48000)); held[i] = down; }
      }
      if (audioAvailable) monitor.pump(plugin); else { std::vector<float> discarded; plugin.process(480, discarded); }
      MsgWaitForMultipleObjects(0, nullptr, FALSE, audioAvailable ? 5 : 10, QS_ALLINPUT);
    }
    // Apply any final UI parameter edit to the processor before state capture.
    for (size_t i = 0; i < held.size(); ++i) if (held[i]) plugin.addNote(false, 60 + static_cast<int>(i), 0.f, 1000 + static_cast<int>(i), 0, plugin.position * bpm / (60.0 * 48000));
    if (auditionHeld) plugin.addNote(false, 69, 0.f, 2000, 0, plugin.position * bpm / (60.0 * 48000));
    std::vector<float> discarded; plugin.process(1, discarded); plugin.stop();
    context.view = nullptr; view->removed(); attached = false; view->setFrame(nullptr); auto saved = plugin.save();
    DestroyWindow(frame->window); frame->window = nullptr; frame->view = nullptr;
    return {{"state", std::move(saved)}, {"audioAvailable", audioAvailable}};
  } catch (...) {
    plugin.stop(); context.view = nullptr; if (attached) view->removed(); view->setFrame(nullptr); DestroyWindow(frame->window); frame->window = nullptr; frame->view = nullptr; throw;
  }
}
Json scan(const Json& request) {
  fields(request, {"modulePath"}); auto path = absolutePath(stringField(request, "modulePath"), "Invalid VST3 module path");
  std::string error; auto module = VST3::Hosting::Module::create(path.u8string(), error); require(module != nullptr, "Could not load VST3 module");
  auto plugins = Json::array();
  for (const auto& info : module->getFactory().classInfos()) if (instrument(info)) plugins.push_back({{"classId", lower(info.ID().toString())}, {"name", info.name()}, {"vendor", info.vendor()}, {"version", info.version()}});
  return {{"plugins", plugins}};
}
int wmain(int argc, wchar_t** argv) {
  fs::path response;
  try {
    require(argc == 4, "Usage: session-vst3-host <scan|render|editor|state|editor-check> <request.json> <response.json>");
    response = absolutePath(utf8(argv[3]), "Invalid response path");
    require(fs::exists(response.parent_path()) && !fs::exists(response), "Response must be a new file in an existing directory");
    auto requestPath = absolutePath(utf8(argv[2]), "Invalid request path");
    require(fs::equivalent(requestPath.parent_path(), response.parent_path()), "Request and response must share a private directory");
    require(fs::file_size(requestPath) <= 12 * 1024 * 1024, "Request exceeds size limit");
    std::ifstream input(requestPath, std::ios::binary); require(input.good(), "Could not read request");
    Json request; try { request = Json::parse(input); } catch (...) { throw HostError("Invalid request JSON"); }
    auto com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED); require(SUCCEEDED(com), "Could not initialize Windows COM");
    Json result;
    try {
      auto command = utf8(argv[1]);
      if (command == "scan") result = scan(request);
      else if (command == "render") result = render(request, response);
      else if (command == "editor") result = editor(request);
      else if (command == "editor-check") result = editor(request, true);
      else if (command == "state") { fields(request, {"modulePath", "classId", "state"}); Plugin plugin(absolutePath(stringField(request, "modulePath"), "Invalid VST3 module path"), stringField(request, "classId"), stateInput(request)); result = {{"state", plugin.save()}}; }
      else throw HostError("Unknown companion command");
    } catch (...) { CoUninitialize(); throw; }
    CoUninitialize(); std::ofstream output(response, std::ios::binary); require(output.good(), "Could not write response"); output << result.dump(); output.flush(); require(output.good(), "Could not finalize response"); return 0;
  } catch (const HostError& error) {
    // Only host-owned error messages are emitted, never module-loader diagnostics or JSON values.
    if (!response.empty() && !fs::exists(response)) { std::ofstream output(response, std::ios::binary); output << Json({{"ok", false}, {"error", error.what()}}).dump(); }
    std::cerr << "SESSION companion command failed\n"; return 1;
  } catch (...) {
    if (!response.empty() && !fs::exists(response)) { std::ofstream output(response, std::ios::binary); output << "{\"ok\":false,\"error\":\"Native plug-in operation failed\"}"; }
    std::cerr << "SESSION companion command failed\n"; return 1;
  }
}
