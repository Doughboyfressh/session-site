import { checkCancelled, encodeWave, yieldExport } from './audio-files';
import type { RecordedTake } from './recording';

export const MAX_TAKES = 8;
export const MAX_TAKE_SECONDS = 240;
export const MAX_TAKE_BYTES = 48 * 1024 * 1024;
export type LocalTake = RecordedTake & {
  id: string;
  name: string;
  url: string;
};
// Positions are relative to the common recording start, in seconds.
export type CompRegion = { takeId: string; start: number; end: number };
export function takeBudget(takes: RecordedTake[], offset: number) {
  const seconds = MAX_TAKE_SECONDS - takes.reduce((n, t) => n + t.seconds, 0);
  const bytes = MAX_TAKE_BYTES - takes.reduce((n, t) => n + t.blob.size, 0);
  const limit = Math.max(
    0,
    Math.min(120, 300 - offset, seconds, (bytes - 128) / (48000 * 4)),
  );
  return { limit, available: takes.length < MAX_TAKES && limit >= 0.1 };
}
export function fullTake(take: LocalTake): CompRegion[] {
  return [{ takeId: take.id, start: 0, end: take.seconds }];
}
export function compFrames(regions: CompRegion[], takes: LocalTake[]) {
  if (!regions.length || regions.length > 64)
    throw new Error('Choose a comp with 1 to 64 sections.');
  const first = takes.find((t) => t.id === regions[0].takeId);
  if (!first) throw new Error('A source take is missing.');
  const rate = first.sampleRate;
  if (!Number.isFinite(first.offset) || first.offset < 0 || first.offset >= 300)
    throw new Error('Invalid comp start position.');
  if (![44100, 48000].includes(rate))
    throw new Error('Unsupported take sample rate.');
  let at = 0;
  const frames = regions.map((r) => {
    const t = takes.find((t) => t.id === r.takeId),
      start = Math.round(r.start * rate),
      end = Math.round(r.end * rate);
    if (!t || t.offset !== first.offset || t.sampleRate !== rate)
      throw new Error(
        'Comp sections must use takes with the same start position and sample rate. Download differing takes to convert them separately.',
      );
    if (
      !Number.isFinite(r.start) ||
      !Number.isFinite(r.end) ||
      start !== at ||
      end <= start ||
      end > Math.round(t.seconds * rate) ||
      end > 120 * rate ||
      first.offset + end / rate > 300 + 1 / rate
    )
      throw new Error(
        'Choose continuous sections within the recorded length of each take.',
      );
    at = end;
    return { takeId: r.takeId, start, end };
  });
  return { frames, rate, length: at, offset: first.offset };
}
export function replaceCompRange(
  regions: CompRegion[],
  takes: LocalTake[],
  takeId: string,
  from: number,
  to: number,
) {
  const { rate, length } = compFrames(regions, takes),
    start = Math.round(from * rate),
    end = Math.round(to * rate);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    start < 0 ||
    end <= start ||
    end > length
  )
    throw new Error('Choose a start and end inside your comp.');
  const result: CompRegion[] = [];
  for (const r of regions) {
    const a = Math.round(r.start * rate),
      b = Math.round(r.end * rate);
    if (a < start)
      result.push({
        takeId: r.takeId,
        start: a / rate,
        end: Math.min(b, start) / rate,
      });
  }
  result.push({ takeId, start: start / rate, end: end / rate });
  for (const r of regions) {
    const a = Math.round(r.start * rate),
      b = Math.round(r.end * rate);
    if (b > end)
      result.push({
        takeId: r.takeId,
        start: Math.max(a, end) / rate,
        end: b / rate,
      });
  }
  const joined: CompRegion[] = [];
  for (const r of result) {
    const previous = joined.at(-1);
    if (previous?.takeId === r.takeId && previous.end === r.start)
      previous.end = r.end;
    else joined.push({ ...r });
  }
  compFrames(joined, takes);
  return joined;
}

