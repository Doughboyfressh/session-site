import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioBroadcast, RoomMicrophones } from '../lib/room-audio';
import {
  TakeCapture,
  type CapturePhase,
  type RecordedTake,
} from '../lib/recording';
import { PeerLink } from '../lib/peer';
import { defaults, playMix } from '../lib/audio';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(test: () => boolean, label: string, ms = 12000) {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() > end) throw new Error('Timeout: ' + label);
    await delay(30);
  }
}
async function tone(frequency: number) {
  const c = new AudioContext({ sampleRate: 48000 }),
    oscillator = c.createOscillator(),
    gain = c.createGain(),
    destination = c.createMediaStreamDestination();
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.15;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  await c.resume();
  return {
    c,
    gain,
    stream: destination.stream,
    close: () => {
      oscillator.stop();
      destination.stream.getTracks().forEach((t) => t.stop());
      void c.close();
    },
  };
}
function probe(c: AudioContext, stream: MediaStream) {
  // Match the production MediaTile's active media element without making
  // synthetic test tones audible on the user's speakers.
  const player = new Audio();
  player.srcObject = stream;
  player.volume = 0;
  void player.play();
  const source = c.createMediaStreamSource(stream),
    analyser = c.createAnalyser();
  analyser.fftSize = 4096;
  source.connect(analyser);
  const silent = c.createGain();
  silent.gain.value = 0;
  analyser.connect(silent).connect(c.destination);
  const values = new Float32Array(analyser.frequencyBinCount);
  return {
    energy: (hz: number) => {
      analyser.getFloatFrequencyData(values);
      const bin = Math.round((hz * analyser.fftSize) / c.sampleRate);
      return Math.max(...values.slice(bin - 2, bin + 3));
    },
    close: () => {
      source.disconnect();
      analyser.disconnect();
      silent.disconnect();
      player.pause();
      player.srcObject = null;
    },
  };
}
function App() {
  const [lines, setLines] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const log = (message: string) => setLines((old) => [...old, message]);
  async function run() {
    setBusy(true);
    setLines([]);
    let count = 0;
    const check = (value: boolean, message: string) => {
      if (!value) throw new Error(message);
      count++;
      log('PASS ' + message);
    };
    const cleanups: (() => void)[] = [];
    const bus = new StudioBroadcast(),
      microphones = new RoomMicrophones();
    cleanups.push(
      () => bus.dispose(),
      () => microphones.end(),
    );
    try {
      const voice = await tone(440),
        music = await tone(880),
        opposite = await tone(660);
      cleanups.push(voice.close, music.close, opposite.close);
      const original = voice.stream.getAudioTracks()[0];
      const settings = JSON.stringify(original.getSettings());
      let originalEnded = 0;
      original.onended = () => originalEnded++;
      microphones.set(voice.stream);
      original.enabled = false;
      const lease = microphones.acquire();
      check(
        lease.stream.getAudioTracks()[0] !== original,
        'Recorder receives its own track clone',
      );
      check(
        !original.enabled && lease.stream.getAudioTracks()[0].enabled,
        'Explicit recording input does not change call mute',
      );
      lease.release();
      check(
        original.readyState === 'live' && originalEnded === 0,
        'Releasing recorder clone leaves call microphone live',
      );
      check(
        JSON.stringify(original.getSettings()) === settings,
        'Recording lease preserves call input settings',
      );
      original.enabled = true;
      const endLease = microphones.acquire();
      microphones.end();
      check(
        endLease.signal.aborted &&
          endLease.stream.getAudioTracks()[0].readyState === 'ended',
        'Room disconnect aborts and stops recorder clones',
      );
      check(
        original.readyState === 'live',
        'Lease manager never stops room-owned source',
      );
      microphones.set(voice.stream);

      let phase: CapturePhase = 'idle',
        take: RecordedTake | null = null,
        error = '';
      let mediaCalls = 0;
      const capture = new TakeCapture(
        {
          state: (p) => {
            phase = p;
          },
          level: () => {},
          progress: () => {},
          take: (t) => {
            take = t;
          },
          error: (e) => {
            error = e;
          },
        },
        {
          context: () => new AudioContext({ sampleRate: 48000 }),
          media: async () => {
            mediaCalls++;
            throw Error('Unexpected microphone request');
          },
          acquire: microphones.acquire,
          output: bus.output,
        },
      );
      cleanups.push(() => capture.dispose());
      await capture.connect();
      check(
        String(phase) === 'ready',
        'Recorder enables through existing room input',
      );
      await capture.start({ bpm: 240, tracks: [] }, 0, 0);
      await wait(() => phase === 'recording', 'recording started');
      await delay(250);
      capture.finish();
      await wait(() => !!take, 'local take completed');
      check(
        original.readyState === 'live' && voice.c.state === 'running',
        'Completed take leaves call source and context running',
      );
      check(
        mediaCalls === 0,
        'Embedded recording never requests a second microphone',
      );
      capture.cancel();
      await capture.connect();
      take = null;
      const backingStream = await bus.enable();
      const backingProbe = probe(voice.c, backingStream);
      cleanups.push(backingProbe.close);
      await capture.start(
        {
          bpm: 240,
          tracks: [
            {
              ...defaults('Backing'),
              notes: [
                {
                  id: 'backing-note',
                  pitch: 57,
                  start: 0,
                  length: 16,
                  velocity: 0.8,
                },
              ],
              sound: 'keys',
            },
          ],
        },
        0,
        0,
      );
      await wait(
        () => phase === 'recording' && backingProbe.energy(220) > -55,
        'recording backing enters room bus',
      );
      check(
        true,
        'Recording backing reaches the music bus across its separate context',
      );
      await delay(300);
      capture.finish();
      await wait(() => !!take, 'backed take completed');
      const decoded = await voice.c.decodeAudioData(
        await (take as unknown as RecordedTake).blob.arrayBuffer(),
      );
      const pcm = decoded.getChannelData(0);
      const amplitude = (frequency: number) => {
        let sin = 0,
          cos = 0;
        const size = Math.min(pcm.length, 8192);
        for (let i = 0; i < size; i++) {
          const angle = (2 * Math.PI * frequency * i) / decoded.sampleRate;
          sin += pcm[i] * Math.sin(angle);
          cos += pcm[i] * Math.cos(angle);
        }
        return (Math.hypot(sin, cos) * 2) / size;
      };
      check(
        amplitude(440) > 0.05 && amplitude(220) < 0.005,
        'Completed room take contains microphone audio without the shared backing',
      );
      bus.disable();
      capture.cancel();
      await capture.connect();
      microphones.end();
      check(
        String(phase) === 'error' && error.includes('room microphone'),
        'Call disconnect visibly cancels active recorder input',
      );
      check(
        original.readyState === 'live' && !!original.onended,
        'Cancellation leaves original microphone handlers and track intact',
      );

      const releaseOutput = bus.output(music.gain);
      cleanups.push(releaseOutput);
      const stream = await bus.enable();
      const receiver = new AudioContext({ sampleRate: 48000 });
      await receiver.resume();
      cleanups.push(() => {
        void receiver.close();
      });
      const direct = probe(receiver, stream);
      cleanups.push(direct.close);
      await wait(() => direct.energy(880) > -45, 'direct music bridge');
      check(
        direct.energy(440) < -65,
        'Studio bus excludes the room microphone',
      );

      const received = new Map<
          string,
          { stream: MediaStream; role?: string }
        >(),
        reverse = new Map<string, MediaStream>();
      let a: PeerLink, b: PeerLink;
      a = new PeerLink(
        'a',
        'b',
        { iceServers: [] },
        {
          send: async (body) => {
            await delay(25);
            void b.receive(structuredClone(body));
          },
          stream: (stream, remove) => {
            if (remove) reverse.delete(stream.id);
            else reverse.set(stream.id, stream);
          },
          state: () => {},
        },
      );
      b = new PeerLink(
        'b',
        'a',
        { iceServers: [] },
        {
          send: async (body) => {
            await delay(25);
            void a.receive(structuredClone(body));
          },
          stream: (stream, remove, role) => {
            if (remove) received.delete(stream.id);
            else received.set(stream.id, { stream, role });
          },
          state: () => {},
        },
      );
      cleanups.push(
        () => a.close(),
        () => b.close(),
      );
      a.setStreams([voice.stream, stream], { [stream.id]: 'music' });
      b.setStreams([opposite.stream]);
      await wait(
        () =>
          a.pc.connectionState === 'connected' &&
          b.pc.connectionState === 'connected',
        'actual loopback RTC',
      );
      await wait(
        () =>
          received.has(voice.stream.id) &&
          received.has(stream.id) &&
          reverse.has(opposite.stream.id),
        'separate streams in both directions',
      );
      check(
        received.get(stream.id)?.role === 'music',
        'Music stream is labeled from its accepted SDP',
      );
      const remoteMusic = probe(receiver, received.get(stream.id)!.stream),
        remoteVoice = probe(receiver, received.get(voice.stream.id)!.stream);
      cleanups.push(remoteMusic.close, remoteVoice.close);
      await delay(1200);
      log(
        'RTC probe ' +
          JSON.stringify({
            music: remoteMusic.energy(880),
            voice: remoteVoice.energy(440),
            state: receiver.state,
            stats: await b.stats(),
          }),
      );
      await wait(
        () => remoteMusic.energy(880) > -50 && remoteVoice.energy(440) > -50,
        'remote music and voice energy',
      );
      check(
        remoteMusic.energy(440) < -60 && remoteMusic.energy(660) < -60,
        'Received music excludes local and remote voices',
      );
      check(
        remoteVoice.energy(880) < -60,
        'Received voice excludes direct music routing',
      );

      const screen = document.createElement('canvas');
      screen.width = 160;
      screen.height = 90;
      const painter = screen.getContext('2d')!;
      painter.fillStyle = 'lime';
      painter.fillRect(0, 0, 160, 90);
      const screenStream = screen.captureStream(5);
      cleanups.push(() => screenStream.getTracks().forEach((t) => t.stop()));
      a.setStreams([voice.stream, stream, screenStream], {
        [stream.id]: 'music',
        [screenStream.id]: 'screen',
      });
      await wait(() => received.has(screenStream.id), 'screen added');
      check(
        received.get(screenStream.id)?.role === 'screen',
        'Screen role remains separate from music',
      );
      a.setStreams([voice.stream, stream], { [stream.id]: 'music' });
      await wait(
        () => !received.has(screenStream.id),
        'stale screen removed from accepted SDP',
      );
      check(
        remoteMusic.energy(880) > -50 && remoteVoice.energy(440) > -50,
        'Stopping screen sharing preserves music and voice',
      );
      a.restart();
      b.restart();
      await delay(800);
      await wait(
        () =>
          a.pc.connectionState === 'connected' &&
          b.pc.connectionState === 'connected',
        'ICE restart',
      );
      check(
        remoteMusic.energy(880) > -50 && remoteVoice.energy(440) > -50,
        'Music and voice survive ICE restart',
      );

      a.setStreams([voice.stream]);
      bus.disable();
      await wait(() => !received.has(stream.id), 'stopped music removed');
      check(
        received.has(voice.stream.id) && remoteVoice.energy(440) > -50,
        'Stopping music removes only its receiver and preserves voice',
      );
      check(
        music.c.state === 'running',
        'Stopping broadcast does not close the studio playback context',
      );
      const next = await bus.enable();
      a.setStreams([voice.stream, next], { [next.id]: 'music' });
      await wait(() => received.has(next.id), 'music re-enabled');
      const nextMusic = probe(receiver, received.get(next.id)!.stream);
      cleanups.push(nextMusic.close);
      await wait(() => nextMusic.energy(880) > -50, 'music after re-enable');
      check(
        received.size === 2,
        'Re-enabling sharing creates no stale or duplicate receivers',
      );
      const lateStreams = new Map<string, MediaStream>();
      let lateSender: PeerLink, lateReceiver: PeerLink;
      lateSender = new PeerLink(
        'late-a',
        'late-b',
        { iceServers: [] },
        {
          send: async (body) => {
            void lateReceiver.receive(structuredClone(body));
          },
          stream: () => {},
          state: () => {},
        },
      );
      lateReceiver = new PeerLink(
        'late-b',
        'late-a',
        { iceServers: [] },
        {
          send: async (body) => {
            void lateSender.receive(structuredClone(body));
          },
          stream: (s, remove) => {
            if (remove) lateStreams.delete(s.id);
            else lateStreams.set(s.id, s);
          },
          state: () => {},
        },
      );
      cleanups.push(
        () => lateSender.close(),
        () => lateReceiver.close(),
      );
      lateSender.setStreams([voice.stream, next], { [next.id]: 'music' });
      await wait(
        () => lateStreams.has(next.id),
        'late collaborator receives current music stream',
      );
      const lateProbe = probe(receiver, lateStreams.get(next.id)!);
      cleanups.push(lateProbe.close);
      await wait(
        () => lateProbe.energy(880) > -50,
        'late collaborator music audible',
      );
      check(
        lateProbe.energy(440) < -60,
        'A late collaborator receives isolated music without restarting the first call',
      );
      a.setStreams([voice.stream, next, screenStream], {
        [next.id]: 'music',
        [screenStream.id]: 'screen',
      });
      b.setStreams([opposite.stream, screenStream], {
        [screenStream.id]: 'screen',
      });
      await wait(
        () => received.has(screenStream.id) && reverse.has(screenStream.id),
        'simultaneous sharing with delayed signaling',
      );
      a.setStreams([voice.stream, next], { [next.id]: 'music' });
      b.setStreams([opposite.stream]);
      await wait(
        () => !received.has(screenStream.id) && !reverse.has(screenStream.id),
        'simultaneous removal',
      );
      check(
        nextMusic.energy(880) > -50,
        'Offer glare and screen toggles preserve the music stream',
      );
      releaseOutput();
      await wait(
        () => nextMusic.energy(880) < -60,
        'released output drains the RTC receive buffer',
      );
      check(
        nextMusic.energy(880) < -60,
        'Closing a studio output removes its audio from the broadcast',
      );
      bus.disable();

      let unblock!: () => void;
      const delayedContext = new AudioContext();
      const realResume = delayedContext.resume.bind(delayedContext);
      delayedContext.resume = async () => {
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
        if (delayedContext.state !== 'closed') await realResume();
      };
      const delayedBus = new StudioBroadcast(() => delayedContext);
      const pending = delayedBus.enable().then(
        () => false,
        (e) => e.name === 'AbortError',
      );
      delayedBus.disable();
      unblock();
      check(
        await pending,
        'Late audio enable cannot reactivate a cancelled broadcast',
      );
      check(
        delayedContext.state === 'closed',
        'Cancelled broadcast closes its owned context',
      );

      let taps = 0,
        releases = 0;
      const interruptedContext = new AudioContext();
      let interrupted = false;
      const interruptedBus = new StudioBroadcast(
        () => interruptedContext,
        () => {
          interrupted = true;
        },
      );
      const interruptedStream = await interruptedBus.enable();
      await interruptedContext.suspend();
      await wait(() => interrupted, 'broadcast interruption notification');
      check(
        interruptedStream.getAudioTracks()[0].readyState === 'ended',
        'Interrupted broadcast releases its outgoing track and reports recovery needed',
      );
      check(
        music.c.state === 'running',
        'Interrupted broadcast leaves source playback context untouched',
      );
      interruptedBus.dispose();
      const playback = await playMix(
        {
          bpm: 240,
          tracks: [
            {
              ...defaults('test'),
              notes: [
                { id: 'n', pitch: 69, start: 0, length: 1, velocity: 0.5 },
              ],
              sound: 'keys',
            },
          ],
        },
        undefined,
        {
          output: () => {
            taps++;
            return () => {
              releases++;
            };
          },
        },
      );
      playback.stop();
      playback.stop();
      check(
        taps === 1 && releases === 1,
        'Studio transport registers and releases its output exactly once',
      );
      log(
        `COMPLETE: ${count} room audio assertions passed. Synthetic media only; no hardware microphone or camera opened.`,
      );
    } catch (error) {
      log('FAIL: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      cleanups.reverse().forEach((close) => {
        try {
          close();
        } catch {}
      });
      setBusy(false);
    }
  }
  return (
    <main
      style={{
        color: '#d8ebce',
        background: '#142010',
        minHeight: '100vh',
        padding: 24,
        fontFamily: 'system-ui',
      }}
    >
      <h1>SESSION room audio checks</h1>
      <p>
        Synthetic sources and local RTC connections. No microphone, camera or
        uploads.
      </p>
      <button disabled={busy} onClick={run}>
        {busy ? 'Checking…' : 'Run room audio checks'}
      </button>
      <pre style={{ whiteSpace: 'pre-wrap' }} aria-live="polite">
        {lines.join('\n')}
      </pre>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
