import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { recordingTiming } from '../lib/recording-timing.ts';
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
for (const rate of [44100, 48000]) {
  const plan = recordingTiming(120, 12.75, 1, rate, {
    preRollBars: 2,
    correctionMs: 80,
  });
  eq(plan.from, 8.75);
  eq(plan.countFrames, rate * 2);
  eq(plan.preRollFrames, rate * 4);
  eq(plan.correctionFrames, Math.round(rate * 0.08));
  eq(recordingTiming(120, 0, 2, rate, { preRollBars: 2 }).preRollFrames, 0);
  eq(
    recordingTiming(120, 0.125, 2, rate, { preRollBars: 2 }).preRollFrames,
    Math.floor(0.125 * rate),
  );
  eq(
    recordingTiming(40, 299.875, 0, rate, { preRollBars: 2, correctionMs: 500 })
      .from,
    287.875,
  );
  for (const bad of [NaN, Infinity, -1, 500.001]) {
    assert.throws(() =>
      recordingTiming(120, 2, 1, rate, { correctionMs: bad }),
    );
    checks++;
  }
  assert.throws(() => recordingTiming(NaN, 2, 1, rate));
  checks++;
  assert.throws(() => recordingTiming(120, 2, 1, rate, { preRollBars: 3 }));
  checks++;
  let Processor;
  let messages = [];
  const sandbox = {
    sampleRate: rate,
    currentFrame: 0,
    Float32Array,
    Number,
    Math,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => messages.push(m) };
      }
    },
    registerProcessor: (_name, p) => {
      Processor = p;
    },
  };
  vm.runInNewContext(
    fs.readFileSync('public/recording-worklet.js', 'utf8'),
    sandbox,
  );
  const run = (p, first, last, origin) => {
    for (let frame = first; frame < last; frame += 128) {
      sandbox.currentFrame = frame;
      const input = Float32Array.from(
        { length: 128 },
        (_, i) => (frame + i - origin) / rate,
      );
      const out = new Float32Array(128).fill(9);
      p.process([[input]], [[out]]);
      assert(out.every((v) => v === 0));
    }
  };
  const pcm = () =>
    Float32Array.from(
      messages
        .filter((m) => m.type === 'samples')
        .flatMap((m) => [...m.samples]),
    );
  const frames = rate === 44100 ? 5516 : 6005;
  const start = 10000 + plan.correctionFrames;
  const p = new Processor();
  p.port.onmessage({ data: { type: 'arm', start, limit: frames } });
  run(p, 9984, start + frames + 128, start);
  let samples = pcm();
  eq(samples.length, frames);
  eq(samples[0], 0);
  eq(samples[frames - 1], Math.fround((frames - 1) / rate));
  eq(messages.filter((m) => m.type === 'done').length, 1);
  // Manual stop before delayed input begins still retains the full delayed tail.
  messages = [];
  sandbox.currentFrame = 0;
  const stopped = new Processor();
  const delayed = 10000 + rate / 2;
  stopped.port.onmessage({
    data: { type: 'arm', start: delayed, limit: rate },
  });
  stopped.port.onmessage({ data: { type: 'finish', end: delayed + frames } });
  run(stopped, 9984, delayed + frames + 128, delayed);
  samples = pcm();
  eq(samples.length, frames);
  eq(samples[0], 0);
  eq(samples.at(-1), Math.fround((frames - 1) / rate));
  stopped.port.onmessage({ data: { type: 'finish', end: delayed + frames } });
  eq(messages.filter((m) => m.type === 'done').length, 1);
  // Tail cancellation produces no final take or stale done message.
  messages = [];
  sandbox.currentFrame = 0;
  const cancelled = new Processor();
  cancelled.port.onmessage({
    data: { type: 'arm', start: 10000, limit: rate },
  });
  run(cancelled, 9984, 11008, 10000);
  cancelled.port.onmessage({ data: { type: 'finish', end: 12000 } });
  cancelled.port.onmessage({ data: { type: 'cancel' } });
  run(cancelled, 11008, 13056, 10000);
  eq(messages.filter((m) => m.type === 'done').length, 0);
  eq(messages.filter((m) => m.type === 'samples').length, 0);
  messages = [];
  cancelled.port.onmessage({ data: { type: 'finish', end: NaN } });
  eq(messages.at(-1).type, 'error');
}
console.log(
  `PASS: ${checks} pre-roll, compensation and scheduled worklet end assertions.`,
);
