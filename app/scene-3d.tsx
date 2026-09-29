'use client';
import { useEffect, useRef, useState } from 'react';
import type * as THREE_NS from 'three';

const RED = 0xff2e43;

export default function Scene3D({
  variant = 'hero',
  getSpectrum,
  poster,
  alt = '',
  className = '',
  label,
}: {
  variant?: 'hero' | 'visualizer';
  getSpectrum?: () => number[] | null;
  poster?: string;
  alt?: string;
  className?: string;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    spectrumRef = useRef(getSpectrum);
  spectrumRef.current = getSpectrum;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      let THREE: typeof THREE_NS;
      try {
        THREE = await import('three');
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) return;

      let renderer: THREE_NS.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        });
      } catch {
        setFailed(true);
        return;
      }

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches,
        bars = variant === 'visualizer' ? 24 : 44,
        visualizer = variant === 'visualizer';

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.domElement.className = 'scene-3d-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      if (!visualizer) renderer.domElement.style.touchAction = 'pan-y';
      element.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        visualizer ? 40 : 38,
        1,
        0.1,
        120,
      );
      const world = new THREE.Group();
      scene.add(world);

      const pillarMat = new THREE.MeshStandardMaterial({
          color: 0x0c0a0a,
          metalness: 0.85,
          roughness: 0.2,
        }),
        capMat = new THREE.MeshStandardMaterial({
          color: 0x1a0507,
          emissive: RED,
          emissiveIntensity: 2,
          roughness: 0.4,
          metalness: 0.1,
        }),
        floor = new THREE.Mesh(
          new THREE.PlaneGeometry(140, 140),
          new THREE.MeshStandardMaterial({
            color: 0x060404,
            metalness: 0.9,
            roughness: 0.09,
          }),
        );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      world.add(floor);

      const barWidth = visualizer ? 0.72 : 0.48;
      const pillarGeo = new THREE.BoxGeometry(barWidth, 1, barWidth),
        capGeo = new THREE.BoxGeometry(barWidth + 0.05, 0.07, barWidth + 0.05),
        pillars: THREE_NS.Mesh[] = [],
        caps: THREE_NS.Mesh[] = [],
        span = visualizer ? 6.8 : 14.4;
      for (let i = 0; i < bars; i++) {
        const x = -span / 2 + (span / (bars - 1)) * i;
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.x = x;
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.x = x;
        pillars.push(pillar);
        caps.push(cap);
        world.add(pillar, cap);
      }

      const key = new THREE.DirectionalLight(0xffffff, visualizer ? 4.2 : 2.4);
      key.position.set(-6, 9, -5);
      const redA = new THREE.PointLight(RED, visualizer ? 160 : 90, 26);
      redA.position.set(2.6, 2.2, 3.2);
      const redB = new THREE.PointLight(RED, visualizer ? 120 : 55, 22);
      redB.position.set(-2.6, 3, 3.2);
      const rim = new THREE.DirectionalLight(0xfff3f4, visualizer ? 2.6 : 0);
      rim.position.set(4, 5, 6);
      const fill = new THREE.AmbientLight(
        0x3a1418,
        visualizer ? 2.4 : 1.1,
      );
      scene.add(key, redA, redB, rim, fill);

      if (visualizer) {
        camera.position.set(0, 2.4, 6.4);
        camera.lookAt(0, 0.9, 0);
      } else {
        camera.position.set(1.2, 2.9, 7.4);
        camera.lookAt(-0.6, 1.5, 0);
      }

      // pointer parallax + drag orbit
      let parallaxX = 0,
        parallaxY = 0,
        dragX = 0,
        dragY = 0,
        dragging = false,
        lastX = 0,
        lastY = 0;
      const onPointerMove = (event: PointerEvent) => {
        const rect = element.getBoundingClientRect();
        if (dragging) {
          dragY = Math.max(-0.7, Math.min(0.7, dragY + (event.clientX - lastX) * 0.004));
          dragX = Math.max(-0.18, Math.min(0.18, dragX + (event.clientY - lastY) * 0.002));
          lastX = event.clientX;
          lastY = event.clientY;
        } else {
          parallaxX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          parallaxY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        }
      };
      const onPointerDown = (event: PointerEvent) => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
      };
      const onPointerUp = () => {
        dragging = false;
      };
      if (!reduced) {
        element.addEventListener('pointermove', onPointerMove);
        element.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointerup', onPointerUp);
      }

      const resize = () => {
        const width = element.clientWidth || 1,
          height = element.clientHeight || 1;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(element);

      let visible = true;

      let t = 0,
        previous = performance.now();
      const draw = () => {
        const now = performance.now(),
          dt = Math.min(0.05, (now - previous) / 1000);
        previous = now;
        t += dt;

        const spectrum = spectrumRef.current?.() ?? null;
        for (let i = 0; i < bars; i++) {
          const phase = t * 0.7 + i * 0.55,
            idle =
              1.4 + 1.15 * Math.sin(phase) + 0.55 * Math.sin(phase * 2.3 + 1.3);
          let target = idle;
          if (spectrum && spectrum.length) {
            const band = spectrum[Math.floor((i / bars) * spectrum.length)];
            target = 0.5 + band * 4.4 + idle * 0.18;
          }
          const pillar = pillars[i],
            cap = caps[i];
          const height =
            pillar.scale.y + (Math.max(0.35, target) - pillar.scale.y) *
              Math.min(1, dt * 10);
          pillar.scale.y = height;
          pillar.position.y = height / 2;
          cap.position.y = height + 0.05;
          if (spectrum && spectrum.length)
            capMat.emissiveIntensity =
              1.4 + spectrum[Math.floor((i / bars) * spectrum.length)] * 3.2;
          else
            capMat.emissiveIntensity = visualizer
              ? 2.6 + Math.sin(phase) * 0.6
              : 1.8 + Math.sin(phase) * 0.35;
        }

        const sway = reduced ? 0 : Math.sin(t * 0.14) * 0.05;
        const targetY = dragY + sway + parallaxX * 0.16,
          targetX = dragX + parallaxY * 0.06;
        world.rotation.y += (targetY - world.rotation.y) * Math.min(1, dt * 6);
        world.rotation.x += (targetX - world.rotation.x) * Math.min(1, dt * 6);

        renderer.render(scene, camera);
        if (reduced) renderer.setAnimationLoop(null);
      };
      const intersection = new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          renderer.setAnimationLoop(visible && !disposed ? draw : null);
        },
        { threshold: 0.05 },
      );
      intersection.observe(element);
      renderer.setAnimationLoop(disposed ? null : draw);

      cleanup = () => {
        disposed = true;
        renderer.setAnimationLoop(null);
        observer.disconnect();
        intersection.disconnect();
        element.removeEventListener('pointermove', onPointerMove);
        element.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerUp);
        pillarGeo.dispose();
        capGeo.dispose();
        floor.geometry.dispose();
        (floor.material as THREE_NS.Material).dispose();
        pillarMat.dispose();
        capMat.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => cleanup?.();
  }, [variant]);

  return (
    <div
      ref={host}
      className={'scene-3d scene-3d-' + variant + (className ? ' ' + className : '')}
      role="img"
      aria-label={label || alt}
    >
      {failed &&
        (poster ? (
          <img src={poster} alt={alt} className="scene-3d-poster" />
        ) : null)}
    </div>
  );
}
