export type WaveDepth = 16 | 24 | 32;
export type Samples = {
  length: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
};
export const MAX_EXPORT_BYTES = 128 * 1024 * 1024;
export function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('Export cancelled.', 'AbortError');
}
export async function yieldExport(signal?: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkCancelled(signal);
}
export function safeAudioName(name: string) {
  return (
    name
      .normalize('NFKC')
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
      .replace(/\.+/g, '_')
      .trim()
      .slice(0, 70) || 'Untitled'
  );
}
function ascii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++)
    view.setUint8(offset + i, text.charCodeAt(i));
}
export async function encodeWave(
  samples: Samples,
  depth: WaveDepth,
  options: { dither?: boolean; signal?: AbortSignal; channels?: 1 | 2 } = {},
) {
  checkCancelled(options.signal);
  if (
    ![16, 24, 32].includes(depth) ||
    !Number.isInteger(samples.length) ||
    samples.length < 1 ||
    ![44100, 48000].includes(samples.sampleRate)
  )
    throw new Error('Unsupported WAV settings.');
  const channelCount = options.channels || 2;
  const bytes = depth / 8,
    frameBytes = channelCount * bytes,
    start = depth === 32 ? 58 : 44;
  const dataSize = samples.length * frameBytes;
  const size = dataSize + start + (dataSize & 1);
  if (size > MAX_EXPORT_BYTES)
    throw new Error('This WAV exceeds the 128 MB export limit.');
  const data = new ArrayBuffer(size),
    view = new DataView(data);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, size - 8, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, depth === 32 ? 18 : 16, true);
  view.setUint16(20, depth === 32 ? 3 : 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, samples.sampleRate, true);
  view.setUint32(28, samples.sampleRate * frameBytes, true);
  view.setUint16(32, frameBytes, true);
  view.setUint16(34, depth, true);
  if (depth === 32) {
    view.setUint16(36, 0, true);
    ascii(view, 38, 'fact');
    view.setUint32(42, 4, true);
    view.setUint32(46, samples.length, true);
  }
  ascii(view, start - 8, 'data');
  view.setUint32(start - 4, samples.length * frameBytes, true);
  const channels = [
    samples.getChannelData(0),
    samples.getChannelData(Math.min(1, samples.numberOfChannels - 1)),
  ];
  const scale = 2 ** (depth - 1);
  let peak = 0;
  for (let first = 0; first < samples.length; first += 65536) {
    checkCancelled(options.signal);
    for (let i = first; i < Math.min(samples.length, first + 65536); i++)
      for (let channel = 0; channel < channelCount; channel++) {
        const value = channels[channel][i];
        if (!Number.isFinite(value))
          throw new Error(
            'The render contains invalid audio samples. Check its source and effects.',
          );
        peak = Math.max(peak, Math.abs(value));
        const offset = start + i * frameBytes + channel * bytes;
        if (depth === 32) view.setFloat32(offset, value, true);
        else {
          if (Math.abs(value) > 1)
            throw new Error(
              'Audio would clip in an integer WAV. Lower export gain or choose 32-bit float.',
            );
          const noise = options.dither ? Math.random() - Math.random() : 0;
          const integer = Math.max(
            -scale,
            Math.min(scale - 1, Math.round(value * scale + noise)),
          );
          if (depth === 16) view.setInt16(offset, integer, true);
          else {
            view.setUint8(offset, integer & 255);
            view.setUint8(offset + 1, (integer >> 8) & 255);
            view.setUint8(offset + 2, (integer >> 16) & 255);
          }
        }
      }
    await yieldExport(options.signal);
  }
  return { blob: new Blob([data], { type: 'audio/wav' }), peak };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array, previous = 0) {
  let crc = previous ^ 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function blobCRC(blob: Blob, signal?: AbortSignal) {
  let crc = 0;
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    checkCancelled(signal);
    crc = crc32(
      new Uint8Array(
        await blob.slice(offset, offset + 1024 * 1024).arrayBuffer(),
      ),
      crc,
    );
    await yieldExport(signal);
  }
  return crc;
}
export async function zipAudio(
  files: { name: string; blob: Blob }[],
  signal?: AbortSignal,
) {
  checkCancelled(signal);
  if (!files.length || files.length > 64)
    throw new Error('Choose up to 32 tracks for the package.');
  const names = new Set<string>(),
    entries: BlobPart[] = [],
    directory: BlobPart[] = [];
  let offset = 0,
    directorySize = 0;
  for (const file of files) {
    if (
      !file.name ||
      /(^\.|[\x00-\x1f/\\])/.test(file.name) ||
      names.has(file.name.toLowerCase())
    )
      throw new Error('Export filenames must be unique and safe.');
    names.add(file.name.toLowerCase());
    const name = new TextEncoder().encode(file.name);
    if (
      name.length > 65535 ||
      offset + file.blob.size + name.length * 2 + 100 + directorySize >
        MAX_EXPORT_BYTES
    )
      throw new Error(
        'The package exceeds 128 MB. Select fewer tracks or a lower bit depth.',
      );
    const crc = await blobCRC(file.blob, signal);
    const local = new ArrayBuffer(30 + name.length),
      l = new DataView(local);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(12, 33, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, file.blob.size, true);
    l.setUint32(22, file.blob.size, true);
    l.setUint16(26, name.length, true);
    new Uint8Array(local).set(name, 30);
    const central = new ArrayBuffer(46 + name.length),
      c = new DataView(central);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, file.blob.size, true);
    c.setUint32(24, file.blob.size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    new Uint8Array(central).set(name, 46);
    entries.push(local, file.blob);
    directory.push(central);
    offset += local.byteLength + file.blob.size;
    directorySize += central.byteLength;
  }
  const end = new ArrayBuffer(22),
    v = new DataView(end);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.length, true);
  v.setUint16(10, files.length, true);
  v.setUint32(12, directorySize, true);
  v.setUint32(16, offset, true);
  if (offset + directorySize + 22 > MAX_EXPORT_BYTES)
    throw new Error('The package exceeds 128 MB.');
  checkCancelled(signal);
  return new Blob([...entries, ...directory, end], { type: 'application/zip' });
}
