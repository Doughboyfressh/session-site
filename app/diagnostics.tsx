'use client';
import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Download, Play, Square } from 'lucide-react';
import { PeerLink } from '@/lib/peer';
import {
  defaults,
  renderBuffer,
  wav,
  midiFile,
  download,
  automationAt,
} from '@/lib/audio';
type Result = {
  name: string;
  status: 'passed' | 'failed' | 'pending';
  detail: string;
};
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 14000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timed out waiting for media.');
    await pause(100);
  }
}
export default function Diagnostics() {
  const [running, setRunning] = useState(false),
    [results, setResults] = useState<Result[]>([]),
    [progress, setProgress] = useState('Ready for a local check'),
    [completed, setCompleted] = useState('');
  const videoA = useRef<HTMLVideoElement>(null),
    videoB = useRef<HTMLVideoElement>(null),
    fixture = useRef<HTMLCanvasElement>(null),
    generation = useRef(0),
    cleanup = useRef<() => void>(() => {});
  useEffect(
    () => () => {
      generation.current++;
      cleanup.current();
    },
    [],
  );
  function stop() {
    generation.current++;
    cleanup.current();
    setRunning(false);
    setProgress('Check stopped. Generated media has been released.');
  }
  async function run() {
    if (running) return;
    setRunning(true);
    setResults([]);
    setCompleted('');
    const epoch = ++generation.current;
    const list: Result[] = [];
    const report = (name: string, status: Result['status'], detail: string) => {
      list.push({ name, status, detail });
      if (epoch === generation.current) setResults([...list]);
    };
    const active = () => {
      if (epoch !== generation.current) throw new Error('Check canceled.');
    };
    const step = async (name: string, fn: () => Promise<string>) => {
      active();
      setProgress(name);
      try {
        const detail = await fn();
        active();
        report(name, 'passed', detail);
      } catch (e: any) {
        active();
        report(name, 'failed', e.message);
        throw e;
      }
    };
    let c: AudioContext | null = null,
      a: PeerLink | null = null,
      b: PeerLink | null = null,
      stream: MediaStream | null = null,
      extra: MediaStream | null = null,
      timer: any;
    const resources: MediaStream[] = [];
    const seen = new Map<string, MediaStream>();
    const meters = new Map<string, AnalyserNode>();
    const inputs = new Map<
      string,
      {
        stream: MediaStream;
        track: MediaStreamTrack;
        source: MediaStreamAudioSourceNode;
        gain: GainNode;
      }
    >();
    const receivedRms = (id: string) => {
      const m = meters.get(id);
      if (!m) return 0;
      const d = new Float32Array(m.fftSize);
      m.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((sum, v) => sum + v * v, 0) / d.length);
    };
    const dispose = () => {
      clearInterval(timer);
      a?.close();
      b?.close();
      for (const s of resources) s.getTracks().forEach((t) => t.stop());
      c?.close().catch(() => {});
      for (const v of [videoA.current, videoB.current])
        if (v) v.srcObject = null;
    };
    cleanup.current = dispose;
    try {
      await step('Studio render, automation, and export', async () => {
        const track = {
          ...defaults('Diagnostic keys'),
          notes: [
            { id: 'test-note', pitch: 60, start: 0, length: 8, velocity: 0.8 },
          ],
          automation: [
            { time: 0, value: 0 },
            { time: 0.5, value: 0 },
            { time: 0.55, value: 1 },
          ],
          pan: -0.4,
        };
        const rendered = await renderBuffer({ bpm: 120, tracks: [track] });
        const data = rendered.getChannelData(0);
        const rms = (from: number, to: number) => {
          let energy = 0;
          for (let i = Math.floor(from * 44100); i < to * 44100; i++)
            energy += data[i] * data[i];
          return Math.sqrt(energy / ((to - from) * 44100));
        };
        const silent = rms(0.1, 0.4),
          audible = rms(0.7, 1.2);
        if (silent > 0.0001 || audible < 0.001)
          throw new Error(
            'Volume automation did not produce the expected silence and sound.',
          );
        if (
          automationAt(
            [
              { time: 0, value: 0 },
              { time: 2, value: 1 },
            ],
            1,
          ) !== 0.5
        )
          throw new Error('Automation interpolation mismatch.');
        const wave = await wav(rendered).arrayBuffer(),
          v = new DataView(wave),
          midi = new Uint8Array(await midiFile(track.notes, 120).arrayBuffer());
        if (
          new TextDecoder().decode(wave.slice(0, 4)) !== 'RIFF' ||
          v.getUint32(24, true) !== 44100 ||
          v.getUint16(22, true) !== 2 ||
          new TextDecoder().decode(midi.slice(0, 4)) !== 'MThd'
        )
          throw new Error('Audio or MIDI export header is invalid.');
        return `Stereo 44.1 kHz WAV and MIDI generated. Silent RMS ${silent.toFixed(6)}; audible RMS ${audible.toFixed(4)}.`;
      });
      c = new AudioContext();
      await c.resume();
      active();
      const audio = c.createMediaStreamDestination(),
        tone = c.createOscillator(),
        gain = c.createGain();
      tone.frequency.value = 330;
      gain.gain.value = 0.12;
      tone.connect(gain).connect(audio);
      tone.start();
      const canvas = fixture.current!,
        ctx = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => {
        ctx.fillStyle = '#182611';
        ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = '#c2f65a';
        ctx.fillRect((frame++ * 7) % 280, 55, 40, 70);
        ctx.fillStyle = '#e4eddb';
        ctx.font = '16px sans-serif';
        ctx.fillText('SESSION · generated test video', 18, 28);
      };
      draw();
      timer = setInterval(draw, 66);
      const visual = canvas.captureStream(15);
      stream = new MediaStream([
        ...audio.stream.getTracks(),
        ...visual.getTracks(),
      ]);
      resources.push(stream);
      const remote =
        (el: HTMLVideoElement | null) => (s: MediaStream, remove: boolean) => {
          if (remove) {
            seen.delete(s.id);
            const input = inputs.get(s.id);
            input?.source.disconnect();
            input?.gain.disconnect();
            inputs.delete(s.id);
            meters.delete(s.id);
            return;
          }
          seen.set(s.id, s);
          const attached = inputs.get(s.id);
          if (
            s.getAudioTracks().length &&
            (!attached ||
              attached.stream !== s ||
              attached.track !== s.getAudioTracks()[0])
          ) {
            attached?.source.disconnect();
            attached?.gain.disconnect();
            const src = c!.createMediaStreamSource(s),
              analyser = c!.createAnalyser(),
              silent = c!.createGain();
            analyser.fftSize = 2048;
            silent.gain.value = 0;
            src.connect(analyser).connect(silent).connect(c!.destination);
            meters.set(s.id, analyser);
            inputs.set(s.id, {
              stream: s,
              track: s.getAudioTracks()[0],
              source: src,
              gain: silent,
            });
          }
          if (el && s.getVideoTracks().length) {
            if (el.srcObject !== s) el.srcObject = s;
            el.play().catch(() => {});
          }
        };
      const trace: string[] = [];
      const config = { iceServers: [] };
      const graph = () =>
        JSON.stringify({
          source: stream?.getTracks().map((t) => ({
            id: t.id,
            kind: t.kind,
            enabled: t.enabled,
            ready: t.readyState,
          })),
          a: a?.pc.getTransceivers().map((t) => ({
            mid: t.mid,
            d: t.direction,
            cd: t.currentDirection,
            send: t.sender.track?.id,
            recv: t.receiver.track.id,
            muted: t.receiver.track.muted,
          })),
          b: b?.pc.getTransceivers().map((t) => ({
            mid: t.mid,
            d: t.direction,
            cd: t.currentDirection,
            send: t.sender.track?.id,
            recv: t.receiver.track.id,
            muted: t.receiver.track.muted,
          })),
        });
      a = new PeerLink('diagnostic-a', 'diagnostic-b', config, {
        send: async (body) => {
          trace.push('A ' + (body.description?.type || 'candidate'));
          await pause(body.description ? 25 : 0);
          if (b && !b.closed) void b.receive(structuredClone(body));
        },
        stream: remote(videoA.current),
        state: (s) => {
          trace.push('A ' + s);
        },
      });
      b = new PeerLink('diagnostic-b', 'diagnostic-a', config, {
        send: async (body) => {
          trace.push('B ' + (body.description?.type || 'candidate'));
          await pause(body.description ? 25 : 0);
          if (a && !a.closed) void a.receive(structuredClone(body));
        },
        stream: remote(videoB.current),
        state: (s) => {
          trace.push('B ' + s);
        },
      });
      const trackB = stream.clone();
      resources.push(trackB);
      a.setStreams([stream]);
      b.setStreams([trackB]);
      await step('Two-way audio/video with simultaneous offers', async () => {
        try {
          await until(
            () =>
              a!.pc.connectionState === 'connected' &&
              b!.pc.connectionState === 'connected' &&
              a!.pc.signalingState === 'stable' &&
              b!.pc.signalingState === 'stable',
          );
        } catch (e: any) {
          throw new Error(
            e.message +
              ' A: ' +
              a!.pc.signalingState +
              '/' +
              a!.pc.iceConnectionState +
              ' B: ' +
              b!.pc.signalingState +
              '/' +
              b!.pc.iceConnectionState +
              '. ' +
              trace.join(' → '),
          );
        }
        await until(
          () =>
            receivedRms(stream!.id) > 0.005 && receivedRms(trackB.id) > 0.005,
          8000,
        );
        await pause(700);
        const first = await a!.stats(),
          second = await b!.stats();
        if (
          first.frames < 2 ||
          second.frames < 2 ||
          receivedRms(stream!.id) < 0.005 ||
          receivedRms(trackB.id) < 0.005
        )
          throw new Error(
            'Connected, but decoded video or received audio energy was missing. A ' +
              JSON.stringify(first) +
              ' B ' +
              JSON.stringify(second),
          );
        return `Both peers connected; decoded ${first.frames}/${second.frames} frames. Received audio RMS ${receivedRms(stream!.id).toFixed(4)}/${receivedRms(trackB.id).toFixed(4)} measured before silent speaker output.`;
      });
      await step('Mute and unmute preserve the call', async () => {
        stream!.getAudioTracks()[0].enabled = false;
        await pause(800);
        const silent = receivedRms(stream!.id);
        stream!.getAudioTracks()[0].enabled = true;
        await pause(1100);
        const sound = receivedRms(stream!.id);
        if (sound < 0.00001 || silent > sound * 0.15)
          throw new Error('Mute did not suppress received audio as expected.');
        return `Received audio RMS while muted ${silent.toFixed(6)}; after unmute ${sound.toFixed(5)}.`;
      });
      await step('Simultaneous ICE restart recovers media', async () => {
        const old = a!.pc.localDescription?.sdp;
        a!.restart();
        b!.restart();
        await until(
          () =>
            a!.pc.localDescription?.sdp !== old &&
            a!.pc.connectionState === 'connected' &&
            b!.pc.connectionState === 'connected' &&
            a!.pc.signalingState === 'stable' &&
            b!.pc.signalingState === 'stable',
        );
        const before = await b!.stats();
        await pause(900);
        const after = await b!.stats();
        if (after.bytes <= before.bytes || after.frames <= before.frames)
          throw new Error('Media did not resume after ICE restart.');
        await until(
          () =>
            receivedRms(stream!.id) > 0.005 && receivedRms(trackB.id) > 0.005,
          8000,
        ).catch(() => {
          throw new Error('Audio missing after ICE restart. ' + graph());
        });
        return `Simultaneous restart requests coordinated by one peer. Received ${after.bytes - before.bytes} bytes, ${after.frames - before.frames} new frames, and nonzero audio from both peers.`;
      });
      await step('Add and stop a second shared stream', async () => {
        const dest = c!.createMediaStreamDestination(),
          osc = c!.createOscillator();
        osc.frequency.value = 550;
        osc.connect(dest);
        osc.start();
        extra = dest.stream;
        resources.push(extra);
        a!.setStreams([stream!, extra]);
        await until(() => seen.has(extra!.id));
        await until(() => receivedRms(extra!.id) > 0.005, 8000);
        await until(
          () =>
            receivedRms(stream!.id) > 0.005 && receivedRms(trackB.id) > 0.005,
          8000,
        ).catch(() => {
          throw new Error('Original audio missing while sharing. ' + graph());
        });
        a!.setStreams([stream!]);
        await until(
          () =>
            a!.pc.signalingState === 'stable' &&
            !seen.has(extra!.id) &&
            !a!.pc
              .getSenders()
              .some((s) => s.track === extra!.getAudioTracks()[0]),
        );
        extra.getTracks().forEach((t) => t.stop());
        osc.stop();
        await until(() => receivedRms(stream!.id) > 0.005, 8000).catch(() => {
          throw new Error(
            'Original audio did not resume after sharing stopped. Context ' +
              c!.state +
              '; received streams ' +
              [...seen.values()]
                .map(
                  (s) =>
                    s.id +
                    ':' +
                    s
                      .getAudioTracks()
                      .map((t) => t.readyState + '/' + t.muted)
                      .join(','),
                )
                .join('; '),
          );
        });
        return 'Second stream delivered audible PCM, then disappeared from the receiver. Original audio continued.';
      });
      await step('Disconnect stays disconnected', async () => {
        a!.close();
        b!.close();
        a!.setStreams([stream!]);
        a!.restart();
        await a!.receive({ description: { type: 'offer', sdp: '' } });
        await pause(250);
        if (
          a!.pc.connectionState !== 'closed' ||
          b!.pc.connectionState !== 'closed' ||
          a!.streams.size ||
          b!.streams.size
        )
          throw new Error('Closed peers retained active media.');
        return 'Late offers, restart requests, and stream changes did not revive either connection.';
      });
      report(
        'Cloudflare relay across separate networks',
        'pending',
        'The local test does not use a relay. Relay-only media and connections between separate devices and networks still require testing.',
      );
      report(
        'Real microphone, camera, and screen capture',
        'pending',
        'Generated media was used. Permission prompts, hardware capture, and long sessions still need device testing.',
      );
      setProgress('Local checks complete');
      setCompleted(new Date().toISOString());
    } catch (e: any) {
      if (epoch === generation.current)
        setProgress('Check ended: ' + e.message);
    } finally {
      dispose();
      if (epoch === generation.current) setRunning(false);
    }
  }
  return (
    <div className="diagnostics">
      <div className="diagnostic-intro">
        <Activity size={34} />
        <div>
          <h2>Sound check. Connection check.</h2>
          <p>
            Run the real studio renderer and room connection engine using
            generated sound and video. Your camera and microphone stay off. No
            test media is saved or sent to another person.
          </p>
        </div>
      </div>
      <div className="actions">
        <button className="button primary" disabled={running} onClick={run}>
          <Play size={16} /> Run local checks
        </button>
        {running && (
          <button className="button secondary" onClick={stop}>
            <Square size={15} /> Stop check
          </button>
        )}
        {results.length > 0 && !running && (
          <button
            className="button secondary"
            onClick={() =>
              download(
                new Blob(
                  [
                    JSON.stringify(
                      {
                        completed,
                        browser: navigator.userAgent,
                        scope:
                          'same-browser generated media; no TURN or hardware validation',
                        results,
                      },
                      null,
                      2,
                    ),
                  ],
                  { type: 'application/json' },
                ),
                'SESSION-connection-check.json',
              )
            }
          >
            <Download size={16} /> Download results
          </button>
        )}
      </div>
      <p role="status" className="diagnostic-progress">
        {progress}
      </p>
      <div className="diagnostic-videos">
        <video
          ref={videoA}
          autoPlay
          muted
          playsInline
          aria-label="Generated remote video A"
        />
        <video
          ref={videoB}
          autoPlay
          muted
          playsInline
          aria-label="Generated remote video B"
        />
      </div>
      <canvas
        ref={fixture}
        width={320}
        height={180}
        className="diagnostic-canvas"
        aria-hidden="true"
      />
      <div className="diagnostic-results">
        {results.map((r, i) => (
          <article key={i} className={r.status}>
            <span>
              {r.status === 'passed' ? (
                <CheckCircle2 size={18} />
              ) : (
                <Activity size={18} />
              )}{' '}
              {r.status}
            </span>
            <div>
              <h3>{r.name}</h3>
              <p>{r.detail}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="small-note">
        A successful local check confirms this browser can render audio and
        exchange media internally. It does not establish compatibility with
        every device, cross-network reliability, or a latency guarantee.
      </p>
    </div>
  );
}
