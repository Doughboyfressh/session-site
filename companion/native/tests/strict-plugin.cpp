// Test-only instrument. It deliberately rejects premature bus activation and
// can refuse required buses; the portable companion never includes this DLL.
#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "public.sdk/source/main/pluginfactory.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/vstspeaker.h"
#include <algorithm>

using namespace Steinberg;
using namespace Steinberg::Vst;
const FUID processorId(0x827AFD91, 0xD0124F31, 0x9198A5E2, 0xD0E85B21);
const FUID controllerId(0x4055B8A1, 0x8A0346F1, 0xAEF80015, 0xC4C1E30A);
class StrictProcessor final : public AudioEffect {
  bool configured = false, audioEnabled = false, notesEnabled = false, held = false;
  uint8 refusal = 0;
public:
  StrictProcessor() { setControllerClass(controllerId); }
  static FUnknown* create(void*) { return static_cast<IAudioProcessor*>(new StrictProcessor); }
  tresult PLUGIN_API initialize(FUnknown* context) override {
    auto result = AudioEffect::initialize(context);
    if (result != kResultOk) return result;
    addAudioOutput(STR16("Output"), SpeakerArr::kStereo, kMain, 0);
    addEventInput(STR16("Notes"), 1, kMain, 0);
    return kResultOk;
  }
  tresult PLUGIN_API setupProcessing(ProcessSetup& setup) override {
    auto result = AudioEffect::setupProcessing(setup);
    configured = result == kResultOk;
    return result;
  }
  tresult PLUGIN_API activateBus(MediaType type, BusDirection direction, int32 index, TBool enabled) override {
    if (!configured) return kResultFalse;
    if (enabled && ((refusal == 1 && type == kAudio) || (refusal == 2 && type == kEvent))) return kResultFalse;
    auto result = AudioEffect::activateBus(type, direction, index, enabled);
    if (result == kResultOk && index == 0) {
      if (type == kAudio && direction == kOutput) audioEnabled = enabled != 0;
      if (type == kEvent && direction == kInput) notesEnabled = enabled != 0;
    }
    return result;
  }
  tresult PLUGIN_API setState(IBStream* stream) override {
    int32 read = 0;
    return stream && stream->read(&refusal, 1, &read) == kResultOk && read == 1 && refusal <= 2 ? kResultOk : kInvalidArgument;
  }
  tresult PLUGIN_API getState(IBStream* stream) override {
    int32 written = 0;
    return stream && stream->write(&refusal, 1, &written) == kResultOk && written == 1 ? kResultOk : kResultFalse;
  }
  tresult PLUGIN_API process(ProcessData& data) override {
    if (!data.numOutputs || data.symbolicSampleSize != kSample32) return kInvalidArgument;
    int32 cursor = 0;
    auto write = [&](int32 end) {
      const float sample = audioEnabled && notesEnabled && held ? 0.05f : 0.f;
      for (int32 channel = 0; channel < data.outputs[0].numChannels; ++channel)
        std::fill(data.outputs[0].channelBuffers32[channel] + cursor, data.outputs[0].channelBuffers32[channel] + end, sample);
      cursor = end;
    };
    if (data.inputEvents) for (int32 i = 0; i < data.inputEvents->getEventCount(); ++i) {
      Event event{};
      if (data.inputEvents->getEvent(i, event) != kResultOk) continue;
      write(std::clamp(event.sampleOffset, cursor, data.numSamples));
      if (event.type == Event::kNoteOnEvent) held = true;
      if (event.type == Event::kNoteOffEvent) held = false;
    }
    write(data.numSamples);
    data.outputs[0].silenceFlags = 0;
    return kResultOk;
  }
};
class StrictController final : public EditController {
public:
  static FUnknown* create(void*) { return static_cast<IEditController*>(new StrictController); }
};
BEGIN_FACTORY_DEF("SESSION tests", "https://session-site-eosin.vercel.app", "")
  DEF_CLASS2(INLINE_UID_FROM_FUID(processorId), PClassInfo::kManyInstances, kVstAudioEffectClass,
    "SESSION strict lifecycle fixture", kDistributable, "Instrument|Synth", "1.0.0", kVstVersionString, StrictProcessor::create)
  DEF_CLASS2(INLINE_UID_FROM_FUID(controllerId), PClassInfo::kManyInstances, kVstComponentControllerClass,
    "SESSION strict fixture controller", 0, "", "1.0.0", kVstVersionString, StrictController::create)
END_FACTORY
