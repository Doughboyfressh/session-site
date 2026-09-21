// Additive insert-effects for the per-channel strip: saturation / drive,
// modulation (chorus / flanger / phaser), a peak limiter, and a tempo-synced
// sidechain-style pump. Each effect bypasses cleanly to unity when its amount
// is 0, so tracks that don't use them render bit-for-bit as before. The chain
// is shared by the realtime transport and the offline export renderer, so a
// mix and its exported stems apply identical processing.

export type DriveType = 'soft' | 'hard' | 'fuzz';
export type ModType = 'chorus' | 'flanger' | 'phaser';

export type SetParam = (
  param: AudioParam,
  value: number,
  smoothing?: number,
) => void;

// The subset of channel fields these effects read. Presets are built from it.
export type InsertFxSettings = {
  drive?: number;
  driveType?: DriveType;
  mod?: number;
  modType?: ModType;
  modRate?: number;
  limiter?: number;
  pump?: number;
};

export const DRIVE_TYPES: DriveType[] = ['soft', 'hard', 'fuzz'];
export const MOD_TYPES: ModType[] = ['chorus', 'flanger', 'phaser'];

const clamp01 = (n: number | undefined) => Math.max(0, Math.min(1, n || 0));

function driveCurve(type: DriveType) {
  const n = 1024,
    curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    if (type === 'hard') curve[i] = Math.max(-1, Math.min(1, x * 2.5));
    else if (type === 'fuzz') {
      const s = Math.sign(x) || 1;
      curve[i] = (s * (1 - Math.exp(-Math.abs(x) * 3))) / (1 - Math.exp(-3));
    } else curve[i] = Math.tanh(x * 2);
  }
  return curve;
}

type Unit = {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
  sources: (OscillatorNode | ConstantSourceNode)[];
};

// Parallel dry/wet so amount 0 is a true bypass (dry = 1, wet = 0).
function buildDrive(c: BaseAudioContext) {
  const input = c.createGain(),
    dry = c.createGain(),
    pre = c.createGain(),
    shaper = c.createWaveShaper(),
    post = c.createGain(),
    wet = c.createGain(),
    output = c.createGain();
  shaper.oversample = '2x';
  shaper.curve = driveCurve('soft');
  dry.gain.value = 1;
  wet.gain.value = 0;
  input.connect(dry).connect(output);
  input.connect(pre).connect(shaper).connect(post).connect(wet).connect(output);
  let curType: DriveType = 'soft';
  const update = (
    amount: number,
    type: DriveType | undefined,
    set: SetParam,
  ) => {
    const t = type || 'soft';
    if (t !== curType) {
      curType = t;
      shaper.curve = driveCurve(t);
    }
    const a = clamp01(amount);
    set(pre.gain, 1 + a * 8);
    set(post.gain, 1 / (1 + a * 2.5));
    set(wet.gain, a > 0 ? 1 : 0);
    set(dry.gain, a > 0 ? 0 : 1);
  };
  const unit: Unit = {
    input,
    output,
    nodes: [input, dry, pre, shaper, post, wet, output],
    sources: [],
  };
  return { unit, update };
}

