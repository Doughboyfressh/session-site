import {
  bufferFor,
  channel,
  routingGraph,
  scheduleClip,
  type Arrangement,
  type MixerTrack,
} from './audio';
import {
  encodeWave,
  zipAudio,
  safeAudioName,
  MAX_EXPORT_BYTES,
  checkCancelled,
  yieldExport,
  type WaveDepth,
  type Samples,
} from './audio-files';

export type ExportOptions = {
  kind: 'mix' | 'tracks';
  sampleRate: 44100 | 48000;
  depth: WaveDepth;
  processing: 'processed' | 'dry';
  trackIds: string[];
  tail: number;
  gainDb: number;
  dither: boolean;
  includeMix: boolean;
};
export type ExportProgress = {
  message: string;
  completed: number;
  total: number;
};
const latencyCache = new Map<number, Promise<number>>();
export function compressorLatency(sampleRate: number) {
  if (!latencyCache.has(sampleRate)) {
    const task = (async () => {
      const c = new OfflineAudioContext(
        1,
        Math.ceil(sampleRate * 0.1),
        sampleRate,
      );
      const source = c.createBufferSource(),
        compressor = c.createDynamicsCompressor();
      source.buffer = c.createBuffer(1, 1, sampleRate);
      source.buffer.getChannelData(0)[0] = 0.1;
      compressor.ratio.value = 1;
      compressor.threshold.value = 0;
      compressor.knee.value = 0;
      source.connect(compressor).connect(c.destination);
      source.start();
      try {
        const data = (await c.startRendering()).getChannelData(0);
        let peak = 0;
        for (let i = 1; i < data.length; i++)
          if (Math.abs(data[i]) > Math.abs(data[peak])) peak = i;
        if (data[peak] < 0.01 || peak > sampleRate * 0.02)
          throw new Error(
            'This browser could not verify export timing. Try another browser.',
          );
        return peak;
      } finally {
        source.disconnect();
        compressor.disconnect();
      }
    })();
    latencyCache.set(sampleRate, task);
    void task.catch(() => latencyCache.delete(sampleRate));
  }
  return latencyCache.get(sampleRate)!;
}
export function exportEnd(t: MixerTrack, duration: number) {
  const end = t.offset + duration - t.trimStart - t.trimEnd;
  if (
    !Number.isFinite(end) ||
    t.trimStart < 0 ||
    t.trimEnd < 0 ||
    t.offset < 0 ||
    t.trimStart + t.trimEnd >= duration
  )
    throw new Error(
      t.name +
        ' is fully trimmed or has invalid timing. Adjust its trims first.',
    );
  if (end > 300 + 1 / 48000)
    throw new Error(
      t.name +
        ' extends beyond the five-minute timeline. Shorten or move it before exporting.',
    );
  return end;
}
export async function renderExportTrack(
  t: MixerTrack,
  source: AudioBuffer,
  frames: number,
  options: Pick<ExportOptions, 'sampleRate' | 'processing' | 'gainDb'>,
  signal?: AbortSignal,
  arrangement?: Arrangement,
): Promise<Samples> {
  checkCancelled(signal);
  const latency =
    options.processing === 'processed' && t.compression
      ? await compressorLatency(options.sampleRate)
      : 0;
  checkCancelled(signal);
  const c = new OfflineAudioContext(2, frames + latency, options.sampleRate);
  const output = c.createGain();
  output.gain.value = 10 ** (options.gainDb / 20);
  output.connect(c.destination);
  const track = { ...t, muted: false, solo: false };
  const routed =
    options.processing === 'processed' && arrangement
      ? routingGraph(
          c,
          { ...arrangement, tracks: [track] },
          output,
          false,
          true,
        )
      : null;
  const input =
    options.processing === 'processed'
      ? channel(c, track, routed?.inputs.get(track.id) || output)
      : (() => {
          const gain = c.createGain();
          gain.connect(output);
          return { input: gain, auto: gain, dispose: () => gain.disconnect() };
        })();
  scheduleClip(
    c,
    options.processing === 'dry' ? { ...track, automation: [] } : track,
    source,
    input,
    0,
    0,
    frames / options.sampleRate,
    latency / options.sampleRate,
  );
  try {
    // Offline rendering cannot be stopped reliably. Wait for it before permitting a replacement export.
    const rendered = await c.startRendering();
    checkCancelled(signal);
    return {
      length: frames,
      sampleRate: options.sampleRate,
      numberOfChannels: 2,
      getChannelData: (ch) =>
        rendered.getChannelData(ch).subarray(latency, latency + frames),
    };
  } finally {
    input.dispose();
    routed?.dispose();
    output.disconnect();
  }
}
let exporting = false;
export async function createAudioExport(
  title: string,
  arrangement: Arrangement,
  options: ExportOptions,
  signal?: AbortSignal,
  progress: (p: ExportProgress) => void = () => {},
) {
  if (exporting)
    throw new Error(
      'The previous export is still finishing. Please wait a moment.',
    );
  exporting = true;
  try {
    const data = structuredClone(arrangement),
      settings = structuredClone(options);
    checkCancelled(signal);
    if (
      ![44100, 48000].includes(settings.sampleRate) ||
      ![16, 24, 32].includes(settings.depth) ||
      !['mix', 'tracks'].includes(settings.kind) ||
      !['dry', 'processed'].includes(settings.processing) ||
      !Number.isFinite(settings.tail) ||
      settings.tail < 0 ||
      settings.tail > 5 ||
      !Number.isFinite(settings.gainDb) ||
      settings.gainDb > 0 ||
      settings.gainDb < -36
    )
      throw new Error('Choose valid export settings.');
    const ids = new Set(settings.trackIds),
      selected = data.tracks.filter((t) => ids.has(t.id));
    if (
      !selected.length ||
      selected.length > 32 ||
      selected.length !== ids.size
    )
      throw new Error('Choose at least one available track.');
    const total = selected.length * 2 + 2;
    const report = (message: string, completed: number) => {
      checkCancelled(signal);
      progress({ message, completed, total });
    };
    // Keep only durations during preflight, not an array of decoded audio buffers.
    let end = 0;
    for (let i = 0; i < selected.length; i++) {
      report('Checking ' + selected[i].name, i);
      const notes = selected[i].notes;
      if (
        (!selected[i].fileId || selected[i].sample) &&
        notes &&
        (Math.max(8, ...notes.map((note) => note.start + note.length)) * 60) /
          data.bpm +
          0.5 >
          300
      )
        throw new Error(
          selected[i].name +
            ' has notes beyond the five-minute instrument limit. Move or shorten those notes before exporting.',
        );
      const b = await bufferFor(selected[i], data.bpm, {
        sampleRate: settings.sampleRate,
        signal,
        revalidate: true,
      });
      checkCancelled(signal);
      end = Math.max(end, exportEnd(selected[i], b.duration));
    }
    const frames = Math.ceil((end + settings.tail) * settings.sampleRate);
    const fileCount =
      settings.kind === 'mix'
        ? 1
        : selected.length + (settings.includeMix ? 1 : 0);
    const bytes = frames * 2 * (settings.depth / 8) * fileCount + 65536;
    if (bytes > MAX_EXPORT_BYTES)
      throw new Error(
        'This export would exceed 128 MB. Select fewer tracks, shorten the arrangement, or choose a lower bit depth.',
      );
    const needMix = settings.kind === 'mix' || settings.includeMix;
    const sum = needMix
      ? [new Float32Array(frames), new Float32Array(frames)]
      : null;
    const files: { name: string; blob: Blob }[] = [],
      peaks: { name: string; peak: number }[] = [];
    for (let i = 0; i < selected.length; i++) {
      const track = selected[i];
      report('Rendering ' + track.name, selected.length + i);
      const b = await bufferFor(track, data.bpm, {
        sampleRate: settings.sampleRate,
        signal,
        revalidate: true,
      });
      checkCancelled(signal);
      const rendered = await renderExportTrack(
        track,
        b,
        frames,
        settings,
        signal,
        data,
      );
      if (sum)
        for (let first = 0; first < frames; first += 65536) {
          for (let ch = 0; ch < 2; ch++) {
            const source = rendered.getChannelData(ch);
            for (let n = first; n < Math.min(frames, first + 65536); n++)
              sum[ch][n] += source[n];
          }
          await yieldExport(signal);
        }
      if (settings.kind === 'tracks') {
        report('Encoding ' + track.name, selected.length + i);
        const encoded = await encodeWave(rendered, settings.depth, {
          signal,
          dither: settings.dither,
        });
        const name =
          String(i + 1).padStart(2, '0') +
          '_' +
          safeAudioName(track.name) +
          '.wav';
        files.push({ name, blob: encoded.blob });
        peaks.push({ name, peak: encoded.peak });
      }
    }
    report('Encoding stereo mix', total - 2);
    let mix: Awaited<ReturnType<typeof encodeWave>> | undefined;
    if (sum)
      mix = await encodeWave(
        {
          length: frames,
          sampleRate: settings.sampleRate,
          numberOfChannels: 2,
          getChannelData: (ch) => sum[ch],
        },
        settings.depth,
        { signal, dither: settings.dither },
      );
    const basename = safeAudioName(title);
    if (settings.kind === 'mix') {
      checkCancelled(signal);
      report('Export ready', total);
      return {
        blob: mix!.blob,
        name: basename + '_mix.wav',
        seconds: frames / settings.sampleRate,
        peak: mix!.peak,
        files: 1,
      };
    }
    if (mix) {
      files.push({
        name: 'REFERENCE_' + settings.processing + '.wav',
        blob: mix.blob,
      });
      peaks.push({
        name: 'REFERENCE_' + settings.processing + '.wav',
        peak: mix.peak,
      });
    }
    const notes = [
      title,
      'SESSION multitrack export',
      '',
      'Import every WAV at 00:00 on separate tracks. Do not remove the leading silence.',
      `Tempo: ${data.bpm} BPM. Stereo ${settings.sampleRate} Hz, ${settings.depth === 32 ? '32-bit IEEE float' : settings.depth + '-bit PCM'}.`,
      `Length: ${frames} frames (${(frames / settings.sampleRate).toFixed(6)} seconds). Tail: ${settings.tail} seconds.`,
      `Export gain: ${settings.gainDb} dB, applied equally to every file. Integer dither: ${settings.depth !== 32 && settings.dither ? 'TPDF' : 'off'}.`,
      settings.processing === 'dry'
        ? 'Dry tracks preserve clip offsets, trims and fades. Mixer volume, pan, automation, EQ, compression, reverb and delay are bypassed.'
        : 'Processed tracks preserve clip offsets, trims, fades, volume, pan, automation, channel effects, group gain/pan and their contribution to shared reverb/delay. Compressor lookahead is compensated.',
      'No master compressor or normalization is applied. A reference file is the sum of the selected exported tracks before WAV quantization.',
      'The selected tracks are exported even if track/group mute or solo excludes them in the studio. Shared return levels are included in processed exports. Dry exports bypass groups and shared returns. Loop and metronome are excluded.',
      'Audio source quality is unchanged by selecting a higher output sample rate or bit depth. Exporting does not change the permissions attached to the music.',
      '',
      ...peaks.map(
        (p) =>
          `${p.name} | sample peak: ${p.peak ? (20 * Math.log10(p.peak)).toFixed(2) + ' dBFS' : 'silence'}`,
      ),
    ].join('\n');
    files.push({
      name: 'README.txt',
      blob: new Blob([notes], { type: 'text/plain;charset=utf-8' }),
    });
    report('Packaging aligned tracks', total - 1);
    const blob = await zipAudio(files, signal);
    report('Export ready', total);
    return {
      blob,
      name: basename + '_' + settings.processing + '_tracks.zip',
      seconds: frames / settings.sampleRate,
      peak: Math.max(...peaks.map((p) => p.peak)),
      files: files.length,
    };
  } finally {
    exporting = false;
  }
}
