import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  encodeWave,
  zipAudio,
  crc32,
  safeAudioName,
  MAX_EXPORT_BYTES,
} from '../lib/audio-files.ts';
const values = [
  new Float32Array([-1, -0.5, 0, 0.5, 1]),
  new Float32Array([0.25, -0.25, 0.125, -0.125, 0]),
];
const samples = {
  length: 5,
  sampleRate: 48000,
  numberOfChannels: 2,
  getChannelData: (ch) => values[ch],
};
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
function parse(bytes) {
  const v = new DataView(bytes);
  eq(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  eq(v.getUint32(4, true) + 8, bytes.byteLength);
  let data, fmt, fact;
  for (let pos = 12; pos + 8 <= bytes.byteLength;) {
    const tag = new TextDecoder().decode(bytes.slice(pos, pos + 4)),
      size = v.getUint32(pos + 4, true);
    if (tag === 'data') data = { offset: pos + 8, size };
    if (tag === 'fmt ') fmt = pos + 8;
    if (tag === 'fact') fact = v.getUint32(pos + 8, true);
    pos += 8 + size + (size & 1);
  }
  return { v, data, fmt, fact };
}
const files = [];
for (const sampleRate of [44100, 48000])
  for (const depth of [16, 24, 32]) {
    const r = await encodeWave({ ...samples, sampleRate }, depth),
      bytes = await r.blob.arrayBuffer(),
      { v, data, fmt, fact } = parse(bytes);
    eq(v.getUint16(fmt, true), depth === 32 ? 3 : 1);
    eq(v.getUint16(fmt + 2, true), 2);
    eq(v.getUint32(fmt + 4, true), sampleRate);
    eq(v.getUint16(fmt + 12, true), (depth / 8) * 2);
    eq(v.getUint32(fmt + 8, true), ((sampleRate * depth) / 8) * 2);
    eq(v.getUint16(fmt + 14, true), depth);
    eq(data.size, ((5 * depth) / 8) * 2);
    if (depth === 32) eq(fact, 5);
    for (let i = 0; i < 5; i++)
      for (let ch = 0; ch < 2; ch++) {
        const at = data.offset + ((i * 2 + ch) * depth) / 8;
        let decoded;
        if (depth === 32) decoded = v.getFloat32(at, true);
        else if (depth === 16) decoded = v.getInt16(at, true) / 32768;
        else {
          let n =
            v.getUint8(at) |
            (v.getUint8(at + 1) << 8) |
            (v.getUint8(at + 2) << 16);
          if (n & 0x800000) n -= 0x1000000;
          decoded = n / 8388608;
        }
        assert(Math.abs(decoded - values[ch][i]) <= 1 / 2 ** (depth - 1));
        checks++;
      }
    files.push({ name: `${sampleRate}_${depth}.wav`, blob: r.blob });
  }
for (const depth of [16, 24]) {
  await assert.rejects(
    () =>
      encodeWave(
        {
          ...samples,
          length: 1,
          getChannelData: () => new Float32Array([1.25]),
        },
        depth,
      ),
    /clip/,
  );
  checks++;
}
const over = await encodeWave(
  { ...samples, length: 1, getChannelData: () => new Float32Array([1.25]) },
  32,
);
const overParsed = parse(await over.blob.arrayBuffer());
eq(overParsed.v.getFloat32(overParsed.data.offset, true), 1.25);
await assert.rejects(
  () =>
    encodeWave(
      { ...samples, getChannelData: () => new Float32Array([NaN]) },
      32,
    ),
  /invalid/,
);
checks++;
await assert.rejects(
  () => encodeWave({ ...samples, length: MAX_EXPORT_BYTES }, 32),
  /128 MB/,
);
checks++;
const control = new AbortController();
control.abort();
await assert.rejects(
  () => encodeWave(samples, 16, { signal: control.signal }),
  { name: 'AbortError' },
);
checks++;
eq(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
eq(
  crc32(
    new TextEncoder().encode('56789'),
    crc32(new TextEncoder().encode('1234')),
  ),
  0xcbf43926,
);
const dither = await encodeWave(
  {
    length: 10000,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(10000),
  },
  16,
  { dither: true },
);
const d = parse(await dither.blob.arrayBuffer());
let sum = 0,
  nonzero = 0;
for (let i = 0; i < 10000; i++) {
  const n = d.v.getInt16(d.data.offset + i * 4, true);
  assert(Math.abs(n) <= 1);
  sum += n;
  nonzero += n !== 0;
}
assert(nonzero > 1000 && Math.abs(sum / 10000) < 0.08);
checks++;
eq(safeAudioName('../bad\\name:\n.wav'), '__bad_name___wav');
const zipFiles = [
  ...files,
  { name: '07_声楽.wav', blob: over.blob },
  { name: 'README.txt', blob: new Blob(['Import at 00:00.']) },
];
const zip = await zipAudio(zipFiles);
const bytes = new Uint8Array(await zip.arrayBuffer()),
  z = new DataView(bytes.buffer);
let pos = 0,
  count = 0;
while (z.getUint32(pos, true) === 0x04034b50) {
  eq(z.getUint16(pos + 6, true), 0x800);
  eq(z.getUint16(pos + 8, true), 0);
  const size = z.getUint32(pos + 18, true),
    len = z.getUint16(pos + 26, true),
    name = new TextDecoder().decode(bytes.slice(pos + 30, pos + 30 + len));
  eq(name, zipFiles[count].name);
  const payload = bytes.slice(pos + 30 + len, pos + 30 + len + size);
  eq(
    [...payload],
    [...new Uint8Array(await zipFiles[count].blob.arrayBuffer())],
  );
  eq(crc32(payload), z.getUint32(pos + 14, true));
  pos += 30 + len + size;
  count++;
}
eq(count, zipFiles.length);
eq(z.getUint32(pos, true), 0x02014b50);
const end = bytes.length - 22;
eq(z.getUint32(end, true), 0x06054b50);
eq(z.getUint16(end + 10, true), count);
eq(z.getUint32(end + 16, true), pos);
await assert.rejects(
  () => zipAudio([{ name: '../outside', blob: new Blob() }]),
  /safe/,
);
checks++;
await assert.rejects(
  () =>
    zipAudio([
      { name: 'a.wav', blob: new Blob() },
      { name: 'A.wav', blob: new Blob() },
    ]),
  /unique/,
);
checks++;
await assert.rejects(() => zipAudio(files, control.signal), {
  name: 'AbortError',
});
checks++;
await fs.mkdir(new URL('../outputs/release-checks/', import.meta.url), { recursive: true });
await fs.writeFile(
  new URL('../outputs/release-checks/export-format-fixtures.zip', import.meta.url),
  bytes,
);
console.log(
  checks + ' audio format checks passed. Independent ZIP fixture saved.',
);
