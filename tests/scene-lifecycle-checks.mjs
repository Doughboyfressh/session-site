import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadTS } from './load-ts.mjs';

// Execute the whole production component with synthetic hooks, DOM, observers,
// and Three resources. No browser, GPU, audio device, or network is involved.
const source = ts.transpileModule(fs.readFileSync('app/scene-3d.tsx', 'utf8'), {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const layout = loadTS('lib/scene-layout.ts');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function fixture({
  reduced = false,
  pendingImport = false,
  setupFailure = false,
} = {}) {
  const renderers = [],
    resources = [],
    targets = [],
    observers = [],
    hooks = [];
  const gate = pendingImport ? deferred() : null;
  let cursor = 0,
    mounted = false,
    lateStateWrites = 0,
    importRequests = 0,
    now = 100;

  class Target {
    constructor() {
      this.listeners = new Map();
      this.attributes = new Map();
      this.style = {};
      this.children = [];
      this.clientWidth = 340;
      this.clientHeight = 168;
      targets.push(this);
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    removeEventListener(name, fn) {
      this.listeners.get(name)?.delete(fn);
    }
    dispatch(name, event = {}) {
      for (const fn of this.listeners.get(name) || []) fn(event);
    }
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
    }
    remove() {
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
    }
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: this.clientWidth,
        height: this.clientHeight,
      };
    }
    listenerCount() {
      return [...this.listeners.values()].reduce(
        (sum, set) => sum + set.size,
        0,
      );
    }
  }
  const host = new Target();
  const media = new Target();
  media.matches = reduced;
  const window = new Target();
  window.devicePixelRatio = 1;
  window.matchMedia = () => media;

  class Resource {
    constructor() {
      this.disposeCount = 0;
      resources.push(this);
    }
    dispose() {
      this.disposeCount++;
    }
  }
  class Geometry extends Resource {
    constructor(width, height) {
      super();
      this.width = width;
      this.height = height;
    }
  }
  class Group {
    constructor() {
      this.children = [];
      this.rotation = { x: 0, y: 0 };
    }
    add(...children) {
      this.children.push(...children);
    }
  }
  class Mesh {
    constructor(geometry) {
      this.geometry = geometry;
      this.position = { x: 0, y: 0 };
      this.scale = { y: 1 };
    }
  }
  class Light {
    constructor() {
      this.position = { set() {} };
    }
  }
  class Camera {
    constructor(fov) {
      this.fov = fov;
      this.position = { set() {} };
    }
    lookAt() {}
    updateProjectionMatrix() {}
  }
  class Renderer {
    constructor() {
      if (setupFailure) throw Error('Synthetic unavailable WebGL');
      this.domElement = new Target();
      this.frames = [];
      this.disposeCount = 0;
      renderers.push(this);
    }
    setPixelRatio() {}
    setSize(width, height) {
      this.width = width;
      this.height = height;
    }
    setAnimationLoop(callback) {
      this.loop = callback;
    }
    render(scene) {
      if (this.renderFailure) throw Error('Synthetic render failure');
      const meshes = scene.children.flatMap((child) => child.children || []);
      this.frames.push({
        width: this.width,
        height: this.height,
        heights: meshes
          .filter((mesh) => mesh.geometry?.height === 1)
          .map((mesh) => mesh.scale.y),
      });
    }
    dispose() {
      this.disposeCount++;
    }
  }
  class Observer {
    constructor(callback, kind) {
      this.callback = callback;
      this.kind = kind;
      this.disconnected = false;
      observers.push(this);
    }
    observe(element) {
      this.element = element;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const three = {
    WebGLRenderer: Renderer,
    Scene: Group,
    Group,
    PerspectiveCamera: Camera,
    Mesh,
    MeshStandardMaterial: Resource,
    BoxGeometry: Geometry,
    DirectionalLight: Light,
    AmbientLight: Light,
  };
  const react = {
    useRef(value) {
      const index = cursor++;
      return (hooks[index] ||= { ref: { current: value } }).ref;
    },
    useState(value) {
      const index = cursor++;
      const entry = (hooks[index] ||= { value });
      return [
        entry.value,
        (next) => {
          if (!mounted) lateStateWrites++;
          entry.value = typeof next === 'function' ? next(entry.value) : next;
        },
      ];
    },
    useEffect(create, deps) {
      const index = cursor++;
      const entry = (hooks[index] ||= {});
      if (!entry.deps || deps.some((value, i) => value !== entry.deps[i]))
        entry.pending = true;
      entry.create = create;
      entry.deps = deps;
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime')
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (id === '@/lib/scene-layout') return layout;
      if (id === 'three') {
        importRequests++;
        return gate?.promise || three;
      }
      throw Error('Unexpected component dependency: ' + id);
    },
    window,
    ResizeObserver: class extends Observer {
      constructor(callback) {
        super(callback, 'resize');
      }
    },
    IntersectionObserver: class extends Observer {
      constructor(callback) {
        super(callback, 'intersection');
      }
    },
    performance: { now: () => now },
  });
  const getSpectrum = () => [0, 0.5, 1];
  const render = () => {
    cursor = 0;
    const tree = exports.default({
      variant: 'visualizer',
      label: 'Synthetic spectrum',
      getSpectrum,
    });
    tree.props.ref.current = host;
    return tree;
  };
  const runEffects = () => {
    for (const entry of hooks)
      if (entry.pending) {
        entry.cleanup?.();
        entry.cleanup = entry.create();
        entry.pending = false;
      }
  };
  const cleanup = () => {
    for (const entry of hooks) entry.cleanup?.();
  };
  return {
    host,
    media,
    renderers,
    resources,
    observers,
    three,
    gate,
    render,
    get importRequests() {
      return importRequests;
    },
    get lateStateWrites() {
      return lateStateWrites;
    },
    mount() {
      mounted = true;
      render();
      runEffects();
    },
    replayEffects() {
      cleanup();
      for (const entry of hooks) if (entry.create) entry.pending = true;
      runEffects();
    },
    unmount() {
      cleanup();
      mounted = false;
    },
    motion(value) {
      media.matches = value;
      media.dispatch('change');
    },
    resize(width, height) {
      host.clientWidth = width;
      host.clientHeight = height;
      for (const observer of observers)
        if (observer.kind === 'resize' && !observer.disconnected)
          observer.callback([]);
    },
    visibility(value) {
      for (const observer of observers)
        if (observer.kind === 'intersection' && !observer.disconnected)
          observer.callback([{ isIntersecting: value }]);
    },
    frame() {
      now += 16;
      renderers.at(-1)?.loop?.();
    },
    assertReleased() {
      assert.equal(host.children.length, 0, 'cleanup removes canvases');
      assert.ok(
        renderers.every(
          (renderer) => renderer.loop === null && renderer.disposeCount === 1,
        ),
        'renderers stop and dispose exactly once',
      );
      assert.ok(
        resources.every((resource) => resource.disposeCount === 1),
        'geometry and materials dispose exactly once',
      );
      assert.ok(
        observers.every((observer) => observer.disconnected),
        'all observers disconnect',
      );
      assert.ok(
        targets.every((target) => target.listenerCount() === 0),
        'all scene event listeners are removed',
      );
    },
    assertFallback() {
      const tree = render();
      assert.equal(tree.props['data-scene-state'], 'fallback');
      assert.equal(tree.props.role, 'img');
      assert.equal(tree.props['aria-label'], 'Synthetic spectrum');
      assert.equal(
        tree.props.children.type,
        'svg',
        'failure leaves the static artwork available',
      );
      assert.equal(
        tree.props.children.props['aria-hidden'],
        'true',
        'fallback uses the shared accessible label',
      );
    },
  };
}

const canceled = fixture({ pendingImport: true });
canceled.mount();
await flush();
assert.equal(canceled.importRequests, 1, 'the scene is waiting for its import');
canceled.unmount();
canceled.gate.resolve(canceled.three);
await flush();
assert.equal(
  canceled.renderers.length,
  0,
  'a resolved import cannot initialize an unmounted scene',
);
assert.equal(
  canceled.lateStateWrites,
  0,
  'a resolved import cannot update an unmounted scene',
);
canceled.assertReleased();

const canceledFailure = fixture({ pendingImport: true });
canceledFailure.mount();
await flush();
canceledFailure.unmount();
canceledFailure.gate.reject(Error('Synthetic import failure after unmount'));
await flush();
assert.equal(
  canceledFailure.lateStateWrites,
  0,
  'a rejected import cannot update an unmounted scene',
);
canceledFailure.assertReleased();

const strict = fixture({ pendingImport: true });
strict.mount();
await flush();
strict.replayEffects();
await flush();
strict.gate.resolve(strict.three);
await flush();
assert.equal(
  strict.renderers.length,
  1,
  'StrictMode effect replay initializes one live renderer',
);
assert.equal(strict.host.children.length, 1, 'StrictMode leaves one canvas');
const renderer = strict.renderers[0];
assert.equal(renderer.domElement.attributes.get('aria-hidden'), 'true');
assert.equal(strict.render().props['data-scene-state'], 'ready');
assert.equal(typeof renderer.loop, 'function', 'normal motion starts the loop');
strict.visibility(false);
assert.equal(renderer.loop, null, 'hidden scenes pause');
strict.visibility(true);
assert.equal(typeof renderer.loop, 'function', 'visible scenes resume');
strict.frame();
strict.motion(true);
assert.equal(renderer.loop, null, 'changing to reduced motion stops the loop');
const staticFrames = renderer.frames.length;
strict.frame();
assert.equal(
  renderer.frames.length,
  staticFrames,
  'reduced motion remains static between explicit updates',
);
strict.resize(200, 150);
assert.equal(
  renderer.frames.length,
  staticFrames + 1,
  'reduced motion redraws after resize',
);
assert.deepEqual(renderer.frames.at(-1), {
  ...renderer.frames.at(-2),
  width: 200,
  height: 150,
});
strict.motion(false);
assert.equal(
  typeof renderer.loop,
  'function',
  'disabling reduced motion resumes animation',
);
let prevented = false;
renderer.domElement.dispatch('webglcontextlost', {
  preventDefault() {
    prevented = true;
  },
});
assert.equal(prevented, true);
strict.assertFallback();
strict.assertReleased();
const failedFrames = renderer.frames.length;
for (const observer of strict.observers)
  observer.callback([{ isIntersecting: true }]);
assert.equal(
  renderer.frames.length,
  failedFrames,
  'queued observer callbacks cannot render after failure',
);
strict.unmount();
strict.assertReleased();

const staticScene = fixture({ reduced: true });
staticScene.mount();
await flush();
const staticRenderer = staticScene.renderers[0];
assert.equal(
  staticRenderer.loop,
  null,
  'an initially reduced-motion scene has no animation loop',
);
assert.equal(staticRenderer.frames.length, 1);
assert.ok(
  new Set(staticRenderer.frames[0].heights).size > 1,
  'the first static frame has initialized spectrum heights',
);
staticScene.resize(500, 180);
assert.equal(staticRenderer.frames.length, 2);
assert.equal(staticRenderer.frames.at(-1).width, 500);
assert.equal(staticRenderer.frames.at(-1).height, 180);
staticScene.unmount();
staticScene.assertReleased();

const renderFailure = fixture();
renderFailure.mount();
await flush();
renderFailure.renderers[0].renderFailure = true;
renderFailure.frame();
renderFailure.assertFallback();
renderFailure.assertReleased();
renderFailure.unmount();
renderFailure.assertReleased();

const setupFailure = fixture({ setupFailure: true });
setupFailure.mount();
await flush();
setupFailure.assertFallback();
setupFailure.assertReleased();
setupFailure.unmount();

const importFailure = fixture({ pendingImport: true });
importFailure.mount();
await flush();
importFailure.gate.reject(Error('Synthetic import failure'));
await flush();
importFailure.assertFallback();
importFailure.assertReleased();
importFailure.unmount();

const remounted = fixture();
remounted.mount();
await flush();
assert.equal(
  remounted.host.children.length,
  1,
  'a fresh mount remains usable after earlier cleanup',
);
assert.equal(remounted.render().props['data-scene-state'], 'ready');
remounted.unmount();
remounted.assertReleased();

console.log(
  'PASS: actual Scene3D lifecycle with synthetic imports, StrictMode replay, static resize, motion changes, context/render/setup/import failures, and unmount cleanup.',
);
