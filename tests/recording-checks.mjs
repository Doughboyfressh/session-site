import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { encodeWave } from '../lib/audio-files.ts';
let Processor;
const messages = [];
const sandbox = {
  Float32Array,
  Number,
  Math,
  sampleRate: 48000,
  currentFrame: 0,
  AudioWorkletProcessor: class {
    constructor() {
      this.port = { postMessage: (m) => messages.push(m) };
    }
  },
  registerProcessor: (name, p) => {
    assert.equal(name, 'session-capture');
    Processor = p;
  },
};
vm.runInNewContext(
  await fs.readFile(
    new URL('../public/recording-worklet.js', import.meta.url),
    'utf8',
  ),
  sandbox,
);
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
const test = new Processor();
const send = (d) => test.port.onmessage({ data: d });
function block(frame, channels, length = 128) {
  sandbox.currentFrame = frame;
  const output = new Float32Array(length).fill(1);
  test.process([channels], [[output]]);
  eq(
    output.every((x) => x === 0),
    true,
  );
}
block(0, [new Float32Array(128).fill(0.2)]);
eq(
  messages.some((m) => m.type === 'samples'),
  false,
);
send({ type: 'arm', start: 150, limit: 173 });
block(128, [new Float32Array(64).fill(0.25)], 64);
block(192, [new Float32Array(256).fill(0.5)], 256);
let samples = messages
  .filter((m) => m.type === 'samples')
  .flatMap((m) => Array.from(m.samples));
eq(samples.length, 173);
eq(
  samples.slice(0, 42).every((x) => x === 0.25),
  true,
);
eq(
  samples.slice(42).every((x) => x === 0.5),
  true,
);
eq(messages.find((m) => m.type === 'done').frames, 173);
const doneBefore = messages.filter((m) => m.type === 'done').length;
send({ type: 'finish' });
eq(messages.filter((m) => m.type === 'done').length, doneBefore);
messages.length = 0;
sandbox.currentFrame = 512;
send({ type: 'arm', start: 512, limit: 48000 });
block(512, [new Float32Array(128).fill(0.6), new Float32Array(128).fill(0.2)]);
send({ type: 'finish' });
eq(messages.find((m) => m.type === 'samples').samples.length, 128);
assert(
  Math.abs(messages.find((m) => m.type === 'samples').samples[0] - 0.4) < 1e-6,
);
checks++;
messages.length = 0;
sandbox.currentFrame = 700;
send({ type: 'arm', start: 700, limit: 48000 });
block(700, [], 128);
send({ type: 'finish' });
eq(
  messages.find((m) => m.type === 'samples').samples.every((x) => x === 0),
  true,
);
messages.length = 0;
sandbox.currentFrame = 1000;
send({ type: 'arm', start: 1000, limit: 5000 });
block(1000, [new Float32Array(128).fill(0.1)]);
send({ type: 'cancel' });
send({ type: 'finish' });
eq(
  messages.some((m) => m.type === 'samples' || m.type === 'done'),
  false,
);
send({ type: 'arm', start: 1, limit: 100 });
eq(messages.at(-1).type, 'error');
send({ type: 'arm', start: 2000, limit: 48000 * 120 + 1 });
eq(messages.at(-1).type, 'error');
messages.length = 0;
sandbox.currentFrame = 2000;
send({ type: 'arm', start: 2000, limit: 5000 });
const invalid = new Float32Array(128);
invalid[40] = NaN;
block(2000, [invalid]);
eq(messages.at(-1).type, 'error');
eq(
  messages.some((m) => m.type === 'done'),
  false,
);
// Long chunks preserve order and exact final partial buffer.
messages.length = 0;
const long = new Processor();
long.port.onmessage({ data: { type: 'arm', start: 3000, limit: 9000 } });
for (let at = 3000; at < 12000; at += 256) {
  sandbox.currentFrame = at;
  long.process(
    [[Float32Array.from({ length: 256 }, (_, i) => (at + i - 3000) / 20000)]],
    [[new Float32Array(256)]],
  );
}
samples = messages
  .filter((m) => m.type === 'samples')
  .flatMap((m) => Array.from(m.samples));
eq(samples.length, 9000);
eq(
  messages.filter((m) => m.type === 'samples').map((m) => m.samples.length),
  [4096, 4096, 808],
);
assert(Math.abs(samples[8999] - 8999 / 20000) < 1e-6);
checks++;
const wave = await encodeWave(
  {
    length: 3,
    sampleRate: 48000,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([-0.5, 0, 0.5]),
  },
  24,
  { channels: 1, dither: false },
);
const v = new DataView(await wave.blob.arrayBuffer());
eq(v.getUint16(22, true), 1);
eq(v.getUint16(32, true), 3);
eq(v.getUint32(28, true), 144000);
eq(v.getUint32(40, true), 9);
eq(wave.blob.size, 54);
eq(v.getUint8(53), 0);
eq(v.getUint32(4, true), 46);
eq(v.getUint8(46), 192);
eq(v.getUint8(52), 64);
console.log(`${checks} recording processor and mono WAV checks passed.`);