// Chorus / flanger (modulated short delay) and phaser (modulated allpass bank)
// live side by side; the inactive path's wet gain sits at 0.
function buildModulation(c: BaseAudioContext) {
  const input = c.createGain(),
    output = c.createGain(),
    dry = c.createGain();
  dry.gain.value = 1;
  input.connect(dry).connect(output);

  const delay = c.createDelay(0.05),
    delayWet = c.createGain(),
    lfo = c.createOscillator(),
    lfoDepth = c.createGain();
  delayWet.gain.value = 0;
  lfo.type = 'sine';
  lfo.frequency.value = 0.8;
  lfoDepth.gain.value = 0;
  delay.delayTime.value = 0.022;
  input.connect(delay).connect(delayWet).connect(output);
  lfo.connect(lfoDepth).connect(delay.delayTime);
  lfo.start();

  const stages = [0, 1, 2, 3].map(() => {
    const f = c.createBiquadFilter();
    f.type = 'allpass';
    f.frequency.value = 1000;
    return f;
  });
  const phaseWet = c.createGain();
  phaseWet.gain.value = 0;
  let node: AudioNode = input;
  for (const s of stages) {
    node.connect(s);
    node = s;
  }
  node.connect(phaseWet).connect(output);
  const plfo = c.createOscillator(),
    plfoDepth = c.createGain();
  plfo.type = 'sine';
  plfo.frequency.value = 0.3;
  plfoDepth.gain.value = 0;
  plfo.connect(plfoDepth);
  for (const s of stages) plfoDepth.connect(s.frequency);
  plfo.start();

  const update = (
    amount: number,
    type: ModType | undefined,
    rate: number | undefined,
    set: SetParam,
  ) => {
    const a = clamp01(amount),
      hz = 0.1 + clamp01(rate) * 5.9,
      kind = type || 'chorus';
    if (kind === 'phaser') {
      set(phaseWet.gain, a);
      set(delayWet.gain, 0);
      set(plfo.frequency, hz * 0.4);
      set(plfoDepth.gain, 700 * a);
    } else {
      set(delayWet.gain, a);
      set(phaseWet.gain, 0);
      set(delay.delayTime, kind === 'flanger' ? 0.003 : 0.022, 0.05);
      set(lfo.frequency, kind === 'flanger' ? hz : hz * 0.5);
      set(lfoDepth.gain, kind === 'flanger' ? 0.002 : 0.006);
    }
  };
  const unit: Unit = {
    input,
    output,
    nodes: [
      input,
      output,
      dry,
      delay,
      delayWet,
      lfoDepth,
      phaseWet,
      plfoDepth,
      ...stages,
    ],
    sources: [lfo, plfo],
  };
  return { unit, update };
}

// Fast peak limiter with partial makeup. Disconnect it at zero: even a
// ratio-one DynamicsCompressorNode introduces lookahead latency.
function buildLimiter(c: BaseAudioContext) {
  const input = c.createGain(),
    makeup = c.createGain(),
    output = c.createGain();
  let comp = c.createDynamicsCompressor();
  comp.knee.value = 0;
  comp.attack.value = 0.003;
  comp.release.value = 0.05;
  comp.ratio.value = 1;
  comp.threshold.value = 0;
  let enabled = false;
  input.connect(output);
  const update = (amount: number, set: SetParam) => {
    const a = clamp01(amount);
    if (a > 0 !== enabled) {
      input.disconnect();
      comp.disconnect();
      makeup.disconnect();
      if (a > 0) {
        unit.nodes = unit.nodes.filter((node) => node !== comp);
        comp = c.createDynamicsCompressor();
        comp.knee.value = 0;
        comp.attack.value = 0.003;
        comp.release.value = 0.05;
        unit.nodes.push(comp);
        input.connect(comp).connect(makeup).connect(output);
      } else input.connect(output);
      enabled = a > 0;
    }
    set(comp.threshold, a > 0 ? -a * 18 : 0);
    set(comp.ratio, a > 0 ? 20 : 1);
    set(makeup.gain, a > 0 ? Math.pow(10, (a * 9) / 20) : 1);
  };
  const unit: Unit = {
    input,
    output,
    nodes: [input, comp, makeup, output],
    sources: [],
  };
  return { unit, update };
}

export type InsertFx = {
  input: AudioNode;
  output: AudioNode;
  update: (t: InsertFxSettings, set: SetParam) => void;
  dispose: () => void;
};

// Pumping is applied at the clip source, aligned with project time.
export function buildInsertFx(c: BaseAudioContext): InsertFx {
  const drive = buildDrive(c),
    mod = buildModulation(c),
    limiter = buildLimiter(c);
  drive.unit.output.connect(mod.unit.input);
  mod.unit.output.connect(limiter.unit.input);

  const units = [drive.unit, mod.unit, limiter.unit];
  return {
    input: drive.unit.input,
    output: limiter.unit.output,
    update: (t, set) => {
      drive.update(t.drive || 0, t.driveType, set);
      mod.update(t.mod || 0, t.modType, t.modRate, set);

      limiter.update(t.limiter || 0, set);
    },
    dispose: () => {
      for (const u of units) {
        for (const s of u.sources) {
          try {
            s.stop();
          } catch {}
        }
        for (const n of u.nodes) n.disconnect();
      }
    },
  };
}