// Read only the mono WAV formats emitted by our recorder. No browser resampling.
export async function takePCM(take: RecordedTake, signal?: AbortSignal) {
  checkCancelled(signal);
  if (take.blob.size > MAX_TAKE_BYTES)
    throw new Error('The take exceeds the local audio limit.');
  const bytes = await take.blob.arrayBuffer();
  checkCancelled(signal);
  const v = new DataView(bytes),
    text = (at: number, n: number) =>
      String.fromCharCode(...new Uint8Array(bytes, at, n));
  if (
    bytes.byteLength < 44 ||
    text(0, 4) !== 'RIFF' ||
    text(8, 4) !== 'WAVE' ||
    v.getUint32(4, true) !== bytes.byteLength - 8
  )
    throw new Error('The take is not a complete WAV.');
  let format = 0,
    rate = 0,
    channels = 0,
    depth = 0,
    block = 0,
    dataStart = 0,
    size = 0;
  let cursor = 12;
  for (; cursor + 8 <= bytes.byteLength;) {
    const at = cursor;
    const n = v.getUint32(at + 4, true),
      id = text(at, 4);
    if (at + 8 + n > bytes.byteLength)
      throw new Error('The take contains an incomplete audio chunk.');
    if (id === 'fmt ') {
      if (format) throw new Error('Duplicate WAV format chunk.');
      if (n < 16) throw new Error('Invalid WAV format.');
      format = v.getUint16(at + 8, true);
      channels = v.getUint16(at + 10, true);
      rate = v.getUint32(at + 12, true);
      block = v.getUint16(at + 20, true);
      depth = v.getUint16(at + 22, true);
    }
    if (id === 'data') {
      if (dataStart) throw new Error('Duplicate WAV audio chunk.');
      dataStart = at + 8;
      size = n;
    }
    cursor += 8 + n + (n & 1);
  }
  if (cursor !== bytes.byteLength)
    throw new Error('The take has incomplete chunk padding.');
  if (
    channels !== 1 ||
    rate !== take.sampleRate ||
    depth !== take.depth ||
    !((format === 1 && depth === 24) || (format === 3 && depth === 32)) ||
    block !== depth / 8 ||
    !dataStart ||
    size % block ||
    size / block !== Math.round(take.seconds * rate)
  )
    throw new Error('The take format or duration changed.');
  const pcm = new Float32Array(size / block);
  for (let first = 0; first < pcm.length; first += 65536) {
    checkCancelled(signal);
    for (let i = first; i < Math.min(pcm.length, first + 65536); i++) {
      const at = dataStart + i * block;
      let value;
      if (depth === 32) value = v.getFloat32(at, true);
      else {
        let n =
          v.getUint8(at) |
          (v.getUint8(at + 1) << 8) |
          (v.getUint8(at + 2) << 16);
        if (n & 0x800000) n -= 0x1000000;
        value = n / 0x800000;
      }
      if (!Number.isFinite(value))
        throw new Error('The take contains invalid audio samples.');
      pcm[i] = value;
    }
    await yieldExport(signal);
  }
  return pcm;
}
export async function renderComp(
  regions: CompRegion[],
  takes: LocalTake[],
  signal?: AbortSignal,
): Promise<RecordedTake> {
  const { frames, rate, length, offset } = compFrames(regions, takes);
  checkCancelled(signal);
  const pcm = new Float32Array(length);
  for (const id of new Set(frames.map((r) => r.takeId))) {
    const source = await takePCM(
      takes.find((t) => t.id === id)!,
      signal,
    );
    for (const r of frames.filter((r) => r.takeId === id)) {
      for (let at = r.start; at < r.end; at += 65536) {
        checkCancelled(signal);
        const end = Math.min(at + 65536, r.end);
        pcm.set(source.subarray(at, end), at);
        await yieldExport(signal);
      }
    }
  }
  // A short dip on either side of each edit avoids hard waveform discontinuities.
  // It does not overlap performances or move their timing.
  const ramp = Math.round(rate * 0.003);
  for (let i = 1; i < frames.length; i++) {
    const left = frames[i - 1],
      right = frames[i];
    if (left.takeId === right.takeId) continue;
    const n = Math.min(
      ramp,
      Math.floor((left.end - left.start) / 2),
      Math.floor((right.end - right.start) / 2),
    );
    for (let j = 0; j < n; j++) {
      const gain = j / Math.max(1, n - 1);
      pcm[left.end - 1 - j] *= gain;
      pcm[right.start + j] *= gain;
    }
  }
  let peak = 0;
  for (let first = 0; first < length; first += 65536) {
    for (let i = first; i < Math.min(length, first + 65536); i++)
      peak = Math.max(peak, Math.abs(pcm[i]));
    await yieldExport(signal);
  }
  const depth = peak > 1 ? 32 : 24;
  const encoded = await encodeWave(
    {
      length,
      sampleRate: rate,
      numberOfChannels: 1,
      getChannelData: () => pcm,
    },
    depth,
    { channels: 1, dither: true, signal },
  );
  return {
    blob: encoded.blob,
    seconds: length / rate,
    offset,
    peak: encoded.peak,
    sampleRate: rate,
    depth,
    kind: 'comp',
  };
}
