'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Canvas and fallback share one accessible image label. */
/* oxlint-disable next/no-img-element -- Optional local poster is a static failure fallback shared with Sites. */
import { useEffect, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import { sceneDistance, sceneLayout } from '@/lib/scene-layout';

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
  const host = useRef<HTMLDivElement>(null);
  const spectrumRef = useRef(getSpectrum);
  useEffect(() => {
    spectrumRef.current = getSpectrum;
  }, [getSpectrum]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    const releases: (() => void)[] = [];
    const cleanup = () => {
      disposed = true;
      for (const release of releases.splice(0).reverse()) release();
    };
    const fail = () => {
      if (disposed) return;
      cleanup();
      setReady(false);
      setFailed(true);
    };
    setReady(false);
    setFailed(false);

    void (async () => {
      const THREE: typeof THREE_NS = await import('three');
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      releases.push(() => {
        renderer.setAnimationLoop(null);
        renderer.dispose();
        renderer.domElement.remove();
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.domElement.className = 'scene-3d-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.style.touchAction = 'pan-y';
      element.appendChild(renderer.domElement);
      const onContextLost = (event: Event) => {
        event.preventDefault();
        fail();
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      releases.push(() =>
        renderer.domElement.removeEventListener(
          'webglcontextlost',
          onContextLost,
        ),
      );

      const visualizer = variant === 'visualizer';
      const layout = sceneLayout(variant);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
      const world = new THREE.Group();
      scene.add(world);
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x62484c,
        metalness: 0.4,
        roughness: 0.38,
      });
      const capMat = new THREE.MeshStandardMaterial({
        color: 0x9f1428,
        emissive: RED,
        emissiveIntensity: 1.5,
        roughness: 0.4,
      });
      const pillarGeo = new THREE.BoxGeometry(
        layout.barWidth,
        1,
        layout.barWidth,
      );
      const capGeo = new THREE.BoxGeometry(
        layout.capWidth,
        0.07,
        layout.capWidth,
      );
      releases.push(() => {
        pillarMat.dispose();
        capMat.dispose();
        pillarGeo.dispose();
        capGeo.dispose();
      });
      const pillars: THREE_NS.Mesh[] = [];
      const caps: THREE_NS.Mesh[] = [];
      for (let i = 0; i < layout.bars; i++) {
        const x = -layout.span / 2 + (layout.span / (layout.bars - 1)) * i;
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        const cap = new THREE.Mesh(capGeo, capMat);
        pillar.position.x = cap.position.x = x;
        pillars.push(pillar);
        caps.push(cap);
        world.add(pillar, cap);
      }
      const key = new THREE.DirectionalLight(0xffffff, 3.2);
      key.position.set(-4, 6, 5);
      const rim = new THREE.DirectionalLight(0xffb5bf, 2.2);
      rim.position.set(4, 3, -2);
      scene.add(key, rim, new THREE.AmbientLight(0xffffff, 1.3));

      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      let reduced = motion.matches;
      let visible = true;
      let t = 0;
      let previous = performance.now();
      let shown = false;
      let parallaxX = 0,
        parallaxY = 0,
        dragX = 0,
        dragY = 0;
      let dragging = false,
        lastX = 0,
        lastY = 0;
      const draw = (dt: number, immediate = false) => {
        if (disposed) return;
        try {
          t += dt;
          const spectrum = spectrumRef.current?.() ?? null;
          let peak = 0;
          for (let i = 0; i < layout.bars; i++) {
            const phase = t * 0.7 + i * 0.55;
            const idle = Math.max(
              0.35,
              1.4 + 1.15 * Math.sin(phase) + 0.55 * Math.sin(phase * 2.3 + 1.3),
            );
            const raw =
              spectrum?.[Math.floor((i / layout.bars) * spectrum.length)] ?? 0;
            const band = Number.isFinite(raw)
              ? Math.max(0, Math.min(1, raw))
              : 0;
            peak = Math.max(peak, band);
            const target = Math.min(
              layout.maxHeight,
              spectrum?.length ? 0.5 + band * 4.4 + idle * 0.18 : idle,
            );
            const pillar = pillars[i];
            const height = immediate
              ? target
              : pillar.scale.y +
                (target - pillar.scale.y) * Math.min(1, dt * 10);
            pillar.scale.y = height;
            pillar.position.y = height / 2;
            caps[i].position.y = height + 0.05;
          }
          capMat.emissiveIntensity = visualizer ? 1.5 + peak * 1.8 : 1.5;
          const targetY = reduced
            ? 0
            : dragY + Math.sin(t * 0.14) * 0.05 + parallaxX * 0.16;
          const targetX = reduced ? 0 : dragX + parallaxY * 0.06;
          world.rotation.y = immediate
            ? targetY
            : world.rotation.y +
              (targetY - world.rotation.y) * Math.min(1, dt * 6);
          world.rotation.x = immediate
            ? targetX
            : world.rotation.x +
              (targetX - world.rotation.x) * Math.min(1, dt * 6);
          renderer.render(scene, camera);
          if (!shown) {
            shown = true;
            setReady(true);
          }
        } catch {
          fail();
        }
      };
      const animate = () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - previous) / 1000);
        previous = now;
        draw(dt);
      };
      const updateLoop = () => {
        if (disposed) return;
        previous = performance.now();
        renderer.setAnimationLoop(visible && !reduced ? animate : null);
      };
      const resize = () => {
        if (disposed) return;
        try {
          const width = Math.max(1, element.clientWidth),
            height = Math.max(1, element.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          const distance = sceneDistance(
            camera.aspect,
            camera.fov,
            layout.span,
            layout.maxHeight,
          );
          camera.far = Math.max(100, distance + layout.span + layout.maxHeight);
          camera.position.set(
            0,
            layout.maxHeight / 2 + distance * 0.08,
            distance,
          );
          camera.lookAt(0, layout.maxHeight / 2, 0);
          camera.updateProjectionMatrix();
          draw(0, true);
        } catch {
          fail();
        }
      };
      const onMotion = () => {
        reduced = motion.matches;
        dragging = false;
        draw(0, true);
        updateLoop();
      };
      motion.addEventListener('change', onMotion);
      releases.push(() => motion.removeEventListener('change', onMotion));
      const onMove = (event: PointerEvent) => {
        if (reduced) return;
        const rect = element.getBoundingClientRect();
        if (dragging) {
          dragY = Math.max(
            -0.7,
            Math.min(0.7, dragY + (event.clientX - lastX) * 0.004),
          );
          dragX = Math.max(
            -0.18,
            Math.min(0.18, dragX + (event.clientY - lastY) * 0.002),
          );
          lastX = event.clientX;
          lastY = event.clientY;
        } else {
          parallaxX =
            ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
          parallaxY =
            ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
        }
      };
      const onDown = (event: PointerEvent) => {
        if (reduced) return;
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
      };
      const onUp = () => {
        dragging = false;
        parallaxX = parallaxY = 0;
      };
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerdown', onDown);
      element.addEventListener('pointerleave', onUp);
      window.addEventListener('pointerup', onUp);
      releases.push(() => {
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerdown', onDown);
        element.removeEventListener('pointerleave', onUp);
        window.removeEventListener('pointerup', onUp);
      });
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      releases.push(() => observer.disconnect());
      const intersection = new IntersectionObserver(
        (entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          updateLoop();
        },
        { threshold: 0.05 },
      );
      intersection.observe(element);
      releases.push(() => intersection.disconnect());
      resize();
      updateLoop();
    })().catch(fail);

    return cleanup;
  }, [variant]);

  return (
    <div
      ref={host}
      className={
        'scene-3d scene-3d-' + variant + (className ? ' ' + className : '')
      }
      role="img"
      aria-label={label || alt}
      data-scene-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}
    >
      {!ready &&
        (poster ? (
          <img src={poster} alt="" className="scene-3d-poster" />
        ) : (
          <svg
            className="scene-3d-poster"
            viewBox="0 0 320 180"
            aria-hidden="true"
          >
            {Array.from({ length: 24 }, (_, i) => {
              const height =
                24 +
                (1 + Math.sin(i * 0.55)) * 34 +
                12 * Math.sin(i * 1.1) ** 2;
              return (
                <g key={i}>
                  <rect
                    x={16 + i * 12}
                    y={150 - height}
                    width="8"
                    height={height}
                    rx="2"
                    fill="#62484c"
                  />
                  <rect
                    x={16 + i * 12}
                    y={150 - height}
                    width="8"
                    height="4"
                    rx="1"
                    fill="#ff2e43"
                  />
                </g>
              );
            })}
          </svg>
        ))}
    </div>
  );
}
