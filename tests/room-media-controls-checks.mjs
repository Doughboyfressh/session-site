import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { RoomMediaControls } from '../lib/room-media-controls.ts';

let checks = 0;
const eq = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
class Track {
  constructor(kind, enabled = true) {
    this.kind = kind;
    this.enabled = enabled;
    this.readyState = 'live';
    this.stops = 0;
  }
  stop() {
    this.readyState = 'ended';
    this.stops++;
  }
}
class Stream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}
const previousStream = globalThis.MediaStream;
globalThis.MediaStream = Stream;

// Exercise the actual Room switch functions and control handlers without
// rendering React or ever asking a browser for camera/microphone permission.
const source = fs.readFileSync('app/room.tsx', 'utf8');
const tree = ts.createSourceFile(
  'room.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functions = new Map();
const toggles = new Map();
const visit = (node) => {
  if (
    ts.isFunctionDeclaration(node) &&
    ['switchMic', 'switchCam'].includes(node.name?.text)
  )
    functions.set(node.name.text, node.getText(tree));
  if (
    ts.isJsxAttribute(node) &&
    node.name.getText(tree) === 'onClick' &&
    node.initializer &&
    ts.isJsxExpression(node.initializer)
  ) {
    const handler = node.initializer.expression;
    if (handler && ts.isArrowFunction(handler))
      for (const kind of ['audio', 'video'])
        if (
          new RegExp(`setEnabled\\(\\s*'${kind}'`).test(handler.getText(tree))
        )
          toggles.set(kind, handler.getText(tree));
  }
  ts.forEachChild(node, visit);
};
visit(tree);
eq([...functions.keys()].sort(), ['switchCam', 'switchMic']);
eq([...toggles.keys()].sort(), ['audio', 'video']);
const extracted = ts.transpileModule(
  `${[...functions.values()].join('\n')}\n` +
    `({ switchMic, switchCam, audio: ${toggles.get('audio')}, video: ${toggles.get('video')} })`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

function fixture(kind, enabled = true, senderOptions = [{}]) {
  const oldAudio = new Track('audio');
  const oldVideo = new Track('video');
  const old = kind === 'audio' ? oldAudio : oldVideo;
  const carried = kind === 'audio' ? oldVideo : oldAudio;
  const original = new Stream([oldAudio, oldVideo]);
  const localRef = { current: original };
  const controls = new RoomMediaControls();
  controls.setEnabled(kind, enabled, original);
  const next = new Track(kind);
  const captured = new Stream([next]);
  const exposures = [],
    notices = [],
    constraints = [],
    replacements = [];
  const senders = senderOptions.map((options) => ({
    track: old,
    async replaceTrack(track) {
      replacements.push({
        track,
        enabled: track?.enabled,
        oldState: old.readyState,
      });
      if (track === next && options.gate) await options.gate.promise;
      if (track === next && options.fail)
        throw new Error('Synthetic replacement failure');
      this.track = track;
    },
  }));
  const f = {
    kind,
    old,
    carried,
    original,
    localRef,
    controls,
    next,
    captured,
    exposures,
    notices,
    constraints,
    replacements,
    senders,
    generation: { current: 3 },
    session: { current: 'synthetic-call' },
    alive: { current: true },
    gum: async () => captured,
    ui: enabled,
    updates: 0,
  };
  const room = vm.runInNewContext(extracted, {
    mediaControls: { current: controls },
    localRef,
    generation: f.generation,
    session: f.session,
    alive: f.alive,
    camQuality: '360',
    stateRef: { current: { sessions: [] } },
    navigator: {
      mediaDevices: {
        getUserMedia: (value) => {
          constraints.push(value);
          return f.gum();
        },
      },
    },
    links: () => [{ pc: { getSenders: () => senders } }],
    microphones: { set: () => {} },
    setChosenMic: () => {},
    setChosenCam: () => {},
    setLocal: (stream) =>
      exposures.push(
        stream.getTracks().map((t) => ({ kind: t.kind, enabled: t.enabled })),
      ),
    setCallNotice: (message) => notices.push(message),
    setMic: (value) => {
      f.ui = value;
    },
    setCam: (value) => {
      f.ui = value;
    },
    updateStreams: () => {
      f.updates++;
    },
    syncPeers: () => {},
  });
  f.switch = (quality = '360') =>
    kind === 'audio'
      ? room.switchMic('synthetic-device')
      : room.switchCam('synthetic-device', quality);
  f.toggle = () => room[kind]();
  f.disconnect = () => {
    f.generation.current++;
    f.session.current = '';
    controls.cancelPending();
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
  };
  return f;
}

try {
  for (const kind of ['audio', 'video']) {
    for (const enabled of [false, true]) {
      const f = fixture(kind, enabled);
      await f.switch(kind === 'video' ? '720' : '360');
      eq(f.next.enabled, enabled);
      eq(f.replacements[0].enabled, enabled);
      eq(f.replacements[0].oldState, 'live');
      eq(
        f.exposures.at(-1).find((track) => track.kind === kind).enabled,
        enabled,
      );
      eq(f.localRef.current.getTracks().includes(f.carried), true);
      eq(f.old.readyState, 'ended');
      eq(f.next.readyState, 'live');
      eq(f.ui, enabled);
      eq(f.updates, 1);
      if (kind === 'video') {
        eq(f.constraints[0].video.width.ideal, 1280);
        eq(f.constraints[0].video.height.ideal, 720);
      } else eq(f.constraints[0].video, false);
    }

    // Each direction matters: acquisition must read current intent, not the
    // closure from when the user opened settings or began getUserMedia.
    for (const initial of [true, false]) {
      const f = fixture(kind, initial);
      const capture = deferred();
      f.gum = () => capture.promise;
      const switching = f.switch();
      f.toggle();
      eq(f.old.enabled, !initial);
      capture.resolve(f.captured);
      await switching;
      eq(f.next.enabled, !initial);
      eq(f.replacements[0].enabled, !initial);
      eq(
        f.exposures.at(-1).find((track) => track.kind === kind).enabled,
        !initial,
      );
      eq(f.ui, !initial);
    }

    const gate = deferred();
    const pending = fixture(kind, true, [{ gate }]);
    const switching = pending.switch();
    await flush();
    eq(pending.replacements.length, 1);
    pending.toggle();
    eq(pending.next.enabled, false);
    eq(pending.old.enabled, false);
    eq(pending.exposures.length, 0);
    gate.resolve();
    await switching;
    eq(
      pending.exposures.at(-1).find((track) => track.kind === kind).enabled,
      false,
    );

    const stoppedGate = deferred();
    const stoppedDuringReplacement = fixture(kind, true, [
      { gate: stoppedGate },
    ]);
    const interrupted = stoppedDuringReplacement.switch();
    await flush();
    stoppedDuringReplacement.next.stop();
    stoppedGate.resolve();
    await interrupted;
    eq(
      stoppedDuringReplacement.localRef.current,
      stoppedDuringReplacement.original,
    );
    eq(stoppedDuringReplacement.senders[0].track, stoppedDuringReplacement.old);
    eq(stoppedDuringReplacement.old.readyState, 'live');
    eq(stoppedDuringReplacement.exposures.length, 0);

    const failing = fixture(kind, false, [{}, { fail: true }]);
    await failing.switch();
    eq(failing.localRef.current, failing.original);
    eq(
      failing.senders.map((sender) => sender.track),
      [failing.old, failing.old],
    );
    eq(failing.old.readyState, 'live');
    eq(failing.old.enabled, false);
    eq(failing.next.readyState, 'ended');
    eq(failing.exposures.length, 0);
    eq(failing.notices.at(-1), 'Synthetic replacement failure');

    const rejected = fixture(kind, false);
    rejected.gum = async () => {
      throw new Error('Synthetic acquisition failure');
    };
    await rejected.switch();
    eq(rejected.old.readyState, 'live');
    eq(rejected.localRef.current, rejected.original);
    eq(rejected.replacements.length, 0);
    eq(rejected.notices.at(-1), 'Synthetic acquisition failure');

    for (const stopped of [false, true]) {
      const invalid = fixture(kind);
      const extra = new Track(kind === 'audio' ? 'video' : 'audio');
      if (stopped) invalid.next.stop();
      invalid.gum = async () =>
        new Stream(stopped ? [invalid.next, extra] : [extra]);
      await invalid.switch();
      eq(extra.readyState, 'ended');
      eq(invalid.exposures.length, 0);
      eq(invalid.old.readyState, 'live');
      eq(invalid.replacements.length, 0);
    }

    const ended = fixture(kind);
    const capture = deferred();
    ended.gum = () => capture.promise;
    const ending = ended.switch();
    ended.disconnect();
    capture.resolve(ended.captured);
    await ending;
    eq(ended.next.readyState, 'ended');
    eq(ended.localRef.current, null);
    eq(ended.exposures.length, 0);
    eq(ended.replacements.length, 0);
    eq(ended.notices.length, 0);

    const replaceGate = deferred();
    const endingSender = fixture(kind, true, [{ gate: replaceGate }]);
    const endingReplacement = endingSender.switch();
    await flush();
    endingSender.disconnect();
    eq(endingSender.next.readyState, 'ended');
    replaceGate.resolve();
    await endingReplacement;
    eq(endingSender.exposures.length, 0);
    eq(endingSender.localRef.current, null);
    eq(endingSender.notices.length, 0);

    const earlier = fixture(kind, false);
    const firstCapture = deferred();
    const latest = new Track(kind);
    let captures = 0;
    earlier.gum = () =>
      ++captures === 1
        ? firstCapture.promise
        : Promise.resolve(new Stream([latest]));
    const first = earlier.switch();
    await earlier.switch();
    firstCapture.resolve(earlier.captured);
    await first;
    eq(earlier.localRef.current.getTracks().includes(latest), true);
    eq(latest.enabled, false);
    eq(earlier.next.readyState, 'ended');
    eq(earlier.exposures.length, 1);

    // A superseded replacement must finish restoring its sender before the
    // next switch adopts that sender; it cannot roll back the newer track.
    const overlapGate = deferred();
    const overlap = fixture(kind, false, [{ gate: overlapGate }]);
    const newerTrack = new Track(kind);
    let overlapCaptures = 0;
    overlap.gum = async () =>
      ++overlapCaptures === 1 ? overlap.captured : new Stream([newerTrack]);
    const obsolete = overlap.switch();
    await flush();
    const newest = overlap.switch();
    await flush();
    overlap.toggle();
    eq(overlap.next.enabled, true);
    eq(newerTrack.enabled, true);
    overlapGate.resolve();
    await Promise.all([obsolete, newest]);
    eq(overlap.localRef.current.getTracks().includes(newerTrack), true);
    eq(overlap.senders[0].track, newerTrack);
    eq(overlap.next.readyState, 'ended');
    eq(newerTrack.readyState, 'live');
    eq(overlap.exposures.length, 1);

    const extras = fixture(kind, false);
    const extra = new Track(kind === 'audio' ? 'video' : 'audio');
    extras.gum = async () => new Stream([extras.next, extra]);
    await extras.switch();
    eq(extra.readyState, 'ended');
    eq(extras.next.readyState, 'live');

    const disconnected = fixture(kind);
    disconnected.disconnect();
    await disconnected.switch();
    eq(disconnected.constraints.length, 0);
    eq(disconnected.exposures.length, 0);
  }

  const concurrent = fixture('audio', false);
  concurrent.controls.setEnabled('video', false, concurrent.localRef.current);
  const video = new Track('video');
  const videoSender = {
    track: concurrent.carried,
    async replaceTrack(track) {
      this.track = track;
    },
  };
  concurrent.senders.push(videoSender);
  const cameraSwitch = concurrent.controls.switchTrack(
    'video',
    async () => new Stream([video]),
    {
      isCurrent: () => true,
      local: () => concurrent.localRef.current,
      senders: () => concurrent.senders,
      publish: (stream) => {
        concurrent.localRef.current = stream;
      },
    },
  );
  await Promise.all([concurrent.switch(), cameraSwitch]);
  eq(concurrent.localRef.current.getAudioTracks()[0], concurrent.next);
  eq(concurrent.localRef.current.getVideoTracks()[0], video);
  eq(concurrent.next.enabled, false);
  eq(video.enabled, false);
  eq(concurrent.old.readyState, 'ended');
  eq(concurrent.carried.readyState, 'ended');

  const audioOnly = fixture('video', false, []);
  audioOnly.localRef.current = new Stream([audioOnly.carried]);
  await audioOnly.switch();
  eq(audioOnly.next.enabled, false);
  eq(audioOnly.localRef.current.getVideoTracks()[0], audioOnly.next);
  eq(audioOnly.updates, 1);
  console.log(
    `PASS: ${checks} room device-switch privacy and cleanup assertions (synthetic media only).`,
  );
} finally {
  if (previousStream === undefined) delete globalThis.MediaStream;
  else globalThis.MediaStream = previousStream;
}
