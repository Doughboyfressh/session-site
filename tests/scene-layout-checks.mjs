import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadTS } from './load-ts.mjs';
const { sceneLayout, sceneDistance } = loadTS('lib/scene-layout.ts');
let checks = 0;
for (const variant of ['hero', 'visualizer']) {
  const layout = sceneLayout(variant);
  const spacing = layout.span / (layout.bars - 1);
  assert.ok(
    layout.barWidth < layout.capWidth && layout.capWidth < spacing,
    'adjacent bars and caps never overlap',
  );
  for (const aspect of [0.1, 0.5, 1, 1.5, 3, 6]) {
    const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 10000);
    const distance = sceneDistance(
      aspect,
      camera.fov,
      layout.span,
      layout.maxHeight,
    );
    camera.position.set(0, layout.maxHeight / 2 + distance * 0.08, distance);
    camera.lookAt(0, layout.maxHeight / 2, 0);
    camera.updateMatrixWorld();
    for (const pitch of [-0.24, 0, 0.24])
      for (const yaw of [-0.91, 0, 0.91]) {
        const rotation = new THREE.Euler(pitch, yaw, 0);
        for (const x of [-1, 1])
          for (const y of [0, layout.maxHeight + 0.12])
            for (const z of [-1, 1]) {
              const point = new THREE.Vector3(
                (x * (layout.span + layout.capWidth)) / 2,
                y,
                (z * layout.capWidth) / 2,
              )
                .applyEuler(rotation)
                .project(camera);
              assert.ok(
                Math.abs(point.x) <= 1 &&
                  Math.abs(point.y) <= 1 &&
                  point.z > -1 &&
                  point.z < 1,
                `${variant} remains framed at aspect ${aspect}, pitch ${pitch}, yaw ${yaw}`,
              );
              checks++;
            }
      }
  }
}
console.log(
  `PASS: separated equalizer bars and ${checks} camera framing checks.`,
);
